import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/wow/storage/StateStore";
import { defaultSettings } from "../src/wow/storage/settings";

const FIXTURE = join(import.meta.dir, "fixtures", "state", "legacy-state.json");

function loadFixtureStore(): { store: StateStore; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), "state-store-")), "state.json");
  copyFileSync(FIXTURE, path);
  return { store: new StateStore(path), path };
}

describe("StateStore with a state file from an older build", () => {
  test("loads and keeps every live field", () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    const { store } = loadFixtureStore();
    const state = store.load();

    const { ignoredAddons: _ignored, ...settings } = raw.settings;
    expect(state.settings).toMatchObject(settings);
    expect(state.installations).toEqual(raw.installations);
    expect(state.addons).toHaveLength(raw.addons.length);
    raw.addons.forEach((addon: Record<string, unknown>, i: number) => {
      const { autoUpdateEnabled: _auto, ...live } = addon;
      expect(state.addons[i]).toMatchObject(live);
    });
    expect(state.deviceId).toBe(raw.deviceId);
  });

  test("drops the retired keys, in memory and on the next save", () => {
    const { store, path } = loadFixtureStore();
    const state = store.load();
    expect(state.settings).not.toHaveProperty("ignoredAddons");
    for (const addon of state.addons) {
      expect(addon).not.toHaveProperty("autoUpdateEnabled");
    }

    void store.persist();
    const saved = readFileSync(path, "utf-8");
    expect(saved).not.toContain("ignoredAddons");
    expect(saved).not.toContain("autoUpdateEnabled");
  });
});

describe("StateStore normalizes stored settings (RF-07)", () => {
  test("garbage values fall back to their defaults; good ones are kept", () => {
    const path = join(mkdtempSync(join(tmpdir(), "state-store-")), "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        settings: {
          updateToastEnabled: "false",
          autoUpdate: "yes",
          wtfKeepSnapshots: 99,
          steamGame: { appId: -1, name: "x" },
          enabledProviders: "Curse",
          lastAutoUpdate: { at: "soon" },
          newlyUpdatedHours: -5,
          wtfBackupDir: 42,
          selectedInstallationId: "retail-0",
          somethingOld: true,
        },
      }),
    );
    const { settings } = new StateStore(path).load();
    expect(settings).toEqual({
      ...defaultSettings(),
      updateToastEnabled: false,
      wtfKeepSnapshots: 10,
      selectedInstallationId: "retail-0",
    });
    expect(settings).not.toHaveProperty("somethingOld");
  });
});
