import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { detectGameRunning, type ProcReader } from "../src/wow/wtf/GameProcessGuard";
import { WtfBackupService, type WtfTarget } from "../src/wow/wtf/WtfBackupService";

/** A backup made by desktop WowUp: it records no game version. */
const DESKTOP_WOWUP_ZIP = join(import.meta.dir, "fixtures/wtf/upstream-wowup-backup.zip");

const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

let tmp: string;
let gameDir: string;
let backupRoot: string;

/** A WTF folder for one flavor, with a recognisable A.lua and Config.wtf. */
function makeWtf(flavor: string, tag: string): WtfTarget {
  const wtfPath = join(gameDir, flavor, "WTF");
  const write = (rel: string, data: string) => {
    const p = join(wtfPath, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  };
  write("Config.wtf", `SET gxApi "${tag}"\n`);
  write("Account/ACC1/SavedVariables/A.lua", `A = "${tag}"\n`);
  write("Account/ACC1/Realm/Char/SavedVariables/B.lua", "B = {}\n");
  return { wtfPath, flavor };
}

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        out[`${rel}/${name}`] = "d";
        walk(p, `${rel}/${name}`);
      } else {
        out[`${rel}/${name}`] = sha(readFileSync(p));
      }
    }
  };
  walk(root, "");
  return out;
}

/** No process is WoW: a stub /proc with one unrelated process. */
const quietProc: ProcReader = {
  pids: async () => ["1"],
  read: async (_pid, file) => (file === "comm" ? "systemd\n" : ""),
};
const wowProc: ProcReader = {
  pids: async () => ["1"],
  read: async (_pid, file) => (file === "comm" ? "Wow.exe\n" : ""),
};

function service(proc: ProcReader = quietProc, startAt = 1_700_000_000_000) {
  let t = startAt;
  return new WtfBackupService({
    backupRoot: () => ({ path: backupRoot, custom: false }),
    now: () => (t += 1000),
    freeBytes: async () => 10 * 1024 ** 3,
    gameStatus: () => detectGameRunning(proc),
  });
}

const zipsFor = (flavor: string) =>
  existsSync(join(backupRoot, flavor)) ? readdirSync(join(backupRoot, flavor)).filter((n) => n.endsWith(".zip")) : [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wtf-copy-"));
  gameDir = join(tmp, "World of Warcraft");
  backupRoot = join(tmp, "backups");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("copy sources", () => {
  test("lists installed and backups-only versions, related first then newest, and marks the default", async () => {
    const forever = makeWtf("_forever_", "forever");
    // Forever Beta: installed, oldest backup. Anniversary: uninstalled, backups only, newest of all.
    // Retail: installed, a backup newer than the beta's. Classic Era: installed, no backups (nothing to copy).
    const beta = makeWtf("_classic_beta_", "beta");
    const retail = makeWtf("_retail_", "retail");
    makeWtf("_classic_era_", "era");
    await service(quietProc, 1_700_000_000_000).createBackup(beta, { kind: "manual" });
    await service(quietProc, 1_700_000_100_000).createBackup(retail, { kind: "manual" });
    const anniversary = makeWtf("_anniversary_", "anniversary");
    await service(quietProc, 1_700_000_200_000).createBackup(anniversary, { kind: "manual" });
    rmSync(dirname(anniversary.wtfPath), { recursive: true });
    // Current settings older than every backup, so backups decide the order.
    for (const flavor of ["_classic_beta_", "_retail_", "_classic_era_"]) {
      utimesSync(join(gameDir, flavor, "WTF", "Config.wtf"), 1_690_000_000, 1_690_000_000);
    }
    const installedAt = (installationId: string, flavor: string) => ({ installationId, flavor, wtfPath: join(gameDir, flavor, "WTF") });

    const { dirAvailable, sources } = await service().listCopySources(forever, [
      installedAt("forever-id", "_forever_"),
      installedAt("beta-id", "_classic_beta_"),
      installedAt("retail-id", "_retail_"),
      installedAt("era-id", "_classic_era_"),
    ]);

    expect(dirAvailable).toBe(true);
    expect(sources.map((s) => [s.flavor, s.displayName, s.installed, s.installationId, s.related, s.isDefault])).toEqual([
      ["_classic_beta_", "Forever Beta", true, "beta-id", true, true],
      ["_anniversary_", "Anniversary", false, null, false, false],
      ["_retail_", "Retail", true, "retail-id", false, false],
      ["_classic_era_", "Classic Era", true, "era-id", false, false],
    ]);
    expect(sources[0]!.backups).toHaveLength(1);
    expect(sources[0]!.backups[0]!.flavor).toBe("_classic_beta_");
  });

  test("reports one WoW-running state for the whole list (the process scan can't tell installations apart)", async () => {
    const forever = makeWtf("_forever_", "forever");
    const beta = makeWtf("_classic_beta_", "beta");
    await service().createBackup(beta, { kind: "manual" });
    expect((await service().listCopySources(forever, [])).gameRunning).toBe("not_running");
    expect((await service(wowProc).listCopySources(forever, [])).gameRunning).toBe("running");
  });

  test("a backup folder for a version this build can't name is not offered (never shown by its folder name)", async () => {
    const forever = makeWtf("_forever_", "forever");
    const beta = makeWtf("_classic_beta_", "beta");
    const made = await service().createBackup(beta, { kind: "manual" });
    mkdirSync(join(backupRoot, "_future_"), { recursive: true });
    writeFileSync(join(backupRoot, "_future_", made.fileName), readFileSync(join(backupRoot, "_classic_beta_", made.fileName)));
    const { sources } = await service().listCopySources(forever, []);
    expect(sources.map((s) => s.flavor)).toEqual(["_classic_beta_"]);
  });

  test("two installations of one version: Current settings comes from the one changed most recently", async () => {
    const forever = makeWtf("_forever_", "forever");
    const older = makeWtf("_classic_beta_", "beta");
    const newerPath = join(tmp, "Second WoW", "_classic_beta_", "WTF");
    makeWtfAt(newerPath);
    utimesSync(join(older.wtfPath, "Config.wtf"), 1_700_000_000, 1_700_000_000);
    utimesSync(join(newerPath, "Config.wtf"), 1_700_000_900, 1_700_000_900);
    const installs = [
      { installationId: "beta-1", flavor: "_classic_beta_", wtfPath: older.wtfPath },
      { installationId: "beta-2", flavor: "_classic_beta_", wtfPath: newerPath },
    ];
    for (const order of [installs, [...installs].reverse()]) {
      const { sources } = await service().listCopySources(forever, order);
      expect(sources.map((s) => [s.flavor, s.installationId, s.current?.modifiedAt])).toEqual([
        ["_classic_beta_", "beta-2", 1_700_000_900_000],
      ]);
    }
  });

  test("with no related version, the newest of any kind is the default", async () => {
    const retail = makeWtf("_retail_", "retail");
    const era = makeWtf("_classic_era_", "era");
    const forever = makeWtf("_forever_", "forever");
    await service(quietProc, 1_700_000_000_000).createBackup(era, { kind: "manual" });
    await service(quietProc, 1_700_000_100_000).createBackup(forever, { kind: "manual" });

    const { sources } = await service().listCopySources(retail, []);
    expect(sources.map((s) => [s.flavor, s.related, s.isDefault])).toEqual([
      ["_forever_", false, true],
      ["_classic_era_", false, false],
    ]);
  });

  test("a coarse fallback flavor key is unrelated to everything, even its own game's family", async () => {
    const retail = makeWtf("_retail_", "retail");
    const odd = { wtfPath: join(tmp, "Odd WoW", "WTF"), flavor: "retail" };
    makeWtfAt(odd.wtfPath);
    await service().createBackup(odd, { kind: "manual" });
    await service().createBackup(retail, { kind: "manual" });

    const fromRetail = await service().listCopySources(retail, []);
    expect(fromRetail.sources.map((s) => [s.flavor, s.displayName, s.related])).toEqual([["retail", "Retail", false]]);
    const fromOdd = await service().listCopySources(odd, []);
    expect(fromOdd.sources.map((s) => [s.flavor, s.related])).toEqual([["_retail_", false]]);
  });

  test("nothing to copy: no sources (the row stays hidden)", async () => {
    const forever = makeWtf("_forever_", "forever");
    mkdirSync(join(gameDir, "_classic_beta_"), { recursive: true });
    await service().createBackup(forever, { kind: "manual" });
    const { sources } = await service().listCopySources(forever, [
      { installationId: "beta-id", flavor: "_classic_beta_", wtfPath: join(gameDir, "_classic_beta_", "WTF") },
    ]);
    expect(sources).toEqual([]);
  });

  test("an unavailable custom backup folder lists nothing and says so", async () => {
    const forever = makeWtf("_forever_", "forever");
    const s = new WtfBackupService({
      backupRoot: () => ({ path: join(tmp, "sdcard", "backups"), custom: true }),
      gameStatus: () => detectGameRunning(quietProc),
    });
    expect(await s.listCopySources(forever, [])).toEqual({ dirAvailable: false, gameRunning: "not_running", sources: [] });
  });
});

function makeWtfAt(wtfPath: string) {
  mkdirSync(join(wtfPath, "Account"), { recursive: true });
  writeFileSync(join(wtfPath, "Config.wtf"), "odd\n");
}

describe("copying another version's backup", () => {
  async function betaBackup() {
    const forever = makeWtf("_forever_", "forever");
    const beta = makeWtf("_classic_beta_", "beta");
    const backup = await service().createBackup(beta, { kind: "manual" });
    return { forever, beta, backup, betaTree: tree(beta.wtfPath), betaZips: zipsFor("_classic_beta_") };
  }

  test("replaces the target WTF, keeps Config.wtf by default, leaves a safety backup and the source untouched", async () => {
    const { forever, beta, backup, betaTree, betaZips } = await betaBackup();
    const s = service();
    const result = await s.restoreBackup(forever, backup.fileName, { sourceFlavor: "_classic_beta_" });

    expect(readFileSync(join(forever.wtfPath, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe('A = "beta"\n');
    expect(readFileSync(join(forever.wtfPath, "Config.wtf"), "utf8")).toBe('SET gxApi "forever"\n');
    const { backups } = await s.listBackups(forever);
    expect(backups.map((b) => [b.fileName, b.kind])).toEqual([[result.snapshotFileName!, "pre-restore"]]);
    expect(tree(beta.wtfPath)).toEqual(betaTree);
    expect(zipsFor("_classic_beta_")).toEqual(betaZips);
  });

  test("replaces Config.wtf too when keepCurrentConfig is off", async () => {
    const { forever, backup } = await betaBackup();
    await service().restoreBackup(forever, backup.fileName, { sourceFlavor: "_classic_beta_", keepCurrentConfig: false });
    expect(readFileSync(join(forever.wtfPath, "Config.wtf"), "utf8")).toBe('SET gxApi "beta"\n');
  });

  test("the target's WoW running blocks the copy with game_running and nothing changes", async () => {
    const { forever, backup } = await betaBackup();
    const before = tree(forever.wtfPath);
    await expect(
      service(wowProc).restoreBackup(forever, backup.fileName, { sourceFlavor: "_classic_beta_" }),
    ).rejects.toMatchObject({ code: "game_running" });
    expect(tree(forever.wtfPath)).toEqual(before);
    expect(zipsFor("_forever_")).toEqual([]);
  });

  test("a backup must belong to the named source version", async () => {
    const { forever, backup } = await betaBackup();
    mkdirSync(join(backupRoot, "_retail_"), { recursive: true });
    writeFileSync(join(backupRoot, "_retail_", backup.fileName), readFileSync(join(backupRoot, "_classic_beta_", backup.fileName)));
    await expect(
      service().restoreBackup(forever, backup.fileName, { sourceFlavor: "_retail_" }),
    ).rejects.toMatchObject({ code: "flavor_mismatch" });
  });

  test("a desktop WowUp backup (no recorded version) in the source's folder asks the unknown-version confirm", async () => {
    const forever = makeWtf("_forever_", "forever");
    const before = tree(forever.wtfPath);
    mkdirSync(join(backupRoot, "_classic_beta_"), { recursive: true });
    copyFileSync(DESKTOP_WOWUP_ZIP, join(backupRoot, "_classic_beta_", "wtf_1.zip"));
    const s = service();
    await expect(s.restoreBackup(forever, "wtf_1.zip", { sourceFlavor: "_classic_beta_" })).rejects.toMatchObject({
      code: "flavor_unknown_needs_confirm",
    });
    expect(tree(forever.wtfPath)).toEqual(before);

    await s.restoreBackup(forever, "wtf_1.zip", { sourceFlavor: "_classic_beta_", acceptUnknownFlavor: true });
    expect(readFileSync(join(forever.wtfPath, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe("A={}\n");
  });

  test("plain restore still refuses another version's backup", async () => {
    const { forever, backup } = await betaBackup();
    mkdirSync(join(backupRoot, "_forever_"), { recursive: true });
    writeFileSync(join(backupRoot, "_forever_", backup.fileName), readFileSync(join(backupRoot, "_classic_beta_", backup.fileName)));
    await expect(service().restoreBackup(forever, backup.fileName)).rejects.toMatchObject({ code: "flavor_mismatch" });
  });
});

describe("copying another version's current settings", () => {
  function setupCurrent() {
    const forever = makeWtf("_forever_", "forever");
    const beta = makeWtf("_classic_beta_", "beta");
    return { forever, beta, betaTree: tree(beta.wtfPath), foreverTree: tree(forever.wtfPath) };
  }

  test("adds a manual backup to the source's list and leaves the source tree byte-identical", async () => {
    const { forever, beta, betaTree } = setupCurrent();
    const s = service();
    const result = await s.copyCurrentSettings(forever, beta);

    const { backups } = await s.listBackups(beta);
    expect(backups.map((b) => [b.fileName, b.kind, b.flavor])).toEqual([[result.restoredFileName, "manual", "_classic_beta_"]]);
    expect(tree(beta.wtfPath)).toEqual(betaTree);
  });

  test("the target ends up with the source's WTF, Config.wtf kept, and a safety backup in its list", async () => {
    const { forever, beta } = setupCurrent();
    const s = service();
    const result = await s.copyCurrentSettings(forever, beta);

    expect(readFileSync(join(forever.wtfPath, "Account/ACC1/SavedVariables/A.lua"), "utf8")).toBe('A = "beta"\n');
    expect(readFileSync(join(forever.wtfPath, "Account/ACC1/Realm/Char/SavedVariables/B.lua"), "utf8")).toBe("B = {}\n");
    expect(readFileSync(join(forever.wtfPath, "Config.wtf"), "utf8")).toBe('SET gxApi "forever"\n');
    const { backups } = await s.listBackups(forever);
    expect(backups.map((b) => [b.fileName, b.kind])).toEqual([[result.snapshotFileName!, "pre-restore"]]);
  });

  test("replaces Config.wtf too when keepCurrentConfig is off", async () => {
    const { forever, beta } = setupCurrent();
    await service().copyCurrentSettings(forever, beta, { keepCurrentConfig: false });
    expect(readFileSync(join(forever.wtfPath, "Config.wtf"), "utf8")).toBe('SET gxApi "beta"\n');
  });

  test("WoW running blocks with game_running and nothing changes on either side (it may be the source or the target)", async () => {
    const { forever, beta, betaTree, foreverTree } = setupCurrent();
    await expect(service(wowProc).copyCurrentSettings(forever, beta)).rejects.toMatchObject({ code: "game_running" });
    expect(tree(forever.wtfPath)).toEqual(foreverTree);
    expect(tree(beta.wtfPath)).toEqual(betaTree);
    expect(zipsFor("_forever_")).toEqual([]);
    expect(zipsFor("_classic_beta_")).toEqual([]);
  });

  test("cancel while the source is being backed up leaves both sides unchanged", async () => {
    const { forever, beta } = setupCurrent();
    writeFileSync(join(beta.wtfPath, "big.bin"), randomBytes(4 * 1024 * 1024));
    const betaTree = tree(beta.wtfPath);
    const foreverTree = tree(forever.wtfPath);
    const abort = new AbortController();
    const phases: string[] = [];
    await expect(
      service().copyCurrentSettings(forever, beta, {
        signal: abort.signal,
        onProgress: (phase) => {
          phases.push(phase);
          if (phase === "compress") {
            abort.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(phases).toContain("compress");
    expect(phases).not.toContain("snapshot");
    expect(tree(forever.wtfPath)).toEqual(foreverTree);
    expect(tree(beta.wtfPath)).toEqual(betaTree);
    expect(existsSync(join(backupRoot, "_classic_beta_")) ? readdirSync(join(backupRoot, "_classic_beta_")) : []).toEqual([]);
    expect(zipsFor("_forever_")).toEqual([]);
  });

  test("a copy that fails after the source backup removes that backup again", async () => {
    const { forever, beta } = setupCurrent();
    let t = 1_700_000_000_000;
    const s = new WtfBackupService({
      backupRoot: () => ({ path: backupRoot, custom: false }),
      now: () => (t += 1000),
      // Room for the source backup but not for restoring it.
      freeBytes: async (path) => (path.startsWith(backupRoot) ? 10 * 1024 ** 3 : 0),
      gameStatus: async () => "not_running",
    });
    await expect(s.copyCurrentSettings(forever, beta)).rejects.toMatchObject({ code: "insufficient_space" });
    expect(zipsFor("_classic_beta_")).toEqual([]);
  });

  test("a source without a WTF folder has no current settings to copy", async () => {
    const forever = makeWtf("_forever_", "forever");
    const beta = { wtfPath: join(gameDir, "_classic_beta_", "WTF"), flavor: "_classic_beta_" };
    mkdirSync(dirname(beta.wtfPath), { recursive: true });
    await expect(service().copyCurrentSettings(forever, beta)).rejects.toMatchObject({ code: "wtf_missing" });
  });
});

describe("copy sources: current settings", () => {
  test("installed versions with a WTF report their current settings; backups-only versions don't", async () => {
    const forever = makeWtf("_forever_", "forever");
    const beta = makeWtf("_classic_beta_", "beta");
    const anniversary = makeWtf("_anniversary_", "anniversary");
    await service().createBackup(anniversary, { kind: "manual" });
    rmSync(dirname(anniversary.wtfPath), { recursive: true });
    // WoW rewrites Config.wtf on every logout: its mtime dates the current settings.
    utimesSync(join(beta.wtfPath, "Config.wtf"), 1_700_000_500, 1_700_000_500);

    const { sources } = await service().listCopySources(forever, [
      { installationId: "beta-id", flavor: "_classic_beta_", wtfPath: beta.wtfPath },
    ]);
    expect(sources.map((s) => [s.flavor, s.installed, s.current])).toEqual([
      ["_classic_beta_", true, { modifiedAt: 1_700_000_500_000, hasConfig: true }],
      ["_anniversary_", false, null],
    ]);
    expect(sources[0]!.backups).toEqual([]);
  });

  test("newest settings counts current settings and backups alike", async () => {
    const forever = makeWtf("_forever_", "forever");
    const retail = makeWtf("_retail_", "retail");
    await service(quietProc, 1_700_000_900_000).createBackup(retail, { kind: "manual" });
    const beta = makeWtf("_classic_beta_", "beta");
    const ptr = makeWtf("_ptr_", "ptr");
    utimesSync(join(beta.wtfPath, "Config.wtf"), 1_700_000_100, 1_700_000_100);
    utimesSync(join(ptr.wtfPath, "Config.wtf"), 1_700_001_000, 1_700_001_000);
    utimesSync(join(retail.wtfPath, "Config.wtf"), 1_700_000_000, 1_700_000_000);

    const { sources } = await service().listCopySources(forever, [
      { installationId: "beta-id", flavor: "_classic_beta_", wtfPath: beta.wtfPath },
      { installationId: "ptr-id", flavor: "_ptr_", wtfPath: ptr.wtfPath },
      { installationId: "retail-id", flavor: "_retail_", wtfPath: retail.wtfPath },
    ]);
    expect(sources.map((s) => [s.flavor, s.isDefault])).toEqual([
      ["_classic_beta_", true],
      ["_ptr_", false],
      ["_retail_", false],
    ]);
  });
});

describe("importing another version's zip", () => {
  /** A Forever Beta backup zip outside the backup folder (copied off another device), and the Forever target. */
  async function betaZipElsewhere() {
    const beta = makeWtf("_classic_beta_", "beta");
    const s = service();
    const made = await s.createBackup(beta, { kind: "manual" });
    const incoming = join(tmp, "incoming");
    mkdirSync(incoming, { recursive: true });
    const zip = join(incoming, "beta-settings.zip");
    writeFileSync(zip, readFileSync(join(backupRoot, "_classic_beta_", made.fileName)));
    await s.deleteBackup(beta, made.fileName);
    return { zip, forever: makeWtf("_forever_", "forever") };
  }

  test("files it in that version's backup folder and reports the version; this version's list stays empty", async () => {
    const { zip, forever } = await betaZipElsewhere();
    const r = await service().importBackup(forever, zip);
    expect(r.alreadyPresent).toBe(false);
    expect(r.otherVersion).toEqual({ flavor: "_classic_beta_", displayName: "Forever Beta" });
    expect(zipsFor("_classic_beta_")).toEqual([r.fileName]);
    expect(zipsFor("_forever_")).toEqual([]);
    expect((await service().listBackups(forever)).backups).toEqual([]);
  });

  test("afterwards that version is a copy source with the imported backup listed", async () => {
    const { zip, forever } = await betaZipElsewhere();
    const r = await service().importBackup(forever, zip);
    const { sources } = await service().listCopySources(forever, []);
    const beta = sources.find((s) => s.flavor === "_classic_beta_");
    expect(beta?.backups.map((b) => b.fileName)).toEqual([r.fileName]);
  });

  test("re-importing it is a no-op", async () => {
    const { zip, forever } = await betaZipElsewhere();
    const first = await service().importBackup(forever, zip);
    const again = await service().importBackup(forever, zip);
    expect(again).toEqual({ ...first, alreadyPresent: true });
    const inFolder = await service().importBackup(forever, join(backupRoot, "_classic_beta_", first.fileName));
    expect(inFolder).toEqual({ ...first, alreadyPresent: true });
    expect(zipsFor("_classic_beta_")).toEqual([first.fileName]);
  });

  test("a version this build can't name is refused (it couldn't be shown or copied) and nothing is copied", async () => {
    const { zip, forever } = await betaZipElsewhere();
    const entries = unzipSync(readFileSync(zip));
    const meta = JSON.parse(new TextDecoder().decode(entries["wowup-meta.json"]));
    meta.wowupDecky.flavor = "_future_";
    entries["wowup-meta.json"] = new TextEncoder().encode(JSON.stringify(meta));
    writeFileSync(zip, zipSync(entries));
    await expect(service().importBackup(forever, zip)).rejects.toMatchObject({ code: "backup_invalid" });
    expect(existsSync(join(backupRoot, "_future_"))).toBe(false);
  });

  test("a recorded flavor that isn't a flavor key is refused and nothing is copied", async () => {
    const { zip, forever } = await betaZipElsewhere();
    const entries = unzipSync(readFileSync(zip));
    const metaName = "wowup-meta.json";
    const meta = JSON.parse(new TextDecoder().decode(entries[metaName]));
    meta.wowupDecky.flavor = "../escape";
    entries[metaName] = new TextEncoder().encode(JSON.stringify(meta));
    writeFileSync(zip, zipSync(entries));
    await expect(service().importBackup(forever, zip)).rejects.toMatchObject({ code: "backup_invalid" });
    expect(readdirSync(backupRoot).sort()).toEqual(["_classic_beta_"]);
    expect(zipsFor("_classic_beta_")).toEqual([]);
  });
});
