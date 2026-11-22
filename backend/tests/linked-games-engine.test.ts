/**
 * Linked games (GLOSSARY) on the real engine, assembled in-process over a
 * synthetic Steam `shortcuts.vdf` and a WoW root in a temp home: the one
 * answer Steam's pages and every `launch.*` method read.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, LinkedGames } from "../src/api/contracts";
import { configFromEnv, startEngine } from "../src/engine";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import type { LaunchWorld } from "../src/wow/launch/LaunchService";
import { writeProductDb } from "./helpers/productDb";
import { writeShortcuts, type ShortcutFixture } from "./helpers/steamShortcuts";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const WOW = 42;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Nothing runs: the launch reads only need an observation. */
const idleWorld: LaunchWorld = {
  now: () => 0,
  wait: () => new Promise(() => {}),
  observe: async () => ({ entryRunning: false, renderer: null, gameRunning: "not_running", targetRunning: null }),
  ask: async () => null,
};

interface Setup {
  /** The Steam user's shortcuts; one named Battle.net shortcut for WoW when unset. */
  shortcuts?: (launcher: string) => ShortcutFixture[];
  /** A state.json an older build left behind. */
  state?: unknown;
  /** The engine's file system, to make the state file refuse a write. */
  fs?: FaultInjectingFs;
}

/** A Retail WoW root that Battle.net, in each shortcut's Steam prefix, lists. */
async function fixture(setup: Setup = {}) {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-linked-games-"));
  roots.push(root);
  const home = join(root, "home");
  const data = join(root, "data");
  const steam = join(home, ".local/share/Steam");
  const wow = join(home, "Games/World of Warcraft");
  mkdirSync(join(wow, "_retail_"), { recursive: true });
  writeFileSync(join(wow, "_retail_", "Wow.exe"), "");
  const launcher = join(wow, "Battle.net Launcher.exe");
  writeFileSync(launcher, "");
  const shortcuts = setup.shortcuts?.(launcher) ?? [{ appId: WOW, name: "World of Warcraft", exe: launcher }];
  for (const { appId } of shortcuts) {
    writeProductDb(join(steam, "steamapps/compatdata", String(appId), "pfx"), [
      { uid: "wow", installPath: `Z:${wow}`, subfolder: "_retail_" },
    ]);
  }
  writeShortcuts(steam, shortcuts);
  if (setup.state !== undefined) {
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "state.json"), JSON.stringify(setup.state));
  }

  const events: LinkedGames[] = [];
  const out = (line: string) => {
    const message = JSON.parse(line) as Partial<EngineEvent>;
    if (message.event === "linkedGames.changed") events.push(message.params as LinkedGames);
  };
  const start = async () => startEngine({
    ...configFromEnv({ HOME: home, WOWDECK_DATA_DIR: data }, "9.9.9"),
    network: new ReplayNetwork(await loadCassette("wowup-hub")),
    now: () => Date.UTC(2026, 10, 20),
    out,
    launchWorld: idleWorld,
    fs: setup.fs,
  });
  const f = {
    engine: await start(),
    events,
    linked: () => f.engine.call("linkedGames.get", {}),
    state: async (appId = WOW) => (await f.engine.call("launch.state", { appId })).state,
    launcher,
    /** Steam renamed the WoW shortcut. */
    rename: (name: string) => writeShortcuts(steam, [{ appId: WOW, name, exe: launcher }]),
    /** Steam user 100's shortcuts are now these. */
    writeShortcuts: (now: ShortcutFixture[]) => writeShortcuts(steam, now),
    /** A second Steam user, whose shortcuts file can't be read. */
    corruptShortcuts: () => {
      mkdirSync(join(steam, "userdata/200/config"), { recursive: true });
      writeFileSync(join(steam, "userdata/200/config/shortcuts.vdf"), "not a vdf");
    },
    /** A new engine over the same home and data directory: what a reboot reads. */
    restart: async () => {
      f.engine = await start();
    },
  };
  return f;
}

test("a found WoW shortcut is a linked game marked found, and its Play has launch state", async () => {
  const f = await fixture();
  expect(await f.linked()).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
  expect((await f.state())?.target).toMatchObject({ kind: "battlenet" });
});

test("an added Battle.net shortcut detection didn't name gets launch state", async () => {
  // Steam gave the shortcut no name, so detection links it to nothing:
  // the launch code must take the engine's list, not only what it found.
  const f = await fixture({ shortcuts: (launcher) => [{ appId: WOW, name: "", exe: launcher }] });
  expect((await f.linked()).games).toEqual([]);
  expect(await f.state()).toBeNull();

  expect(await f.engine.call("linkedGames.add", { appId: WOW, name: "Battle.net" })).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "Battle.net", source: "added" }],
    removed: [],
  });
  expect((await f.state())?.target).toMatchObject({ kind: "battlenet" });
});

test("Show in Steam off keeps the list and unlinks every app id for launch; on restores it", async () => {
  const f = await fixture();
  const launchReads = async () => ({
    state: await f.state(),
    start: await f.engine.call("launch.start", { appId: WOW, canStartSteam: true }),
    icon: (await f.engine.call("launch.icon", { appId: WOW, targetId: "battlenet" })).icon,
    select: await f.engine.call("launch.select", { appId: WOW, targetId: "battlenet" }).then(
      () => "selected",
      (err: Error) => err.message,
    ),
  });
  await f.engine.call("settings.set", { settings: { steamEnabled: false } });
  expect(await f.linked()).toEqual({
    enabled: false,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
  expect(await launchReads()).toEqual({
    state: null,
    start: { state: null },
    icon: null,
    select: "This client can't be launched from this Steam game page",
  });

  await f.engine.call("settings.set", { settings: { steamEnabled: true } });
  expect((await f.linked()).enabled).toBe(true);
  expect((await f.state())?.target).toMatchObject({ kind: "battlenet" });
});

/**
 * A state.json from before linked games: the Retail installation detection
 * linked to WoW's shortcut, plus the old hand-made link and toggle.
 */
const oldState = (settings: Record<string, unknown>) => ({
  installations: [{
    id: "retail-0",
    clientType: 0,
    location: "/elsewhere/World of Warcraft/_retail_",
    label: "Retail",
    displayName: "Retail",
    selected: true,
    defaultAddonChannelType: 0,
    source: "detected",
    steamGames: [{ appId: WOW, name: "World of Warcraft" }],
  }],
  addons: [],
  settings,
});

test("upgrade: a hand-made link to a found game is dropped as a duplicate", async () => {
  const f = await fixture({ state: oldState({ steamGame: { appId: WOW, name: "World of Warcraft" }, steamAutoLink: true }) });
  expect(await f.linked()).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
  expect((await f.engine.call("settings.get", {})).settings.steamAddedGames).toEqual([]);
});

/** WoW's shortcut, and a Lutris shortcut detection doesn't recognise. */
const withLutris = (launcher: string): ShortcutFixture[] => [
  { appId: WOW, name: "World of Warcraft", exe: launcher },
  { appId: 77, name: "Lutris WoW", exe: "/usr/bin/lutris" },
];

test("upgrade: a hand-made link to a game detection doesn't find becomes an added game", async () => {
  const f = await fixture({
    shortcuts: withLutris,
    state: oldState({ steamGame: { appId: 77, name: "Lutris WoW" } }),
  });
  expect(await f.linked()).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [
      { appId: WOW, name: "World of Warcraft", source: "found" },
      { appId: 77, name: "Lutris WoW", source: "added" },
    ],
    removed: [],
  });
});

test("upgrade: Link detected Steam games off starts Show in Steam off", async () => {
  const f = await fixture({ state: oldState({ steamGame: null, steamAutoLink: false }) });
  expect(await f.linked()).toEqual({
    enabled: false,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
  expect(await f.state()).toBeNull();
});

test("a hidden installation's found game stays linked", async () => {
  const f = await fixture();
  const [retail] = (await f.engine.call("installations.list", {})).installations;
  await f.engine.call("installations.update", { installationId: retail!.id, hidden: true });
  await f.engine.call("installations.detect", {});
  expect((await f.linked()).games).toEqual([{ appId: WOW, name: "World of Warcraft", source: "found" }]);
  expect(await f.state()).not.toBeNull();
});

test("linkedGames.changed fires after a scan and after a Show in Steam change", async () => {
  const f = await fixture();
  f.events.splice(0);
  await f.engine.call("installations.detect", {});
  expect(f.events).toEqual([{ enabled: true, playOwner: "wowdeck", games: [{ appId: WOW, name: "World of Warcraft", source: "found" }], removed: [] }]);

  await f.engine.call("settings.set", { settings: { steamEnabled: false } });
  expect(f.events.at(-1)).toEqual({ enabled: false, playOwner: "wowdeck", games: [{ appId: WOW, name: "World of Warcraft", source: "found" }], removed: [] });
  const count = f.events.length;
  await f.engine.call("settings.set", { settings: { steamBadge: false } });
  expect(f.events).toHaveLength(count);
});

test("an add and a remove fire linkedGames.changed; adding a found game keeps it found", async () => {
  const f = await fixture();
  f.events.splice(0);
  await f.engine.call("linkedGames.add", { appId: 77, name: "Lutris WoW" });
  expect(f.events.at(-1)?.games).toContainEqual({ appId: 77, name: "Lutris WoW", source: "added" });
  await f.engine.call("linkedGames.remove", { appId: 77 });
  expect(f.events.at(-1)?.games).toEqual([{ appId: WOW, name: "World of Warcraft", source: "found" }]);

  // Picking the found game adds nothing beside it.
  expect((await f.engine.call("linkedGames.add", { appId: WOW, name: "WoW" })).games).toEqual([
    { appId: WOW, name: "World of Warcraft", source: "found" },
  ]);
  expect((await f.engine.call("settings.get", {})).settings.steamAddedGames).toEqual([]);
});

test("the diagnosis repro: an added game no longer survives Show in Steam off, and a pick keeps the found game", async () => {
  // A second Battle.net shortcut Steam gave no name: only adding links it.
  const f = await fixture({
    shortcuts: (launcher) => [
      { appId: WOW, name: "World of Warcraft", exe: launcher },
      { appId: 43, name: "", exe: launcher },
    ],
  });
  await f.engine.call("linkedGames.add", { appId: 43, name: "Battle.net" });
  // A pick adds beside the found game instead of replacing it.
  expect((await f.linked()).games.map(({ appId, source }) => [appId, source])).toEqual([
    [WOW, "found"],
    [43, "added"],
  ]);
  for (const appId of [WOW, 43]) expect(await f.state(appId)).not.toBeNull();
  // Off hides everything, the hand-added game included.
  await f.engine.call("settings.set", { settings: { steamEnabled: false } });
  expect((await f.linked()).enabled).toBe(false);
  for (const appId of [WOW, 43]) expect(await f.state(appId)).toBeNull();
});

test("settings.set can't write the added games", async () => {
  const f = await fixture();
  await f.engine.call("settings.set", { settings: { steamAddedGames: [{ appId: 77, name: "x" }] } });
  expect((await f.linked()).games.map((game) => game.appId)).toEqual([WOW]);
});

test("removing a found game unlinks it, through rescans and restarts", async () => {
  const f = await fixture();
  expect(await f.engine.call("linkedGames.remove", { appId: WOW })).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [],
    removed: [{ appId: WOW, name: "World of Warcraft" }],
  });
  expect(await f.state()).toBeNull();

  await f.engine.call("installations.detect", {});
  expect((await f.linked()).games).toEqual([]);
  expect(await f.state()).toBeNull();

  await f.restart();
  expect((await f.linked()).games).toEqual([]);
  expect(await f.state()).toBeNull();
});

test("removing an added game deletes it instead of remembering it as removed", async () => {
  const f = await fixture();
  await f.engine.call("linkedGames.add", { appId: 77, name: "Lutris WoW" });
  expect((await f.engine.call("linkedGames.remove", { appId: 77 })).games).toEqual([
    { appId: WOW, name: "World of Warcraft", source: "found" },
  ]);
  const { settings } = await f.engine.call("settings.get", {});
  expect(settings.steamAddedGames).toEqual([]);
  expect(settings.steamRemovedGames).toEqual([]);
});

test("removing a found game fires linkedGames.changed", async () => {
  const f = await fixture();
  f.events.splice(0);
  await f.engine.call("linkedGames.remove", { appId: WOW });
  expect(f.events).toEqual([{ enabled: true, playOwner: "wowdeck", games: [], removed: [{ appId: WOW, name: "World of Warcraft" }] }]);
});

test("a found game the player had also added is removed in full", async () => {
  // Added while Steam gave the shortcut no name; named later, a scan found it.
  const f = await fixture({ shortcuts: (launcher) => [{ appId: WOW, name: "", exe: launcher }] });
  await f.engine.call("linkedGames.add", { appId: WOW, name: "Battle.net" });
  f.rename("World of Warcraft");
  await f.engine.call("installations.detect", {});
  expect((await f.linked()).games).toEqual([{ appId: WOW, name: "World of Warcraft", source: "found" }]);

  await f.engine.call("linkedGames.remove", { appId: WOW });
  expect((await f.linked()).games).toEqual([]);
  await f.restart();
  expect((await f.linked()).games).toEqual([]);
});

test("removing a game that isn't linked fails", async () => {
  const f = await fixture();
  await expect(f.engine.call("linkedGames.remove", { appId: 999 })).rejects.toThrow("isn't linked");
});

test("a remove the state file can't take fails, and the game stays linked", async () => {
  const fs = new FaultInjectingFs();
  const f = await fixture({ fs });
  fs.failAt("state.replace");
  await expect(f.engine.call("linkedGames.remove", { appId: WOW })).rejects.toThrow();
  fs.clear();
  expect((await f.linked()).games.map((game) => game.appId)).toEqual([WOW]);
  await f.restart();
  expect((await f.linked()).games.map((game) => game.appId)).toEqual([WOW]);
});

test("the read names the removed games, for the Add a game picker", async () => {
  const f = await fixture();
  await f.engine.call("linkedGames.remove", { appId: WOW });
  expect(await f.linked()).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [],
    removed: [{ appId: WOW, name: "World of Warcraft" }],
  });
});

test("adding a removed found game links it as found again and takes it off the removed list", async () => {
  const f = await fixture();
  await f.engine.call("linkedGames.remove", { appId: WOW });
  expect(await f.engine.call("linkedGames.add", { appId: WOW, name: "World of Warcraft" })).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
  const { settings } = await f.engine.call("settings.get", {});
  expect(settings.steamAddedGames).toEqual([]);
  expect(settings.steamRemovedGames).toEqual([]);
  await f.restart();
  expect((await f.linked()).games).toEqual([{ appId: WOW, name: "World of Warcraft", source: "found" }]);
});

test("Find games brings a removed game back as found and names it; installations.detect doesn't", async () => {
  const f = await fixture();
  await f.engine.call("linkedGames.remove", { appId: WOW });
  await f.engine.call("installations.detect", {});
  expect((await f.linked()).games).toEqual([]);

  expect(await f.engine.call("linkedGames.find", {})).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
    found: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
  });
  expect((await f.state())?.target).toMatchObject({ kind: "battlenet" });
});

test("Find games names nothing when every found game was already linked", async () => {
  const f = await fixture();
  expect((await f.engine.call("linkedGames.find", {})).found).toEqual([]);
});

test("Find games fires linkedGames.changed with the restored list", async () => {
  const f = await fixture();
  await f.engine.call("linkedGames.remove", { appId: WOW });
  f.events.splice(0);
  await f.engine.call("linkedGames.find", {});
  expect(f.events.at(-1)).toEqual({
    enabled: true,
    playOwner: "wowdeck",
    games: [{ appId: WOW, name: "World of Warcraft", source: "found" }],
    removed: [],
  });
});

test("a scan forgets added and removed games deleted from shortcuts.vdf", async () => {
  const f = await fixture({ shortcuts: withLutris });
  await f.engine.call("linkedGames.add", { appId: 77, name: "Lutris WoW" });
  await f.engine.call("linkedGames.remove", { appId: WOW });
  // A scan with both shortcuts still in Steam keeps both lists.
  await f.engine.call("installations.detect", {});
  expect(await f.linked()).toMatchObject({
    games: [{ appId: 77, source: "added" }],
    removed: [{ appId: WOW }],
  });

  f.writeShortcuts([]);
  f.events.splice(0);
  await f.engine.call("installations.detect", {});
  expect(await f.linked()).toEqual({ enabled: true, playOwner: "wowdeck", games: [], removed: [] });
  const { settings } = await f.engine.call("settings.get", {});
  expect(settings.steamAddedGames).toEqual([]);
  expect(settings.steamRemovedGames).toEqual([]);
  expect(f.events.at(-1)).toEqual({ enabled: true, playOwner: "wowdeck", games: [], removed: [] });
});

test("the startup scan forgets an added game deleted from Steam while WoWDeck wasn't running", async () => {
  const f = await fixture({ shortcuts: withLutris });
  await f.engine.call("linkedGames.add", { appId: 77, name: "Lutris WoW" });
  f.writeShortcuts([{ appId: WOW, name: "World of Warcraft", exe: f.launcher }]);
  await f.restart();
  expect((await f.linked()).games.map(({ appId }) => appId)).toEqual([WOW]);
});

test("a shortcuts file that can't be read forgets nothing", async () => {
  const f = await fixture({ shortcuts: withLutris });
  await f.engine.call("linkedGames.add", { appId: 77, name: "Lutris WoW" });
  // The game may live in the unreadable user's shortcuts.
  f.writeShortcuts([{ appId: WOW, name: "World of Warcraft", exe: f.launcher }]);
  f.corruptShortcuts();
  await f.engine.call("installations.detect", {});
  expect((await f.linked()).games).toContainEqual({ appId: 77, name: "Lutris WoW", source: "added" });
});
