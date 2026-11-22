/**
 * Play on DroidDeck (GLOSSARY: Launch target), on the real engine assembled
 * in-process over a DroidDeck-made Battle.net shortcut, with fake processes
 * in place of the machine's and a temporary system root that holds
 * DroidDeck's store launcher or doesn't.
 */

import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, LaunchCompletion, LinkedGames } from "../src/api/contracts";
import { configFromEnv, startEngine, type Engine } from "../src/engine";
import type { LaunchWorld } from "../src/wow/launch/LaunchService";
import { writeProductDb } from "./helpers/productDb";
import { writeShortcuts } from "./helpers/steamShortcuts";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

/** The phone's Forever game (docs/hardware/2026-11-21-droiddeck-launch). */
const APP_ID = 3249681327;
/** DroidDeck's shared Battle.net prefix. */
const PREFIX_ID = 2596113170;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Marker = "executable" | "not-executable" | "absent";

/** A system root, with DroidDeck's store launcher as `marker` says. */
function systemRoot(root: string, marker: Marker): string {
  const system = join(root, `system-${marker}`);
  const bin = join(system, "usr/local/bin");
  mkdirSync(bin, { recursive: true });
  if (marker !== "absent") {
    const launcher = join(bin, "droiddeck-store-launch");
    writeFileSync(launcher, "#!/bin/sh\n");
    chmodSync(launcher, marker === "executable" ? 0o755 : 0o644);
  }
  return system;
}

/**
 * Forever, which Battle.net lists in DroidDeck's shared prefix, and the
 * Steam game DroidDeck made for it: Battle.net in that prefix, told to
 * start Forever.
 */
function droidDeckHome(root: string) {
  const home = join(root, "home");
  const steam = join(home, ".local/share/Steam");
  const wow = join(home, "Games/Stores/Battle.net/World of Warcraft");
  mkdirSync(join(wow, "_forever_"), { recursive: true });
  writeFileSync(join(wow, "_forever_", "Wow.exe"), "");
  const launcher = join(wow, "Battle.net Launcher.exe");
  writeFileSync(launcher, "");
  const compatData = join(steam, "steamapps/compatdata", String(PREFIX_ID));
  writeProductDb(join(compatData, "pfx"), [
    { uid: "wowf", installPath: `Z:${wow}`, subfolder: "_forever_" },
  ]);
  writeShortcuts(steam, [{
    appId: APP_ID,
    name: "World of Warcraft: Forever",
    exe: launcher,
    launchOptions: `STEAM_COMPAT_DATA_PATH="${compatData}" %command% --exec="launch WoWF"`,
  }]);
  return home;
}

/** The engine over one home and data folder; pass `root` again for a restart. */
async function fixture(marker: Marker, previous?: string) {
  const root = previous ?? mkdtempSync(join(tmpdir(), "wowdeck-droiddeck-"));
  if (!previous) {
    roots.push(root);
    droidDeckHome(root);
  }
  const asks: unknown[] = [];
  let tick: (() => void) | undefined;
  let now = 0;
  const world: LaunchWorld = {
    now: () => now,
    wait: () => new Promise<void>((resolve) => { tick = resolve; }),
    // Battle.net is open and ready: a launch WoWDeck owned would ask it.
    observe: async () => ({ entryRunning: true, renderer: 11, gameRunning: "not_running", targetRunning: null }),
    ask: async (replay) => {
      asks.push(replay);
      return { startupFailed: Promise.resolve(false) };
    },
  };
  const completions: LaunchCompletion[] = [];
  const linkedEvents: LinkedGames[] = [];
  const out = (line: string) => {
    const message = JSON.parse(line) as Partial<EngineEvent>;
    if (message.event === "launch.completed") completions.push(message.params as LaunchCompletion);
    if (message.event === "linkedGames.changed") linkedEvents.push(message.params as LinkedGames);
  };
  const engine: Engine = await startEngine({
    ...configFromEnv({ HOME: join(root, "home"), WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9"),
    network: new ReplayNetwork(await loadCassette("wowup-hub")),
    now: () => Date.UTC(2026, 10, 21),
    out,
    launchWorld: world,
    systemRoot: systemRoot(root, marker),
  });
  const { installations } = await engine.call("installations.list", {});
  return {
    root, engine, asks, completions, linkedEvents,
    forever: installations.find((i) => i.path.endsWith("_forever_"))?.id ?? "",
    linked: () => engine.call("linkedGames.get", {}),
    state: async () => (await engine.call("launch.state", { appId: APP_ID })).state,
    start: () => engine.call("launch.start", { appId: APP_ID, canStartSteam: true }),
    select: (targetId: string) => engine.call("launch.select", { appId: APP_ID, targetId }),
    icon: async (targetId: string) => (await engine.call("launch.icon", { appId: APP_ID, targetId })).icon,
    /** The settings as saved in the state file. */
    saved: () => (JSON.parse(readFileSync(join(root, "data/state.json"), "utf8")) as {
      settings: { steamLaunchMenu?: unknown; steamLaunchTargets?: unknown };
    }).settings,
    /** Let a running attempt see the clock reach `ms`. */
    async at(ms: number) {
      now = ms;
      tick?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

test("without DroidDeck's store launcher, WoWDeck owns Play on a DroidDeck-made shortcut", async () => {
  const f = await fixture("absent");
  expect(await f.linked()).toMatchObject({
    playOwner: "wowdeck",
    games: [{ appId: APP_ID, source: "found" }],
  });
  expect((await f.state())?.clients.map(({ shortName }) => shortName)).toEqual(["Battle.net", "Forever"]);
  expect((await f.select(f.forever)).target.shortName).toBe("Forever");

  expect((await f.start()).state?.busy).toBe(true);
  await f.at(15_000);
  expect(f.asks).toHaveLength(1);
});

test("with DroidDeck's store launcher, Play is left to DroidDeck: no launch state, no start, no ask", async () => {
  const f = await fixture("executable");
  expect(await f.linked()).toMatchObject({
    playOwner: "droiddeck",
    games: [{ appId: APP_ID, source: "found" }],
  });
  expect(await f.state()).toBeNull();
  expect(await f.engine.call("launch.state", { appId: 42 })).toEqual({ state: null });

  expect(await f.start()).toEqual({ state: null });
  for (const ms of [15_000, 30_000, 150_000]) await f.at(ms);
  expect(f.asks).toEqual([]);
  expect(f.completions).toEqual([]);

  for (const target of ["battlenet", f.forever]) {
    expect(await f.icon(target)).toBeNull();
    await expect(f.select(target)).rejects.toMatchObject({ code: "play_left_to_droiddeck" });
  }
});

test("linkedGames.changed names DroidDeck too", async () => {
  const f = await fixture("executable");
  await f.engine.call("settings.set", { settings: { steamEnabled: false } });
  expect(f.linkedEvents.at(-1)).toMatchObject({ enabled: false, playOwner: "droiddeck" });
});

test("a store launcher that isn't executable isn't DroidDeck", async () => {
  const f = await fixture("not-executable");
  expect((await f.linked()).playOwner).toBe("wowdeck");
  expect((await f.state())?.target.kind).toBe("battlenet");
});

test("on DroidDeck, saved launch targets and Play starts WoW are left as they are, and come back off DroidDeck", async () => {
  const first = await fixture("absent");
  await first.select(first.forever);
  await first.engine.call("settings.set", { settings: { steamLaunchMenu: false } });
  const before = first.saved();
  expect(before.steamLaunchTargets).toEqual({ [String(APP_ID)]: first.forever });

  const droidDeck = await fixture("executable", first.root);
  expect(await droidDeck.state()).toBeNull();
  await droidDeck.start();
  await droidDeck.select("battlenet").catch(() => {});
  expect((await droidDeck.engine.call("settings.get", {})).settings).toMatchObject({
    steamLaunchMenu: false,
    steamLaunchTargets: { [String(APP_ID)]: first.forever },
  });
  expect(droidDeck.saved()).toMatchObject({
    steamLaunchMenu: before.steamLaunchMenu,
    steamLaunchTargets: before.steamLaunchTargets,
  });

  const again = await fixture("absent", first.root);
  expect((await again.state())?.target.shortName).toBe("Forever");
});
