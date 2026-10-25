import { afterEach, describe, expect, test } from "bun:test";
import {
  closeStalePanel,
  pluginUpdateRow,
  pluginUpdateToast,
  requestPluginUpdate,
  type PluginUpdateInfo,
} from "./pluginUpdate";

const info = (over: Partial<PluginUpdateInfo>): PluginUpdateInfo => ({
  status: "current",
  currentVersion: "0.1.1",
  latestVersion: null,
  releaseUrl: null,
  downloadUrl: null,
  ...over,
});

describe("pluginUpdateToast", () => {
  test("no toast when up to date", () => {
    expect(pluginUpdateToast(info({ status: "current" }))).toBeNull();
  });

  test("no toast when the check couldn't run (private repo, offline)", () => {
    expect(pluginUpdateToast(info({ status: "unknown" }))).toBeNull();
  });

  test("the toast names the new version", () => {
    expect(
      pluginUpdateToast(
        info({ status: "available", latestVersion: "0.2.0", releaseUrl: "https://x" }),
      ),
    ).toEqual({ title: "WoWDeck 0.2.0 available", body: "Link in Options → Updates" });
  });
});

describe("pluginUpdateRow", () => {
  test("available: current → latest with the release link", () => {
    expect(
      pluginUpdateRow(
        info({
          status: "available",
          latestVersion: "0.2.0",
          releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
        }),
      ),
    ).toEqual({
      label: "WoWDeck update available",
      description: "0.1.1 → 0.2.0 · https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
    });
  });

  test("available without a link: falls back to the releases page", () => {
    const row = pluginUpdateRow(info({ status: "available", latestVersion: "0.2.0" }));
    expect(row.description).toContain("github.com/sigboe/wowdeck/releases");
  });

  test("current: states the version", () => {
    expect(pluginUpdateRow(info({ status: "current" }))).toEqual({
      label: "WoWDeck 0.1.1",
      description: "Up to date",
    });
  });

  test("unknown: couldn't check, not a failure", () => {
    expect(pluginUpdateRow(info({ status: "unknown" }))).toEqual({
      label: "WoWDeck 0.1.1",
      description: "Couldn't check for a newer release",
    });
  });
});

describe("requestPluginUpdate", () => {
  const staged = {
    artifact: "file:///tmp/wowdeck-update-0.2.0.zip",
    version: "0.2.0",
    sha256: "deadbeef",
  };
  const g = globalThis as { window?: unknown };

  afterEach(() => {
    delete g.window;
  });

  test("no loader bridge (older loaders, tests): unavailable, never a throw", async () => {
    delete g.window;
    const result = await requestPluginUpdate(staged);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  test("calls Decky's installer with the staged file, version, hash, UPDATE", async () => {
    const calls: unknown[][] = [];
    g.window = {
      DeckyBackend: {
        call: async (...args: unknown[]) => {
          calls.push(args);
          return true;
        },
      },
    };
    const result = await requestPluginUpdate(staged);
    expect(result.success).toBe(true);
    expect(calls).toEqual([
      ["utilities/install_plugin", staged.artifact, "WoWDeck", "0.2.0", "deadbeef", 2],
    ]);
  });

  test("a remote artifact is refused outright (decky-loader #984)", async () => {
    const calls: unknown[][] = [];
    g.window = {
      DeckyBackend: {
        call: async (...args: unknown[]) => {
          calls.push(args);
          return true;
        },
      },
    };
    const result = await requestPluginUpdate({
      ...staged,
      artifact: "https://github.com/sigboe/wowdeck/releases/download/v0.2.0/WoWDeck.zip",
    });
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  test("the loader reporting failure reads as unavailable", async () => {
    g.window = { DeckyBackend: { call: async () => false } };
    expect((await requestPluginUpdate(staged)).success).toBe(false);
  });

  test("closeStalePanel closes only our own open panel", () => {
    let closed = 0;
    g.window = {
      DeckyPluginLoader: {
        deckyState: {
          publicState: () => ({ activePlugin: { name: "WoWDeck" } }),
          closeActivePlugin: () => {
            closed += 1;
          },
        },
      },
    };
    expect(closeStalePanel()).toBe(true);
    expect(closed).toBe(1);
    g.window = {
      DeckyPluginLoader: {
        deckyState: {
          publicState: () => ({ activePlugin: { name: "Something else" } }),
          closeActivePlugin: () => {
            closed += 1;
          },
        },
      },
    };
    expect(closeStalePanel()).toBe(false);
    expect(closed).toBe(1);
  });
});
