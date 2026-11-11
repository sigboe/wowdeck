import { afterEach, describe, expect, test } from "bun:test";
import {
  closeStalePanel,
  isOffChannel,
  panelOffer,
  pluginUpdateDot,
  pluginUpdateRow,
  pluginUpdateToast,
  prChannelLine,
  releaseNotesAction,
  updateChannelChoice,
  requestPluginUpdate,
  UPDATE_CHANNEL_ROWS,
  type PluginUpdateInfo,
} from "./pluginUpdate";
import { UPDATE_CHANNELS } from "../backend/src/api/contracts";

const info = (over: Partial<PluginUpdateInfo>): PluginUpdateInfo => ({
  status: "current",
  currentVersion: "0.1.1",
  channel: { kind: "stable" },
  offer: null,
  checked: true,
  failed: false,
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

describe("releaseNotesAction: Y on the panel's Update button", () => {
  test("an offer with notes: Y opens the release notes modal, titled with the version", () => {
    const offer = {
      ...UPDATE.offer!,
      version: "0.2.1-beta.4",
      releaseNotes: "Added\n• Beta updates",
    };
    expect(releaseNotesAction(offer)).toEqual({
      label: "Release notes",
      title: "WoWDeck 0.2.1-beta.4 release notes",
      notes: "Added\n• Beta updates",
    });
  });

  test("an offer without notes, or only whitespace, has no Y action and no hint", () => {
    expect(releaseNotesAction(UPDATE.offer)).toBeNull();
    expect(releaseNotesAction({ ...UPDATE.offer!, releaseNotes: "" })).toBeNull();
    expect(releaseNotesAction({ ...UPDATE.offer!, releaseNotes: " \n " })).toBeNull();
  });

  test("no offer, no action", () => {
    expect(releaseNotesAction(null)).toBeNull();
  });
});

describe("isOffChannel (a test build, or a PR build that left its PR channel)", () => {
  test("true when the answer served no channel", () => {
    expect(isOffChannel(info({ currentVersion: "1.0.2-test.114", channel: null }))).toBe(true);
    expect(isOffChannel(info({ currentVersion: "1.0.2-pr.117.2", channel: null }))).toBe(true);
  });

  test("false on Stable, Beta and a PR channel", () => {
    expect(isOffChannel(info({ channel: { kind: "stable" } }))).toBe(false);
    expect(isOffChannel(info({ currentVersion: "1.1.2-beta.29", channel: { kind: "beta" } }))).toBe(
      false,
    );
    const onPr = info({
      currentVersion: "1.0.2-pr.117.2",
      channel: { kind: "pr", number: 117, title: "Fix" },
    });
    expect(isOffChannel(onPr)).toBe(false);
  });

  test("false before the engine answered", () => {
    expect(isOffChannel(null)).toBe(false);
  });
});

describe("a leaveTest offer (the way out of a test build)", () => {
  const LEAVE_TEST = info({
    status: "available",
    currentVersion: "1.0.2-test.114",
    channel: null,
    offer: {
      kind: "leaveTest",
      version: "1.0.2-beta.27",
      headline: "Switch to beta 1.0.2-beta.27",
      buttonLabel: "Switch to beta 1.0.2-beta.27",
      toastBody: "Switch in Options",
      rowLabel: "Switch to beta 1.0.2-beta.27",
      releaseNotes: null,
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v1.0.2-beta.27",
      installable: true,
    },
  });

  test("the Updates row names the switch and the version transition", () => {
    expect(pluginUpdateRow(LEAVE_TEST)).toEqual({
      label: "Switch to beta 1.0.2-beta.27",
      description: "1.0.2-test.114 → 1.0.2-beta.27",
    });
  });

  test("a pr build's rebuild gets the same wording as a test build", () => {
    const fromPr = { ...LEAVE_TEST, currentVersion: "1.0.2-pr.117.2" };
    expect(isOffChannel(fromPr)).toBe(true);
    expect(pluginUpdateRow(fromPr)).toEqual({
      label: "Switch to beta 1.0.2-beta.27",
      description: "1.0.2-pr.117.2 → 1.0.2-beta.27",
    });
    expect(panelOffer(fromPr)?.kind).toBe("leaveTest");
  });

  test("the panel offers it and toasts once, like any installable offer", () => {
    expect(panelOffer(LEAVE_TEST)?.kind).toBe("leaveTest");
    expect(pluginUpdateToast({ ...LEAVE_TEST, toastPending: true })).toEqual({
      title: "Switch to beta 1.0.2-beta.27",
      body: "Switch in Options",
    });
  });
});

describe("pluginUpdateRow", () => {
  test("an offer: the version transition only, so it fits the QAM", () => {
    expect(pluginUpdateRow(UPDATE)).toEqual({
      label: "WoWDeck update available",
      description: "0.1.1 → 0.2.0",
    });
    expect(pluginUpdateRow(UPDATE).description).not.toContain("https://");
  });

  test("names an offer without its zip too", () => {
    expect(pluginUpdateRow(NO_ZIP).label).toBe("WoWDeck update available");
  });

  test("a switch says Switch to stable X and names the versions", () => {
    expect(pluginUpdateRow(SWITCH)).toEqual({
      label: "Switch to stable 0.3.0",
      description: "0.3.1-beta.57 → 0.3.0",
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

describe("the PR channel (GLOSSARY: PR channel)", () => {
  const PR_117 = { kind: "pr", number: 117, title: "Add PR builds to the channel picker" } as const;
  /** A PR build on its PR channel, with nothing newer listed. */
  const CURRENT = info({ status: "current", currentVersion: "1.1.2-pr.117.2", channel: PR_117 });
  /** The engine's offer of the PR's newer build. */
  const NEWER = info({
    status: "available",
    currentVersion: "1.1.2-pr.117.2",
    channel: PR_117,
    offer: {
      kind: "prUpdate",
      version: "1.1.2-pr.117.3",
      headline: "PR #117 has a newer build",
      buttonLabel: "Update to 1.1.2-pr.117.3",
      toastBody: "Update in Options",
      rowLabel: "PR #117 has a newer build",
      releaseNotes: null,
      releaseUrl: "https://github.com/sigboe/wowdeck/pull/117",
      installable: true,
    },
  });

  test("nothing newer: the panel reads Up to date with PR #N, with no offer and no dot", () => {
    expect(prChannelLine(CURRENT)).toBe("Up to date with PR #117");
    expect(panelOffer(CURRENT)).toBeNull();
    expect(pluginUpdateDot(CURRENT)).toBeNull();
    expect(pluginUpdateRow(CURRENT)).toEqual({
      label: "WoWDeck 1.1.2-pr.117.2",
      description: "Up to date with PR #117",
    });
  });

  test("a newer build of the PR: the panel's offer, the dot, the row and the toast", () => {
    expect(prChannelLine(NEWER)).toBeNull();
    expect(panelOffer(NEWER)?.buttonLabel).toBe("Update to 1.1.2-pr.117.3");
    expect(pluginUpdateDot(NEWER)).toBe("update");
    expect(pluginUpdateRow(NEWER)).toEqual({
      label: "PR #117 has a newer build",
      description: "1.1.2-pr.117.2 → 1.1.2-pr.117.3",
    });
    expect(pluginUpdateToast({ ...NEWER, toastPending: true })).toEqual({
      title: "PR #117 has a newer build",
      body: "Update in Options",
    });
    expect(releaseNotesAction(panelOffer(NEWER))).toBeNull();
  });

  test("no panel line on Stable, Beta or off any channel", () => {
    expect(prChannelLine(info({ status: "current" }))).toBeNull();
    expect(prChannelLine(info({ status: "current", channel: null }))).toBeNull();
    expect(prChannelLine(null)).toBeNull();
  });

  test("a PR channel that couldn't check says so, not up to date", () => {
    const failed = info({ ...CURRENT, status: "unknown", failed: true });
    expect(prChannelLine(failed)).toBeNull();
    expect(pluginUpdateRow(failed).description).toBe("Couldn't check for a newer release");
  });
});

describe("the channel modal's rows (updateChannelChoice)", () => {
  test("on a PR channel: the PR's row is checked, with its title; Stable and Beta stay pickable", () => {
    const onPr = info({
      currentVersion: "1.1.2-pr.117.2",
      channel: { kind: "pr", number: 117, title: "Add PR builds to the channel picker" },
    });
    expect(updateChannelChoice(onPr, "beta")).toEqual({
      checked: null,
      pr: { name: "PR #117", description: "Add PR builds to the channel picker" },
    });
  });

  test("a PR the list never titled still gets its row", () => {
    const untitled = info({
      currentVersion: "1.1.2-pr.117.2",
      channel: { kind: "pr", number: 117, title: null },
    });
    expect(updateChannelChoice(untitled, "stable").pr).toEqual({
      name: "PR #117",
      description: "",
    });
  });

  test("on Stable or Beta: the stored channel is checked, and no PR row is offered", () => {
    expect(updateChannelChoice(info({}), "stable")).toEqual({ checked: "stable", pr: null });
    expect(updateChannelChoice(null, "beta")).toEqual({ checked: "beta", pr: null });
  });

  test("off any channel (a test build): no row is checked", () => {
    const test = info({ currentVersion: "1.0.2-test.114", channel: null });
    expect(updateChannelChoice(test, "beta")).toEqual({ checked: null, pr: null });
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
    ["an http URL", "http://localhost/wowdeck-update-0.2.0.zip"],
    ["a non-file scheme", "ftp:///tmp/wowdeck-update-0.2.0.zip"],
    ["a file URL with a host", "file://host/tmp/wowdeck-update-0.2.0.zip"],
    ["a .. segment", "file:///tmp/../home/wowdeck-update-0.2.0.zip"],
    ["a . segment", "file:///tmp/./wowdeck-update-0.2.0.zip"],
    ["a .. file segment", "file:///tmp/.."],
    ["a directory, not a file", "file:///tmp/"],
  ])("%s is refused before the installer", async (_, artifact) => {
    const calls = recordingLoader();
    const result = await requestPluginUpdate({ ...staged, artifact });
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
