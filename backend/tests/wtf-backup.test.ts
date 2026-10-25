import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { parseBackupMeta } from "../src/wow/wtf/BackupMeta";
import { WtfBackupError } from "../src/wow/wtf/errors";
import { WtfBackupService, type WtfTarget } from "../src/wow/wtf/WtfBackupService";
import { walkWtf } from "../src/wow/wtf/WtfWalker";
import { listZipEntries } from "../src/wow/wtf/ZipReader";
import { MAX_ZIP_ENTRIES, writeBackupZip } from "../src/wow/wtf/ZipWriter";

const FIXTURE = join(import.meta.dir, "fixtures/wtf/upstream-wowup-backup.zip");
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

let tmp: string;
let wtf: string;
let backupRoot: string;
let target: WtfTarget;

function write(rel: string, data: string | Uint8Array) {
  const p = join(wtf, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

/** A small but representative WTF tree (including an empty directory). */
function makeWtf() {
  write("Config.wtf", 'SET gxApi "D3D12"\n');
  write("Account/ACC1/SavedVariables/A.lua", "A = { 1, 2, 3 }\n");
  write("Account/ACC1/SavedVariables/A.lua.bak", "OLD\n");
  write("Account/ACC1/Realm/Char/SavedVariables/B.lua", "B = {}\n");
  write("Account/ACC1/Realm/Char/macros-cache.txt", "MACRO 1\n");
  mkdirSync(join(wtf, "Account/ACC1/EmptyDir"), { recursive: true });
}

function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      out.push(`${rel}/${name}:${st.isDirectory() ? "d" : `${st.size}:${sha(readFileSync(p))}:${st.mtimeMs}`}`);
      if (st.isDirectory()) walk(p, `${rel}/${name}`);
    }
  };
  walk(root, "");
  return out;
}

function service(overrides: Partial<ConstructorParameters<typeof WtfBackupService>[0]> = {}) {
  let t = 1_700_000_000_000;
  return new WtfBackupService({
    backupRoot: () => ({ path: backupRoot, custom: false }),
    now: () => (t += 1000),
    pluginVersion: () => "9.9.9",
    freeBytes: async () => 10 * 1024 ** 3,
    ...overrides,
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wtf-test-"));
  wtf = join(tmp, "game", "_retail_", "WTF");
  backupRoot = join(tmp, "backups");
  mkdirSync(wtf, { recursive: true });
  target = { wtfPath: wtf, flavor: "_retail_" };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("WtfWalker", () => {
  test("reports root-relative paths with leading slash, sorted, parents first", async () => {
    makeWtf();
    const r = await walkWtf(wtf);
    expect(r.entries.map((e) => e.rel)).toEqual([
      "/Account",
      "/Account/ACC1",
      "/Account/ACC1/EmptyDir",
      "/Account/ACC1/Realm",
      "/Account/ACC1/Realm/Char",
      "/Account/ACC1/Realm/Char/SavedVariables",
      "/Account/ACC1/Realm/Char/SavedVariables/B.lua",
      "/Account/ACC1/Realm/Char/macros-cache.txt",
      "/Account/ACC1/SavedVariables",
      "/Account/ACC1/SavedVariables/A.lua",
      "/Config.wtf",
    ]);
    expect(r.fileCount).toBe(4);
    expect(r.dirCount).toBe(7);
  });

  test("excludes .lua.bak by default, includes them when asked", async () => {
    makeWtf();
    expect((await walkWtf(wtf)).entries.some((e) => e.rel.endsWith(".bak"))).toBe(false);
    expect((await walkWtf(wtf, { excludeBak: false })).entries.some((e) => e.rel.endsWith(".bak"))).toBe(true);
  });

  test("never follows or lists symlinks, and skips a stray metadata file at the root", async () => {
    makeWtf();
    symlinkSync(tmp, join(wtf, "link-to-outside"));
    write("wowup-meta.json", "{}");
    const rels = (await walkWtf(wtf)).entries.map((e) => e.rel);
    expect(rels.some((r) => r.includes("link-to-outside"))).toBe(false);
    expect(rels).not.toContain("/wowup-meta.json");
  });
});

describe("createBackup", () => {
  test("writes a WowUp-compatible zip: root + every dir + every file in the metadata, explicit dir entries", async () => {
    makeWtf();
    const info = await service().createBackup(target, { kind: "manual" });
    expect(info.valid).toBe(true);
    expect(info.kind).toBe("manual");
    expect(info.flavor).toBe("_retail_");
    expect(info.fileCount).toBe(4);

    const zipPath = join(backupRoot, "_retail_", info.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const meta = parseBackupMeta(Buffer.from(unz["wowup-meta.json"]!).toString("utf8"));

    expect(meta.contents[0]).toEqual({ path: "", isDirectory: true, size: 0 });
    // Upstream's restore rule: meta entries (incl. root) === nodes found after extraction (root + dirs + files).
    const zipNames = Object.keys(unz).filter((n) => n !== "wowup-meta.json");
    expect(meta.contents.length).toBe(zipNames.length + 1);
    // Every directory has an explicit "dir/" zip entry (so empty dirs are recreated by upstream's extractor).
    for (const c of meta.contents.filter((c) => c.isDirectory && c.path !== "")) {
      expect(zipNames).toContain(`${c.path.slice(1)}/`);
    }
    // Hashes/sizes describe the actual bytes in the zip.
    for (const c of meta.contents.filter((c) => !c.isDirectory)) {
      const bytes = unz[c.path.slice(1)]!;
      expect(c.size).toBe(bytes.length);
      expect(c.hash).toBe(sha(bytes));
    }
    expect(meta.contents.some((c) => c.path.endsWith(".bak"))).toBe(false);
    expect(meta.wowupDecky).toEqual({ formatVersion: 1, flavor: "_retail_", deviceId: "local", pluginVersion: "9.9.9" });
  });

  test("only ever reads the source tree (no metadata file written into WTF, nothing changed)", async () => {
    makeWtf();
    const before = snapshotTree(wtf);
    await service().createBackup(target, { kind: "manual" });
    expect(snapshotTree(wtf)).toEqual(before);
    expect(existsSync(join(wtf, "wowup-meta.json"))).toBe(false);
  });

  test("a multi-chunk binary file round-trips byte for byte", async () => {
    const big = randomBytes(3 * 1024 * 1024 + 123);
    write("Account/ACC1/SavedVariables/Big.lua", big);
    const info = await service().createBackup(target, { kind: "manual" });
    const unz = unzipSync(new Uint8Array(readFileSync(join(backupRoot, "_retail_", info.fileName))));
    expect(sha(unz["Account/ACC1/SavedVariables/Big.lua"]!)).toBe(sha(big));
  });

  test("preserves modification times (DOS resolution)", async () => {
    write("Config.wtf", "x");
    const when = new Date("2024-03-05T10:20:30Z");
    utimesSync(join(wtf, "Config.wtf"), when, when);
    const info = await service().createBackup(target, { kind: "manual" });
    const entries = await listZipEntries(join(backupRoot, "_retail_", info.fileName));
    expect(entries.find((e) => e.name === "Config.wtf")).toBeDefined();
  });

  test("no WTF folder -> wtf_missing", async () => {
    rmSync(wtf, { recursive: true });
    await expect(service().createBackup(target, { kind: "manual" })).rejects.toMatchObject({ code: "wtf_missing" });
  });

  test("unavailable custom backup folder -> backup_dir_unavailable and nothing is created", async () => {
    makeWtf();
    const gone = join(tmp, "media", "sdcard", "backups");
    const s = service({ backupRoot: () => ({ path: gone, custom: true }) });
    await expect(s.createBackup(target, { kind: "manual" })).rejects.toMatchObject({ code: "backup_dir_unavailable" });
    expect(existsSync(join(tmp, "media"))).toBe(false);
    const listed = await s.listBackups(target);
    expect(listed.dirAvailable).toBe(false);
    expect(listed.backups).toEqual([]);
  });

  test("not enough free space -> insufficient_space, nothing written", async () => {
    makeWtf();
    const s = service({ freeBytes: async () => 1024 });
    await expect(s.createBackup(target, { kind: "manual" })).rejects.toMatchObject({ code: "insufficient_space" });
    expect(readdirSync(join(backupRoot, "_retail_"))).toEqual([]);
  });

  test("cancelling leaves neither a partial nor a final file", async () => {
    write("a/one.bin", randomBytes(2 * 1024 * 1024));
    write("a/two.bin", randomBytes(2 * 1024 * 1024));
    const ac = new AbortController();
    const p = service().createBackup(target, {
      kind: "manual",
      signal: ac.signal,
      onProgress: (phase) => {
        if (phase === "compress") ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    expect(readdirSync(join(backupRoot, "_retail_"))).toEqual([]);
  });

  test("too many entries -> wtf_too_large before touching the disk", async () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRIES }, (_, i) => ({
      rel: `/f${i}`,
      abs: join(tmp, "nope"),
      isDirectory: false,
      size: 1,
      mtimeMs: 0,
    }));
    const out = join(tmp, "x.zip");
    await expect(
      writeBackupZip({ outPath: out, entries, totalBytes: 0, buildMeta: () => ({ createdBy: "manual", createdAt: 1, contents: [] }) }),
    ).rejects.toBeInstanceOf(WtfBackupError);
    expect(existsSync(out)).toBe(false);
  });

  test("keeps the event loop responsive while backing up a larger tree", async () => {
    for (let i = 0; i < 40; i++) write(`Account/A/SavedVariables/f${i}.lua`, "x = {}\n".repeat(150_000));
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);
    await service().createBackup(target, { kind: "manual" });
    clearInterval(timer);
    expect(maxGap).toBeLessThan(400); // loose: guards against a regression to one long synchronous block
  });
});

describe("listBackups / deleteBackup", () => {
  test("lists newest first with kind, flavor and file count; ignores non-zips and partials", async () => {
    makeWtf();
    const s = service();
    const a = await s.createBackup(target, { kind: "manual" });
    const b = await s.createBackup(target, { kind: "pre-restore" });
    writeFileSync(join(backupRoot, "_retail_", "notes.txt"), "hi");
    writeFileSync(join(backupRoot, "_retail_", `wtf_5.zip.partial`), "half");
    const listed = await s.listBackups(target);
    expect(listed.dirAvailable).toBe(true);
    expect(listed.backups.map((x) => x.fileName)).toEqual([b.fileName, a.fileName]);
    expect(listed.backups.map((x) => x.kind)).toEqual(["pre-restore", "manual"]);
    expect(listed.totalBackupBytes).toBe(a.sizeBytes + b.sizeBytes);
  });

  test("flavors are separate lists", async () => {
    makeWtf();
    const s = service();
    await s.createBackup(target, { kind: "manual" });
    expect((await s.listBackups({ ...target, flavor: "_classic_era_" })).backups).toEqual([]);
  });

  test("a corrupt zip is listed as invalid with a reason, never crashes the list", async () => {
    mkdirSync(join(backupRoot, "_retail_"), { recursive: true });
    writeFileSync(join(backupRoot, "_retail_", "wtf_1.zip"), "this is not a zip file at all, but long enough");
    const listed = await service().listBackups(target);
    expect(listed.backups).toHaveLength(1);
    expect(listed.backups[0]!.valid).toBe(false);
    expect(listed.backups[0]!.invalidReason).toBeTruthy();
  });

  test("a backup made by desktop WowUp is valid, kind manual, flavor unknown", async () => {
    mkdirSync(join(backupRoot, "_retail_"), { recursive: true });
    copyFileSync(FIXTURE, join(backupRoot, "_retail_", "wtf_1700000000000.zip"));
    const [info] = (await service().listBackups(target)).backups;
    expect(info).toMatchObject({ valid: true, kind: "manual", flavor: null, fileCount: 3 });
  });

  test("delete removes the file and refuses anything that is not a bare zip name", async () => {
    makeWtf();
    const s = service();
    const a = await s.createBackup(target, { kind: "manual" });
    for (const bad of ["../x.zip", "sub/x.zip", "..\\x.zip", ".hidden.zip", "notes.txt", "wtf_1.zip.partial", ""]) {
      await expect(s.deleteBackup(target, bad)).rejects.toBeInstanceOf(WtfBackupError);
    }
    await s.deleteBackup(target, a.fileName);
    expect((await s.listBackups(target)).backups).toEqual([]);
    await expect(s.deleteBackup(target, a.fileName)).rejects.toMatchObject({ code: "not_found" });
  });

  test("readMeta accepts upstream metadata and rejects malformed metadata", async () => {
    const meta = await service().readMeta(FIXTURE);
    expect(meta.createdBy).toBe("manual");
    expect(meta.contents[0]).toMatchObject({ path: "", isDirectory: true });
    expect(meta.contents.length).toBe(11); // root + 7 dirs + 3 files, as written by upstream
    expect(() => parseBackupMeta("{}")).toThrow(WtfBackupError);
    expect(() => parseBackupMeta("not json")).toThrow(WtfBackupError);
    expect(() => parseBackupMeta(JSON.stringify({ createdBy: "x", createdAt: 1, contents: [{ path: 1 }] }))).toThrow(WtfBackupError);
  });
});
