/**
 * The `launch.*` methods on the real engine, assembled in-process over a
 * recorded Steam shortcut and a WoW root, with fake processes in place of
 * the machine's.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { LaunchCompletion } from "../src/api/contracts";
import { configFromEnv, startEngine, type Engine } from "../src/engine";
import type { LaunchWorld, Observation } from "../src/wow/launch/LaunchService";
import { writeProductDb } from "./helpers/productDb";
import { readLaunchIconFile, type LaunchIconRead } from "../src/wow/launch/LaunchIcons";
import { BMP, PNG, syntheticPe } from "./helpers/syntheticPe";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const APP_ID = 42;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Synthetic binary KeyValues shortcuts.vdf with one non-Steam shortcut. */
function writeShortcut(steam: string, exe: string) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const appid = Buffer.alloc(4);
  appid.writeUInt32LE(APP_ID);
  const record = Buffer.concat([
    Buffer.from("\x000\0\x02appid\0"),
    appid,
    string("AppName", "World of Warcraft"),
    string("Exe", `"${exe}"`),
    string("StartDir", ""),
    string("LaunchOptions", ""),
    Buffer.from([8]),
  ]);
  const config = join(steam, "userdata/100/config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "shortcuts.vdf"),
    Buffer.concat([Buffer.from("\0shortcuts\0"), record, Buffer.from([8, 8])]),
  );
}

interface Setup {
  /** The shortcut's executable, relative to the WoW root. */
  exe?: string;
  /** Bytes of the launcher executable; empty when unset. */
  launcher?: Uint8Array;
  /** Reuse an earlier fixture's home and data (an engine restart). */
  root?: string;
  readIcon?: LaunchIconRead;
  renameIcon?: (from: string, to: string) => Promise<void>;
  dataDir?: string;
  version?: string;
}

/** A WoW root with Retail, Classic and Forever, linked to one Battle.net shortcut. */
async function fixture(setup: Setup = {}) {
  const root = setup.root ?? mkdtempSync(join(tmpdir(), "wowdeck-launch-engine-"));
  if (!setup.root) roots.push(root);
  const home = join(root, "home");
  const steam = join(home, ".local/share/Steam");
  const wow = join(home, "Games/World of Warcraft");
  for (const [flavor, exe] of [["_retail_", "Wow.exe"], ["_classic_", "WowClassic.exe"], ["_classic_era_", "WowClassic.exe"], ["_forever_", "Wow.exe"]]) {
    mkdirSync(join(wow, flavor!), { recursive: true });
    writeFileSync(join(wow, flavor!, exe!), "");
  }
  writeFileSync(join(wow, "Battle.net Launcher.exe"), setup.launcher ?? "");
  writeProductDb(join(steam, "steamapps/compatdata", String(APP_ID), "pfx"), [
    { uid: "wow", installPath: `Z:${wow}`, subfolder: "_retail_" },
    { uid: "wow_classic", installPath: `Z:${wow}`, subfolder: "_classic_" },
    { uid: "wow_classic_era", installPath: `Z:${wow}`, subfolder: "_classic_era_" },
    { uid: "wowf", installPath: `Z:${wow}`, subfolder: "_forever_" },
  ]);
  writeShortcut(steam, join(wow, setup.exe ?? "Battle.net Launcher.exe"));

  let now = 0;
  let tick: (() => void) | undefined;
  const asks: number[] = [];
  const observation: Omit<Observation, "targetRunning"> & { running?: string } = {
    entryRunning: false, renderer: null, gameRunning: "not_running",
  };
  const world: LaunchWorld = {
    now: () => now,
    wait: () => new Promise<void>((resolve) => { tick = resolve; }),
    // `running` names the flavor folder of a WoW client running in the prefix.
    observe: async (entry) => {
      const { running, ...rest } = observation;
      const target = entry.targetFolders?.find(({ path }) => basename(path) === running);
      return { ...rest, ...(running && { gameRunning: "running" }), targetRunning: target?.path ?? null };
    },
    ask: async () => {
      asks.push(now);
      return { startupFailed: Promise.resolve(false) };
    },
  };
  const completions: LaunchCompletion[] = [];
  const out = (line: string) => {
    const message = JSON.parse(line) as { event?: string; params?: LaunchCompletion };
    if (message.event === "launch.completed") completions.push(message.params!);
  };
  const base = configFromEnv({ HOME: home, WOWDECK_DATA_DIR: setup.dataDir ?? join(root, "data") }, setup.version ?? "9.9.9");
  const engine: Engine = await startEngine({
    ...base,
    network: new ReplayNetwork(await loadCassette("wowup-hub")),
    now: () => Date.UTC(2026, 10, 1),
    out,
    launchWorld: world,
    launchIconRead: setup.readIcon,
    launchIconRename: setup.renameIcon,
  });
  const { installations } = await engine.call("installations.list", {});
  // A direct client shortcut discovers its own flavor only.
  const id = (flavor: string) => installations.find((i) => i.path.endsWith(flavor))?.id ?? "";
  return {
    root, engine, observation, asks, completions,
    retail: id("_retail_"), classic: id("_classic_"), era: id("_classic_era_"), forever: id("_forever_"),
    selected: async () =>
      (await engine.call("installations.list", {})).installations.find((i) => i.selected)?.id,
    state: async () => (await engine.call("launch.state", { appId: APP_ID })).state,
    icon: async (targetId: string) =>
      (await engine.call("launch.icon", { appId: APP_ID, targetId })).icon,
    select: (targetId: string) => engine.call("launch.select", { appId: APP_ID, targetId }),
    start: (canStartSteam = true) => engine.call("launch.start", { appId: APP_ID, canStartSteam }),
    async at(ms: number) {
      now = ms;
      tick?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

test("Battle.net is the default target and leads Retail, one Classic row and Forever", async () => {
  const f = await fixture();
  const state = await f.state();
  expect(state?.target).toMatchObject({ kind: "battlenet", id: "battlenet" });
  expect(state?.clients).toEqual([
    { kind: "battlenet", id: "battlenet", name: "Battle.net", shortName: "Battle.net" },
    { kind: "wow", id: f.retail, name: "World of Warcraft", shortName: "Retail" },
    { kind: "wow", id: "classic", name: "World of Warcraft Classic", shortName: "Classic" },
    { kind: "wow", id: f.forever, name: "World of Warcraft: Forever", shortName: "Forever" },
  ]);
});

test("picking any row changes only the launch target, never My Addons' installation", async () => {
  const f = await fixture();
  const active = await f.selected();
  for (const id of [f.forever, "classic", "battlenet", f.retail]) {
    expect((await f.select(id)).target.id).toBe(id);
    expect((await f.state())?.target.id).toBe(id);
    expect(await f.selected()).toBe(active);
  }
});

test("a saved choice survives an engine restart", async () => {
  const first = await fixture();
  await first.select(first.forever);
  const again = await fixture({ root: first.root });
  expect((await again.state())?.target).toMatchObject({ kind: "wow", id: first.forever, shortName: "Forever" });
});

/** Writes a launch target the way an earlier picker saved it. */
function saveTarget(root: string, targetId: string) {
  const file = join(root, "data/state.json");
  const saved = JSON.parse(readFileSync(file, "utf8")) as { settings: Record<string, unknown> };
  saved.settings.steamLaunchTargets = { [String(APP_ID)]: targetId };
  writeFileSync(file, JSON.stringify(saved));
}

test("a choice saved by #284's first picker still resolves", async () => {
  const first = await fixture();
  saveTarget(first.root, first.forever);
  const again = await fixture({ root: first.root });
  expect((await again.state())?.target).toMatchObject({ kind: "wow", id: first.forever, shortName: "Forever" });
});

test("a saved Mists or Classic Era installation is the Classic row", async () => {
  for (const flavor of ["classic", "era"] as const) {
    const first = await fixture();
    saveTarget(first.root, first[flavor]);
    const again = await fixture({ root: first.root });
    expect((await again.state())?.target.id).toBe("classic");
  }
});

test("only a row's own id can be chosen", async () => {
  const f = await fixture();
  await f.select(f.retail);
  await expect(f.select(f.era)).rejects.toThrow();
  await expect(f.select("elsewhere")).rejects.toThrow();
  expect((await f.state())?.target.id).toBe(f.retail);
});

test("starting Battle.net starts the Steam entry and never sends a launch ask", async () => {
  const f = await fixture();
  const { state, steamStart } = await f.start();
  expect(state?.busy).toBe(true);
  expect(steamStart?.gameId).toBe(((42n << 32n) | 0x02000000n).toString());
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  for (const ms of [5_000, 20_000, 35_000]) await f.at(ms);
  expect(f.asks).toEqual([]);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Battle.net", outcome: "confirmed" }]);

  // Battle.net already open: nothing more to start.
  expect(await f.start()).toEqual({ state: expect.objectContaining({ busy: false }) });
});

test("a Steam refusal of a Battle.net start is reported", async () => {
  const f = await fixture();
  const { steamStart } = await f.start();
  await f.engine.call("launch.steamRefused", { attemptId: steamStart!.attemptId });
  await f.at(1_000);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Battle.net", outcome: "steam-refused" }]);
});

test("starting a chosen client asks Battle.net once it is ready and names the client on completion", async () => {
  const f = await fixture();
  await f.select(f.forever);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  expect((await f.start()).steamStart).toBeUndefined();
  await f.at(15_000);
  expect(f.asks).toEqual([15_000]);
  f.observation.running = "_forever_";
  await f.at(16_000);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Forever", outcome: "confirmed" }]);
});

test("Classic is confirmed by whichever Classic starts, and the completion names it", async () => {
  const f = await fixture();
  await f.select("classic");
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.start();
  await f.at(15_000);
  expect(f.asks).toEqual([15_000]);
  f.observation.running = "_classic_era_";
  await f.at(16_000);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Classic Era", outcome: "confirmed" }]);
});

test("Classic that never starts in the window ends as not started, with Battle.net left open", async () => {
  const f = await fixture();
  await f.select("classic");
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.start();
  for (const ms of [15_000, 30_000, 45_000, 150_000]) await f.at(ms);
  expect(f.asks).toEqual([15_000, 30_000, 45_000]);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Classic", outcome: "not-started" }]);
});

test("a shortcut that starts a WoW client executable directly gets no launch state", async () => {
  const f = await fixture({ exe: "_retail_/Wow.exe" });
  expect(await f.state()).toBeNull();
  expect((await f.start()).state).toBeNull();
  await expect(f.select("battlenet")).rejects.toThrow();
});

test("icons come one client at a time, never in the polled state", async () => {
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  const withIcon = await fixture({ launcher: pe });
  expect(JSON.stringify(await withIcon.state())).not.toContain("data:");
  expect(await withIcon.icon("battlenet")).toStartWith("data:image/x-icon;base64,");
  // The fixture's client executables are empty: WoWDeck's glyph.
  expect(await withIcon.icon(withIcon.forever)).toBeNull();
  expect(await withIcon.icon("no-such-client")).toBeNull();
  expect(await withIcon.icon("constructor")).toBeNull();

  const unreadable = await fixture({ launcher: new TextEncoder().encode("MZ") });
  expect(await unreadable.icon("battlenet")).toBeNull();
});

test("a client's icon is read from that client's executable", async () => {
  const f = await fixture();
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  writeFileSync(join(f.root, "home/Games/World of Warcraft/_forever_/Wow.exe"), pe);
  expect(await f.icon(f.forever)).toStartWith("data:image/x-icon;base64,");
  expect(await f.icon(f.retail)).toBeNull();

  // Classic's icon is Mists' while Mists is installed, even beside Classic Era.
  writeFileSync(join(f.root, "home/Games/World of Warcraft/_classic_era_/WowClassic.exe"), pe);
  expect(await f.icon("classic")).toBeNull();
  writeFileSync(join(f.root, "home/Games/World of Warcraft/_classic_/WowClassic.exe"), pe);
  expect(await f.icon("classic")).toStartWith("data:image/x-icon;base64,");
  expect(await f.icon(f.era)).toBeNull();
});


test("launch icons survive restart and executable replacement without changing saved choices", async () => {
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  const first = await fixture({ launcher: pe });
  await first.select(first.forever);
  const active = await first.selected();
  const icon = await first.icon("battlenet");
  expect(icon).toStartWith("data:image/x-icon;base64,");
  // Restart replaces the executable with an empty file. A usable cached icon has no expiry.
  const again = await fixture({ root: first.root, version: "10.0.0" });
  expect(await again.icon("battlenet")).toBe(icon);
  expect((await again.state())?.target.id).toBe(first.forever);
  expect(await again.selected()).toBe(active);
});


test("restart reads persistent icons without reading the executable, even when it is absent", async () => {
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  const first = await fixture({ launcher: pe });
  const icon = await first.icon("battlenet");
  let sourceReads = 0;
  const again = await fixture({ root: first.root, readIcon: async (path, limit) => {
    if (path.endsWith(".exe")) { sourceReads++; return undefined; }
    return readLaunchIconFile(path, limit);
  } });
  rmSync(join(first.root, "home/Games/World of Warcraft/Battle.net Launcher.exe"));
  expect(await again.icon("battlenet")).toBe(icon);
  expect(sourceReads).toBe(0);
});

test("concurrent launch.icon requests share one executable extraction", async () => {
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const f = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: PNG }]),
    readIcon: async (path, limit) => {
      if (path.endsWith(".exe")) { reads++; entered(); await gate; }
      return readLaunchIconFile(path, limit);
    },
  });
  const pending = Array.from({ length: 8 }, () => f.icon("battlenet"));
  await reading;
  release();
  const icons = await Promise.all(pending);
  expect(icons[0]).toStartWith("data:image/x-icon;base64,");
  expect(new Set(icons).size).toBe(1);
  expect(reads).toBe(1);
});


test("unrelated shortcuts and prefixes sharing persistent data keep their own icon", async () => {
  const first = await fixture({ launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]) });
  const firstIcon = await first.icon("battlenet");
  const other = await fixture({ dataDir: join(first.root, "data"),
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: PNG }]),
  });
  const otherIcon = await other.icon("battlenet");
  expect(otherIcon).toStartWith("data:image/x-icon;base64,");
  expect(otherIcon).not.toBe(firstIcon);
  expect(await first.icon("battlenet")).toBe(firstIcon);
  expect(await other.icon(other.retail)).toBeNull();
});

test("missing, corrupt and incompatible cache entries rebuild through launch.icon", async () => {
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  for (const damage of ["missing", "manifest", "version", "hash", "oversized"]) {
    const first = await fixture({ launcher: pe });
    const icon = await first.icon("battlenet");
    const cache = join(first.root, "data/launch-icons");
    const files = readdirSync(cache);
    const manifest = join(cache, files.find((name) => name.endsWith(".json"))!);
    const asset = join(cache, files.find((name) => name.endsWith(".ico"))!);
    if (damage === "missing") rmSync(asset);
    if (damage === "manifest") writeFileSync(manifest, "{");
    if (damage === "version") {
      const entry = JSON.parse(readFileSync(manifest, "utf8"));
      entry.version = 999;
      writeFileSync(manifest, JSON.stringify(entry));
    }
    if (damage === "hash") writeFileSync(asset, "corrupt");
    if (damage === "oversized") writeFileSync(asset, new Uint8Array(1024 * 1024 + 23));
    const again = await fixture({ root: first.root, launcher: pe });
    expect(await again.icon("battlenet")).toBe(icon);
    const restarted = await fixture({ root: first.root });
    expect(await restarted.icon("battlenet")).toBe(icon);
  }
});

test("cache write failure returns the available icon and does not prevent launching", async () => {
  const f = await fixture({ launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]) });
  writeFileSync(join(f.root, "data/launch-icons"), "unwritable cache directory");
  expect(await f.icon("battlenet")).toStartWith("data:image/x-icon;base64,");
  expect((await f.start()).steamStart).toBeDefined();
});

test("interrupted cache publication leaves the last usable image available", async () => {
  const first = await fixture({ launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]) });
  const icon = await first.icon("battlenet");
  const cache = join(first.root, "data/launch-icons");
  // An interrupted replacement left partial files beside the published entry.
  for (const name of readdirSync(cache)) writeFileSync(join(cache, `${name}.interrupted.tmp`), "partial");
  const again = await fixture({ root: first.root });
  expect(await again.icon("battlenet")).toBe(icon);
});


test("failed manifest replacement preserves the previously published icon", async () => {
  const first = await fixture({ launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]) });
  const previous = await first.icon("battlenet");
  const { rename } = await import("node:fs/promises");
  let failed = false;
  const replacing = await fixture({ root: first.root,
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: PNG }]),
    // A transient read fault forces a rebuild while the old entry remains intact.
    readIcon: async (path, limit) => path.endsWith(".json") ? undefined : readLaunchIconFile(path, limit),
    renameIcon: async (from, to) => {
      if (to.endsWith(".json")) { failed = true; throw new Error("simulated rename failure"); }
      await rename(from, to);
    },
  });
  const available = await replacing.icon("battlenet");
  expect(available).toStartWith("data:image/x-icon;base64,");
  expect(available).not.toBe(previous);
  expect(failed).toBe(true);
  const again = await fixture({ root: first.root });
  expect(await again.icon("battlenet")).toBe(previous);
});
