import { afterEach, describe, expect, test } from "bun:test";
import {
  closeStalePanel,
  panelOffer,
  pluginUpdateDot,
  pluginUpdateRow,
  pluginUpdateToast,
  requestPluginUpdate,
  UPDATE_CHANNEL_ROWS,
  type PluginUpdateInfo,
} from "./pluginUpdate";
import { UPDATE_CHANNELS } from "../backend/src/api/contracts";

const info = (over: Partial<PluginUpdateInfo>): PluginUpdateInfo => ({
  status: "current",
  currentVersion: "0.1.1",
  offer: null,
  checked: true,
  toastPending: false,
  ...over,
});

/** The engine's offer of 0.2.0, as system.updateCheck words it. */
const UPDATE = info({
  status: "available",
  offer: {
    kind: "update",
    version: "0.2.0",
    headline: "WoWDeck 0.2.0 available",
    buttonLabel: "Update",
    toastBody: "Update in Options",
    rowLabel: "WoWDeck update available",
    releaseNotes: null,
    releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
    installable: true,
  },
});

/** A beta build on Stable, offered the older latest stable. */
const SWITCH = info({
  status: "available",
  currentVersion: "0.3.1-beta.57",
  offer: {
    kind: "switchToStable",
    version: "0.3.0",
    headline: "Switch to stable 0.3.0",
    buttonLabel: "Switch to stable 0.3.0",
    toastBody: "Install it in Options",
    rowLabel: "Switch to stable 0.3.0",
    releaseNotes: null,
    releaseUrl: "https://x",
    installable: true,
  },
});

/** An offer whose WoWDeck.zip is not attached yet. */
const NO_ZIP = info({ ...UPDATE, offer: { ...UPDATE.offer!, installable: false } });

describe("pluginUpdateToast", () => {
  test("no toast without an offer", () => {
    expect(pluginUpdateToast(info({ status: "current" }))).toBeNull();
    expect(pluginUpdateToast(info({ status: "unknown" }))).toBeNull();
  });

  test("no toast when the engine's gate is not pending (already shown)", () => {
    expect(pluginUpdateToast(UPDATE)).toBeNull();
  });

  test("the toast is the offer's headline and says where to go", () => {
    expect(pluginUpdateToast({ ...UPDATE, toastPending: true })).toEqual({
      title: "WoWDeck 0.2.0 available",
      body: "Update in Options",
    });
    expect(pluginUpdateToast({ ...SWITCH, toastPending: true })).toEqual({
      title: "Switch to stable 0.3.0",
      body: "Install it in Options",
    });
  });
});

describe("the update panel and its dot", () => {
  test("show an installable offer", () => {
    expect(panelOffer(UPDATE)).toBe(UPDATE.offer);
    expect(panelOffer(SWITCH)).toBe(SWITCH.offer);
    expect(pluginUpdateDot(UPDATE)).toBe("update");
    expect(pluginUpdateDot(SWITCH)).toBe("update");
  });

  test("absent while the offer has no WoWDeck.zip: Update could only fail", () => {
    expect(panelOffer(NO_ZIP)).toBeNull();
    expect(pluginUpdateDot(NO_ZIP)).toBeNull();
  });

  test("absent before the first answer, when current (cleared after the update installs) or unknown", () => {
    for (const answer of [null, info({ status: "current" }), info({ status: "unknown" })]) {
      expect(panelOffer(answer)).toBeNull();
      expect(pluginUpdateDot(answer)).toBeNull();
    }
  });
});

describe("pluginUpdateRow", () => {
  test("an offer: current → offered with the release link", () => {
    expect(pluginUpdateRow(UPDATE)).toEqual({
      label: "WoWDeck update available",
      description: "0.1.1 → 0.2.0 · https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
    });
  });

  test("names an offer without its zip too", () => {
    expect(pluginUpdateRow(NO_ZIP).label).toBe("WoWDeck update available");
  });

  test("a switch says Switch to stable X", () => {
    expect(pluginUpdateRow(SWITCH)).toEqual({
      label: "Switch to stable 0.3.0",
      description: "0.3.1-beta.57 → 0.3.0 · https://x",
    });
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

  /** A loader bridge that accepts every call and records its arguments. */
  function recordingLoader(): unknown[][] {
    const calls: unknown[][] = [];
    g.window = {
      DeckyBackend: {
        call: async (...args: unknown[]) => {
          calls.push(args);
          return true;
        },
      },
    };
    return calls;
  }

  test("no loader bridge (older loaders, tests): unavailable, never a throw", async () => {
    delete g.window;
    const result = await requestPluginUpdate(staged);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  test("calls Decky's installer with the staged file, version, hash, UPDATE", async () => {
    const calls = recordingLoader();
    const result = await requestPluginUpdate(staged);
    expect(result.success).toBe(true);
    expect(calls).toEqual([
      ["utilities/install_plugin", staged.artifact, "WoWDeck", "0.2.0", "deadbeef", 2],
    ]);
  });

  test("a staged beta reaches Decky's installer (#10)", async () => {
    const calls = recordingLoader();
    const result = await requestPluginUpdate({
      artifact: "file:///tmp/wowdeck-update-0.2.1-beta.4.zip",
      version: "0.2.1-beta.4",
      sha256: "deadbeef",
    });
    expect(result.success).toBe(true);
    expect(calls).toEqual([
      [
        "utilities/install_plugin",
        "file:///tmp/wowdeck-update-0.2.1-beta.4.zip",
        "WoWDeck",
        "0.2.1-beta.4",
        "deadbeef",
        2,
      ],
    ]);
  });

  test("a remote artifact is refused outright (decky-loader #984)", async () => {
    const calls = recordingLoader();
    const result = await requestPluginUpdate({
      ...staged,
      artifact: "https://github.com/sigboe/wowdeck/releases/download/v0.2.0/WoWDeck.zip",
    });
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  test.each([
    ["an http URL", "http://localhost/wowdeck-update-0.2.0.zip", "0.2.0"],
    ["another file name", "file:///tmp/WoWDeck.zip", "0.2.0"],
    ["an rc", "file:///tmp/wowdeck-update-0.2.1-rc.1.zip", "0.2.1-rc.1"],
    ["a bare -beta", "file:///tmp/wowdeck-update-0.2.1-beta.zip", "0.2.1-beta"],
    ["a -beta.x", "file:///tmp/wowdeck-update-0.2.1-beta.x.zip", "0.2.1-beta.x"],
    ["a .. segment", "file:///tmp/../home/wowdeck-update-0.2.0.zip", "0.2.0"],
    ["a name for another version", "file:///tmp/wowdeck-update-0.2.1-beta.4.zip", "0.2.1-beta.5"],
    ["a release name with a beta version", "file:///tmp/wowdeck-update-0.2.1.zip", "0.2.1-beta.4"],
  ])("%s is refused before the installer", async (_, artifact, version) => {
    const calls = recordingLoader();
    const result = await requestPluginUpdate({ artifact, version, sha256: "deadbeef" });
    expect(result).toEqual({
      success: false,
      error: "The update could not be verified, so it was not installed.",
    });
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
