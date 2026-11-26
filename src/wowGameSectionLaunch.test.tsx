import { afterEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginSettings } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, type FakeEngine } from "./testSupport/fakeEngine";
import { saveSetting } from "./testSupport/saveSetting";

mock.module("@decky/ui", () => ({ ...deckyUiStub, QuickAccessTab: {} }));
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

const { WowGameSection } = await import("./components/WowGameSection");
const { settingsStore } = await import("./settings");

const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** The addon section on linked app 42's page, with these settings. */
async function showSection(settings: Partial<PluginSettings> = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  const fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "settings.get": {
      settings: {
        ...defaultSettings(),
        steamAutoCheck: false,
        ...settings,
      },
    },
  });
  const disconnect = connectEngine(fake);
  const container = dom.window.document.getElementById("root")!;
  const root: Root = createRoot(container);
  cleanup = async () => {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  };
  await settingsStore.load();
  await act(async () => {
    root.render(<WowGameSection appId={42} attachLaunch={() => () => {}} />);
  });
  const addonSection = () => container.querySelector(".wowdeck-game-section")!;
  const all = () => [...addonSection().querySelectorAll<HTMLElement>("[role=button]")];
  const buttons = () => all().map((b) => b.textContent);
  const retry = () => all().find((button) => button.textContent === "Retry");
  return { fake, addonSection, buttons, retry };
}

const setLaunchMenu = (fake: FakeEngine, on: boolean) =>
  saveSetting(settingsStore, fake, { steamLaunchMenu: on });

const inert = (b: HTMLElement | undefined) => b?.getAttribute("aria-disabled") === "true";

test("a failed launch read gets a box of its own with Retry", async () => {
  const { fake, addonSection, retry } = await showSection();
  expect(addonSection().querySelectorAll(".wowdeck-page-box")).toHaveLength(1);
  await act(async () => fake.next("launch.state").fail(new Error("bridge disconnected")));
  const boxes = addonSection().querySelectorAll(".wowdeck-page-box");
  expect(boxes).toHaveLength(2);
  expect(boxes[1]!.textContent).toContain("Couldn't check WoW launch status");
  expect(inert(retry())).toBe(false);
  await act(async () => retry()?.click());
  expect(inert(retry())).toBe(true);
  await act(async () => fake.next("launch.state").resolve({ state: null }));
  expect(retry()).toBeUndefined();
});

test("a linked page with no launch state (DroidDeck owns Play) shows no launch lines", async () => {
  const { fake, addonSection, buttons } = await showSection();
  await act(async () => fake.next("launch.state").resolve({ state: null }));
  expect(addonSection().textContent).toContain("WoW addons");
  expect(addonSection().textContent).not.toContain("launch");
  expect(buttons()).toEqual(["Check for updates", "My Addons"]);
});

test("with Choose the WoW version from Play off, the section reads no launch state and shows no launch lines", async () => {
  const { fake, addonSection, buttons } = await showSection({ steamLaunchMenu: false });
  expect(fake.paramsOf("launch.state")).toEqual([]);
  expect(addonSection().textContent).not.toContain("launch");
  expect(buttons()).toEqual(["Check for updates", "My Addons"]);

  // Turning it on with the page open starts the read (no line while it
  // reads); off again drops the launch box.
  await setLaunchMenu(fake, true);
  expect(fake.paramsOf("launch.state")).toHaveLength(1);
  expect(addonSection().textContent).not.toContain("launch");
  await act(async () => fake.next("launch.state").fail(new Error("bridge disconnected")));
  expect(buttons()).toContain("Retry");

  await setLaunchMenu(fake, false);
  expect(addonSection().textContent).not.toContain("launch");
  expect(buttons()).toEqual(["Check for updates", "My Addons"]);
});
