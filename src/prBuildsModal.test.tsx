/**
 * The PR builds modal (Options › Updates › WoWDeck › channel picker ›
 * "PR builds…"), rendered in a DOM and fed through the production typed
 * RPC over a transport the test answers (createDeferredRpc), so no test
 * reaches the engine or the network.
 */
import { afterAll, afterEach, beforeAll, describe, expect, jest, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
import { createDeferredRpc, type DeferredRpc } from "./testSupport/deferredRpc";
import type { PrBuild } from "./types";
import type { StagedUpdate } from "./pluginUpdate";

mock.module("@decky/ui", () => deckyUiStub);

const { PrBuildsModal } = await import("./components/PrBuildsModal");
const { createSelfUpdateStore } = await import("./selfUpdateStore");
const { UpdateChannelModal } = await import("./components/UpdateChannelModal");

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;
beforeAll(() => {
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

/** Build times in a fixed zone and locale, so the text doesn't depend on the machine. */
const UTC = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const PR_171: PrBuild = {
  number: 171,
  title: "Show raid frames in the overlay",
  author: "octocat",
  version: "1.1.2-pr.171",
  headSha: "8f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6",
  builtAt: "2026-11-09T18:42:07Z",
  zipSize: 73104512,
};
const PR_117: PrBuild = {
  number: 117,
  title: "Add PR builds to the channel picker",
  author: "sigboe",
  version: "1.1.2-pr.117.2",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  builtAt: "2026-11-08T09:15:00Z",
  zipSize: 72998400,
};

/**
 * The self-update store the modal installs through, over the test's
 * engine; Decky's installer records what it was handed and answers once
 * `installer.release()` is called (at once unless `installer.hold()`).
 */
function storeOver(engine: DeferredRpc, handed: StagedUpdate[] = [], toasts: string[] = []) {
  let gate: Promise<void> | null = null;
  let release = () => {};
  const selfUpdate = createSelfUpdateStore({
    rpc: engine.rpc,
    toast: (title) => toasts.push(title),
    toastError: (title) => toasts.push(title),
    requestUpdate: async (staged) => {
      handed.push(staged);
      if (gate) await gate;
      return { success: true };
    },
  });
  const installer = {
    hold() {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
  };
  return { selfUpdate, installer };
}

/** Open the modal over a fresh engine; it has not answered yet. */
async function open(): Promise<DeferredRpc> {
  const engine = createDeferredRpc();
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () =>
    root!.render(
      <PrBuildsModal
        rpc={engine.rpc}
        selfUpdate={storeOver(engine).selfUpdate}
        dateFormat={UTC}
        closeModal={() => {}}
      />,
    ),
  );
  return engine;
}

const page = () => dom.window.document.getElementById("root")!;
const text = () => page().textContent ?? "";
const button = (label: string) =>
  [...page().querySelectorAll("button")].find((b) => b.textContent === label);
const progressBar = () => page().querySelector('[role="progressbar"]');

describe("PR builds modal", () => {
  test("lists each build with its PR number, title, author, version and build time", async () => {
    const engine = await open();

    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [PR_171, PR_117] }));

    expect(text()).toContain("#171 Show raid frames in the overlay");
    expect(text()).toContain("octocat · 1.1.2-pr.171 · built 9 Nov 2026, 18:42");
    expect(text()).toContain("#117 Add PR builds to the channel picker");
    expect(text()).toContain("sigboe · 1.1.2-pr.117.2 · built 8 Nov 2026, 09:15");
    // Newest PR first, as the engine lists them.
    expect(text().indexOf("#171")).toBeLessThan(text().indexOf("#117"));
  });

  test("a title with markup shows as the plain text its author typed", async () => {
    const engine = await open();
    const title = '<b>Urgent</b> <img src=x onerror="alert(1)"> [click](https://evil.example)';

    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [{ ...PR_171, title }] }));

    expect(text()).toContain(`#171 ${title}`);
    expect(page().querySelector("img")).toBeNull();
    expect(page().querySelector("a")).toBeNull();
    expect([...page().querySelectorAll("b")].map((b) => b.textContent)).not.toContain("Urgent");
  });

  test("with nothing published it says so, not that it failed", async () => {
    const engine = await open();

    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [] }));

    expect(text()).toContain("No PR builds right now.");
    expect(text()).not.toContain("Couldn't load PR builds");
  });

  test("says it is loading until the engine answers", async () => {
    await open();

    expect(text()).toContain("Loading PR builds…");
    expect(text()).not.toContain("No PR builds right now.");
  });

  test("a list that couldn't load says so and Retry asks again", async () => {
    const engine = await open();

    await act(() => engine.next("system.listPrBuilds").resolve({ builds: null }));

    expect(text()).toContain("Couldn't load PR builds");
    expect(text()).not.toContain("No PR builds right now.");

    await act(async () => button("Retry")!.click());
    expect(text()).toContain("Loading PR builds…");
    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [PR_117] }));

    expect(text()).toContain("#117 Add PR builds to the channel picker");
    expect(text()).not.toContain("Couldn't load PR builds");
    expect(button("Retry")).toBeUndefined();
  });

  test("a failed call is the same load error", async () => {
    const engine = await open();

    await act(() => engine.next("system.listPrBuilds").fail(new Error("Python Exception")));

    expect(text()).toContain("Couldn't load PR builds");
    expect(button("Retry")).toBeDefined();
  });

  test("asks the engine once when it opens, and not again by itself", async () => {
    jest.useFakeTimers();
    try {
      const engine = await open();
      await act(() => engine.next("system.listPrBuilds").resolve({ builds: [PR_171] }));
      // An hour on the clock: no poll or retry timer may fire.
      await act(async () => {
        jest.advanceTimersByTime(60 * 60 * 1000);
      });

      expect(engine.log).toEqual(["system.listPrBuilds"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("installing a PR build", () => {
  /** Open the modal listing #117, with a Decky installer that records what it was handed. */
  async function openListed() {
    const engine = createDeferredRpc();
    const handed: StagedUpdate[] = [];
    const happened: string[] = [];
    const toasts: string[] = [];
    const { selfUpdate, installer } = storeOver(engine, handed, toasts);
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <PrBuildsModal
          rpc={engine.rpc}
          selfUpdate={selfUpdate}
          dateFormat={UTC}
          closeModal={() => happened.push("closed")}
        />,
      ),
    );
    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [PR_117] }));
    return { engine, handed, happened, toasts, selfUpdate, installer };
  }
  const pick = (label: string) =>
    act(async () =>
      (
        [...page().querySelectorAll("b")].find((b) => b.textContent === label)!
          .parentElement as HTMLElement
      ).click(),
    );

  test("picking a build asks to confirm, saying the code comes from a labeled, unreleased pull request", async () => {
    const { engine } = await openListed();

    await pick("#117 Add PR builds to the channel picker");

    expect(text()).toContain("Install WoWDeck 1.1.2-pr.117.2?");
    expect(text()).toContain("#117 Add PR builds to the channel picker, by sigboe");
    expect(text()).toContain(
      "Its code comes from a labeled, unreleased pull request. A maintainer labeled it for testing; it is not a release.",
    );
    expect(text()).toContain("Decky asks you to confirm the install next.");
    expect(button("Install")).toBeDefined();
    expect(button("Cancel")).toBeDefined();
    expect(engine.log).toEqual(["system.listPrBuilds"]);
  });

  test("Cancel goes back to the list and installs nothing", async () => {
    const { engine, handed, happened } = await openListed();
    await pick("#117 Add PR builds to the channel picker");

    await act(async () => button("Cancel")!.click());

    expect(text()).not.toContain("Install WoWDeck");
    expect(text()).toContain("#117 Add PR builds to the channel picker");
    expect(engine.log).toEqual(["system.listPrBuilds"]);
    expect(handed).toEqual([]);
    expect(happened).toEqual([]);
  });

  test("Install stages the confirmed build and hands it to Decky's installer", async () => {
    const { engine, handed, happened } = await openListed();
    await pick("#117 Add PR builds to the channel picker");

    await act(async () => button("Install")!.click());
    expect(progressBar()).not.toBeNull();
    expect(button("Install")).toBeUndefined();
    const staged = {
      artifact: "file:///tmp/wowdeck-update-1.1.2-pr.117.2.zip",
      version: "1.1.2-pr.117.2",
      sha256: "a".repeat(64),
    };
    await act(() => engine.next("system.installPrBuild").resolve({ result: staged, error: null }));

    expect(engine.log).toEqual([
      "system.listPrBuilds",
      'system.installPrBuild {"number":117,"version":"1.1.2-pr.117.2"}',
    ]);
    expect(handed).toEqual([staged]);
    expect(happened).toEqual(["closed"]);
  });

  test("a refused install says why, hands Decky nothing and lets the owner go back", async () => {
    const { engine, handed, happened } = await openListed();
    await pick("#117 Add PR builds to the channel picker");

    await act(async () => button("Install")!.click());
    await act(() =>
      engine.next("system.installPrBuild").resolve({
        result: null,
        error: {
          code: "checksum_mismatch",
          message: "The download doesn't match the published PR build, so it wasn't installed",
        },
      }),
    );

    expect(text()).toContain(
      "The download doesn't match the published PR build, so it wasn't installed",
    );
    expect(progressBar()).toBeNull();
    expect(button("Install")!.disabled).toBe(false);
    expect(handed).toEqual([]);
    expect(happened).toEqual([]);
    await act(async () => button("Cancel")!.click());
    expect(text()).toContain("#117 Add PR builds to the channel picker");
  });
});

describe("a PR build's download", () => {
  /** Open the list, pick #117 and press Install; the engine is downloading. */
  async function installing() {
    const engine = createDeferredRpc();
    const handed: StagedUpdate[] = [];
    const happened: string[] = [];
    const toasts: string[] = [];
    const { selfUpdate, installer } = storeOver(engine, handed, toasts);
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <PrBuildsModal
          rpc={engine.rpc}
          selfUpdate={selfUpdate}
          dateFormat={UTC}
          closeModal={() => happened.push("closed")}
        />,
      ),
    );
    await act(() => engine.next("system.listPrBuilds").resolve({ builds: [PR_117] }));
    await act(async () =>
      (
        [...page().querySelectorAll("b")].find(
          (b) => b.textContent === "#117 Add PR builds to the channel picker",
        )!.parentElement as HTMLElement
      ).click(),
    );
    await act(async () => button("Install")!.click());
    const progress = (received: number) =>
      act(async () =>
        selfUpdate.handleEvent({
          event: "system.downloadProgress",
          params: { version: PR_117.version, received, total: PR_117.zipSize },
        }),
      );
    return { engine, handed, happened, toasts, installer, progress };
  }
  const staged = {
    artifact: "file:///tmp/wowdeck-update-1.1.2-pr.117.2.zip",
    version: "1.1.2-pr.117.2",
    sha256: "a".repeat(64),
  };

  test("Valve's progress bar shows Downloading X of Y MB in Install's place, then Preparing… for Decky", async () => {
    const { engine, happened, installer, progress } = await installing();

    expect(progressBar()).not.toBeNull();
    expect(button("Install")).toBeUndefined();
    await progress(36_499_200);
    expect(text()).toContain("Downloading 36.5 of 73.0 MB");
    await progress(PR_117.zipSize);
    expect(text()).toContain("Preparing…");

    installer.hold();
    await act(() => engine.next("system.installPrBuild").resolve({ result: staged, error: null }));
    expect(text()).toContain("Preparing…");
    expect(happened).toEqual([]);
    await act(async () => installer.release());
    expect(happened).toEqual(["closed"]);
  });

  test("B cancels the download silently: back to the confirmation, no error, nothing handed to Decky", async () => {
    const { engine, handed, happened, toasts, progress } = await installing();
    await progress(10_000_000);

    await act(async () => button("B: Cancel download")!.click());
    await act(() => engine.next("system.cancelDownload").resolve({ cancelled: true }));
    await act(() =>
      engine.next("system.installPrBuild").resolve({
        result: null,
        error: { code: "cancelled", message: "The download was cancelled" },
      }),
    );

    expect(progressBar()).toBeNull();
    expect(text()).toContain("Install WoWDeck 1.1.2-pr.117.2?");
    expect(text()).not.toContain("cancelled");
    expect(button("Install")!.disabled).toBe(false);
    expect(handed).toEqual([]);
    expect(happened).toEqual([]);
    expect(toasts).toEqual([]);
  });

  test("a download that fails partway says so, and Install can be pressed again", async () => {
    const { engine, handed, progress } = await installing();
    await progress(10_000_000);

    await act(() =>
      engine.next("system.installPrBuild").resolve({
        result: null,
        error: { code: "download_failed", message: "Couldn't download the PR build. Try again" },
      }),
    );

    expect(text()).toContain("Couldn't download the PR build. Try again");
    expect(progressBar()).toBeNull();
    expect(button("Install")!.disabled).toBe(false);
    expect(handed).toEqual([]);
  });
});

describe("updating to a newer build of the running PR (the update panel's button)", () => {
  const NEWER: PrBuild = { ...PR_117, version: "1.1.2-pr.117.3" };

  async function openConfirming() {
    const engine = createDeferredRpc();
    const handed: StagedUpdate[] = [];
    const happened: string[] = [];
    const { selfUpdate } = storeOver(engine, handed);
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <PrBuildsModal
          rpc={engine.rpc}
          selfUpdate={selfUpdate}
          confirm={NEWER}
          closeModal={() => happened.push("closed")}
        />,
      ),
    );
    return { engine, handed, happened };
  }

  test("opens on the confirmation for that build, without loading the list", async () => {
    const { engine } = await openConfirming();

    expect(text()).toContain("Install WoWDeck 1.1.2-pr.117.3?");
    expect(text()).toContain("Its code comes from a labeled, unreleased pull request.");
    expect(engine.log).toEqual([]);
  });

  test("Install stages that build and hands it to Decky's installer", async () => {
    const { engine, handed, happened } = await openConfirming();

    await act(async () => button("Install")!.click());
    const staged = {
      artifact: "file:///tmp/wowdeck-update-1.1.2-pr.117.3.zip",
      version: "1.1.2-pr.117.3",
      sha256: "b".repeat(64),
    };
    await act(() => engine.next("system.installPrBuild").resolve({ result: staged, error: null }));

    expect(engine.log).toEqual(['system.installPrBuild {"number":117,"version":"1.1.2-pr.117.3"}']);
    expect(handed).toEqual([staged]);
    expect(happened).toEqual(["closed"]);
  });

  test("Cancel closes the modal and installs nothing", async () => {
    const { engine, handed, happened } = await openConfirming();

    await act(async () => button("Cancel")!.click());

    expect(happened).toEqual(["closed"]);
    expect(handed).toEqual([]);
    expect(engine.log).toEqual([]);
  });
});

describe("the channel picker's PR builds row", () => {
  async function openPicker(
    onPrBuilds: () => void,
    closeModal: () => void,
    {
      current = "stable",
      pr = null,
      onPick = () => {},
    }: Partial<Parameters<typeof UpdateChannelModal>[0]> = {},
  ) {
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <UpdateChannelModal
          current={current}
          pr={pr}
          onPick={onPick}
          onPrBuilds={onPrBuilds}
          moveToStable={false}
          onMoveToStable={() => {}}
          closeModal={closeModal}
        />,
      ),
    );
  }
  const row = (label: string) =>
    [...page().querySelectorAll("b")].find((b) => b.textContent === label)!.parentElement!;

  test("sits below Stable and Beta and opens the PR builds modal, closing the picker", async () => {
    const happened: string[] = [];
    await openPicker(
      () => happened.push("PR builds opened"),
      () => happened.push("picker closed"),
    );

    expect(text().indexOf("Beta")).toBeLessThan(text().indexOf("PR builds…"));

    await act(async () => row("PR builds…").click());

    expect(happened).toEqual(["picker closed", "PR builds opened"]);
  });

  test("on a PR channel: the PR's row first, with its title; Stable leaves the PR channel", async () => {
    const happened: string[] = [];
    await openPicker(
      () => happened.push("PR builds opened"),
      () => happened.push("picker closed"),
      {
        current: null,
        pr: { name: "PR #117", description: "Add PR builds to the channel picker" },
        onPick: (channel) => happened.push(`picked ${channel}`),
      },
    );

    expect(text()).toContain("Add PR builds to the channel picker");
    expect(text().indexOf("PR #117")).toBeLessThan(text().indexOf("Stable"));
    expect(row("PR #117").querySelector("svg")).not.toBeNull();
    expect(row("Stable").querySelector("svg")).toBeNull();

    await act(async () => row("PR #117").click());
    await act(async () => row("Stable").click());

    expect(happened).toEqual(["picker closed", "picker closed", "picked stable"]);
  });
});

describe("the channel picker's Move to Stable after release toggle", () => {
  async function openPicker(
    current: "stable" | "beta" | null,
    moveToStable: boolean,
    happened: string[] = [],
  ) {
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <UpdateChannelModal
          current={current}
          pr={null}
          onPick={() => {}}
          onPrBuilds={() => {}}
          moveToStable={moveToStable}
          onMoveToStable={(on) => happened.push(`toggle ${on ? "on" : "off"}`)}
          closeModal={() => happened.push("picker closed")}
        />,
      ),
    );
  }
  const toggle = () =>
    page().querySelector<HTMLInputElement>('input[aria-label="Move to Stable after release"]');

  test("shows below the channels while Beta is selected, off on a fresh install", async () => {
    await openPicker("beta", false);

    expect(toggle()).not.toBeNull();
    expect(toggle()!.checked).toBe(false);
  });

  test("shows the stored choice", async () => {
    await openPicker("beta", true);

    expect(toggle()!.checked).toBe(true);
  });

  test("is hidden on Stable and on a test build", async () => {
    await openPicker("stable", true);
    expect(toggle()).toBeNull();
    await act(async () => root?.unmount());

    await openPicker(null, true);
    expect(toggle()).toBeNull();
  });

  test("turning it on saves the choice and keeps the picker open; off again saves off", async () => {
    const happened: string[] = [];
    await openPicker("beta", false, happened);

    await act(async () => toggle()!.click());
    expect(toggle()!.checked).toBe(true);
    await act(async () => toggle()!.click());

    expect(toggle()!.checked).toBe(false);
    expect(happened).toEqual(["toggle on", "toggle off"]);
  });
});
