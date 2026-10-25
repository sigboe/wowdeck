import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { rmSync, mkdirSync, existsSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  extractArchive,
  inspectExtracted,
  sniffArchiveFormat,
} from "../src/wow/archives/ArchiveExtractor";

const TMP = "/tmp/opencode/wowdeck-tests/extract";
const FIXTURES = join(import.meta.dir, "fixtures", "archives");

function writeZip(path: string, files: Record<string, Uint8Array>): void {
  const zipped = zipSync(files);
  writeFileSync(path, Buffer.from(zipped));
}

/** Runs `fn` with PATH set to `path`; restored afterwards. */
async function withPath<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}

// RAR and 7z need the host's 7-Zip or unrar (`make test` provides 7zz). A
// 7-Zip built without the unfree RAR codec (nixpkgs' _7zz, Debian's 7zip)
// lists RAR archives but can't unpack them: it doesn't count.
const sevenZipReadsRar = (c: string) =>
  !!Bun.which(c) && /\b40305 Rar5\b/.test(Bun.spawnSync([c, "i"], { stderr: "ignore" }).stdout.toString()); // the codec, not just the format
const hasRarTool = !!Bun.which("unrar") || ["7zz", "7z"].some(sevenZipReadsRar);
const has7zTool = ["7zz", "7z", "7za"].some((c) => Bun.which(c));

describe("ArchiveExtractor", () => {
  test("extracts a normal addon zip", async () => {
    const dest = join(TMP, "normal");
    const zipPath = join(TMP, "normal.zip");
    writeZip(zipPath, {
      "Foo/Foo.toc": new TextEncoder().encode("## Title: Foo\n## Version: 1\n"),
      "Foo/Foo.lua": new TextEncoder().encode("print(1)\n"),
      "FooLib/FooLib.toc": new TextEncoder().encode("## Title: FooLib\n## Version: 1\n"),
      "__MACOSX/Foo/._Foo.toc": new TextEncoder().encode("junk"),
    });
    const result = await extractArchive(zipPath, dest);
    expect(result.topLevelDirs.sort()).toEqual(["Foo", "FooLib"]);
    expect(result.fileCount).toBe(3); // __MACOSX junk skipped
    expect(existsSync(join(dest, "Foo", "Foo.toc"))).toBe(true);
    expect(existsSync(join(dest, "FooLib", "FooLib.toc"))).toBe(true);
    expect(existsSync(join(dest, "__MACOSX"))).toBe(false);
  });

  test("a file next to the addon folders is not an addon folder", async () => {
    const dest = join(TMP, "toplevel-file");
    const zipPath = join(TMP, "toplevel-file.zip");
    writeZip(zipPath, {
      "README.txt": new TextEncoder().encode("install me"),
      "Foo/Foo.toc": new TextEncoder().encode("## Title: Foo\n"),
    });
    const result = await extractArchive(zipPath, dest);
    expect(result.topLevelDirs).toEqual(["Foo"]);
  });

  test("rejects zip-slip traversal entries", async () => {
    const dest = join(TMP, "slip");
    const zipPath = join(TMP, "slip.zip");
    writeZip(zipPath, {
      "Foo/Foo.toc": new TextEncoder().encode("## X: 1\n"),
      "Foo/../../evil.lua": new TextEncoder().encode("pwned"),
    });
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/unsafe files/);
    expect(existsSync(join(TMP, "evil.lua"))).toBe(false);
  });

  test("rejects absolute path entries", async () => {
    const dest = join(TMP, "abs");
    const zipPath = join(TMP, "abs.zip");
    writeZip(zipPath, { "/etc/pwned": new TextEncoder().encode("x") });
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/unsafe files/);
  });

  test("a damaged zip says so", async () => {
    const dest = join(TMP, "corrupt");
    const zipPath = join(TMP, "corrupt.zip");
    writeFileSync(zipPath, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("truncated")]));
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
  });

  test("a download that is no archive at all (a web page) says so, not 'damaged'", async () => {
    const dest = join(TMP, "html");
    const path = join(TMP, "page.zip");
    writeFileSync(path, "<!doctype html><title>Download</title>");
    await expect(extractArchive(path, dest)).rejects.toThrow(/isn't a zip, RAR or 7z archive/);
  });

  test("rejects empty archives", async () => {
    const dest = join(TMP, "empty");
    const zipPath = join(TMP, "empty.zip");
    writeZip(zipPath, { "dir/": new Uint8Array(0) });
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/was empty/);
  });

  test("the format comes from the first bytes", () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    expect(sniffArchiveFormat(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("zip");
    expect(sniffArchiveFormat(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00))).toBe("rar");
    expect(sniffArchiveFormat(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00))).toBe("rar");
    expect(sniffArchiveFormat(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))).toBe("7z");
    expect(sniffArchiveFormat(bytes(0x1f, 0x8b, 0x08))).toBeNull();
  });

  test("a RAR without 7-Zip or unrar on the system names what to install", async () => {
    const empty = join(TMP, "no-tools");
    mkdirSync(empty, { recursive: true });
    await withPath(empty, async () => {
      await expect(extractArchive(join(FIXTURES, "rar5-addon.rar"), join(TMP, "rar-no-tool"))).rejects.toThrow(
        /a RAR archive\. Install 7-Zip or unrar/,
      );
    });
  });

  test.skipIf(!hasRarTool)("extracts a solid RAR5 archive with the host's tool", async () => {
    const dest = join(TMP, "rar");
    const result = await extractArchive(join(FIXTURES, "rar5-addon.rar"), dest);
    expect(result.topLevelDirs).toEqual(["RXPLite"]);
    expect(result.fileCount).toBe(5);
    expect(existsSync(join(dest, "RXPLite", "RXPLite.toc"))).toBe(true);
    expect(existsSync(join(dest, "RXPLite", "libs", "HereBeDragons", "HereBeDragons.toc"))).toBe(true);
  });

  test.skipIf(!hasRarTool)("falls through to the next tool when one can't unpack it", async () => {
    // A 7zz that fails, as a p7zip built without RAR support does.
    const fake = join(TMP, "fake-tools");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "7zz"), "#!/bin/sh\necho 'Can not open the file as archive' >&2\nexit 2\n");
    chmodSync(join(fake, "7zz"), 0o755);
    const dest = join(TMP, "rar-fallback");
    const result = await withPath(`${fake}:${process.env.PATH}`, () =>
      extractArchive(join(FIXTURES, "rar5-addon.rar"), dest),
    );
    expect(result.topLevelDirs).toEqual(["RXPLite"]);
  });

  test("every tool failing is a clear error, and leaves nothing behind", async () => {
    const fake = join(TMP, "failing-tools");
    mkdirSync(fake, { recursive: true });
    for (const name of ["7zz", "7z", "unrar"]) {
      writeFileSync(join(fake, name), "#!/bin/sh\nexit 2\n");
      chmodSync(join(fake, name), 0o755);
    }
    const dest = join(TMP, "rar-all-fail");
    await withPath(fake, async () => {
      await expect(extractArchive(join(FIXTURES, "rar5-addon.rar"), dest)).rejects.toThrow(
        /Couldn't unpack the RAR archive/,
      );
    });
    expect(existsSync(dest)).toBe(false);
  });

  test.skipIf(!has7zTool)("extracts a 7z archive with the host's tool", async () => {
    const dest = join(TMP, "7z");
    const result = await extractArchive(join(FIXTURES, "addon.7z"), dest);
    expect(result.topLevelDirs).toEqual(["RXPLite"]);
    expect(result.fileCount).toBe(5);
  });

  test.skipIf(!has7zTool)("rejects an archive whose extraction creates a symbolic link", async () => {
    const dest = join(TMP, "symlink");
    // A 7-Zip that creates the link hits our own walk ("unsafe files"); the
    // p7zip on CI runners refuses it earlier ("Dangerous link path was
    // ignored", exit 2). Both reject the archive, which is what matters; the
    // walk itself is pinned by the test below.
    await expect(extractArchive(join(FIXTURES, "symlink.7z"), dest)).rejects.toThrow(
      /unsafe files|Couldn't unpack the 7z archive/,
    );
  });

  test("the extracted tree rejects a symbolic link it contains", async () => {
    const dest = join(TMP, "symlinked-tree");
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(dest, "Evil"), { recursive: true });
    writeFileSync(join(dest, "Evil", "Evil.toc"), "## Title: Evil\n");
    symlinkSync("/tmp", join(dest, "Evil", "escape"));
    await expect(inspectExtracted(dest)).rejects.toThrow(/unsafe files/);
  });
});

// clean once at start
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
