/**
 * Safe archive extraction (project-owned).
 *
 * Replaces WowUp's yauzl/adm-zip usage (AGENTS.md: reimplement with a
 * zip-slip guard). The format comes from the file's first bytes, never its
 * name. Zip is decoded in-process with fflate (MIT). RAR and 7z (WF-09:
 * addons hosted as a direct link are sometimes packed that way) are
 * unpacked by the host's 7-Zip or unrar, which SteamOS ships; the engine
 * carries no RAR decoder of its own (the UnRAR licence is not GPL-compatible).
 *
 * Guarantees:
 * - no archive entry can escape the destination (zip: lexical validation +
 *   joinWithin containment; host tools: they refuse `..`/absolute names,
 *   unrar skips links, and an extracted symlink rejects the whole archive)
 * - symlinks in zips are stored as data only
 * - `__MACOSX` and `._` junk removed
 * - never executes anything from the archive (the host tool only unpacks)
 */

import { unzip } from "fflate";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { joinWithin, isSafeArchiveEntryPath, createDirectory, removeDirectory } from "../fs/safe-fs";
import { InstallError } from "../errors";

export interface ExtractResult {
  /** Top-level directory names created (addon folders); top-level files are not listed. */
  topLevelDirs: string[];
  fileCount: number;
  totalBytes: number;
}

export type ArchiveFormat = "zip" | "rar" | "7z";

const SIGNATURES: Array<{ format: ArchiveFormat; bytes: number[] }> = [
  { format: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  // An empty zip is only an end-of-central-directory record.
  { format: "zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
  // RAR 1.5-4.x ("Rar!\x1a\x07\x00") and RAR 5+ ("Rar!\x1a\x07\x01\x00") share this prefix.
  { format: "rar", bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { format: "7z", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
];

const FORMAT_NAMES: Record<ArchiveFormat, string> = { zip: "zip", rar: "RAR", "7z": "7z" };

/** What the file is, from its first bytes; null when it is none of the formats we unpack. */
export function sniffArchiveFormat(head: Uint8Array): ArchiveFormat | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => head[i] === b))?.format ?? null;
}

/**
 * The archive's format from its first bytes, before any extraction: the
 * preview path (addons.inspectArchive) reports "not a supported archive"
 * as its own stable code instead of a failed extraction.
 */
export async function archiveFormatOf(path: string): Promise<ArchiveFormat | null> {
  return sniffArchiveFormat(await readHead(path));
}

interface HostTool {
  command: string;
  args: (archivePath: string, destinationDir: string) => string[];
}

// 7-Zip prints nothing (-bso0/-bsp0) and asks nothing (-y); stdin is closed,
// so a password prompt fails instead of waiting.
const sevenZip = (command: string): HostTool => ({
  command,
  args: (archive, dest) => ["x", "-y", "-bd", "-bso0", "-bsp0", `-o${dest}`, "--", archive],
});
// -p-: never ask for a password; -ol-: skip symbolic links.
const unrar: HostTool = {
  command: "unrar",
  args: (archive, dest) => ["x", "-y", "-idq", "-p-", "-ol-", "--", archive, `${dest}/`],
};

/**
 * Host tools per format, tried in order until one unpacks the archive: a
 * distribution's p7zip may be built without RAR support while unrar is there.
 * 7za is p7zip's standalone build, which never reads RAR. bsdtar is not used:
 * libarchive fails at the end of RAR 7 archives with a recovery record.
 */
const HOST_TOOLS: Record<Exclude<ArchiveFormat, "zip">, HostTool[]> = {
  rar: [sevenZip("7zz"), sevenZip("7z"), unrar],
  "7z": [sevenZip("7zz"), sevenZip("7z"), sevenZip("7za")],
};

const MISSING_TOOL_HINT: Record<Exclude<ArchiveFormat, "zip">, string> = {
  rar: "Install 7-Zip or unrar to unpack it",
  "7z": "Install 7-Zip to unpack it",
};

const HOST_TOOL_TIMEOUT_MS = 120_000;

async function readHead(path: string): Promise<Uint8Array> {
  const fh = await open(path, "r");
  try {
    const head = new Uint8Array(8);
    await fh.read(head, 0, head.length, 0);
    return head;
  } finally {
    await fh.close();
  }
}

/** Unpack an addon archive (zip, RAR or 7z) into `destinationDir`, which must not exist yet. */
export async function extractArchive(archivePath: string, destinationDir: string): Promise<ExtractResult> {
  const format = sniffArchiveFormat(await readHead(archivePath));
  if (format === null) {
    throw new InstallError("The archive isn't a zip, RAR or 7z archive");
  }
  if (format === "zip") {
    await extractZipInProcess(archivePath, destinationDir);
  } else {
    await extractWithHostTool(format, archivePath, destinationDir);
  }
  return inspectExtracted(destinationDir);
}

async function extractZipInProcess(zipPath: string, destinationDir: string): Promise<void> {
  const data = new Uint8Array(await Bun.file(zipPath).arrayBuffer());

  const entries = await new Promise<Map<string, Uint8Array>>((resolve, reject) => {
    const collected = new Map<string, Uint8Array>();
    unzip(data, (err, unzipped) => {
      if (err) {
        console.error(`[extract] zip is corrupt: ${err.message ?? String(err)}`);
        reject(new InstallError("The archive is damaged. Try again"));
        return;
      }
      for (const [path, content] of Object.entries(unzipped)) {
        collected.set(path, content);
      }
      resolve(collected);
    });
  });

  await createDirectory(destinationDir);
  for (const [entryPath, content] of entries) {
    if (entryPath.endsWith("/") || entryPath.endsWith("\\")) {
      continue;
    }
    if (!isSafeArchiveEntryPath(entryPath)) {
      console.error(`[extract] unsafe archive entry rejected: ${entryPath.replace(/[^\x20-\x7e]/g, "?")}`);
      throw new InstallError("The archive contains unsafe files and was rejected");
    }
    await Bun.write(joinWithin(destinationDir, ...entryPath.replace(/\\/g, "/").split("/")), content);
  }
}

async function extractWithHostTool(
  format: Exclude<ArchiveFormat, "zip">,
  archivePath: string,
  destinationDir: string,
): Promise<void> {
  const name = FORMAT_NAMES[format];
  const tools = HOST_TOOLS[format].flatMap((tool) => {
    const path = Bun.which(tool.command, { PATH: process.env.PATH ?? "" });
    return path ? [{ ...tool, path }] : [];
  });
  if (tools.length === 0) {
    throw new InstallError(`This addon is a ${name} archive. ${MISSING_TOOL_HINT[format]}`);
  }
  for (const tool of tools) {
    // Each attempt starts from an empty directory: a failed one may leave files.
    await removeDirectory(destinationDir);
    await createDirectory(destinationDir);
    const proc = Bun.spawn([tool.path, ...tool.args(archivePath, destinationDir)], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      timeout: HOST_TOOL_TIMEOUT_MS,
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (exitCode === 0) {
      return;
    }
    console.error(
      `[extract] ${tool.command} failed on a ${name} archive (exit ${exitCode}${proc.signalCode ? `, ${proc.signalCode}` : ""}): ${stderr.trim().slice(0, 500)}`,
    );
  }
  await removeDirectory(destinationDir);
  throw new InstallError(`Couldn't unpack the ${name} archive. It may be damaged or password-protected`);
}

function isJunk(name: string): boolean {
  return name === "__MACOSX" || name.startsWith("._");
}

/**
 * The extracted tree as installable content: junk removed, anything but
 * plain files and directories (a symlink, a device) rejects the archive.
 * Exported for the safety walk's own unit test.
 */
export async function inspectExtracted(destinationDir: string): Promise<ExtractResult> {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if (isJunk(name)) {
        await removeDirectory(path);
        continue;
      }
      const st = await lstat(path);
      if (st.isDirectory()) {
        await walk(path);
      } else if (st.isFile()) {
        fileCount += 1;
        totalBytes += st.size;
      } else {
        console.error(`[extract] archive entry is not a plain file: ${name.replace(/[^\x20-\x7e]/g, "?")}`);
        throw new InstallError("The archive contains unsafe files and was rejected");
      }
    }
  };
  await createDirectory(destinationDir);
  await walk(destinationDir);
  if (fileCount === 0) {
    throw new InstallError("The archive was empty");
  }
  const topLevelDirs: string[] = [];
  for (const entry of await readdir(destinationDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      topLevelDirs.push(entry.name);
    }
  }
  return { topLevelDirs, fileCount, totalBytes };
}
