/**
 * `settings.set` on the real engine, assembled in-process over an empty
 * home: a save the state file never got reports an error, and the engine
 * keeps showing what the file holds.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFromEnv, startEngine } from "../src/engine";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function engineOver(root: string, fs?: FaultInjectingFs) {
  return startEngine({
    ...configFromEnv({ HOME: join(root, "home"), WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9"),
    network: new ReplayNetwork(await loadCassette("wowup-hub")),
    now: () => Date.UTC(2026, 10, 20),
    fs,
  });
}

test("a save the state file can't take fails, and nothing reads as saved", async () => {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-settings-save-"));
  roots.push(root);
  const fs = new FaultInjectingFs();
  const engine = await engineOver(root, fs);
  await engine.call("settings.set", { settings: { hideLibraries: true } });

  fs.failAt("state.replace");
  await expect(engine.call("settings.set", { settings: { hideLibraries: false, autoUpdate: true } })).rejects.toThrow();

  expect((await engine.call("settings.get", {})).settings).toMatchObject({ hideLibraries: true, autoUpdate: false });
  fs.clear();
  const restarted = await engineOver(root);
  expect((await restarted.call("settings.get", {})).settings).toMatchObject({ hideLibraries: true, autoUpdate: false });
});

test("a save that reached the state file survives a restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-settings-save-"));
  roots.push(root);
  const engine = await engineOver(root, new FaultInjectingFs());
  expect((await engine.call("settings.set", { settings: { autoUpdate: true } })).settings.autoUpdate).toBe(true);

  const restarted = await engineOver(root);
  expect((await restarted.call("settings.get", {})).settings.autoUpdate).toBe(true);
});
