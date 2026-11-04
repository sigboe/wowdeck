/**
 * Content evidence of one AddOns location, for addon transaction recovery
 * (ADR 0006): whether something is there and, for a folder, a digest over
 * every entry's relative path, kind and bytes. A path, a folder's identity
 * or its TOC version can't tell an edited file from the original; this can.
 * Reading every byte is the cost the owner accepted.
 *
 * Not WowUp's fingerprint (FingerprintScanner): that one matches releases
 * on providers and skips files; this one must notice any change.
 */

import { lstat, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { StageFs } from "../fs/StageFs";

export type FolderEvidence =
  | { kind: "absent" }
  | {
      kind: "folder";
      /** "sha256:<hex>" over the sorted entry list (see `folderEvidence`). */
      digest: string;
      files: number;
      bytes: number;
    };

/**
 * Evidence of `path`. A folder is digested entry by entry in sorted order:
 * `D <rel>` for a folder, `F <rel> <size> <sha256>` for a file, `L <rel>
 * <target>` for a link inside it (not followed). Throws when something
 * can't be read, or when `path` itself is not a plain folder: that is no
 * evidence, and a transaction must not go ahead without it.
 *
 * `mounts` (recovery, #108) digests a folder some of whose entries are
 * elsewhere now: each `rel` → path stands in at that place inside `path`,
 * as if it had been moved back. An entry already at a mounted place is
 * not the original: that throws too.
 */
export async function folderEvidence(
  fs: StageFs,
  path: string,
  mounts: Readonly<Record<string, string>> = {},
): Promise<FolderEvidence> {
  const top = await lstat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return null;
    }
    throw err;
  });
  if (!top) {
    return { kind: "absent" };
  }
  if (!top.isDirectory()) {
    throw new Error(`Not a plain folder: ${path}`);
  }
  const mounted = Object.keys(mounts);
  const digest = new Bun.CryptoHasher("sha256");
  let files = 0;
  let bytes = 0;
  const walk = async (dir: string, rel: string): Promise<void> => {
    const here = await readdir(dir);
    const extra = mounted
      .filter((m) => (rel ? m.startsWith(`${rel}/`) : true) && !m.slice(rel ? rel.length + 1 : 0).includes("/"))
      .map((m) => m.slice(rel ? rel.length + 1 : 0));
    for (const name of extra) {
      if (here.includes(name)) {
        throw new Error(`Not the original: ${join(dir, name)}`);
      }
    }
    for (const name of [...here, ...extra].sort()) {
      const relPath = rel ? `${rel}/${name}` : name;
      const full = mounts[relPath] ?? join(dir, name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        digest.update(`L ${relPath} ${await readlink(full)}\n`);
      } else if (info.isDirectory()) {
        digest.update(`D ${relPath}\n`);
        await walk(full, relPath);
      } else if (info.isFile()) {
        const content = await fs.readFile("evidence.read", full);
        digest.update(`F ${relPath} ${content.length} ${new Bun.CryptoHasher("sha256").update(content).digest("hex")}\n`);
        files += 1;
        bytes += content.length;
      } else {
        throw new Error(`Not a file or folder: ${full}`);
      }
    }
  };
  await walk(path, "");
  return { kind: "folder", digest: `sha256:${digest.digest("hex")}`, files, bytes };
}

/** Whether two evidences describe the same content. */
export function sameEvidence(a: FolderEvidence, b: FolderEvidence): boolean {
  return a.kind === "absent" ? b.kind === "absent" : b.kind === "folder" && a.digest === b.digest;
}
