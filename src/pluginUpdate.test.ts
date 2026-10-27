import { afterEach, describe, expect, test } from "bun:test";
import {
  closeStalePanel,
  pluginUpdateButton,
  pluginUpdateDot,
  pluginUpdatePanel,
  pluginUpdateRow,
  pluginUpdateToast,
  requestPluginUpdate,
  UPDATE_CHANNEL_ROWS,
  type PluginUpdateInfo,
} from "./pluginUpdate";
import { UPDATE_CHANNELS } from "../backend/src/api/contracts";

const ZIP = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7";

const info = (over: Partial<PluginUpdateInfo>): PluginUpdateInfo => ({
  status: "current",
  currentVersion: "0.1.1",
  latestVersion: null,
  releaseUrl: null,
  downloadUrl: null,
  switchToStable: false,
  checked: true,
  toastPending: false,
  ...over,
});

describe("pluginUpdateToast", () => {
  test("no toast when up to date", () => {
    expect(pluginUpdateToast(info({ status: "current" }))).toBeNull();
  });

  test("no toast when the check couldn't run (private repo, offline)", () => {
    expect(pluginUpdateToast(info({ status: "unknown" }))).toBeNull();
  });

  test("no toast when the engine already showed this version's", () => {
    // The engine's gate decides (system.updateCheck's toastPending): an
    // available answer whose toast already fired — re-read on every wake,
    // every panel, every restart — stays quiet.
    expect(
      pluginUpdateToast(info({ status: "available", latestVersion: "0.2.0", toastPending: false })),
    ).toBeNull();
  });

  test("the toast names the new version and where to go", () => {
    expect(
      pluginUpdateToast(
        info({
          status: "available",
          latestVersion: "0.2.0",
          releaseUrl: "https://x",
          toastPending: true,
        }),
      ),
    ).toEqual({ title: "WoWDeck 0.2.0 available", body: "Update in Options" });
  });

  test("a cached answer the gate marks pending still toasts (it is the first for that version)", () => {
    // e.g. the engine restarted holding yesterday's answer that no toast
    // was ever shown for: cached (checked false), pending true, one toast.
    expect(
      pluginUpdateToast(
        info({ status: "available", latestVersion: "0.2.0", checked: false, toastPending: true }),
      ),
    ).toEqual({ title: "WoWDeck 0.2.0 available", body: "Update in Options" });
  });
});

const SWITCH = {
  status: "available",
  currentVersion: "0.3.1-beta.57",
  latestVersion: "0.3.0",
  switchToStable: true,
  downloadUrl: ZIP,
} as const;

describe("switch to stable", () => {
  test("the toast, panel and button say Switch to stable X", () => {
    expect(pluginUpdateToast(info({ ...SWITCH, toastPending: true }))).toEqual({
      title: "Switch to stable 0.3.0",
      body: "Install it in Options",
    });
    expect(pluginUpdatePanel(info(SWITCH))).toEqual({ text: "Switch to stable 0.3.0" });
    expect(pluginUpdateButton(false, info(SWITCH))).toEqual({
      label: "Switch to stable 0.3.0",
      disabled: false,
    });
    expect(pluginUpdateButton(true, info(SWITCH))).toEqual({ label: "Preparing…", disabled: true });
  });

  test("the Updates row says Switch to stable X", () => {
    expect(pluginUpdateRow(info({ ...SWITCH, releaseUrl: "https://x" }))).toEqual({
      label: "Switch to stable 0.3.0",
      description: "0.3.1-beta.57 → 0.3.0 · https://x",
    });
  });

  test("the update dot behaves as for any offered update", () => {
    expect(pluginUpdateDot(info(SWITCH))).toBe("update");
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

describe("pluginUpdatePanel", () => {
  test("available: one line naming the target version", () => {
    expect(
      pluginUpdatePanel(info({ status: "available", latestVersion: "0.2.0", downloadUrl: ZIP })),
    ).toEqual({
      text: "WoWDeck 0.2.0 available",
    });
  });

  test("absent while the release has no WoWDeck.zip: Update could only fail", () => {
    expect(
      pluginUpdatePanel(info({ status: "available", latestVersion: "0.2.0", downloadUrl: null })),
    ).toBeNull();
  });

  test("absent while unanswered, current or unknown", () => {
    expect(pluginUpdatePanel(null)).toBeNull();
    expect(pluginUpdatePanel(info({ status: "current" }))).toBeNull();
    expect(pluginUpdatePanel(info({ status: "unknown" }))).toBeNull();
  });

  test("absent when an available answer names no version", () => {
    expect(pluginUpdatePanel(info({ status: "available", latestVersion: null }))).toBeNull();
  });
});

describe("pluginUpdateDot", () => {
  test("orange while a release is available", () => {
    expect(
      pluginUpdateDot(info({ status: "available", latestVersion: "0.2.0", downloadUrl: ZIP })),
    ).toBe("update");
  });

  test("off while the release has no WoWDeck.zip", () => {
    expect(
      pluginUpdateDot(info({ status: "available", latestVersion: "0.2.0", downloadUrl: null })),
    ).toBeNull();
  });

  test("off before the first answer", () => {
    expect(pluginUpdateDot(null)).toBeNull();
  });

  test("off once up to date (cleared after the update installs)", () => {
    expect(pluginUpdateDot(info({ status: "current", currentVersion: "0.2.0" }))).toBeNull();
  });

  test("off when the check couldn't run", () => {
    expect(pluginUpdateDot(info({ status: "unknown" }))).toBeNull();
  });
});

describe("pluginUpdateButton", () => {
  test("idle: Update, usable", () => {
    expect(pluginUpdateButton(false, info({}))).toEqual({ label: "Update", disabled: false });
  });

  test("staging: Preparing…, disabled", () => {
    expect(pluginUpdateButton(true, info({}))).toEqual({ label: "Preparing…", disabled: true });
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

describe("update channel rows (the WoWDeck Update Channel modal)", () => {
  test("one row per engine channel, in the engine's order", () => {
    expect(UPDATE_CHANNEL_ROWS.map((r) => r.channel)).toEqual([...UPDATE_CHANNELS]);
  });

  test("Stable and Beta carry the GLOSSARY's names and descriptions", () => {
    expect(UPDATE_CHANNEL_ROWS).toEqual([
      { channel: "stable", name: "Stable", description: "Recommended for most users." },
      {
        channel: "beta",
        name: "Beta",
        description: "Built from every merged change. Newer features, may have bugs.",
      },
    ]);
  });
});
