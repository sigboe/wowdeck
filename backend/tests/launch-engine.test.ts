/**
 * The `launch.*` methods on the real engine, assembled in-process over a
 * recorded Steam shortcut and a WoW root, with fake processes in place of
 * the machine's.
 */

import { createHash } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
function writeShortcut(steam: string, exe: string, id = APP_ID, launchOptions = "") {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const appid = Buffer.alloc(4);
  appid.writeUInt32LE(id);
  const record = Buffer.concat([
    Buffer.from("\x000\0\x02appid\0"),
    appid,
    string("AppName", "World of Warcraft"),
    string("Exe", `"${exe}"`),
    string("StartDir", ""),
    string("LaunchOptions", launchOptions),
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
  for (const [flavor, exe] of [
    ["_retail_", "Wow.exe"],
    ["_classic_", "WowClassic.exe"],
    ["_classic_era_", "WowClassic.exe"],
    ["_forever_", "Wow.exe"],
  ]) {
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
    entryRunning: false,
    renderer: null,
    gameRunning: "not_running",
  };
  const world: LaunchWorld = {
    now: () => now,
    wait: () =>
      new Promise<void>((resolve) => {
        tick = resolve;
      }),
    // `running` names the flavor folder of a WoW client running in the prefix.
    observe: async (entry) => {
      const { running, ...rest } = observation;
      const target = entry.targetFolders?.find(({ path }) => basename(path) === running);
      return {
        ...rest,
        ...(running && { gameRunning: "running" }),
        targetRunning: target?.path ?? null,
      };
    },
    ask: async () => {
      asks.push(now);
      return { startupFailed: Promise.resolve(false) };
    },
  };
  const iconChanges: Array<{ appId: number; targetId: string }> = [];
  const iconWaiters: Array<() => void> = [];
  let iconChanged!: () => void;
  const changed = new Promise<void>((resolve) => {
    iconChanged = resolve;
  });
  const completions: LaunchCompletion[] = [];
  const out = (line: string) => {
    const message = JSON.parse(line) as { event?: string; params?: LaunchCompletion };
    if (message.event === "launch.iconChanged") {
      iconChanges.push(message.params as unknown as { appId: number; targetId: string });
      iconChanged();
      for (const notify of iconWaiters) notify();
    }
    if (message.event === "launch.completed") completions.push(message.params!);
  };
  const base = configFromEnv(
    { HOME: home, WOWDECK_DATA_DIR: setup.dataDir ?? join(root, "data") },
    setup.version ?? "9.9.9",
  );
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
    root,
    engine,
    observation,
    asks,
    completions,
    iconChanges,
    waitForIcons: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (iconChanges.length >= count) resolve();
        };
        iconWaiters.push(check);
        check();
      }),
    changed,
    retail: id("_retail_"),
    classic: id("_classic_"),
    era: id("_classic_era_"),
    forever: id("_forever_"),
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
  expect((await again.state())?.target).toMatchObject({
    kind: "wow",
    id: first.forever,
    shortName: "Forever",
  });
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
  expect((await again.state())?.target).toMatchObject({
    kind: "wow",
    id: first.forever,
    shortName: "Forever",
  });
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
  expect(f.completions).toEqual([
    { appId: APP_ID, clientName: "Battle.net", outcome: "confirmed" },
  ]);

  // Battle.net already open: nothing more to start.
  expect(await f.start()).toEqual({ state: expect.objectContaining({ busy: false }) });
});

test("a Steam refusal of a Battle.net start is reported", async () => {
  const f = await fixture();
  const { steamStart } = await f.start();
  await f.engine.call("launch.steamRefused", { attemptId: steamStart!.attemptId });
  await f.at(1_000);
  expect(f.completions).toEqual([
    { appId: APP_ID, clientName: "Battle.net", outcome: "steam-refused" },
  ]);
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
  expect(f.completions).toEqual([
    { appId: APP_ID, clientName: "Classic Era", outcome: "confirmed" },
  ]);
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
  const again = await fixture({
    root: first.root,
    readIcon: async (path, limit) => {
      if (path.endsWith(".exe")) {
        sourceReads++;
        return undefined;
      }
      return readLaunchIconFile(path, limit);
    },
  });
  rmSync(join(first.root, "home/Games/World of Warcraft/Battle.net Launcher.exe"));
  expect(await again.icon("battlenet")).toBe(icon);
  expect(sourceReads).toBe(0);
});

test("concurrent launch.icon requests share one executable extraction", async () => {
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const f = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: PNG }]),
    readIcon: async (path, limit) => {
      if (path.endsWith(".exe")) {
        reads++;
        entered();
        await gate;
      }
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
  const first = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  });
  const firstIcon = await first.icon("battlenet");
  const other = await fixture({
    dataDir: join(first.root, "data"),
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
    const manifest = join(
      cache,
      files.find((name) => name.endsWith(".json"))!,
    );
    const asset = join(
      cache,
      files.find((name) => name.endsWith(".ico"))!,
    );
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
  const f = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  });
  writeFileSync(join(f.root, "data/launch-icons"), "unwritable cache directory");
  expect(await f.icon("battlenet")).toStartWith("data:image/x-icon;base64,");
  expect((await f.start()).steamStart).toBeDefined();
});

test("interrupted cache publication leaves the last usable image available", async () => {
  const first = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  });
  const icon = await first.icon("battlenet");
  const cache = join(first.root, "data/launch-icons");
  // An interrupted replacement left partial files beside the published entry.
  for (const name of readdirSync(cache))
    writeFileSync(join(cache, `${name}.interrupted.tmp`), "partial");
  const again = await fixture({ root: first.root });
  expect(await again.icon("battlenet")).toBe(icon);
});

test("failed manifest replacement preserves the previously published icon", async () => {
  const first = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  });
  const previous = await first.icon("battlenet");
  const { rename } = await import("node:fs/promises");
  let failed = false;
  const replacing = await fixture({
    root: first.root,
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: PNG }]),
    // A transient read fault forces a rebuild while the old entry remains intact.
    readIcon: async (path, limit) =>
      path.endsWith(".json") ? undefined : readLaunchIconFile(path, limit),
    renameIcon: async (from, to) => {
      if (to.endsWith(".json")) {
        failed = true;
        throw new Error("simulated rename failure");
      }
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

const RETAIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#ffcc00" d="M0 0h48v48z"/></svg>';
function cacheFile(root: string, content: string) {
  const hash = createHash("md5").update(content).digest("hex");
  const dir = join(
    root,
    "home/.local/share/Steam/steamapps/compatdata/42/pfx/drive_c/users/steamuser/AppData/Local/Battle.net/Cache",
    hash.slice(0, 2),
    hash.slice(2, 4),
  );
  mkdirSync(dir, { recursive: true });
  const path = join(dir, hash);
  writeFileSync(path, content);
  return { hash, path };
}
function retailArtwork(root: string, svg = RETAIL_SVG, product = "WoW") {
  const asset = cacheFile(root, svg);
  const catalogue = cacheFile(
    root,
    JSON.stringify({
      fragment_id: "world_of_warcraft",
      products: [{ id: product, base: { icon_svg: "wow#RETAIL_ICON" } }],
      files: { default: { "wow#RETAIL_ICON": { hash: asset.hash } } },
    }),
  );
  return { asset, catalogue };
}
test("Retail returns ICO before shared background artwork completes, updates and survives restart", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const reading = new Promise<void>((r) => {
    entered = r;
  });
  let reads = 0;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) {
        reads++;
        entered();
        await gate;
      }
      return readLaunchIconFile(path, limit);
    },
  });
  retailArtwork(f.root);
  writeFileSync(
    join(f.root, "home/Games/World of Warcraft/_retail_/Wow.exe"),
    syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  );
  const fallback = await f.icon(f.retail);
  expect(fallback).toStartWith("data:image/x-icon;base64,");
  await reading;
  expect(await f.icon(f.retail)).toBe(fallback);
  expect(reads).toBe(1);
  release();
  await f.changed;
  expect(f.iconChanges).toEqual([{ appId: 42, targetId: f.retail }]);
  const svg = await f.icon(f.retail);
  expect(svg).toBe(`data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`);
  const again = await fixture({
    root: f.root,
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache") || path.endsWith(".exe"))
        throw Error("cached artwork must avoid sources");
      return readLaunchIconFile(path, limit);
    },
  });
  expect(await again.icon(again.retail)).toBe(svg);
  expect(readdirSync(join(f.root, "data/launch-icons")).some((name) => name.endsWith(".ico"))).toBe(
    true,
  );
});

test("invalid catalogue and SVG candidates cannot hide an older valid Retail image", async () => {
  for (const invalid of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.test/a)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x "bad">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" width="2"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:red"/></svg>',
    "x".repeat(256 * 1024 + 1),
    "hash mismatch",
    "catalogue mismatch",
    "escaped asset",
    "bad shape",
  ]) {
    const f = await fixture();
    const valid = retailArtwork(f.root);
    utimesSync(valid.catalogue.path, 100, 100);
    const bad = retailArtwork(f.root, invalid);
    utimesSync(bad.catalogue.path, 200, 200);
    if (invalid === "hash mismatch") writeFileSync(bad.asset.path, RETAIL_SVG);
    if (invalid === "catalogue mismatch")
      writeFileSync(bad.catalogue.path, readFileSync(valid.catalogue.path));
    if (invalid === "bad shape") writeFileSync(bad.catalogue.path, '{"products":null}');
    if (invalid === "escaped asset") {
      const external = join(f.root, "outside.svg");
      writeFileSync(external, RETAIL_SVG);
      rmSync(bad.asset.path);
      symlinkSync(external, bad.asset.path);
    }
    expect(await f.icon(f.retail)).toBeNull();
    await f.changed;
    expect(await f.icon(f.retail)).toBe(
      `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`,
    );
  }
});

test("foreground reads suppress a failed scan, launcher activity retries missing artwork", async () => {
  let scanned!: () => void;
  const scanning = new Promise<void>((r) => {
    scanned = r;
  });
  let reads = 0;
  let missing = true;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) {
        reads++;
        if (missing) {
          scanned();
          return undefined;
        }
      }
      return readLaunchIconFile(path, limit);
    },
  });
  cacheFile(f.root, JSON.stringify({ fragment_id: "world_of_warcraft", products: [] }));
  expect(await f.icon(f.retail)).toBeNull();
  await scanning;
  for (let i = 0; i < 8; i++) expect(await f.icon(f.retail)).toBeNull();
  expect(reads).toBe(1);
  missing = false;
  retailArtwork(f.root);
  await f.start();
  await f.changed;
  expect(await f.icon(f.retail)).toStartWith("data:image/svg+xml;base64,");
});

test("an unavailable source can recover on a later engine load", async () => {
  const first = await fixture();
  expect(await first.icon(first.retail)).toBeNull();
  const again = await fixture({ root: first.root });
  retailArtwork(again.root);
  expect(await again.icon(again.retail)).toBeNull();
  await again.changed;
  expect(await again.icon(again.retail)).toStartWith("data:image/svg+xml;base64,");
});

test("equal-time catalogue candidates use the hash tie-break and Battle.net keeps its ICO", async () => {
  const f = await fixture({
    launcher: syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  });
  const first = retailArtwork(f.root);
  const otherSvg = RETAIL_SVG.replace("#ffcc00", "#cc00ff");
  const second = retailArtwork(f.root, otherSvg);
  for (const candidate of [first, second]) utimesSync(candidate.catalogue.path, 100, 100);
  const expected = first.catalogue.hash > second.catalogue.hash ? RETAIL_SVG : otherSvg;
  const ico = await f.icon("battlenet");
  expect(ico).toStartWith("data:image/x-icon;base64,");
  await f.changed;
  expect(await f.icon(f.retail)).toBe(
    `data:image/svg+xml;base64,${Buffer.from(expected).toString("base64")}`,
  );
  expect(await f.icon("battlenet")).toBe(ico);
  expect(await f.icon("classic")).toBeNull();
  expect(await f.icon(f.forever)).toBeNull();
});

test("a failed SVG replacement retains the published artwork and its ICO fallback", async () => {
  const first = await fixture();
  retailArtwork(first.root);
  writeFileSync(
    join(first.root, "home/Games/World of Warcraft/_retail_/Wow.exe"),
    syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  );
  const ico = await first.icon(first.retail);
  await first.changed;
  const saved = await first.icon(first.retail);
  let failed!: () => void;
  const failure = new Promise<void>((r) => {
    failed = r;
  });
  const { rename } = await import("node:fs/promises");
  const replacing = await fixture({
    root: first.root,
    readIcon: async (path, limit) =>
      path.endsWith(".svg.json") ? undefined : readLaunchIconFile(path, limit),
    renameIcon: async (from, to) => {
      if (to.endsWith(".svg.json")) {
        failed();
        throw Error("interrupted SVG manifest replacement");
      }
      await rename(from, to);
    },
  });
  retailArtwork(first.root, RETAIL_SVG.replace("#ffcc00", "#cc00ff"));
  expect(await replacing.icon(replacing.retail)).toBe(ico);
  await failure;
  expect(await replacing.icon(replacing.retail)).toBe(ico);
  const again = await fixture({ root: first.root });
  expect(await again.icon(again.retail)).toBe(saved);
});

test("preferred artwork stays isolated by prefix and a corrupt saved SVG rebuilds with the retained ICO", async () => {
  const first = await fixture();
  retailArtwork(first.root);
  writeFileSync(
    join(first.root, "home/Games/World of Warcraft/_retail_/Wow.exe"),
    syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]),
  );
  const ico = await first.icon(first.retail);
  await first.changed;
  const saved = await first.icon(first.retail);
  const other = await fixture({ dataDir: join(first.root, "data") });
  expect(await other.icon(other.retail)).toBeNull();
  expect(await first.icon(first.retail)).toBe(saved);
  const cache = join(first.root, "data/launch-icons");
  for (const name of readdirSync(cache))
    if (name.endsWith(".svg")) writeFileSync(join(cache, name), "corrupt");
  const again = await fixture({ root: first.root });
  expect(await again.icon(again.retail)).toBe(ico);
  await again.changed;
  expect(await again.icon(again.retail)).toBe(saved);
});

test("well-hashed malformed catalogue field shapes do not block another valid catalogue", async () => {
  const f = await fixture();
  const valid = retailArtwork(f.root);
  utimesSync(valid.catalogue.path, 100, 100);
  for (const shape of [
    null,
    [],
    { products: null },
    { products: [null], files: { default: {} } },
    { products: [{ id: "WoW", base: { icon_svg: "__proto__" } }], files: { default: {} } },
    { products: [{ id: "WoW", base: { icon_svg: 42 } }], files: { default: {} } },
  ]) {
    const bad = cacheFile(f.root, JSON.stringify({ fragment_id: "world_of_warcraft", ...shape }));
    utimesSync(bad.path, 200, 200);
  }
  expect(await f.icon(f.retail)).toBeNull();
  await f.changed;
  expect(await f.icon(f.retail)).toStartWith("data:image/svg+xml;base64,");
});

for (const [product, row, folder, exe, colour] of [
  ["WoW", "retail", "_retail_", "Wow.exe", "#ffcc00"],
  ["WoWC", "classic", "_classic_", "WowClassic.exe", "#00ccff"],
  ["WoWF", "forever", "_forever_", "Wow.exe", "#cc00ff"],
] as const) {
  test(`${product} shares background work, survives source removal and recovers an icon-only wipe`, async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const reading = new Promise<void>((r) => {
      entered = r;
    });
    let reads = 0;
    const f = await fixture({
      readIcon: async (path, limit) => {
        if (path.includes("Battle.net/Cache")) {
          reads++;
          entered();
          await gate;
        }
        return readLaunchIconFile(path, limit);
      },
    });
    const target = row === "classic" ? "classic" : f[row];
    const svg = RETAIL_SVG.replace("#ffcc00", colour);
    const source = retailArtwork(f.root, svg, product);
    const executable = join(f.root, "home/Games/World of Warcraft", folder, exe);
    const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
    writeFileSync(executable, pe);
    await f.select(target);
    const selected = await f.selected();
    const fallback = await f.icon(target);
    expect(fallback).toStartWith("data:image/x-icon;base64,");
    await reading;
    expect(await Promise.all([f.icon(target), f.icon(target)])).toEqual([fallback, fallback]);
    expect(reads).toBe(1);
    release();
    await f.changed;
    const expected = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    expect(await f.icon(target)).toBe(expected);
    expect(f.iconChanges).toEqual([{ appId: 42, targetId: target }]);
    rmSync(join(source.asset.path, "../../.."), { recursive: true, force: true });
    let sourceReads = 0;
    const again = await fixture({
      root: f.root,
      readIcon: async (path, limit) => {
        if (path.includes("Battle.net/Cache") || path.endsWith(".exe")) sourceReads++;
        return readLaunchIconFile(path, limit);
      },
    });
    expect(await again.icon(target)).toBe(expected);
    expect(sourceReads).toBe(0);
    expect((await again.state())?.target.id).toBe(target);
    expect(await again.selected()).toBe(selected);
    const settings = readFileSync(join(f.root, "data/state.json"));
    rmSync(join(f.root, "data/launch-icons"), { recursive: true });
    const wiped = await fixture({ root: f.root });
    writeFileSync(executable, pe);
    retailArtwork(f.root, svg, product);
    expect(await wiped.icon(target)).toBe(fallback);
    await wiped.changed;
    expect(await wiped.icon(target)).toBe(expected);
    expect((await wiped.state())?.target.id).toBe(target);
    expect(await wiped.selected()).toBe(selected);
    expect(readFileSync(join(f.root, "data/state.json"))).toEqual(settings);
  });
}

test("partial catalogues preserve each product and isolate every product across prefixes", async () => {
  const first = await fixture();
  retailArtwork(first.root, RETAIL_SVG, "WoWC");
  expect(await first.icon("classic")).toBeNull();
  await first.changed;
  const classic = await first.icon("classic");
  expect(classic).toStartWith("data:image/svg+xml;base64,");
  const again = await fixture({ root: first.root });
  const svg = RETAIL_SVG.replace("#ffcc00", "#112233");
  retailArtwork(first.root, svg, "WoWF");
  expect(await again.icon(again.forever)).toBeNull();
  await again.changed;
  expect(await again.icon("classic")).toBe(classic);
  expect(await again.icon(again.forever)).toBe(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  expect(await again.icon(again.retail)).toBeNull();
  const other = await fixture({ dataDir: join(first.root, "data") });
  for (const target of [other.retail, "classic", other.forever])
    expect(await other.icon(target)).toBeNull();
  expect(await again.icon("classic")).toBe(classic);
});

test("one population attempt fills Classic and Forever while Retail remains unavailable", async () => {
  let reads = 0;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) reads++;
      return readLaunchIconFile(path, limit);
    },
  });
  retailArtwork(f.root, RETAIL_SVG, "WoWC");
  retailArtwork(f.root, RETAIL_SVG.replace("#ffcc00", "#112233"), "WoWF");
  expect(await f.icon(f.retail)).toBeNull();
  await f.waitForIcons(2);
  expect(await f.icon("classic")).toBe(
    `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`,
  );
  expect(await f.icon(f.forever)).toBe(
    `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG.replace("#ffcc00", "#112233")).toString("base64")}`,
  );
  const afterPopulation = reads;
  for (let i = 0; i < 5; i++) expect(await f.icon(f.retail)).toBeNull();
  expect(reads).toBe(afterPopulation);
  expect(f.iconChanges.map((x) => x.targetId).sort()).toEqual(["classic", f.forever].sort());
});

test("a Classic source resolved during discovery shares the scan and updates its target", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) {
        reads++;
        entered();
        await gate;
      }
      return readLaunchIconFile(path, limit);
    },
  });
  retailArtwork(f.root, RETAIL_SVG, "WoWC");
  expect(await f.icon("classic")).toBeNull();
  await reading;
  // Battle.net now offers Era as the first Classic executable, changing the
  // source identity while the same target's original population is in flight.
  writeProductDb(join(f.root, "home/.local/share/Steam/steamapps/compatdata/42/pfx"), [
    {
      uid: "wow_classic_era",
      installPath: `Z:${join(f.root, "home/Games/World of Warcraft")}`,
      subfolder: "_classic_era_",
    },
  ]);
  expect(await f.icon("classic")).toBeNull();
  expect(reads).toBe(1);
  release();
  await f.waitForIcons(2);
  expect(await f.icon("classic")).toBe(
    `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`,
  );
  expect(f.iconChanges).toEqual([
    { appId: APP_ID, targetId: "classic" },
    { appId: APP_ID, targetId: "classic" },
  ]);
  // One catalogue and its referenced asset; the new identity shares discovery.
  expect(reads).toBe(2);
});

test("a source resolved after population gets artwork without retrying earlier failed identities", async () => {
  let reads = 0;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) reads++;
      return readLaunchIconFile(path, limit);
    },
  });
  const prefix = join(f.root, "home/.local/share/Steam/steamapps/compatdata/42/pfx");
  const installPath = `Z:${join(f.root, "home/Games/World of Warcraft")}`;
  writeProductDb(prefix, [
    { uid: "wow", installPath, subfolder: "_retail_" },
    { uid: "wow_classic", installPath, subfolder: "_classic_" },
  ]);
  retailArtwork(f.root, RETAIL_SVG, "WoWC");
  retailArtwork(f.root, RETAIL_SVG, "WoWF");
  expect(await f.icon(f.retail)).toBeNull();
  await f.changed;
  expect(await f.icon("classic")).toStartWith("data:image/svg+xml;base64,");
  const originalReads = reads;
  for (let i = 0; i < 5; i++) expect(await f.icon(f.retail)).toBeNull();
  expect(reads).toBe(originalReads);

  // Retail becomes available too, but a newly resolved Classic path must not
  // reset suppression for the already attempted Retail identity.
  retailArtwork(f.root);
  writeProductDb(prefix, [
    { uid: "wow", installPath, subfolder: "_retail_" },
    { uid: "wow_classic_era", installPath, subfolder: "_classic_era_" },
    { uid: "wowf", installPath, subfolder: "_forever_" },
  ]);
  expect(await f.icon("classic")).toBeNull();
  await f.waitForIcons(3);
  expect(await f.icon("classic")).toBe(
    `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`,
  );
  expect(await f.icon(f.forever)).toStartWith("data:image/svg+xml;base64,");
  const afterPopulation = reads;
  expect(afterPopulation).toBeGreaterThan(originalReads);
  for (let i = 0; i < 5; i++) {
    expect(await f.icon(f.retail)).toBeNull();
    expect(await f.icon("classic")).toStartWith("data:image/svg+xml;base64,");
  }
  expect(reads).toBe(afterPopulation);
  expect(f.iconChanges).toEqual([
    { appId: APP_ID, targetId: "classic" },
    { appId: APP_ID, targetId: "classic" },
    { appId: APP_ID, targetId: f.forever },
  ]);
});

test("a shortcut resolved during discovery receives its own icon update while sharing the source", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const f = await fixture({
    readIcon: async (path, limit) => {
      if (path.includes("Battle.net/Cache")) {
        reads++;
        entered();
        await gate;
      }
      return readLaunchIconFile(path, limit);
    },
  });
  retailArtwork(f.root, RETAIL_SVG, "WoWC");
  expect(await f.icon("classic")).toBeNull();
  await reading;
  const steam = join(f.root, "home/.local/share/Steam");
  writeShortcut(
    steam,
    join(f.root, "home/Games/World of Warcraft/Battle.net Launcher.exe"),
    43,
    `STEAM_COMPAT_DATA_PATH="${join(steam, "steamapps/compatdata/42")}" %command%`,
  );
  await f.engine.call("linkedGames.add", { appId: 43, name: "Battle.net" });
  expect((await f.engine.call("launch.icon", { appId: 43, targetId: "classic" })).icon).toBeNull();
  release();
  await f.waitForIcons(2);
  expect(f.iconChanges).toEqual([
    { appId: APP_ID, targetId: "classic" },
    { appId: 43, targetId: "classic" },
  ]);
  expect((await f.engine.call("launch.icon", { appId: 43, targetId: "classic" })).icon).toBe(
    `data:image/svg+xml;base64,${Buffer.from(RETAIL_SVG).toString("base64")}`,
  );
  expect(reads).toBe(2);
});
