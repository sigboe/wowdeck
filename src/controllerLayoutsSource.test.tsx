/// <reference types="bun-types" />
import { afterAll, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";
import { defaultSettings } from "../backend/src/wow/storage/settings";

/**
 * Options › Sources › Controller layouts (#265): the switch shows and stores
 * the engine's setting, and the source read the destination and the
 * catalogue gate on follows it. Nothing reads as on before the engine answers.
 */

let stored = { ...defaultSettings(), controllerLayoutsEnabled: true };
const fake = createFakeEngine({
  "settings.get": () => ({ settings: stored }),
  "settings.set": ({ settings: patch }) => {
    stored = { ...stored, ...patch };
    return { settings: stored };
  },
});
connectEngine(fake);
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));
mock.module("@decky/ui", () => deckyUiStub);

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
env.window = dom.window;
env.document = dom.window.document;
env.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
const { createRoot } = await import("react-dom/client");
const { settingsStore } = await import("./settings");
const { controllerLayoutsSourceOn } = await import("./controllerLayoutsSource");
const { ControllerLayoutsSourceRow } =
  await import("./components/settings/ControllerLayoutsSourceRow");

test("the source reads off until the engine's settings arrive", () => {
  expect(controllerLayoutsSourceOn(settingsStore.get())).toBe(false);
});

test("the Controller layouts switch shows the stored choice and turning it off stores the opt-out", async () => {
  await settingsStore.load();
  expect(controllerLayoutsSourceOn(settingsStore.get())).toBe(true);
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(<ControllerLayoutsSourceRow />));
  const toggle = dom.window.document.querySelector<HTMLInputElement>(
    'input[aria-label="Controller layouts"]',
  )!;
  expect(toggle.checked).toBe(true);

  await act(async () => toggle.click());

  expect(fake.calls.filter((c) => c.method === "settings.set").map((c) => c.params)).toEqual([
    { settings: { controllerLayoutsEnabled: false } },
  ]);
  expect(toggle.checked).toBe(false);
  expect(controllerLayoutsSourceOn(settingsStore.get())).toBe(false);
  await act(async () => root.unmount());
});
