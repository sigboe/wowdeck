/**
 * A release archive's lifetime: acquired (downloaded, or a picked file
 * copied in), read (hash, inspection, where it installs), then disposed.
 * Local files and a fake network only.
 */

import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReleaseArchives } from "../src/wow/archives/ReleaseArchive";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { NetworkClient } from "../src/wow/net/network";
import { NetworkError } from "../src/wow/net/network";
import { FileProvider } from "../src/wow/providers/file/FileProvider";
import { ZipProvider } from "../src/wow/providers/zip/ZipProvider";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/release-archive";

const release = (version: string) =>
  zipSync({ "Foo/Foo.toc": new TextEncoder().encode(`## Interface: 110005\n## Title: Foo Addon\n## Version: ${version}\n`) });

function fixture(dir: string, served: Record<string, Uint8Array> = {}) {
  const root = join(ROOT, dir);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "picked"), { recursive: true });
  const net = {
    downloadToFile: async (url: string, dest: string) => {
      const bytes = served[url];
      if (!bytes) {
        throw new NetworkError("HTTP 404", 404, url);
      }
      writeFileSync(dest, bytes);
      return bytes.length;
    },
  } as unknown as NetworkClient;
  const downloads = join(root, "dl");
  const inspect = join(root, "inspect");
  return {
    archives: new ReleaseArchives(new DownloadService(net, downloads), inspect),
    pick: (name: string, bytes: Uint8Array) => {
      writeFileSync(join(root, "picked", name), bytes);
      return join(root, "picked", name);
    },
    /** What the archives left on disk: downloads and inspection directories. */
    leftovers: () => [downloads, inspect].flatMap((d) => (existsSync(d) ? readdirSync(d) : [])),
  };
}

describe("ReleaseArchives", () => {
  test("two archives held at once each keep their own file", async () => {
    const f = fixture("two", { "https://example.org/Foo-1.2.zip": release("1.2") });
    const picked = await f.archives.acquire(new FileProvider(), f.pick("Foo-1.3.zip", release("1.3")));
    const linked = await f.archives.acquire(new ZipProvider(), "https://example.org/Foo-1.2.zip");
    expect((await picked.inspect(WowClientType.Retail)).version).toBe("1.3");
    expect((await linked.inspect(WowClientType.Retail)).version).toBe("1.2");
    expect(await picked.hash()).not.toBe(await linked.hash());
  });

  test("a picked file keeps its own name, for the preview", async () => {
    const f = fixture("name");
    const archive = await f.archives.acquire(new FileProvider(), f.pick("Foo-1.3.zip", release("1.3")));
    expect((await archive.inspect(WowClientType.Retail)).fileName).toBe("Foo-1.3.zip");
  });

  test("dispose removes everything the archive left, and a second dispose is harmless", async () => {
    const f = fixture("dispose");
    const archive = await f.archives.acquire(new FileProvider(), f.pick("Foo.zip", release("1.0")));
    await archive.inspect(WowClientType.Retail);
    await archive.hash();
    expect(f.leftovers()).not.toEqual([]);
    await archive.dispose();
    await archive.dispose();
    expect(f.leftovers()).toEqual([]);
  });

  test("disposing one archive leaves the other one held", async () => {
    const f = fixture("dispose-one");
    const a = await f.archives.acquire(new FileProvider(), f.pick("A.zip", release("1.0")));
    const b = await f.archives.acquire(new FileProvider(), f.pick("B.zip", release("2.0")));
    await a.dispose();
    expect((await b.inspect(WowClientType.Retail)).version).toBe("2.0");
  });

  test("a failed download or copy leaves nothing behind", async () => {
    const f = fixture("failed");
    await expect(f.archives.acquire(new ZipProvider(), "https://example.org/gone.zip")).rejects.toThrow();
    await expect(f.archives.acquire(new FileProvider(), join(ROOT, "failed", "picked", "missing.zip"))).rejects.toThrow(/missing/i);
    expect(f.leftovers()).toEqual([]);
  });

  test("an archive that is no addon matches by its id alone", async () => {
    const f = fixture("unreadable");
    const archive = await f.archives.acquire(new FileProvider(), f.pick("Junk.zip", new TextEncoder().encode("not a zip")));
    expect(await archive.target([], "File", "/picked/Junk.zip", WowClientType.Retail)).toEqual({ kind: "new" });
    await archive.dispose();
    expect(f.leftovers()).toEqual([]);
  });

  test("leftovers from an engine that stopped mid-download are removed at start", () => {
    const stale = join(ROOT, "stale", "dl", "old");
    rmSync(join(ROOT, "stale"), { recursive: true, force: true });
    mkdirSync(stale, { recursive: true });
    new DownloadService({} as NetworkClient, join(ROOT, "stale", "dl"));
    expect(existsSync(stale)).toBe(false);
  });
});
