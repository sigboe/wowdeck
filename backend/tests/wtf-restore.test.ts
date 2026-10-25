import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { detectGameRunning, type ProcReader } from "../src/wow/wtf/GameProcessGuard";
import { WtfBackupError } from "../src/wow/wtf/errors";
import { WtfBackupService, type WtfTarget } from "../src/wow/wtf/WtfBackupService";

const FIXTURE = join(import.meta.dir, "fixtures/wtf/upstream-wowup-backup.zip");
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

let tmp: string;
let flavor: string;
let wtf: string;
let backupRoot: string;
let target: WtfTarget;

function write(rel: string, data: string | Uint8Array) {
  const p = join(wtf, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

/** path -> content hash ("d" for directories); `.bak` files ignored because backups exclude them. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        out[`${rel}/${name}`] = "d";
        walk(p, `${rel}/${name}`);
      } else if (!name.endsWith(".lua.bak")) {
        out[`${rel}/${name}`] = sha(readFileSync(p));
      }
    }
  };
  walk(root, "");
  return out;
}

function makeWtf() {
  write("Config.wtf", 'SET gxApi "D3D12"\n');
  write("Account/ACC1/SavedVariables/A.lua", "A = { 1, 2, 3 }\n");
  write("Account/ACC1/SavedVariables/A.lua.bak", "OLD\n");
  write("Account/ACC1/Realm/Char/SavedVariables/B.lua", "B = {}\n");
  mkdirSync(join(wtf, "Account/ACC1/EmptyDir"), { recursive: true });
}

function service(over: Partial<ConstructorParameters<typeof WtfBackupService>[0]> = {}) {
  let t = 1_700_000_000_000;
  return new WtfBackupService({
    backupRoot: () => ({ path: backupRoot, custom: false }),
    now: () => (t += 1000),
    freeBytes: async () => 10 * 1024 ** 3,
    gameStatus: async () => "not_running",
    ...over,
  });
}

const backupDir = () => join(backupRoot, "_retail_");
const zipsIn = () => (existsSync(backupDir()) ? readdirSync(backupDir()).filter((n) => n.endsWith(".zip")) : []);
const flavorEntries = () => readdirSync(flavor).sort();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wtf-restore-"));
  flavor = join(tmp, "game", "_retail_");
  wtf = join(flavor, "WTF");
  backupRoot = join(tmp, "backups");
  mkdirSync(wtf, { recursive: true });
  target = { wtfPath: wtf, flavor: "_retail_" };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("restore round trip", () => {
  test("restores the backed-up tree exactly (empty dirs included) and takes a pre-restore safety snapshot", async () => {
    makeWtf();
    const original = tree(wtf);
    const s = service();
    const backup = await s.createBackup(target, { kind: "manual" });

    // the user changes things afterwards
    write("Account/ACC1/SavedVariables/A.lua", "A = { 9 }\n");
    write("Account/ACC1/SavedVariables/New.lua", "N = 1\n");
    rmSync(join(wtf, "Account/ACC1/Realm"), { recursive: true });
    const changed = tree(wtf);
    expect(changed).not.toEqual(original);

    const result = await s.restoreBackup(target, backup.fileName);
    expect(tree(wtf)).toEqual(original);
    expect(result.snapshotFileName).toBeTruthy();
    expect(flavorEntries()).toEqual(["WTF"]); // no staging / old dirs left

    // undo: restoring the safety snapshot brings back the pre-restore state
    await s.restoreBackup(target, result.snapshotFileName!);
    expect(tree(wtf)).toEqual(changed);
  });

  test("restores into a flavor dir with no WTF yet (no snapshot)", async () => {
    makeWtf();
    const original = tree(wtf);
    const s = service();
    const backup = await s.createBackup(target, { kind: "manual" });
    rmSync(wtf, { recursive: true });
    const result = await s.restoreBackup(target, backup.fileName);
    expect(result.snapshotFileName).toBeNull();
    expect(tree(wtf)).toEqual(original);
  });

  test("restores a backup made by desktop WowUp, only after the unknown-flavor confirmation", async () => {
    mkdirSync(backupDir(), { recursive: true });
    copyFileSync(FIXTURE, join(backupDir(), "wtf_1700000000000.zip"));
    const s = service();
    await expect(s.restoreBackup(target, "wtf_1700000000000.zip")).rejects.toMatchObject({ code: "flavor_unknown_needs_confirm" });
    expect(existsSync(join(wtf, "Config.wtf"))).toBe(false);

    await s.restoreBackup(target, "wtf_1700000000000.zip", { acceptUnknownFlavor: true });
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "D3D12"\n');
    expect(readFileSync(join(wtf, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe("A={}\n");
    expect(existsSync(join(wtf, "Account/ACC1/EmptyDir"))).toBe(true);
    expect(existsSync(join(wtf, "wowup-meta.json"))).toBe(false);
  });

  test("a backup for another flavor is refused", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    mkdirSync(join(backupRoot, "_classic_era_"), { recursive: true });
    copyFileSync(join(backupDir(), b.fileName), join(backupRoot, "_classic_era_", b.fileName));
    await expect(s.restoreBackup({ ...target, flavor: "_classic_era_" }, b.fileName)).rejects.toMatchObject({ code: "flavor_mismatch" });
  });

  test("keepCurrentConfig keeps this device's Config.wtf", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    write("Config.wtf", 'SET gxApi "VULKAN"\n');
    await s.restoreBackup(target, b.fileName, { keepCurrentConfig: true });
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "VULKAN"\n');
    expect(readFileSync(join(wtf, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe("A = { 1, 2, 3 }\n");
  });
});

describe("keepCurrentConfig / Config.wtf", () => {
  test("backups report whether they contain a Config.wtf and whether keeping this device's is suggested", async () => {
    makeWtf();
    const s = service();
    const own = await s.createBackup(target, { kind: "manual" });
    expect(own).toMatchObject({ hasConfig: true, fromThisDevice: true, keepConfigSuggested: false });
    mkdirSync(backupDir(), { recursive: true });
    copyFileSync(FIXTURE, join(backupDir(), "wtf_1.zip"));
    const foreign = (await s.listBackups(target)).backups.find((b) => b.fileName === "wtf_1.zip")!;
    expect(foreign).toMatchObject({ hasConfig: true, fromThisDevice: false, keepConfigSuggested: true });
    rmSync(join(wtf, "Config.wtf"));
    const noConfig = await s.createBackup(target, { kind: "manual" });
    expect(noConfig.hasConfig).toBe(false);
  });

  test("a backup made by another plugin install is 'another computer'; the same install recognises its own", async () => {
    makeWtf();
    const a = service({ deviceId: () => "device-a" });
    const made = await a.createBackup(target, { kind: "manual" });
    expect(made).toMatchObject({ fromThisDevice: true, keepConfigSuggested: false, flavor: "_retail_" });

    const b = service({ deviceId: () => "device-b" });
    const seenByB = (await b.listBackups(target)).backups.find((x) => x.fileName === made.fileName)!;
    expect(seenByB).toMatchObject({ fromThisDevice: false, keepConfigSuggested: true, flavor: "_retail_", valid: true });
    // same flavor => no unknown-flavor confirmation needed, it restores normally
    await b.restoreBackup(target, made.fileName);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "D3D12"\n');
  });

  test("a backup with no device id (older or hand-made) is treated as another computer", async () => {
    makeWtf();
    const a = service({ deviceId: () => "device-a" });
    const made = await a.createBackup(target, { kind: "manual" });
    const zipPath = join(backupDir(), made.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const meta = JSON.parse(Buffer.from(unz["wowup-meta.json"]!).toString("utf8"));
    delete meta.wowupDecky.deviceId;
    unz["wowup-meta.json"] = new TextEncoder().encode(JSON.stringify(meta));
    writeFileSync(zipPath, zipSync(unz));
    const seen = (await service({ deviceId: () => "device-a" }).listBackups(target)).backups[0]!;
    expect(seen).toMatchObject({ fromThisDevice: false, keepConfigSuggested: true });
  });

  test("keeping the current Config.wtf when the backup has none leaves it in place", async () => {
    write("Account/ACC1/SavedVariables/A.lua", "A");
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" }); // no Config.wtf in the backup
    write("Config.wtf", 'SET gxApi "VULKAN"\n');
    await s.restoreBackup(target, b.fileName, { keepCurrentConfig: true });
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "VULKAN"\n');
    write("Config.wtf", "x");
    await s.restoreBackup(target, b.fileName, { keepCurrentConfig: false });
    expect(existsSync(join(wtf, "Config.wtf"))).toBe(false); // the backup had none, so a plain restore has none either
  });

  test("keeping the current Config.wtf when this device has none restores the backup's instead of leaving it without", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    rmSync(join(wtf, "Config.wtf"));
    await s.restoreBackup(target, b.fileName, { keepCurrentConfig: true });
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "D3D12"\n');
  });

  test("keeping the current Config.wtf never touches the other restored files", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    write("Config.wtf", "device");
    write("Account/ACC1/SavedVariables/A.lua", "changed");
    await s.restoreBackup(target, b.fileName, { keepCurrentConfig: true });
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe("device");
    expect(readFileSync(join(wtf, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe("A = { 1, 2, 3 }\n");
  });
});

describe("restore safety", () => {
  test("refuses while WoW is running: nothing changes, no snapshot", async () => {
    makeWtf();
    const b = await service().createBackup(target, { kind: "manual" });
    write("Config.wtf", "changed");
    const before = tree(wtf);
    const s = service({ gameStatus: async () => "running" });
    await expect(s.restoreBackup(target, b.fileName)).rejects.toMatchObject({ code: "game_running" });
    expect(tree(wtf)).toEqual(before);
    expect(zipsIn()).toHaveLength(1);
  });

  test("not enough space -> insufficient_space, nothing changes", async () => {
    makeWtf();
    const b = await service().createBackup(target, { kind: "manual" });
    const before = tree(wtf);
    await expect(service({ freeBytes: async () => 10 }).restoreBackup(target, b.fileName)).rejects.toMatchObject({ code: "insufficient_space" });
    expect(tree(wtf)).toEqual(before);
  });

  test("a checksum mismatch aborts, leaves WTF byte-identical and removes the staging dir", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    // corrupt: change a file's bytes inside the zip but keep the metadata
    const zipPath = join(backupDir(), b.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    unz["Config.wtf"] = new TextEncoder().encode('SET gxApi "TAMPERED"\n');
    writeFileSync(zipPath, zipSync(unz));
    write("Account/ACC1/SavedVariables/A.lua", "current\n");
    const before = tree(wtf);

    await expect(s.restoreBackup(target, b.fileName)).rejects.toMatchObject({ code: "verify_failed" });
    expect(tree(wtf)).toEqual(before);
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("an entry that inflates past its declared size is aborted (zip bomb guard)", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    const zipPath = join(backupDir(), b.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    unz["Config.wtf"] = new Uint8Array(5 * 1024 * 1024); // metadata says 18 bytes
    writeFileSync(zipPath, zipSync(unz));
    const before = tree(wtf);
    await expect(s.restoreBackup(target, b.fileName)).rejects.toMatchObject({ code: "verify_failed" });
    expect(tree(wtf)).toEqual(before);
  });

  test.each(["../evil.txt", "/abs-evil.txt", "a/../../evil.txt", "C:/evil.txt"])("zip-slip entry %p is rejected and nothing is written outside staging", async (evil) => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    const zipPath = join(backupDir(), b.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const meta = JSON.parse(Buffer.from(unz["wowup-meta.json"]!).toString("utf8"));
    meta.contents.push({ path: `/${evil}`, isDirectory: false, size: 4, hash: sha(Buffer.from("evil")) });
    unz["wowup-meta.json"] = new TextEncoder().encode(JSON.stringify(meta));
    unz[evil] = new TextEncoder().encode("evil");
    writeFileSync(zipPath, zipSync(unz));
    const before = tree(wtf);

    await expect(s.restoreBackup(target, b.fileName)).rejects.toBeInstanceOf(WtfBackupError);
    expect(tree(wtf)).toEqual(before);
    expect(existsSync(join(tmp, "evil.txt"))).toBe(false);
    expect(existsSync(join(flavor, "evil.txt"))).toBe(false);
    expect(existsSync("/abs-evil.txt")).toBe(false);
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("an unlisted entry in the zip is refused", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    const zipPath = join(backupDir(), b.fileName);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    unz["Extra.lua"] = new TextEncoder().encode("x");
    writeFileSync(zipPath, zipSync(unz));
    await expect(s.restoreBackup(target, b.fileName)).rejects.toMatchObject({ code: "verify_failed" });
  });

  test("a truncated/garbage zip is refused as invalid", async () => {
    makeWtf();
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(join(backupDir(), "wtf_1.zip"), randomBytes(500));
    await expect(service().restoreBackup(target, "wtf_1.zip", { acceptUnknownFlavor: true })).rejects.toMatchObject({ code: "backup_invalid" });
  });

  test("a failing final rename rolls back: the original WTF is restored", async () => {
    makeWtf();
    const s0 = service();
    const b = await s0.createBackup(target, { kind: "manual" });
    write("Account/ACC1/SavedVariables/A.lua", "current\n");
    const before = tree(wtf);
    let calls = 0;
    const s = service({
      rename: async (from, to) => {
        calls += 1;
        if (to === wtf && from.includes(".WTF-restore-")) {
          throw new Error("disk went away");
        }
        await fsRename(from, to);
      },
    });
    await expect(s.restoreBackup(target, b.fileName)).rejects.toThrow("disk went away");
    expect(calls).toBeGreaterThanOrEqual(3); // wtf->old, stage->wtf (fails), old->wtf (rollback)
    expect(tree(wtf)).toEqual(before);
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("a failing first rename leaves WTF untouched", async () => {
    makeWtf();
    const b = await service().createBackup(target, { kind: "manual" });
    write("Config.wtf", "current");
    const before = tree(wtf);
    const s = service({
      rename: async (from, to) => {
        if (from === wtf) throw new Error("busy");
        await fsRename(from, to);
      },
    });
    await expect(s.restoreBackup(target, b.fileName)).rejects.toThrow("busy");
    expect(tree(wtf)).toEqual(before);
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("cancelling during extraction leaves WTF untouched and no staging dir", async () => {
    write("Account/ACC1/SavedVariables/Big.lua", randomBytes(3 * 1024 * 1024));
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    const before = tree(wtf);
    const ac = new AbortController();
    await expect(
      s.restoreBackup(target, b.fileName, {
        signal: ac.signal,
        onProgress: (phase) => {
          if (phase === "extract") ac.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(tree(wtf)).toEqual(before);
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("only one WTF job at a time", async () => {
    write("a/one.bin", randomBytes(4 * 1024 * 1024));
    const s = service();
    const first = s.createBackup(target, { kind: "manual" });
    await expect(s.createBackup(target, { kind: "manual" })).rejects.toMatchObject({ code: "job_in_progress" });
    await expect(s.restoreBackup(target, "wtf_1.zip")).rejects.toMatchObject({ code: "job_in_progress" });
    // Delete and import take the same lock (RF-14; the handlers used to guard them).
    await expect(s.deleteBackup(target, "wtf_1.zip")).rejects.toMatchObject({ code: "job_in_progress" });
    await expect(s.importBackup(target, "/tmp/some.zip")).rejects.toMatchObject({ code: "job_in_progress" });
    await first;
    expect(s.busy).toBe(false);
  });

  test("restore is refused for path-like names", async () => {
    await expect(service().restoreBackup(target, "../x.zip")).rejects.toBeInstanceOf(WtfBackupError);
  });
});

describe("retention", () => {
  test("keeps the newest N pre-restore snapshots, never prunes manual backups, never the one just made", async () => {
    makeWtf();
    const s = service({ keepSnapshots: () => 2 });
    const manual = await s.createBackup(target, { kind: "manual" });
    for (let i = 0; i < 4; i++) {
      write("Config.wtf", `v${i}`);
      await s.restoreBackup(target, manual.fileName);
    }
    const { backups } = await s.listBackups(target);
    expect(backups.filter((b) => b.kind === "pre-restore")).toHaveLength(2);
    expect(backups.filter((b) => b.kind === "manual")).toHaveLength(1);
  });
});

describe("recover", () => {
  const OLD = (n: number) => join(flavor, `WTF-pre-restore-${n}`);
  const STAGE = (n: number) => join(flavor, `.WTF-restore-${n}`);

  test("WTF missing + pre-restore copy present -> put the old WTF back", async () => {
    rmSync(wtf, { recursive: true });
    mkdirSync(join(OLD(100), "Account"), { recursive: true });
    writeFileSync(join(OLD(100), "Config.wtf"), "precious");
    mkdirSync(STAGE(100), { recursive: true });
    const r = await service().recover(target);
    expect(r.restoredPreviousWtf).toBe(true);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe("precious");
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("WTF present + leftover pre-restore copy -> the swap had finished: drop the leftover", async () => {
    write("Config.wtf", "new");
    mkdirSync(OLD(100), { recursive: true });
    writeFileSync(join(OLD(100), "Config.wtf"), "old");
    const r = await service().recover(target);
    expect(r.restoredPreviousWtf).toBe(false);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe("new");
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("with several pre-restore copies the newest one is used", async () => {
    rmSync(wtf, { recursive: true });
    for (const n of [100, 300, 200]) {
      mkdirSync(OLD(n), { recursive: true });
      writeFileSync(join(OLD(n), "Config.wtf"), `v${n}`);
    }
    await service().recover(target);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe("v300");
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("a staging dir alone is removed; WTF untouched; second run is a no-op", async () => {
    write("Config.wtf", "keep");
    mkdirSync(STAGE(5), { recursive: true });
    writeFileSync(join(STAGE(5), "half"), "x");
    const s = service();
    await s.recover(target);
    await s.recover(target);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe("keep");
    expect(flavorEntries()).toEqual(["WTF"]);
  });

  test("recover() does nothing while a job is running", async () => {
    write("a/one.bin", randomBytes(4 * 1024 * 1024));
    mkdirSync(STAGE(5), { recursive: true });
    const s = service();
    const job = s.createBackup(target, { kind: "manual" });
    await s.recover(target);
    expect(existsSync(STAGE(5))).toBe(true);
    await job;
  });

  test("sweepPartials removes interrupted-backup leftovers only", async () => {
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(join(backupDir(), "wtf_1.zip.partial"), "half");
    writeFileSync(join(backupDir(), "wtf_2.zip"), "keep");
    expect(await service().sweepPartials()).toBe(1);
    expect(readdirSync(backupDir())).toEqual(["wtf_2.zip"]);
  });
});

describe("detectGameRunning", () => {
  const reader = (procs: Record<string, { comm?: string; cmdline?: string; environ?: string }> | null): ProcReader => ({
    pids: async () => (procs ? Object.keys(procs) : null),
    read: async (pid, file) => procs?.[pid]?.[file] ?? null,
  });

  test("finds Wine/Proton by comm (incl. 15-char truncation) and by Windows path in cmdline", async () => {
    expect(await detectGameRunning(reader({ "1": { comm: "bash" }, "2": { comm: "Wow.exe" } }))).toBe("running");
    expect(await detectGameRunning(reader({ "2": { comm: "WowClassicT-arm" } }))).toBe("running");
    expect(await detectGameRunning(reader({ "3": { comm: "wine64-preloader", cmdline: "Z:\\home\\deck\\Games\\World of Warcraft\\_retail_\\Wow.exe\0-launcherlogin" } }))).toBe("running");
    expect(await detectGameRunning(reader({ "3": { comm: "x", cmdline: "/usr/bin/wine\0/home/deck/Games/wow/_classic_era_/WowClassic.exe" } }))).toBe("running");
  });

  test("not running when nothing matches; lookalikes don't match", async () => {
    expect(await detectGameRunning(reader({ "1": { comm: "bash", cmdline: "bash\0-c\0echo Wow.exe.txt" }, "2": { comm: "WowUp" } }))).toBe("not_running");
  });

  test("unknown when /proc is unreadable", async () => {
    expect(await detectGameRunning(reader(null))).toBe("unknown");
    expect(await detectGameRunning({ pids: async () => ["1"], read: async () => null })).toBe("unknown");
  });
});

describe("importBackup", () => {
  const outside = () => join(tmp, "incoming");

  test("copies a valid backup from anywhere into this flavor's list, then it can be restored", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    mkdirSync(outside(), { recursive: true });
    const src = join(outside(), "my-settings.zip");
    copyFileSync(join(backupDir(), b.fileName), src);
    await s.deleteBackup(target, b.fileName);

    const r = await s.importBackup(target, src);
    expect(r.alreadyPresent).toBe(false);
    expect(r.fileName).toMatch(/^wtf_\d+\.zip$/);
    expect(zipsIn()).toEqual([r.fileName]);
    expect(readdirSync(backupDir()).some((n) => n.endsWith(".partial"))).toBe(false);
    write("Config.wtf", "changed");
    await s.restoreBackup(target, r.fileName);
    expect(readFileSync(join(wtf, "Config.wtf"), "utf8")).toBe('SET gxApi "D3D12"\n');
  });

  test("importing the same file twice, or a file already in the folder, is a no-op", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    const again = await s.importBackup(target, join(backupDir(), b.fileName));
    expect(again).toEqual({ fileName: b.fileName, alreadyPresent: true });
    mkdirSync(outside(), { recursive: true });
    const src = join(outside(), "copy.zip");
    copyFileSync(join(backupDir(), b.fileName), src);
    const first = await s.importBackup(target, src);
    const second = await s.importBackup(target, src);
    expect(second).toEqual({ fileName: first.fileName, alreadyPresent: true });
    expect(zipsIn().length).toBeLessThanOrEqual(2);
  });

  test("accepts a desktop WowUp backup", async () => {
    const r = await service().importBackup(target, FIXTURE);
    expect(r.alreadyPresent).toBe(false);
    const [info] = (await service().listBackups(target)).backups;
    expect(info).toMatchObject({ valid: true, flavor: null });
  });

  test("rejects relative paths, non-zips, missing files, garbage and the wrong flavor; copies nothing", async () => {
    makeWtf();
    const s = service();
    const b = await s.createBackup(target, { kind: "manual" });
    mkdirSync(outside(), { recursive: true });
    writeFileSync(join(outside(), "notes.txt"), "x");
    writeFileSync(join(outside(), "junk.zip"), randomBytes(300));
    const other = join(outside(), "era.zip");
    copyFileSync(join(backupDir(), b.fileName), other);
    for (const [path, code] of [
      ["relative.zip", "backup_invalid"],
      [join(outside(), "notes.txt"), "backup_invalid"],
      [join(outside(), "nope.zip"), "not_found"],
      [join(outside(), "junk.zip"), "backup_invalid"],
    ] as const) {
      await expect(s.importBackup(target, path)).rejects.toMatchObject({ code });
    }
    await expect(s.importBackup({ ...target, flavor: "_classic_era_" }, other)).rejects.toMatchObject({ code: "flavor_mismatch" });
    expect(zipsIn()).toEqual([b.fileName]);
  });

  test("not enough space -> insufficient_space", async () => {
    mkdirSync(outside(), { recursive: true });
    await expect(service({ freeBytes: async () => 5 }).importBackup(target, FIXTURE)).rejects.toMatchObject({ code: "insufficient_space" });
  });
});
