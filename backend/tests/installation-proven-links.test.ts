import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationDetector } from "../src/wow/installation/InstallationDetector";
import type { ProcReader } from "../src/wow/wtf/GameProcessGuard";

// Proven links (#279): the shortcut seen launching WoW, read from the running game's process.

let home: string;
let data: string;
let steam: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wowdeck-launch-links-"));
  data = join(home, "plugin-data");
  steam = join(home, ".local/share/Steam");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

// Synthetic binary KeyValues shortcuts.vdf for one Steam user.
function shortcuts(user: string, entries: Array<{ appid: number; name: string }>) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const records = entries.map((entry, index) => {
    const appid = Buffer.alloc(4);
    appid.writeUInt32LE(entry.appid);
    return Buffer.concat([
      Buffer.from(`\0${index}\0\x02appid\0`),
      appid,
      string("AppName", entry.name),
      // A wrapper script tells detection nothing: only the running game links it.
      string("Exe", "/opt/start-games.sh"),
      string("StartDir", "/opt"),
      string("LaunchOptions", ""),
      Buffer.from([8]),
    ]);
  });
  const config = join(steam, "userdata", user, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "shortcuts.vdf"), Buffer.concat([Buffer.from("\0shortcuts\0"), ...records, Buffer.from([8, 8])]));
}

/** A Proton prefix holding WoW's retail flavor under C:; returns its compat data folder and the flavor. */
function protonInstall(compatId: number) {
  const compat = join(steam, "steamapps/compatdata", String(compatId));
  const driveC = join(compat, "pfx/drive_c");
  const retail = join(driveC, "Program Files (x86)/World of Warcraft/_retail_");
  mkdirSync(retail, { recursive: true });
  writeFileSync(join(retail, "Wow.exe"), "");
  mkdirSync(join(compat, "pfx/dosdevices"), { recursive: true });
  symlinkSync("../drive_c", join(compat, "pfx/dosdevices/c:"));
  symlinkSync("/", join(compat, "pfx/dosdevices/z:"));
  return { compat, retail };
}

const RETAIL_EXE = "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe";

/** The 64-bit game id Steam gives a non-Steam shortcut: its app id in the high half. */
const shortcutGameId = (appId: number) => String((BigInt(appId) << 32n) | 0x02000000n);

/** /proc as the fake processes would show it. */
function procs(entries: Record<string, { comm: string; cmdline: string[]; environ: Record<string, string> }>): ProcReader {
  return {
    async pids() {
      return Object.keys(entries);
    },
    async read(pid, file) {
      const p = entries[pid];
      if (!p) return null;
      if (file === "comm") return p.comm + "\n";
      if (file === "cmdline") return p.cmdline.join("\0") + "\0";
      return Object.entries(p.environ).map(([k, v]) => `${k}=${v}`).join("\0") + "\0";
    },
  };
}

function detector(procReader?: ProcReader) {
  return new InstallationDetector({ homeDir: home, scanRemovableMedia: false, dataDir: data, procReader });
}

test("WoW seen running from a shortcut is a proven link that a new detector still has", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "1": { comm: "bash", cmdline: ["/bin/bash"], environ: { SteamGameId: shortcutGameId(42) } },
    "2": {
      comm: "Wow.exe",
      cmdline: [RETAIL_EXE],
      environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat },
    },
  });

  expect(await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail])).toBe(true);

  const found = await detector().detect();
  expect(found.map((i) => i.location)).toEqual([retail]);
  expect(found[0]!.steamGames).toEqual([{ appId: 42, name: "My games", accountId: 100, provenance: "launch" }]);
});

test("a Steam log PID considers only that process and still verifies its shortcut", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "Battle.net" }]);
  const reader = procs({
    "1": {
      comm: "Wow.exe",
      cmdline: [RETAIL_EXE],
      environ: { SteamGameId: shortcutGameId(43), STEAM_COMPAT_DATA_PATH: compat },
    },
    "2": {
      comm: "Wow.exe",
      cmdline: [RETAIL_EXE],
      environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat },
    },
  });
  const scan = spyOn(reader, "pids");
  const launch = { appId: 42, accountId: 100 };
  const service = detector(reader);
  expect(await service.recordLaunch(launch, [retail], "1")).toBe(false);
  expect(await service.recordLaunch(launch, [retail], "2")).toBe(true);
  expect(scan).not.toHaveBeenCalled();
});

test.each([
  ["SteamAppId and WINEPREFIX", (compat: string) => ({ SteamAppId: "42", WINEPREFIX: join(compat, "pfx") })],
  ["STEAM_COMPAT_APP_ID", (compat: string) => ({ SteamAppId: "0", STEAM_COMPAT_APP_ID: "42", STEAM_COMPAT_DATA_PATH: compat })],
])("the launching app id and prefix are read from %s", async (_, environ) => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({ "7": { comm: "Wow.exe", cmdline: [RETAIL_EXE, "-launch"], environ: environ(compat) } });

  expect(await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail])).toBe(true);
  expect((await detector().detect())[0]!.steamGames).toEqual([
    { appId: 42, name: "My games", accountId: 100, provenance: "launch" },
  ]);
});

test("a Z: path resolves through the prefix's drive mapping", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "7": {
      comm: "Wow.exe",
      cmdline: [`Z:${join(retail, "Wow.exe").replaceAll("/", "\\")}`],
      environ: { SteamAppId: "42", STEAM_COMPAT_DATA_PATH: compat },
    },
  });
  expect(await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail])).toBe(true);
});

test.each([
  ["the app id is not a shortcut", 43, 100],
  ["the shortcut belongs to another Steam account", 42, 200],
])("nothing is recorded when %s", async (_, appId, accountId) => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  shortcuts("200", [{ appid: 7, name: "Other account" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(appId), STEAM_COMPAT_DATA_PATH: compat } },
  });
  expect(await detector(reader).recordLaunch({ appId, accountId }, [retail])).toBe(false);
  expect((await detector().detect())[0]!.steamGames ?? []).toEqual([]);
});

test("nothing is recorded when the running WoW is not a known installation", async () => {
  const { compat, retail } = protonInstall(999);
  const other = join(home, "other/_retail_");
  mkdirSync(other, { recursive: true });
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat } },
  });
  expect(await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [other])).toBe(false);
  expect((await detector().detect()).find((i) => i.location === retail)!.steamGames ?? []).toEqual([]);
});

test("nothing is recorded when WoW was started by another app", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }, { appid: 43, name: "Launcher" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(43), STEAM_COMPAT_DATA_PATH: compat } },
  });
  expect(await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail])).toBe(false);
});

test("a deleted shortcut's proven link disappears, and a renamed one shows the new name", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat } },
  });
  await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail]);

  shortcuts("100", [{ appid: 42, name: "WoW" }]);
  expect((await detector().detect())[0]!.steamGames).toEqual([
    { appId: 42, name: "WoW", accountId: 100, provenance: "launch" },
  ]);
  shortcuts("100", []);
  expect((await detector().detect())[0]!.steamGames ?? []).toEqual([]);
});

test("the process environment and paths are never logged", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": {
      comm: "Wow.exe",
      cmdline: [RETAIL_EXE],
      environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat, SECRET_TOKEN: "hunter2" },
    },
  });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail]);
    await detector().detect();
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain(home);
  } finally {
    log.mockRestore();
  }
});

test("recording a launch updates the installation list's links without a scan that starts update checks", async () => {
  const { StateStore } = await import("../src/wow/storage/StateStore");
  const { InstallationService } = await import("../src/wow/installation/InstallationService");
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat } },
  });
  const service = new InstallationService(new StateStore(join(home, "state.json")), async () => {}, () => {}, { dataDir: data, procReader: reader });
  expect((await service.detect(home))[0]!.steamGames).toEqual([]);
  let found = 0;
  service.foundListeners.add(() => found++);

  expect(await service.recordLaunch(home, { appId: 42, accountId: 100 })).toEqual({
    recorded: true,
    installations: [expect.objectContaining({ path: retail, steamGames: [{ appId: 42, name: "My games", accountId: 100, provenance: "launch" }] })],
  });
  expect(found).toBe(0);
  expect((await service.recordLaunch(home, { appId: 43, accountId: 100 })).recorded).toBe(false);
  // A restarted engine finds it again on its startup scan.
  const restarted = new InstallationService(new StateStore(join(home, "state.json")), async () => {}, () => {}, { dataDir: data });
  expect((await restarted.detect(home))[0]!.steamGames).toEqual([{ appId: 42, name: "My games", accountId: 100, provenance: "launch" }]);
});

test.each([
  ["an app id that is no Steam app id", { appId: 0 }],
  ["a fractional account id", { appId: 42, accountId: 1.5 }],
])("recording a launch rejects %s", async (_, launch) => {
  const { StateStore } = await import("../src/wow/storage/StateStore");
  const { InstallationService } = await import("../src/wow/installation/InstallationService");
  const service = new InstallationService(new StateStore(join(home, "state.json")), async () => {}, () => {}, { dataDir: data });
  await expect(service.recordLaunch(home, launch)).rejects.toThrow(/must be/);
});

test("a deleted shortcut's proven link is dropped for good: the same app id added again is not linked", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat } },
  });
  await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail]);

  shortcuts("100", []);
  await detector().detect();
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  expect((await detector().detect())[0]!.steamGames ?? []).toEqual([]);
});

test("an unreadable shortcut list keeps the proven links", async () => {
  const { compat, retail } = protonInstall(999);
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  const reader = procs({
    "2": { comm: "Wow.exe", cmdline: [RETAIL_EXE], environ: { SteamGameId: shortcutGameId(42), STEAM_COMPAT_DATA_PATH: compat } },
  });
  await detector(reader).recordLaunch({ appId: 42, accountId: 100 }, [retail]);

  writeFileSync(join(steam, "userdata/100/config/shortcuts.vdf"), Buffer.from("\0shortcuts\0\x01trunc"));
  await detector().detect();
  shortcuts("100", [{ appid: 42, name: "My games" }]);
  expect((await detector().detect())[0]!.steamGames).toEqual([
    { appId: 42, name: "My games", accountId: 100, provenance: "launch" },
  ]);
});
