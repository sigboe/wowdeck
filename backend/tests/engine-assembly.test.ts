/**
 * The real engine, assembled in-process (engine.ts) against a temporary
 * home and data folder and the WowUp Hub's recorded responses: the same
 * wiring the compiled binary runs, reached through the contract.
 */

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFromEnv, runEngine, startEngine, type EngineConfig } from "../src/engine";
import { loadCassette, ReplayNetwork } from "./providers/cassette";
import { CONTROLLER_LAYOUT_CATALOGUE_URL } from "../src/wow/controllerLayouts/ControllerLayoutCatalogue";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A temp root holding a home with one Retail installation (Lutris-style, under ~/Applications). */
function home(): { root: string; homeDir: string; retail: string } {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-engine-"));
  roots.push(root);
  const homeDir = join(root, "home");
  const wowRoot = join(homeDir, "Applications", "World of Warcraft");
  const retail = join(wowRoot, "_retail_");
  mkdirSync(join(retail, "Interface", "AddOns"), { recursive: true });
  writeFileSync(join(retail, ".flavor.info"), "Product Flavor!STRING:0\nwow\n");
  writeFileSync(join(wowRoot, ".build.info"), "Product!STRING:0|Version!STRING:0\nwow|11.0.2\n");
  return { root, homeDir, retail };
}

async function config(homeDir: string, root: string): Promise<{ config: EngineConfig; network: ReplayNetwork }> {
  const network = new ReplayNetwork(await loadCassette("wowup-hub"));
  const base = configFromEnv({ HOME: homeDir, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  return { config: { ...base, network, now: () => Date.UTC(2026, 10, 1) }, network };
}

test("the assembled engine finds the installation at startup and answers Latest from the WowUp Hub", async () => {
  const { root, homeDir } = home();
  const { config: cfg, network } = await config(homeDir, root);
  const engine = await startEngine(cfg);

  expect(await engine.call("system.getStatus", {})).toMatchObject({ backendVersion: "9.9.9", homeDir });
  const { installations } = await engine.call("installations.list", {});
  expect(installations.map((i) => i.gameType)).toEqual(["retail"]);
  await engine.call("installations.select", { installationId: installations[0]!.id });
  const latest = await engine.call("discover.latest", { installationId: installations[0]!.id, providerId: "WowUpHub", index: 0, pageSize: 5 });

  expect(latest.results).toHaveLength(5);
  expect(latest.results.every((r) => r.providerId === "WowUpHub")).toBe(true);
  expect(network.misses).toEqual([]);
});

test("startup detects, then recovers an interrupted restore, then serves", async () => {
  const { root, homeDir, retail } = home();
  // A restore that died mid-swap: the current WTF is gone, the previous one is set aside.
  mkdirSync(join(retail, "WTF-pre-restore-1700000000000"), { recursive: true });
  writeFileSync(join(retail, "WTF-pre-restore-1700000000000", "Config.wtf"), "previous");
  const { config: cfg } = await config(homeDir, root);
  const answers: { line: string; wtfBack: boolean }[] = [];
  const out = (line: string) => answers.push({ line, wtfBack: existsSync(join(retail, "WTF", "Config.wtf")) });
  const request = new TextEncoder().encode(`${JSON.stringify({ id: 1, method: "installations.list", params: {} })}\n`);

  await runEngine({ ...cfg, out }, (async function* () {
    yield request;
  })());

  expect(answers).toHaveLength(1);
  // Served after detection: the installation is listed in the first answer.
  expect(JSON.parse(answers[0]!.line).result.installations.map((i: { path: string }) => i.path)).toEqual([retail]);
  // Served after recovery, which needed detection's list: the WTF was back before the answer was written.
  expect(answers[0]!.wtfBack).toBe(true);
});

test("the environment maps to the configuration, with the public hosts as defaults", () => {
  const set = configFromEnv(
    {
      HOME: "/home/x",
      WOWDECK_DATA_DIR: "/data",
      WOWDECK_HUB_URL: "http://127.0.0.1:1",
      WOWDECK_RELEASES_URL: "http://127.0.0.1:2/releases/latest",
      WOWDECK_PR_BUILDS_URL: "http://127.0.0.1:3/index.json",
      WOWDECK_TUKUI_URL: "http://127.0.0.1:4/tukui",
      WOWDECK_CF_URL: "http://127.0.0.1:5",
      WOWDECK_ABOUT_URL: "http://127.0.0.1:6/raw",
      WOWDECK_CONTROLLER_LAYOUTS_URL: "http://127.0.0.1:7/catalogue.json",
      WOWDECK_BUNDLED_CURSEFORGE_API_KEY: " key \n",
      WOWDECK_PLUGIN_DIR: "/plugins/wowdeck",
      DECKY_PLUGIN_VERSION: "1.2.3",
    },
    "1.0.0",
  );
  expect(set).toMatchObject({
    backendVersion: "1.0.0",
    dataDir: "/data",
    homeDir: "/home/x",
    urls: {
      hub: "http://127.0.0.1:1",
      releases: "http://127.0.0.1:2/releases/latest",
      prBuilds: "http://127.0.0.1:3/index.json",
      tukui: "http://127.0.0.1:4/tukui",
      curseForge: "http://127.0.0.1:5",
      about: "http://127.0.0.1:6/raw",
      controllerLayouts: "http://127.0.0.1:7/catalogue.json",
    },
    bundledCurseForgeKey: "key",
    pluginDir: "/plugins/wowdeck",
    pluginVersion: "1.2.3",
  });

  const unset = configFromEnv({ WOWDECK_BUNDLED_CURSEFORGE_API_KEY: "  " }, "1.0.0");
  expect(unset).toMatchObject({
    dataDir: join(tmpdir(), "wowdeck"),
    homeDir: "/home/deck",
    urls: {
      hub: "https://hub.wowup.io",
      releases: "https://api.github.com/repos/sigboe/wowdeck/releases/latest",
      prBuilds: "https://sigboe.github.io/wowdeck/index.json",
    },
    bundledCurseForgeKey: undefined,
    pluginDir: null,
  });
});

test("the assembled engine reads the Controller layouts catalogue from its published URL", async () => {
  const { root, homeDir } = home();
  const catalogue = readFileSync(join(import.meta.dir, "fixtures", "controller-layouts", "two-entries.json"), "utf-8");
  const network = new ReplayNetwork({
    recordedAt: "2026-11-17T00:00:00Z",
    interactions: [{ method: "GET", url: CONTROLLER_LAYOUT_CATALOGUE_URL, status: 200, response: catalogue }],
  });
  const base = configFromEnv({ HOME: homeDir, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  const engine = await startEngine({ ...base, network, now: () => Date.UTC(2026, 10, 1) });

  const answer = await engine.call("controllerLayouts.catalogue", {});

  expect(answer.state).toBe("ready");
  expect(answer.state === "ready" && answer.layouts.map((l) => l.id)).toEqual(["fixture-synthetic-a", "kinzo-wow-forever"]);
  expect(network.misses).toEqual([]);
});

test("an unreachable Controller layouts catalogue answers unavailable through the engine", async () => {
  const { root, homeDir } = home();
  const network = new ReplayNetwork({ recordedAt: "2026-11-17T00:00:00Z", interactions: [] });
  const base = configFromEnv({ HOME: homeDir, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  const engine = await startEngine({ ...base, network, now: () => Date.UTC(2026, 10, 1) });

  expect(await engine.call("controllerLayouts.catalogue", {})).toEqual({ state: "unavailable" });
});
