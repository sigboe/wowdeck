import { afterEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UpdateAllProgress } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, type FakeEngine } from "./testSupport/fakeEngine";

const toasts: string[] = [];
mock.module("@decky/ui", () => ({ ...deckyUiStub, QuickAccessTab: {} }));
mock.module("@decky/api", () => ({
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
}));

const { WowGameSection } = await import("./components/WowGameSection");
const { settingsStore } = await import("./settings");
const { addonSession } = await import("./session");

const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  toasts.length = 0;
});

const summary = (updates: number) => ({
  installations: [{ installationId: "i1", displayName: "Retail", updates }],
});
const step = (done: number, total: number, addonName: string | null, failed = 0) =>
  ({ done, total, failed, addonName }) satisfies UpdateAllProgress;

/**
 * The band on linked app 42's page with 3 updates waiting. Update all waits
 * for the test (`fake.next("addons.updateAll")`); the summary read after it
 * answers `after` updates.
 */
async function showBand() {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  env.window = dom.window;
  Object.assign(globalThis, { document: dom.window.document });
  env.IS_REACT_ACT_ENVIRONMENT = true;
  const fake = createFakeEngine({
    "addons.updateSummary": summary(3),
    "addons.list": { addons: [] },
    "settings.get": {
      settings: { ...defaultSettings(), steamAutoCheck: false, steamLaunchMenu: false },
    },
  });
  const disconnect = connectEngine(fake);
  const container = dom.window.document.getElementById("root")!;
  let root: Root = createRoot(container);
  const render = () =>
    act(async () => root.render(<WowGameSection appId={42} attachLaunch={() => () => {}} />));
  cleanup = async () => {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  };
  await settingsStore.load();
  await render();
  const band = () => container.querySelector(".wowdeck-game-section")!;
  const button = (name: string) =>
    [...band().querySelectorAll<HTMLElement>("[role=button]")].find((b) => b.textContent === name);
  const text = () => band().textContent ?? "";
  const progress = (p: UpdateAllProgress) =>
    act(async () => fake.emit({ event: "addons.updateAllProgress", params: p }));
  /** Leave the page and open it again. */
  const remount = async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
  };
  return { fake, dom, band, button, text, progress, remount };
}

const inert = (b: HTMLElement) => b.getAttribute("aria-disabled") === "true";

async function finish(fake: FakeEngine, after: number) {
  fake.answers["addons.updateSummary"] = summary(after);
  await act(async () => fake.next("addons.updateAll").resolve({ operations: [] }));
}

test("Update all on the band checks first, then shows My Addons' bar over every installation", async () => {
  const { fake, button, text, band, progress } = await showBand();
  expect(text()).toContain("WoW addons · 3 updates ready");
  await act(async () => button("Update all")!.click());

  expect(fake.paramsOf("addons.updateAll")).toEqual([{ allInstallations: true }]);
  expect(text()).toContain("Checking for updates");
  expect(band().querySelector("[role=progressbar]")).not.toBeNull();
  // One action: Update all checks every installation itself.
  expect(inert(button("Update all")!)).toBe(true);
  expect(button("Check for updates")).toBeUndefined();
  expect(inert(button("My Addons")!)).toBe(false);

  await progress(step(0, 4, "Bagnon"));
  expect(text()).toContain("Updating 1 of 4 · 0%");
  expect(text()).toContain("Bagnon");
  // A failed turn still moves the bar on by one share.
  await progress(step(2, 4, "Details", 1));
  expect(text()).toContain("Updating 3 of 4 · 50% · 1 failed");
  expect(text()).toContain("Details");
  expect(band().querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("50");

  await finish(fake, 0);
  expect(text()).not.toContain("Updating");
  expect(text()).toContain("WoW addons are up to date");
  expect(fake.paramsOf("addons.updateSummary").slice(-1)[0]).toEqual({ refresh: false });
  expect(toasts).toHaveLength(1);
  expect(button("Update all")).toBeUndefined();
  expect(inert(button("Check for updates")!)).toBe(false);
  expect(addonSession.get().updatingAll).toBeNull();
});

test("one candidate shows the updating spinner and its name; none goes back to the summary", async () => {
  const { fake, button, text, progress } = await showBand();
  await act(async () => button("Update all")!.click());
  await progress(step(0, 1, "Deadly Boss Mods"));
  expect(text()).toContain("Updating");
  expect(text()).not.toContain("1 of 1");
  expect(text()).toContain("Deadly Boss Mods");
  await finish(fake, 0);

  // Nothing to update after all: checking, then the refreshed summary.
  fake.answers["addons.updateSummary"] = summary(2);
  await act(async () => void (await import("./steamUpdates")).steamUpdates.loadSummary());
  await act(async () => button("Update all")!.click());
  expect(text()).toContain("Checking for updates");
  await finish(fake, 2);
  expect(text()).toContain("2 updates ready");
  expect(inert(button("Update all")!)).toBe(false);
});

test("leaving and reopening the page mid-run shows the same progress, and the run stays the only one", async () => {
  const { fake, button, text, progress, remount } = await showBand();
  await act(async () => button("Update all")!.click());
  await progress(step(1, 3, "WeakAuras"));
  await remount();
  expect(text()).toContain("Updating 2 of 3 · 33%");
  expect(text()).toContain("WeakAuras");
  expect(inert(button("Update all")!)).toBe(true);

  // My Addons' Update all while it runs starts nothing.
  await act(async () => addonSession.actions.updateAll("installation"));
  expect(fake.paramsOf("addons.updateAll")).toHaveLength(1);
  await finish(fake, 0);
  expect(text()).toContain("WoW addons are up to date");
});

test("a run started in My Addons shows its progress on the band", async () => {
  const { fake, button, text, progress } = await showBand();
  let run!: Promise<void>;
  await act(async () => void (run = addonSession.actions.updateAll("all")));
  expect(text()).toContain("Checking for updates");
  await progress(step(0, 2, "Plater"));
  expect(text()).toContain("Updating 1 of 2 · 0%");
  expect(inert(button("Update all")!)).toBe(true);
  await finish(fake, 1);
  await act(async () => run);
  expect(text()).toContain("1 update ready");
});

test("a failed run clears its progress, refreshes the summary, toasts and gives Update all back", async () => {
  const { fake, button, text, progress } = await showBand();
  await act(async () => button("Update all")!.click());
  await progress(step(0, 3, "Bagnon"));
  fake.answers["addons.updateSummary"] = summary(2);
  await act(async () => fake.next("addons.updateAll").fail(new Error("bridge disconnected")));
  expect(toasts).toEqual(["Couldn't update addons"]);
  expect(text()).not.toContain("Updating");
  expect(text()).toContain("2 updates ready");
  expect(inert(button("Update all")!)).toBe(false);
});

test("the action keeps its element through the run, so focus stays on it, and A on it starts nothing", async () => {
  const { fake, band, button, progress } = await showBand();
  const action = button("Update all")!;
  await act(async () => action.click());
  await progress(step(0, 2, "Bagnon"));
  expect(band().querySelector("[role=button]")).toBe(action);
  expect(inert(action)).toBe(true);
  await act(async () => action.click());
  expect(fake.paramsOf("addons.updateAll")).toHaveLength(1);

  // Done with nothing left: the same element now checks for updates.
  await finish(fake, 0);
  expect(band().querySelector("[role=button]")).toBe(action);
  expect(action.textContent).toBe("Check for updates");
  expect(inert(action)).toBe(false);
});

test("a run started elsewhere leaves focus on Steam's Play button", async () => {
  const { fake, dom } = await showBand();
  const play = dom.window.document.createElement("button");
  dom.window.document.body.append(play);
  play.focus();

  let run!: Promise<void>;
  await act(async () => void (run = addonSession.actions.updateAll("all")));
  expect(dom.window.document.activeElement).toBe(play);
  await finish(fake, 0);
  await act(async () => run);
  expect(dom.window.document.activeElement).toBe(play);
});
