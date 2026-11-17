/**
 * The Controller layouts source (#265): on once for new installs and for the
 * first upgrade that carries the setting, and a player's opt-out survives every
 * later restart and upgrade. Driven through settings.get / settings.set over
 * a state file on disk, the way the engine reads it at start.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsHandlers } from "../src/api/handlers/settings";
import { createStateStore } from "../src/wow/storage/StateStore";
import { controllerLayoutsSourceEnabled } from "../src/wow/controllerLayouts/source";

const cleanup: (() => unknown)[] = [];
afterEach(() => {
  for (const done of cleanup.splice(0).reverse()) done();
});

/** A data folder, optionally holding a state file a previous build wrote. */
function dataDir(stateFile?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "controller-layouts-source-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  if (stateFile !== undefined) {
    writeFileSync(join(dir, "state.json"), JSON.stringify(stateFile));
  }
  return dir;
}

/** One engine run over the data folder: the settings RPC and the source read. */
function start(dir: string) {
  const store = createStateStore(dir);
  const rpc = settingsHandlers({ store, installationService: { list: () => [] } });
  return {
    get: async () => (await rpc["settings.get"]()).settings,
    set: async (settings: Record<string, unknown>) => (await rpc["settings.set"]({ settings })).settings,
    sourceEnabled: () => controllerLayoutsSourceEnabled(store.settings),
    flush: () => store.persist(),
  };
}

/** A state file a release before Controller layouts wrote (recorded). */
const PRE_FEATURE_STATE = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "state", "legacy-state.json"), "utf-8"),
) as { settings: Record<string, unknown> };

test("a new install has the Controller layouts source on", async () => {
  const engine = start(dataDir());

  expect((await engine.get()).controllerLayoutsEnabled).toBe(true);
  expect(engine.sourceEnabled()).toBe(true);
});

test("the first upgrade from a release before Controller layouts turns the source on", async () => {
  const engine = start(dataDir(PRE_FEATURE_STATE));

  expect((await engine.get()).controllerLayoutsEnabled).toBe(true);
  expect(engine.sourceEnabled()).toBe(true);
});

test("turning the source off through Options survives a restart", async () => {
  const dir = dataDir(PRE_FEATURE_STATE);
  const first = start(dir);
  expect((await first.set({ controllerLayoutsEnabled: false })).controllerLayoutsEnabled).toBe(false);
  expect(first.sourceEnabled()).toBe(false);
  await first.flush();

  const second = start(dir);

  expect((await second.get()).controllerLayoutsEnabled).toBe(false);
  expect(second.sourceEnabled()).toBe(false);
});

test("a later upgrade keeps the player's opt-out", async () => {
  const dir = dataDir(PRE_FEATURE_STATE);
  const rollout = start(dir);
  // The first start after the upgrade stores the rollout default with any other write.
  await rollout.set({ updateToastEnabled: false });
  await rollout.flush();
  const optOut = start(dir);
  await optOut.set({ controllerLayoutsEnabled: false });
  await optOut.flush();
  // A later release writes its own keys and drops ones it no longer knows.
  const stored = JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"));
  stored.settings.someLaterSetting = "kept by that release";
  writeFileSync(join(dir, "state.json"), JSON.stringify(stored));

  const later = start(dir);

  expect((await later.get()).controllerLayoutsEnabled).toBe(false);
  expect(later.sourceEnabled()).toBe(false);
});

test("turning the source back on is stored like any other choice", async () => {
  const dir = dataDir({ ...PRE_FEATURE_STATE, settings: { ...PRE_FEATURE_STATE.settings, controllerLayoutsEnabled: false } });
  const first = start(dir);
  await first.set({ controllerLayoutsEnabled: true });
  await first.flush();

  expect(start(dir).sourceEnabled()).toBe(true);
});
