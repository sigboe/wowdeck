/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { PluginUpdateInfo, StagedUpdate, UpdateRequestResult } from "./pluginUpdate";
import { createSelfUpdateStore, type SelfUpdateDeps } from "./selfUpdateStore";
import type { UpdateChannel } from "./types";

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

const available = info({
  status: "available",
  latestVersion: "0.2.0",
  releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
  downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/1",
});

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
  /** The params of each system.setUpdateChannel ask, in order. */
  const channelParams: unknown[] = [];
  let channelAnswer: PluginUpdateInfo | Error = available;
  /** The engine's stored channel, as system.getUpdateChannel answers it. */
  let storedChannel: UpdateChannel | Error = "stable";
  const deps: SelfUpdateDeps = {
    rpc: (async (method: string, params?: { notify?: boolean; channel?: UpdateChannel }) => {
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
        if (checkGate) await checkGate.promise;
        if (checkAnswer instanceof Error) throw checkAnswer;
        // Like the engine: only a notify ask may report the toast.
        return params?.notify ? checkAnswer : { ...checkAnswer, toastPending: false };
      }
      if (stageGate) await stageGate.promise;
      if (stageAnswer instanceof Error) throw stageAnswer;
      return stageAnswer;
    }) as SelfUpdateDeps["rpc"],
    toast: (title, body = "") => toasts.push(body ? `${title}: ${body}` : title),
    toastError: (title, e) => toasts.push(e instanceof Error ? `${title}: ${e.message}` : title),
    requestUpdate: async (what) => {
      calls.push(`install ${what.version}`);
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
    expect(h.store.get()).toEqual({ info: null, staging: false });
    const heard: number[] = [];
    h.store.subscribe(() => heard.push(h.store.get().info?.latestVersion === "0.2.0" ? 1 : 0));

    const refreshing = h.store.refresh();
    expect(h.calls).toEqual(["system.updateCheck"]);

    await refreshing;
    expect(h.store.get()).toEqual({ info: available, staging: false });
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
    await h.store.refresh({ toast: true, force: true }); // plugin load
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
    await h.store.refresh({ toast: true, force: true }); // …but a wake always does
    expect(h.calls).toEqual(["system.updateCheck", "system.updateCheck"]);
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
    await h.store.refresh({ toast: true, force: true }); // plugin load, offline
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
    expect(h.calls).toEqual(["system.updateStage", "install 0.2.0"]);
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
    expect(h.calls).toEqual(["system.updateStage", "install 0.2.0"]);
  });

  test("an engine staging refusal says so and re-enables the button", async () => {
    const h = harness();
    h.stage({ result: null, error: { code: "no_download", message: "No zip on the release" } });
    await h.store.runUpdate();
    expect(h.calls).toEqual(["system.updateStage"]);
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

  test("a staging failure the engine cannot phrase is still said", async () => {
    const h = harness();
    h.stage(new Error("disk full"));
    await h.store.runUpdate();
    expect(h.toasts).toEqual(["Couldn't update WoWDeck: disk full"]);
    expect(h.store.get().staging).toBe(false);
  });
});

describe("self-update store: setChannel", () => {
  const beta = info({
    status: "available",
    latestVersion: "0.3.0-beta.4",
    releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.3.0-beta.4",
    downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/4",
  });

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
