/**
 * GitHub personal access token settings persistence. The token goes
 * through the exact same plain-JSON StateStore mechanism as the
 * existing CurseForge API key (this matches upstream's own actual,
 * unencrypted storage, not a downgrade from an idealized one). Covers
 * that mechanism's save/update/clear/
 * restart behavior for this field (also applicable to curseApiKey).
 */

import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createStateStore } from "../src/wow/storage/StateStore";
import { defaultSettings } from "../src/wow/storage/settings";

const ROOT = "/tmp/opencode/wowdeck-tests/github-token-settings";

describe("githubAccessToken persistence", () => {
  test("defaults to null (no token configured)", () => {
    expect(defaultSettings().githubAccessToken).toBeNull();
  });

  test("missing: a freshly created store has no token", () => {
    const dir = join(ROOT, "d1");
    rmSync(dir, { recursive: true, force: true });
    const store = createStateStore(dir);
    expect(store.settings.githubAccessToken).toBeNull();
  });

  test("saved: setting a token persists it in-memory immediately", () => {
    const dir = join(ROOT, "d2");
    rmSync(dir, { recursive: true, force: true });
    const store = createStateStore(dir);
    store.updateSettings({ githubAccessToken: "ghp_test_token_123" });
    expect(store.settings.githubAccessToken).toBe("ghp_test_token_123");
  });

  test("changed: saving a new token overwrites the old one", () => {
    const dir = join(ROOT, "d3");
    rmSync(dir, { recursive: true, force: true });
    const store = createStateStore(dir);
    store.updateSettings({ githubAccessToken: "ghp_first" });
    store.updateSettings({ githubAccessToken: "ghp_second" });
    expect(store.settings.githubAccessToken).toBe("ghp_second");
  });

  test("cleared: setting it back to null removes it", () => {
    const dir = join(ROOT, "d4");
    rmSync(dir, { recursive: true, force: true });
    const store = createStateStore(dir);
    store.updateSettings({ githubAccessToken: "ghp_test" });
    store.updateSettings({ githubAccessToken: null });
    expect(store.settings.githubAccessToken).toBeNull();
  });

  test("survives a simulated plugin restart (reload from the same data dir)", () => {
    const dir = join(ROOT, "d5");
    rmSync(dir, { recursive: true, force: true });
    const first = createStateStore(dir);
    first.updateSettings({ githubAccessToken: "ghp_persisted_value" });

    // A fresh StateStore instance over the same directory simulates the
    // engine process restarting (no shared in-memory state).
    const second = createStateStore(dir);
    expect(second.settings.githubAccessToken).toBe("ghp_persisted_value");
  });

  test("other settings fields are unaffected by a token update", () => {
    const dir = join(ROOT, "d6");
    rmSync(dir, { recursive: true, force: true });
    const store = createStateStore(dir);
    store.updateSettings({ curseApiKey: "cf-key" });
    store.updateSettings({ githubAccessToken: "ghp_token" });
    expect(store.settings.curseApiKey).toBe("cf-key");
    expect(store.settings.githubAccessToken).toBe("ghp_token");
  });
});
