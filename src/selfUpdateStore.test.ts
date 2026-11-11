/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { panelOffer, pluginUpdateDot, prChannelLine } from "./pluginUpdate";
import type { PluginUpdateInfo, StagedUpdate, UpdateRequestResult } from "./pluginUpdate";
import { createSelfUpdateStore, downloadView, type SelfUpdateDeps } from "./selfUpdateStore";
import type { UpdateChannel } from "./types";

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

/** An engine offer of `version`, installable. */
const offerOf = (version: string): PluginUpdateInfo["offer"] => ({
  kind: "update",
  version,
  headline: `WoWDeck ${version} available`,
  buttonLabel: "Update",
  toastBody: "Update in Options",
  rowLabel: "WoWDeck update available",
  releaseNotes: null,
  releaseUrl: `https://github.com/sigboe/wowdeck/releases/tag/v${version}`,
  installable: true,
});

const available = info({ status: "available", offer: offerOf("0.2.0") });

/** The engine's once-per-version signal: the first answer for 0.2.0. */
const availablePending = info({ ...available, toastPending: true });

const staged: StagedUpdate = {
  artifact: "file:///tmp/wowdeck-update-0.2.0.zip",
  version: "0.2.0",
  sha256: "deadbeef",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const calls: string[] = [];
  /** The params of each system.updateCheck ask, in order. */
  const checkParams: unknown[] = [];
  const toasts: string[] = [];
  let nowMs = 10_000_000;
  let checkAnswer: PluginUpdateInfo | Error = available;
  let checkGate: { promise: Promise<unknown>; resolve: (v: unknown) => void } | null = null;
  let stageAnswer:
    { result: StagedUpdate | null; error: { code: string; message: string } | null } | Error = {
    result: staged,
    error: null,
  };
  let stageGate: { promise: Promise<unknown>; resolve: (v: unknown) => void } | null = null;
  let installResult: UpdateRequestResult = { success: true };
  let installGate: { promise: Promise<unknown>; resolve: (v: unknown) => void } | null = null;
  /** The params of each system.setUpdateChannel ask, in order. */
  const channelParams: unknown[] = [];
  let channelAnswer: PluginUpdateInfo | Error = available;
  /** The engine's stored channel, as system.getUpdateChannel answers it. */
  let storedChannel: UpdateChannel | Error = "stable";
  const deps: SelfUpdateDeps = {
    rpc: (async (
      method: string,
      params?: { notify?: boolean; force?: boolean; channel?: UpdateChannel },
    ) => {
      calls.push(method);
      if (method === "system.getUpdateChannel") {
        if (storedChannel instanceof Error) throw storedChannel;
        return { channel: storedChannel };
      }
      if (method === "system.setUpdateChannel") {
        channelParams.push(params);
        if (channelAnswer instanceof Error) throw channelAnswer;
        storedChannel = params!.channel!;
        return channelAnswer;
      }
      if (method === "system.updateCheck") {
        checkParams.push(params);
        // The engine answers as of the ask; a held ask is that answer in transit.
        const answer = checkAnswer;
        if (checkGate) await checkGate.promise;
        if (answer instanceof Error) throw answer;
        // Like the engine: only a notify ask may report the toast.
        return params?.notify ? answer : { ...answer, toastPending: false };
      }
      if (method === "system.cancelDownload") {
        // Like the engine: the download in flight answers "cancelled".
        const inFlight = stageGate !== null;
        if (inFlight) {
          stageAnswer = {
            result: null,
            error: { code: "cancelled", message: "The download was cancelled" },
          };
          stageGate!.resolve(null);
        }
        return { cancelled: inFlight };
      }
      if (stageGate) await stageGate.promise;
      stageGate = null;
      if (stageAnswer instanceof Error) throw stageAnswer;
      return stageAnswer;
    }) as SelfUpdateDeps["rpc"],
    toast: (title, body = "") => toasts.push(body ? `${title}: ${body}` : title),
    toastError: (title, e) => toasts.push(e instanceof Error ? `${title}: ${e.message}` : title),
    requestUpdate: async (what) => {
      calls.push(`install ${what.version}`);
      if (installGate) await installGate.promise;
      return installResult;
    },
    now: () => nowMs,
  };
  return {
    store: createSelfUpdateStore(deps),
    calls,
    checkParams,
    channelParams,
    toasts,
    advance: (ms: number) => {
      nowMs += ms;
    },
    answer: (next: PluginUpdateInfo | Error) => {
      checkAnswer = next;
    },
    holdCheck: () => {
      checkGate = deferred<unknown>();
      return () => checkGate!.resolve(null);
    },
    stage: (next: typeof stageAnswer) => {
      stageAnswer = next;
    },
    holdStage: () => {
      stageGate = deferred<unknown>();
      return () => stageGate!.resolve(null);
    },
    holdInstall: () => {
      installGate = deferred<unknown>();
      return () => installGate!.resolve(null);
    },
    install: (next: UpdateRequestResult) => {
      installResult = next;
    },
    switchAnswer: (next: PluginUpdateInfo | Error) => {
      channelAnswer = next;
    },
    storedChannel: (next: UpdateChannel | Error) => {
      storedChannel = next;
    },
  };
}

describe("self-update store: refresh", () => {
  test("a trigger with no answer asks the engine, lands the answer, and tells subscribers", async () => {
    const h = harness();
    expect(h.store.get()).toEqual({
      info: null,
      staging: false,
      checking: false,
      download: null,
    });
    const heard: number[] = [];
    h.store.subscribe(() => heard.push(h.store.get().info?.offer?.version === "0.2.0" ? 1 : 0));

    const refreshing = h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck"]);

    await refreshing;
    expect(h.store.get()).toEqual({
      info: available,
      staging: false,
      checking: false,
      download: null,
    });
    expect(heard).toContain(1);
  });

  test("concurrent triggers share one in-flight fetch", async () => {
    const h = harness();
    const release = h.holdCheck();

    const load = h.store.refresh({ toast: true });
    const options = h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck"]);

    release();
    await Promise.all([load, options]);
    expect(h.calls).toEqual(["system.updateCheck"]);
  });

  test("a toast trigger joining an in-flight fetch still gets its toast", async () => {
    const h = harness();
    h.answer(availablePending);
    const release = h.holdCheck();

    const options = h.store.refresh(); // Options started a quiet ask…
    const wake = h.store.refresh({ toast: true }); // …the wake waits for it
    release();
    await Promise.all([options, wake]);
    // …then asks with notify (the engine serves its stored answer, no network).
    expect(h.checkParams).toEqual([{}, { notify: true }]);
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 available: Update in Options"]);
  });

  test("a toast trigger joining a toast ask shares it", async () => {
    const h = harness();
    h.answer(availablePending);
    const release = h.holdCheck();

    const load = h.store.refresh({ toast: true });
    const wake = h.store.refresh({ toast: true });
    release();
    await Promise.all([load, wake]);
    expect(h.checkParams).toEqual([{ notify: true }]);
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 available: Update in Options"]);
  });

  test("only a toast trigger asks the engine with notify", async () => {
    const h = harness();
    await h.store.refresh({ toast: true, bypassWindow: true }); // plugin load
    h.advance(16 * 60_000);
    await h.store.refresh(); // Options
    expect(h.checkParams).toEqual([{ notify: true }, {}]);
  });

  test("opening Options right after plugin load re-asks nothing", async () => {
    const h = harness();
    await h.store.refresh(); // plugin load
    h.advance(60_000); // Options opens a minute later
    await h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck"]);
    expect(h.store.get().info).toEqual(available);
  });

  test("a stale answer is re-asked on the next trigger", async () => {
    const h = harness();
    await h.store.refresh();
    h.advance(16 * 60_000); // past the freshness window: the wake could have slept a day
    await h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck", "system.updateCheck"]);
  });

  test("wake and load re-ask even inside the freshness window", async () => {
    const h = harness();
    await h.store.refresh();
    h.advance(60_000); // still fresh: a surface trigger would not re-ask…
    await h.store.refresh({ toast: true, bypassWindow: true }); // …but a wake always does
    expect(h.calls).toEqual(["system.updateCheck", "system.updateCheck"]);
  });
});

describe("self-update store: on the PR channel", () => {
  const PR_117 = { kind: "pr", number: 117, title: "Add PR builds to the channel picker" } as const;
  const current = info({ currentVersion: "1.1.2-pr.117.2", channel: PR_117 });

  test("Options asks only the update check: the PR channel lives in it", async () => {
    const h = harness();
    h.answer(current);

    await h.store.refresh();

    expect(h.calls).toEqual(["system.updateCheck"]);
    expect(h.store.get().info?.channel).toEqual(PR_117);
  });

  test("Check again on an up-to-date PR channel says which PR it is up to date with", async () => {
    const h = harness();
    h.answer(current);

    expect(await h.store.checkAgain()).toEqual({ kind: "current" });
    expect(h.checkParams).toEqual([{ force: true }]);
    expect(h.toasts).toEqual(["Up to date with PR #117"]);
  });

  test("Update on the PR's newer build stages it like any update", async () => {
    const h = harness();
    h.answer(
      info({
        ...current,
        status: "available",
        offer: { ...offerOf("1.1.2-pr.117.3")!, kind: "prUpdate" },
      }),
    );
    await h.store.refresh();

    await h.store.runUpdate();

    expect(h.calls.slice(1, 3)).toEqual(["system.updateStage", "install 0.2.0"]);
  });
});

describe("self-update store: the load/wake toast", () => {
  test("the load trigger toasts when the engine reports the version's toast pending", async () => {
    const h = harness();
    h.answer(availablePending);
    await h.store.refresh({ toast: true });
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 available: Update in Options"]);
  });

  test("a toast the engine already fired for this version stays quiet", async () => {
    const h = harness();
    h.answer(info({ ...available, toastPending: false }));
    await h.store.refresh({ toast: true });
    expect(h.toasts).toEqual([]);
  });

  test("a cached answer (engine served its snapshot) toasts only when it is the version's first", async () => {
    const h = harness();
    h.answer(info({ ...availablePending, checked: false }));
    await h.store.refresh({ toast: true });
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 available: Update in Options"]);
  });

  test("a check that could not run stays quiet", async () => {
    const h = harness();
    h.answer(info({ status: "unknown" }));
    await h.store.refresh({ toast: true });
    expect(h.toasts).toEqual([]);
  });

  test("an Options visit never toasts, even for a pending version", async () => {
    const h = harness();
    h.answer(availablePending);
    await h.store.refresh();
    expect(h.toasts).toEqual([]);
  });
});

describe("self-update store: a check that cannot run", () => {
  test("keeps the held answer, silently, and the next trigger retries", async () => {
    const h = harness();
    h.answer(new Error("engine not ready"));
    await h.store.refresh({ toast: true });
    expect(h.store.get().info).toBeNull();
    expect(h.toasts).toEqual([]);

    h.advance(60_000); // inside the freshness window — but nothing was answered
    h.answer(available);
    await h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck", "system.updateCheck"]);
    expect(h.store.get().info).toEqual(available);
  });

  test("an answer that could not check is not fresh: the next Options visit re-asks", async () => {
    const h = harness();
    h.answer(info({ status: "unknown" }));
    await h.store.refresh({ toast: true, bypassWindow: true }); // plugin load, offline
    h.advance(60_000); // Wi-Fi back, Options a minute later
    h.answer(available);
    await h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck", "system.updateCheck"]);
    expect(h.store.get().info).toEqual(available);
  });

  test("a later failed ask keeps the answer already shown", async () => {
    const h = harness();
    await h.store.refresh();
    h.advance(16 * 60_000);
    h.answer(new Error("engine went away"));
    await h.store.refresh();
    expect(h.store.get().info).toEqual(available);
    expect(h.toasts).toEqual([]);
  });
});

describe("self-update store: runUpdate", () => {
  test("stages in the engine, hands off to Decky's installer, and reports the run", async () => {
    const h = harness();
    const release = h.holdStage();

    const running = h.store.runUpdate();
    expect(h.store.get().staging).toBe(true);
    expect(h.calls).toEqual(["system.updateStage"]);

    release();
    await running;
    expect(h.calls).toEqual(["system.updateStage", "install 0.2.0", "system.updateCheck"]);
    expect(h.store.get().staging).toBe(false);
    expect(h.toasts).toEqual([]);
  });

  test("a second press while staging starts nothing new", async () => {
    const h = harness();
    const release = h.holdStage();

    const first = h.store.runUpdate();
    const second = h.store.runUpdate();
    release();
    await Promise.all([first, second]);
    expect(h.calls).toEqual(["system.updateStage", "install 0.2.0", "system.updateCheck"]);
  });

  test("an engine staging refusal says so and re-enables the button", async () => {
    const h = harness();
    h.stage({ result: null, error: { code: "no_download", message: "No zip on the release" } });
    await h.store.runUpdate();
    expect(h.calls).toEqual(["system.updateStage", "system.updateCheck"]);
    expect(h.toasts).toEqual(["Couldn't update WoWDeck: No zip on the release"]);
    expect(h.store.get().staging).toBe(false);
  });

  test("Decky's installer refusing says so", async () => {
    const h = harness();
    h.install({ success: false, error: "Installer unavailable" });
    await h.store.runUpdate();
    expect(h.toasts).toEqual(["Couldn't update WoWDeck: Installer unavailable"]);
    expect(h.store.get().staging).toBe(false);
  });

  test("afterwards the panel shows the engine's current answer, even inside the freshness window", async () => {
    // Staging may have forced a fresh check (a pruned beta's zip answered
    // 404), so the held 0.2.0 offer is stale.
    const h = harness();
    await h.store.refresh();
    expect(h.store.get().info?.offer?.version).toBe("0.2.0");
    h.answer(info({ status: "available", offer: offerOf("0.2.1-beta.4") }));
    await h.store.runUpdate();
    expect(h.store.get().info?.offer?.version).toBe("0.2.1-beta.4");
    // A quiet ask: the engine answers from what staging just stored.
    expect(h.checkParams[h.checkParams.length - 1]).toEqual({});
  });

  test("a check in flight since before staging cannot leave its stale answer showing", async () => {
    const h = harness();
    const release = h.holdCheck();
    const pending = h.store.refresh();
    const running = h.store.runUpdate();
    h.answer(info({ status: "available", offer: offerOf("0.2.1-beta.4") }));
    release();
    await Promise.all([pending, running]);
    expect(h.store.get().info?.offer?.version).toBe("0.2.1-beta.4");
  });

  test("a failed run refreshes the answer too", async () => {
    const h = harness();
    await h.store.refresh();
    h.stage({
      result: null,
      error: { code: "up_to_date", message: "WoWDeck is already up to date" },
    });
    h.answer(info({ status: "current" }));
    await h.store.runUpdate();
    expect(h.store.get().info?.status).toBe("current");
    expect(h.store.get().staging).toBe(false);
  });

  test("a staging failure the engine cannot phrase is still said", async () => {
    const h = harness();
    h.stage(new Error("disk full"));
    await h.store.runUpdate();
    expect(h.toasts).toEqual(["Couldn't update WoWDeck: disk full"]);
    expect(h.store.get().staging).toBe(false);
  });
});

describe("self-update store: download progress and cancel", () => {
  const progress = (received: number, total: number | null) =>
    ({ event: "system.downloadProgress", params: { version: "0.2.0", received, total } }) as const;

  test("shows Downloading X of Y MB from the engine's events, then Preparing… during Decky's handoff", async () => {
    const h = harness();
    const releaseStage = h.holdStage();
    const releaseInstall = h.holdInstall();

    const running = h.store.runUpdate();
    expect(downloadView(h.store.get())).toEqual({ text: "Downloading…", percent: null });
    h.store.handleEvent(progress(0, 73_104_512));
    expect(downloadView(h.store.get())).toEqual({ text: "Downloading 0.0 of 73.1 MB", percent: 0 });
    h.store.handleEvent(progress(36_552_256, 73_104_512));
    expect(downloadView(h.store.get())).toEqual({
      text: "Downloading 36.6 of 73.1 MB",
      percent: 50,
    });
    h.store.handleEvent(progress(73_104_512, 73_104_512));
    expect(downloadView(h.store.get())).toEqual({ text: "Preparing…", percent: null });

    releaseStage();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls).toContain("install 0.2.0");
    expect(downloadView(h.store.get())).toEqual({ text: "Preparing…", percent: null });
    releaseInstall();
    await running;
    expect(downloadView(h.store.get())).toBeNull();
    expect(h.store.get().download).toBeNull();
  });

  test("without a known size it counts what has arrived", async () => {
    const h = harness();
    const release = h.holdStage();
    const running = h.store.runUpdate();

    h.store.handleEvent(progress(5_000_000, null));
    expect(downloadView(h.store.get())).toEqual({ text: "Downloading 5.0 MB", percent: null });
    release();
    await running;
  });

  test("progress with nothing downloading changes nothing", () => {
    const h = harness();

    h.store.handleEvent(progress(1, 2));

    expect(h.store.get().download).toBeNull();
    expect(downloadView(h.store.get())).toBeNull();
  });

  test("Cancel stops the download silently: no toast, nothing handed to Decky, the button comes back", async () => {
    const h = harness();
    h.holdStage();
    const running = h.store.runUpdate();
    h.store.handleEvent(progress(1_000_000, 73_104_512));

    await h.store.cancelDownload();
    await running;

    expect(h.calls).toEqual(["system.updateStage", "system.cancelDownload", "system.updateCheck"]);
    expect(h.toasts).toEqual([]);
    expect(h.store.get().staging).toBe(false);
    expect(downloadView(h.store.get())).toBeNull();
  });

  test("Cancel with nothing downloading asks nothing", async () => {
    const h = harness();

    await h.store.cancelDownload();

    expect(h.calls).toEqual([]);
  });

  test("a download that failed partway says so, and Update can be pressed again", async () => {
    const h = harness();
    h.stage({
      result: null,
      error: { code: "download_failed", message: "Couldn't download the update. Try again" },
    });

    await h.store.runUpdate();

    expect(h.toasts).toEqual(["Couldn't update WoWDeck: Couldn't download the update. Try again"]);
    expect(h.store.get().staging).toBe(false);
  });
});

describe("self-update store: setChannel", () => {
  const beta = info({ status: "available", offer: offerOf("0.3.0-beta.4") });

  test("stores the channel in the engine and shows the check it answers with", async () => {
    const h = harness();
    await h.store.refresh();
    h.switchAnswer(beta);

    expect(await h.store.setChannel("beta")).toBe(true);
    expect(h.channelParams).toEqual([{ channel: "beta" }]);
    expect(h.store.get().info).toEqual(beta);
    expect(h.toasts).toEqual([]);
  });

  test("the switch's answer is fresh: opening Options right after re-asks nothing", async () => {
    const h = harness();
    await h.store.setChannel("beta");
    h.advance(60_000);
    await h.store.refresh();
    expect(h.calls).toEqual(["system.setUpdateChannel"]);
  });

  test("a check in flight when the channel switches cannot overwrite the new channel's answer", async () => {
    const h = harness();
    const release = h.holdCheck();
    const checking = h.store.refresh();
    h.switchAnswer(beta);

    const switching = h.store.setChannel("beta");
    release();
    await Promise.all([checking, switching]);
    expect(h.calls).toEqual(["system.updateCheck", "system.setUpdateChannel"]);
    expect(h.store.get().info).toEqual(beta);
  });

  test("a failed switch says so and keeps what is shown", async () => {
    const h = harness();
    await h.store.refresh();
    h.switchAnswer(new Error("engine went away"));

    expect(await h.store.setChannel("beta")).toBe(false);
    expect(h.store.get().info).toEqual(available);
    expect(h.toasts).toEqual(["Couldn't switch the update channel: engine went away"]);
  });
});

describe("self-update store: getChannel", () => {
  test("reads the channel the engine stored, including one just switched to", async () => {
    const h = harness();
    expect(await h.store.getChannel()).toBe("stable");
    await h.store.setChannel("beta");
    expect(await h.store.getChannel()).toBe("beta");
    expect(h.toasts).toEqual([]);
  });

  test("an unreadable channel says so and resolves null", async () => {
    const h = harness();
    h.storedChannel(new Error("engine went away"));
    expect(await h.store.getChannel()).toBeNull();
    expect(h.toasts).toEqual(["Couldn't read the update channel: engine went away"]);
  });
});

describe("self-update store: checkAgain", () => {
  test("asks the engine with force even inside the freshness window, and lands its answer", async () => {
    const h = harness();
    await h.store.refresh();
    h.answer(info({ status: "available", offer: offerOf("0.2.1") }));

    const result = await h.store.checkAgain();
    expect(h.checkParams).toEqual([{}, { force: true }]);
    expect(result).toEqual({ kind: "available", version: "0.2.1" });
    expect(h.store.get().info?.offer?.version).toBe("0.2.1");
  });

  test("checking is true while it runs, false once it lands", async () => {
    const h = harness();
    const release = h.holdCheck();
    const pressed = h.store.checkAgain();
    expect(h.store.get().checking).toBe(true);
    release();
    await pressed;
    expect(h.store.get().checking).toBe(false);
  });

  test("each outcome has its own toast", async () => {
    const h = harness();
    h.answer(info({ status: "current" }));
    expect(await h.store.checkAgain()).toEqual({ kind: "current" });
    h.answer(available);
    expect(await h.store.checkAgain()).toEqual({ kind: "available", version: "0.2.0" });
    h.answer(new Error("engine went away"));
    expect(await h.store.checkAgain()).toEqual({ kind: "failed" });
    expect(h.toasts).toEqual([
      "WoWDeck is up to date",
      "WoWDeck 0.2.0 is available",
      "Couldn't check for updates",
    ]);
  });

  test("a failed network attempt is a failure, even though the engine serves the stored offer", async () => {
    const h = harness();
    h.answer(info({ ...available, failed: true }));
    expect(await h.store.checkAgain()).toEqual({ kind: "failed" });
    h.answer(info({ status: "unknown" }));
    expect(await h.store.checkAgain()).toEqual({ kind: "failed" });
    expect(h.toasts).toEqual(["Couldn't check for updates", "Couldn't check for updates"]);
  });

  test("a second press while one runs joins it: one ask, one toast", async () => {
    const h = harness();
    const release = h.holdCheck();
    const first = h.store.checkAgain();
    const second = h.store.checkAgain();
    release();
    await Promise.all([first, second]);
    expect(h.checkParams).toEqual([{ force: true }]);
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 is available"]);
  });

  test("a press during a trigger's unforced ask waits it out, then forces its own", async () => {
    const h = harness();
    const release = h.holdCheck();
    const options = h.store.refresh();
    const pressed = h.store.checkAgain();
    release();
    await Promise.all([options, pressed]);
    expect(h.checkParams).toEqual([{}, { force: true }]);
    expect(h.toasts).toEqual(["WoWDeck 0.2.0 is available"]);
  });

  test("a trigger during a Check again joins it", async () => {
    const h = harness();
    const release = h.holdCheck();
    const pressed = h.store.checkAgain();
    const options = h.store.refresh();
    release();
    await Promise.all([options, pressed]);
    expect(h.checkParams).toEqual([{ force: true }]);
  });
});

test("merged-building is visible without a button, dot or toast", async () => {
  const h = harness();
  h.answer(
    info({
      status: "available",
      channel: { kind: "pr", number: 117, title: null },
      offer: {
        ...offerOf("1.1.2-pr.117")!,
        kind: "prMergedBuilding",
        installable: false,
        headline: "PR #117 was merged. A beta with it is still building",
      },
    }),
  );
  await h.store.refresh({ toast: true });
  expect(prChannelLine(h.store.get().info)).toBe(
    "PR #117 was merged. A beta with it is still building",
  );
  expect(panelOffer(h.store.get().info)).toBeNull();
  expect(pluginUpdateDot(h.store.get().info)).toBeNull();
  expect(h.toasts).toEqual([]);
});

test("ready merged beta shows the update dot and stages through Decky", async () => {
  const h = harness();
  h.answer(
    info({
      currentVersion: "1.1.2-pr.117.2",
      status: "available",
      channel: { kind: "beta" },
      toastPending: true,
      offer: { ...offerOf("1.1.2-beta.43")!, kind: "prMergedBeta" },
    }),
  );
  await h.store.refresh({ toast: true });
  expect(pluginUpdateDot(h.store.get().info)).toBe("update");
  expect(panelOffer(h.store.get().info)?.buttonLabel).toBe("Update");
  expect(h.toasts).toEqual(["WoWDeck 1.1.2-beta.43 available: Update in Options"]);
  await h.store.runUpdate();
  expect(h.calls).toContain("system.updateStage");
  expect(h.calls).toContain("install 0.2.0");
});

describe("closed and unlisted PR recovery", () => {
  test.each(["prClosed", "prUnlisted"] as const)(
    "%s shows the return offer and accepts a relisted build",
    async (kind) => {
      const h = harness();
      const headline = kind === "prClosed" ? "PR #117 was closed" : "PR #117 is no longer listed";
      const fallback = info({
        status: "available",
        currentVersion: "1.1.2-pr.117",
        channel: { kind: "pr", number: 117, title: "Add PR builds to the channel picker" },
        offer: {
          ...offerOf("1.1.1")!,
          kind,
          headline,
          rowLabel: headline,
          buttonLabel: "Switch to stable 1.1.1",
          toastBody: "Switch in Options",
        },
      });
      h.answer(fallback);
      await h.store.refresh();
      expect(panelOffer(h.store.get().info)?.headline).toBe(headline);
      expect(panelOffer(h.store.get().info)?.buttonLabel).toBe("Switch to stable 1.1.1");
      expect(pluginUpdateDot(h.store.get().info)).toBe("update");
      expect(h.store.get().info?.channel).toEqual(fallback.channel);
      expect(h.channelParams).toEqual([]);
      h.answer(
        info({
          ...fallback,
          offer: {
            ...offerOf("1.1.2-pr.117.2")!,
            kind: "prUpdate",
            headline: "PR #117 has a newer build",
            buttonLabel: "Update to 1.1.2-pr.117.2",
          },
        }),
      );
      await h.store.checkAgain();
      expect(panelOffer(h.store.get().info)?.kind).toBe("prUpdate");
      expect(pluginUpdateDot(h.store.get().info)).toBe("update");
      expect(h.channelParams).toEqual([]);
    },
  );
});
