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
          pluginUpdateToastShownFor: "tomorrow",
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

  test("the stored release-check answer survives a reload; a broken one costs one extra check, not a wrong answer", () => {
    const good = {
      checkedAt: 1_800_000_000_000,
      latestVersion: "v0.2.0",
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      downloadUrl: null,
    };
    const path = join(mkdtempSync(join(tmpdir(), "state-store-")), "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        settings: {
          lastPluginUpdate: good,
        },
      }),
    );
    const { settings } = new StateStore(path).load();
    // The v is stripped by the normalizer — versions compare without it.
    expect(settings.lastPluginUpdate).toEqual({ ...good, latestVersion: "0.2.0" });

    for (const broken of [
      null,
      "yesterday",
      { checkedAt: "soon", latestVersion: "0.2.0" },
      { checkedAt: 123 },
      { checkedAt: Number.NaN, latestVersion: "0.2.0" },
      { checkedAt: 123, latestVersion: "1.2.3.4" },
    ]) {
      writeFileSync(path, JSON.stringify({ settings: { lastPluginUpdate: broken } }));
      expect(new StateStore(path).load().settings.lastPluginUpdate).toBeNull();
    }

    // URLs are coerced, not fatal: a lost link costs nothing, a guessed
    // version would.
    writeFileSync(
      path,
      JSON.stringify({ settings: { lastPluginUpdate: { checkedAt: 123, latestVersion: "0.2.0", releaseUrl: 7, downloadUrl: [] } } }),
    );
    expect(new StateStore(path).load().settings.lastPluginUpdate).toEqual({
      checkedAt: 123,
      latestVersion: "0.2.0",
      releaseUrl: null,
      downloadUrl: null,
    });
  });

  test("the toast gate's shown-version mark survives a reload; anything but a version costs one toast, not a wrong one", () => {
    const path = join(mkdtempSync(join(tmpdir(), "state-store-")), "state.json");
    writeFileSync(path, JSON.stringify({ settings: { pluginUpdateToastShownFor: "v0.2.0" } }));
    // The v is stripped by the normalizer — versions compare without it.
    expect(new StateStore(path).load().settings.pluginUpdateToastShownFor).toBe("0.2.0");

    for (const broken of [null, "banana", "1.2.3.4", 42, "", { version: "0.2.0" }]) {
      writeFileSync(path, JSON.stringify({ settings: { pluginUpdateToastShownFor: broken } }));
      expect(new StateStore(path).load().settings.pluginUpdateToastShownFor).toBeNull();
    }
  });

  test("the release check's failure backoff survives a reload; a broken one costs one early retry, not a silenced check", () => {
    const path = join(mkdtempSync(join(tmpdir(), "state-store-")), "state.json");
    writeFileSync(
      path,
      JSON.stringify({ settings: { pluginUpdateBackoff: { failedAt: 1_800_000_000_000, failures: 2 } } }),
    );
    expect(new StateStore(path).load().settings.pluginUpdateBackoff).toEqual({
      failedAt: 1_800_000_000_000,
      failures: 2,
    });

    // A missing count, a zero count, a broken time: dropped whole rather
    // than half-trusted — the check runs once more instead of never.
    for (const broken of [
      null,
      "soon",
      { failedAt: 123 },
      { failures: 1 },
      { failedAt: Number.NaN, failures: 1 },
      { failedAt: 123, failures: 0 },
      { failedAt: 123, failures: 1.5 },
      { failedAt: 123, failures: "2" },
    ]) {
      writeFileSync(path, JSON.stringify({ settings: { pluginUpdateBackoff: broken } }));
      expect(new StateStore(path).load().settings.pluginUpdateBackoff).toBeNull();
    }
  });
});
