import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationDetector } from "../src/wow/installation/InstallationDetector";
import { WowClientType } from "../src/wow/types";
import { shortcutPrefixes } from "../src/wow/installation/SteamShortcuts";

let home: string;
let steam: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wowdeck-shortcuts-"));
  steam = join(home, ".local/share/Steam");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function detector() {
  return new InstallationDetector({ homeDir: home, scanRemovableMedia: false });
}

test.each([
  'STEAM_COMPAT_DATA_PATH="$HOME/shared" %command%',
  'STEAM_COMPAT_DATA_PATH="$(touch /tmp/never-execute)" %command%',
  'STEAM_COMPAT_DATA_PATH=/shared`hostname` %command%',
  'STEAM_COMPAT_DATA_PATH=relative %command%',
  'STEAM_COMPAT_DATA_PATH="/unclosed',
  '%command% STEAM_COMPAT_DATA_PATH=/argument',
  '/wrapper STEAM_COMPAT_DATA_PATH=/argument',
])("unsupported launch syntax is never interpreted: %s", (launchOptions) => {
  expect(shortcutPrefixes({ appId: 1, exe: "/launcher", startDir: "", launchOptions })).toEqual([]);
});

test("duplicate override paths and launcher ancestry contribute one prefix", () => {
  expect(shortcutPrefixes({
    appId: 1,
    exe: '"/shared/pfx/drive_c/Battle.net.exe"',
    startDir: "/shared/pfx/drive_c",
    launchOptions: 'STEAM_COMPAT_DATA_PATH=/shared WINEPREFIX=/shared/pfx %command%',
  })).toEqual(["/shared/pfx"]);
});

test("symlink aliases open a shared registry only once per scan", async () => {
  const shared = join(home, "shared/pfx");
  mkdirSync(shared, { recursive: true });
  const alias = join(home, "alias");
  symlinkSync(join(shared, ".."), alias);
  shortcuts("100", [
    { appid: 1, exe: "/launcher", start: "", options: `WINEPREFIX=${shared} %command%` },
    { appid: 2, exe: "/launcher", start: "", options: `STEAM_COMPAT_DATA_PATH=${alias} %command%` },
  ]);
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await detector().detectCandidates();
    expect(log.mock.calls.filter(([line]) => JSON.parse(line).reason === "missing-registry")).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});

// Synthetic binary KeyValues fixture, including fields Steam writes that discovery ignores.
function shortcuts(user: string, entries: Array<{ appid: number; exe: string; start: string; options?: string; name?: string }>) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const records = entries.map((entry, index) => {
    const appid = Buffer.alloc(4);
    appid.writeUInt32LE(entry.appid);
    return Buffer.concat([
      Buffer.from(`\0${index}\0\x02appid\0`),
      appid,
      string("AppName", entry.name ?? "World of Warcraft"),
      string("Exe", entry.exe),
      string("StartDir", entry.start),
      string("LaunchOptions", entry.options ?? ""),
      Buffer.from("\0tags\0"),
      string("0", "Game"),
      Buffer.from([8, 8]),
    ]);
  });
  const config = join(steam, "userdata", user, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "shortcuts.vdf"),
    Buffer.concat([Buffer.from("\0shortcuts\0"), ...records, Buffer.from([8, 8])]),
  );
}

function flavor(path: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "Wow.exe"), "");
  return path;
}

test.each(["Wow.exe", "Wow-ARM64.exe"])("a quoted %s shortcut discovers a launcher-free installation", async (exe) => {
  const retail = flavor(join(home, "unusual/client/_retail_"));
  rmSync(join(retail, "Wow.exe"));
  writeFileSync(join(retail, exe), "");
  shortcuts("100", [{ appid: 3000000001, exe: `\"${retail}/${exe}\"`, start: "" }]);
  expect(await detector().detectCandidates()).toEqual([
    {
      location: retail,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "steam-shortcut",
    },
  ]);
  expect((await detector().detect()).map((installation) => installation.location)).toEqual([
    retail,
  ]);
});

test("all Steam users contribute Exe and StartDir folder candidates with unchanged validity", async () => {
  const retail = flavor(join(home, "first/root/_retail_"));
  const era = join(home, "second/root/_classic_era_");
  mkdirSync(join(era, "Data"), { recursive: true });
  const beta = join(home, "third/root/_classic_beta_");
  mkdirSync(join(beta, "Interface"), { recursive: true });
  shortcuts("100", [{ appid: 3000000001, exe: retail, start: "" }]);
  shortcuts("200", [{ appid: 3000000002, exe: join(era, ".."), start: "" }]);
  steam = join(home, ".steam/steam");
  shortcuts("300", [{ appid: 3000000003, exe: "/missing/launcher.exe", start: `"${beta}"` }]);
  shortcuts("400", [{ appid: 3000000004, exe: "", start: join(era, "..") }]);
  expect(await detector().detectCandidates()).toEqual([
    {
      location: retail,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "steam-shortcut",
    },
    {
      location: beta,
      clientType: WowClientType.ClassicBeta,
      validity: "addon-data",
      detectionSource: "steam-shortcut",
    },
    {
      location: era,
      clientType: WowClientType.ClassicEra,
      validity: "likely",
      detectionSource: "steam-shortcut",
    },
  ]);
  expect((await detector().detect()).map((installation) => installation.location)).toEqual([
    retail,
    era,
  ]);
});

function prefix(appId: number, target: string, library = steam) {
  const path = join(library, "steamapps/compatdata", String(appId), "pfx");
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "system.reg"),
    `[Software\\\\Wow6432Node\\\\Blizzard Entertainment\\\\World of Warcraft]\n"InstallPath"="Z:${target.replaceAll("/", "\\\\")}"\n`,
  );
  return path;
}

test.each([
  ["unquoted", (path: string) => `STEAM_COMPAT_DATA_PATH=${path}/.. %command%`],
  ["quoted", (path: string) => `STEAM_COMPAT_DATA_PATH="${path}/.." %command%`],
  ["env", (path: string) => `env -- OTHER=1 STEAM_COMPAT_DATA_PATH='${path}/..' %command%`],
  ["Wine", (path: string) => `WINEPREFIX="${path}" /usr/bin/umu-run`],
])("%s override finds an external shared prefix with a different app ID", async (_name, options) => {
  const retail = flavor(join(home, "outside/_retail_"));
  const path = prefix(2596113170, retail, join(home, "external library"));
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  // An unquoted assignment cannot contain spaces.
  const alias = join(home, "shared");
  symlinkSync(join(path, ".."), alias);
  const input = _name === "unquoted" ? join(alias, "pfx") : path;
  shortcuts("100", [{ appid: 3249681327, exe: "/launcher", start: "", options: options(input) }]);
  expect((await detector().detectCandidates()).map(c => [c.location, c.detectionSource])).toEqual([
    [retail, "prefix-registry"],
  ]);
});

test("launcher paths inside pfx discover its registry without launch options", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const path = prefix(2596113170, retail);
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  shortcuts("100", [{ appid: 3249681327, exe: `"${path}/drive_c/Battle.net.exe"`, start: "" }]);
  expect((await detector().detectCandidates()).map(c => c.location)).toEqual([retail]);
});

test("live compatdata symlinks discover external prefix registries", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const path = prefix(123, retail, join(home, "external"));
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  const compat = join(steam, "steamapps/compatdata");
  mkdirSync(compat, { recursive: true });
  symlinkSync(join(path, ".."), join(compat, "3249681327"));
  shortcuts("100", [{ appid: 3249681327, exe: "/launcher", start: "" }]);
  expect((await detector().detectCandidates()).map(c => c.location)).toEqual([retail]);
});

test("registry discovery searches every prefix, including those without a live shortcut", async () => {
  const live = flavor(join(home, "live/_retail_"));
  const native = flavor(join(home, "native/_classic_era_"));
  const stale = flavor(join(home, "stale/_classic_beta_"));
  prefix(3000000001, live);
  const library = join(home, "external-library");
  prefix(123, native, library);
  writeFileSync(join(steam, "steamapps/libraryfolders.vdf"), `"path" "${library}"`);
  prefix(3000000002, stale);
  // Real drive mappings, including Z: outside the prefix.
  for (const id of [3000000001, 123, 3000000002]) {
    const path = join(
      id === 123 ? library : steam,
      "steamapps/compatdata",
      String(id),
      "pfx/dosdevices",
    );
    mkdirSync(path);
    symlinkSync("/", join(path, "z:"));
  }
  shortcuts("100", [{ appid: 3000000000, exe: "/launcher/other.exe", start: "" }]);
  shortcuts("200", [{ appid: 3000000001, exe: "/launcher/Battle.net.exe", start: "" }]);
  writeFileSync(join(library, "steamapps/appmanifest_123.acf"), '"appid" "123"');
  expect(await detector().detectCandidates()).toEqual([
    {
      location: live,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
    {
      location: stale,
      clientType: WowClientType.ClassicBeta,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
    {
      location: native,
      clientType: WowClientType.ClassicEra,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
  ]);
});

test.each([
  ["missing", undefined],
  ["truncated", Buffer.from("\0shortcuts\0\0\x30\0\x02appid\0\xff")],
  ["unknown value type", Buffer.from("\0shortcuts\0\x7ffield\0\x08\x08")],
  ["unterminated string", Buffer.from("\0shortcuts\0\0\x30\0\x01Exe\0broken")],
])(
  "a shortcut file that is %s cannot stop another user's shortcuts or other discovery",
  async (_name, bytes) => {
    const retail = flavor(join(home, "elsewhere/_retail_"));
    flavor(join(home, "Applications/World of Warcraft/_classic_era_")); // Fallback is unnecessary.
    const config = join(steam, "userdata/100/config");
    mkdirSync(config, { recursive: true });
    if (bytes) writeFileSync(join(config, "shortcuts.vdf"), bytes);
    shortcuts("200", [{ appid: 3000000001, exe: join(retail, "Wow.exe"), start: "" }]);
    expect(await detector().detectCandidates()).toEqual([
      {
        location: retail,
        clientType: WowClientType.Retail,
        validity: "confirmed",
        detectionSource: "steam-shortcut",
      },
    ]);
  },
);

test("shortcut discovery deduplicates below custom and registry sources and above folder probes", async () => {
  const retail = flavor(join(home, "Applications/World of Warcraft/_retail_"));
  shortcuts("100", [{ appid: 3000000001, exe: join(retail, "Wow.exe"), start: retail }]);
  expect(
    (await detector().detectCandidates()).map((candidate) => candidate.detectionSource),
  ).toEqual(["steam-shortcut"]);
  const custom = new InstallationDetector({
    homeDir: home,
    customPaths: [retail],
    scanRemovableMedia: false,
  });
  expect((await custom.detectCandidates()).map((candidate) => candidate.detectionSource)).toEqual([
    "custom",
  ]);
  const path = prefix(3000000001, retail);
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  expect(
    (await detector().detectCandidates()).map((candidate) => candidate.detectionSource),
  ).toEqual(["prefix-registry"]);
});

test("disabling Steam discovery skips shortcuts and their prefix registries", async () => {
  const retail = flavor(join(home, "elsewhere/_retail_"));
  shortcuts("100", [{ appid: 3000000001, exe: retail, start: "" }]);
  const disabled = new InstallationDetector({
    homeDir: home,
    scanSteam: false,
    scanRemovableMedia: false,
  });
  expect(await disabled.detectCandidates()).toEqual([]);
});

test("with no readable shortcut file, every compatdata prefix registry is still read", async () => {
  const live = flavor(join(home, "live/_retail_"));
  prefix(3000000001, live);
  const dosdevices = join(steam, "steamapps/compatdata/3000000001/pfx/dosdevices");
  mkdirSync(dosdevices);
  symlinkSync("/", join(dosdevices, "z:"));
  expect(await detector().detectCandidates()).toEqual([
    {
      location: live,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
  ]);
});


test.each(["World of Warcraft Launcher.exe", "Battle.net.exe", "Battle.net Launcher.exe"])("%s attaches a direct WoW root without confirming a launcher-only flavor", async (exe) => {
  const retail = flavor(join(home, "elsewhere/World of Warcraft/_retail_"));
  writeFileSync(join(retail, "..", exe), "");
  shortcuts("100", [{ appid: 42, exe: `"${join(retail, "..", exe)}"`, start: "" }]);
  const found = await detector().detect();
  expect(found.map(i => i.location)).toEqual([retail]);
  expect(found[0]!.steamGames).toEqual([{ appId: 42, name: "World of Warcraft" }]);
});

test("every WoW launcher sharing a registry prefix attaches, but another Blizzard game does not", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const path = prefix(123, retail);
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  const options = `STEAM_COMPAT_DATA_PATH="${join(path, "..")}" %command%`;
  shortcuts("100", [
    { appid: 42, name: "WoW", exe: "/launcher/Battle.net.exe", start: "", options: options + ' --exec="launch WoWF"' },
    { appid: 43, name: "Battle.net", exe: "/launcher/Battle.net Launcher.exe", start: "", options },
    { appid: 44, name: "Diablo", exe: "/launcher/Battle.net.exe", start: "", options: options + ' --exec="launch Fen"' },
    { appid: 45, name: "Overlay", exe: "/launcher/battlenet.overlay.runtime.exe", start: "", options },
  ]);
  expect((await detector().detect())[0]!.steamGames).toEqual([
    { appId: 42, name: "WoW" }, { appId: 43, name: "Battle.net" },
  ]);
});

test("known locations are a last resort and do not attach unrelated Steam entries", async () => {
  const fallback = flavor(join(home, "Applications/World of Warcraft/_retail_"));
  shortcuts("100", [{ appid: 42, name: "Battle.net", exe: "/unrelated/Battle.net.exe", start: "" }]);
  const found = await detector().detect();
  expect(found.map(i => i.location)).toEqual([fallback]);
  expect(found[0]!.steamGames ?? []).toEqual([]);
});

test.each([false, true])("discovery persists all Steam links, removes stale links, and preserves autoUpdate=%s", async (autoUpdate) => {
  const { StateStore } = await import("../src/wow/storage/StateStore");
  const { InstallationService } = await import("../src/wow/installation/InstallationService");
  const retail = flavor(join(home, "outside/_retail_"));
  shortcuts("100", [{ appid: 42, exe: join(retail, "Wow.exe"), start: "" }]);
  const store = new StateStore(join(home, "state.json"));
  store.updateSettings({ autoUpdate, steamAutoCheck: false, steamBadge: false, steamGame: { appId: 9, name: "My manual entry" } });
  const service = new InstallationService(store, async () => {});
  expect((await service.detect(home))[0]!.steamGames).toEqual([{ appId: 42, name: "World of Warcraft" }]);
  expect(store.settings.autoUpdate).toBe(autoUpdate);
  expect(store.settings.steamAutoCheck).toBe(false);
  expect(store.settings.steamBadge).toBe(false);
  expect(store.settings.steamGame).toEqual({ appId: 9, name: "My manual entry" });
  shortcuts("100", []);
  expect((await service.detect(home))[0]!.steamGames).toEqual([]);
  expect(store.settings.autoUpdate).toBe(autoUpdate);
});

test("an explicit prefix override does not attach the shortcut to its old default prefix", async () => {
  const old = flavor(join(home, "old/_retail_"));
  const actual = flavor(join(home, "actual/_classic_era_"));
  for (const [id, dir] of [[42, old], [123, actual]] as const) {
    const path = prefix(id, dir);
    mkdirSync(join(path, "dosdevices"));
    symlinkSync("/", join(path, "dosdevices/z:"));
  }
  shortcuts("100", [{ appid: 42, exe: "/launcher/Battle.net.exe", start: "", options: `STEAM_COMPAT_DATA_PATH=${join(steam, "steamapps/compatdata/123")} %command%` }]);
  const found = await detector().detect();
  expect(found.find(i => i.location === actual)!.steamGames).toEqual([{ appId: 42, name: "World of Warcraft" }]);
  expect(found.find(i => i.location === old)!.steamGames ?? []).toEqual([]);
});

test("an executable's prefix ancestry does not override Proton's default appId prefix", async () => {
  const copied = flavor(join(home, "copied/_retail_"));
  const actual = flavor(join(home, "actual/_classic_era_"));
  for (const [id, dir] of [[123, copied], [42, actual]] as const) {
    const path = prefix(id, dir);
    mkdirSync(join(path, "dosdevices"));
    symlinkSync("/", join(path, "dosdevices/z:"));
  }
  shortcuts("100", [{ appid: 42, exe: join(steam, "steamapps/compatdata/123/pfx/drive_c/Battle.net.exe"), start: "" }]);
  const found = await detector().detect();
  expect(found.find(i => i.location === actual)!.steamGames).toEqual([{ appId: 42, name: "World of Warcraft" }]);
  expect(found.find(i => i.location === copied)!.steamGames ?? []).toEqual([]);
});

test("a wrapper with an explicit WoW product and prefix attaches through registry evidence", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const path = prefix(123, retail);
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  const options = `WINEPREFIX="${path}" /usr/bin/umu-run`;
  shortcuts("100", [
    { appid: 42, name: "Wrapped WoW", exe: "/usr/bin/umu-run", start: "", options: options + ' --exec="launch WoWF"' },
    { appid: 43, name: "Unknown game", exe: "/usr/bin/umu-run", start: "", options },
    { appid: 44, name: "Diablo", exe: "/usr/bin/umu-run", start: "", options: options + ' --exec="launch Fen"' },
  ]);
  expect((await detector().detect())[0]!.steamGames).toEqual([{ appId: 42, name: "Wrapped WoW" }]);
});
