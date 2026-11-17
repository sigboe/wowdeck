/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { ControllerLayout, ControllerLayoutCatalogue } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, engineFailure, type EngineFailure } from "./testSupport/fakeEngine";

/**
 * The Controller layouts destination's pane (#266): browse-only rows in the
 * maintainers' order, one honest state per catalogue answer, and no request
 * at all while the source is off. Synthetic fixture layouts, not production
 * entries.
 */

const LAYOUT_A: ControllerLayout = {
  id: "fixture-synthetic-a",
  title: "Fixture layout A",
  author: "WoWDeck fixtures",
  description: "A synthetic layout for tests.",
  controllerType: "controller_neptune",
  publishedFileId: "1000000000000000001",
  offer: "available",
  revision: { number: 1, sha256: "1".repeat(64), contentFormat: 1, withdrawn: false },
  revisions: [{ number: 1, sha256: "1".repeat(64), contentFormat: 1, withdrawn: false }],
};
const LAYOUT_B: ControllerLayout = {
  ...LAYOUT_A,
  id: "fixture-synthetic-b",
  title: "Fixture layout B",
  author: "Another fixture",
  description: undefined,
  controllerType: "controller_triton",
  publishedFileId: "1000000000000000002",
};

let sourceOn = true;
let answer: ControllerLayoutCatalogue | EngineFailure = {
  state: "ready",
  layouts: [LAYOUT_A, LAYOUT_B],
};
const fake = createFakeEngine({
  "settings.get": () => ({
    settings: { ...defaultSettings(), controllerLayoutsEnabled: sourceOn },
  }),
  "controllerLayouts.catalogue": () => answer,
});
connectEngine(fake);
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));
mock.module("@decky/ui", () => deckyUiStub);

const dom = new JSDOM('<div id="root"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
env.window = dom.window;
env.document = doc;
env.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
const { createRoot } = await import("react-dom/client");
const { settingsStore } = await import("./settings");
const { controllerLayoutsModule } = await import("./controllerLayouts");
const { ControllerLayoutsTab } = await import("./components/ControllerLayoutsTab");

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  sourceOn = true;
  answer = { state: "ready", layouts: [LAYOUT_A, LAYOUT_B] };
  fake.calls.length = 0;
  controllerLayoutsModule.catalogue.forget(controllerLayoutsModule.KEY);
  root = createRoot(doc.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

async function show(): Promise<string> {
  await act(async () => settingsStore.load());

  await act(async () => root.render(<ControllerLayoutsTab view="qam.browse.controllerLayouts" />));
  await act(async () => {});
  return doc.getElementById("root")!.textContent ?? "";
}

const catalogueRequests = () =>
  fake.calls.filter((c) => c.method === "controllerLayouts.catalogue").length;

test("the reviewed layouts appear in the maintainers' order, browse only", async () => {
  const text = await show();

  expect(text).toContain("WoWDeck can't apply these layouts yet");
  expect(text.indexOf("Fixture layout A")).toBeLessThan(text.indexOf("Fixture layout B"));
  expect(text).toContain("by WoWDeck fixtures");
  expect(text).toContain("Steam Deck");
  expect(text).toContain("A synthetic layout for tests.");
  expect(text).toContain("by Another fixture");
  expect(text).toContain("Steam Controller");
  expect(text).not.toMatch(/apply$|Apply layout|Preview/);
  expect(doc.querySelectorAll("button").length).toBe(0);
});

test("a withdrawn layout is explained, not offered", async () => {
  answer = { state: "ready", layouts: [{ ...LAYOUT_A, offer: "withdrawn", revision: null }] };

  const text = await show();

  expect(text).toContain("Fixture layout A");
  expect(text).toContain("Withdrawn by the WoWDeck maintainers");
});

test("nothing is asked for while the source is off", async () => {
  sourceOn = false;

  const text = await show();

  expect(text).toBe("");
  expect(catalogueRequests()).toBe(0);
});

test("an engine that has the source off shows nothing, not a failure", async () => {
  // The toggle went off in the engine before this client's settings caught up.
  answer = { state: "disabled" };

  expect(await show()).toBe("");
});

test.each<[string, ControllerLayoutCatalogue | EngineFailure, string, boolean]>([
  ["empty", { state: "ready", layouts: [] }, "No controller layouts yet", false],
  ["unavailable", { state: "unavailable" }, "Couldn't load controller layouts", true],
  ["malformed", { state: "malformed" }, "Couldn't read the controller layouts list", true],
  ["unsupported", { state: "unsupported", schemaVersion: 9 }, "Update WoWDeck", false],
  ["failed", engineFailure("not_ready"), "Couldn't load controller layouts", true],
])("a %s catalogue reads as its own state", async (_name, catalogue, text, retry) => {
  answer = catalogue;

  const shown = await show();

  expect(shown).toContain(text);
  expect(shown).not.toContain("Fixture layout");
  expect(shown.includes("Retry")).toBe(retry);
});

test("Retry asks again and shows what comes back", async () => {
  answer = { state: "unavailable" };
  await show();
  answer = { state: "ready", layouts: [LAYOUT_A] };

  const retry = [...doc.querySelectorAll("b")].find((b) => b.textContent === "Retry")!;
  await act(async () => (retry.parentElement as HTMLElement).click());
  await act(async () => {});

  expect(catalogueRequests()).toBe(2);
  expect(doc.getElementById("root")!.textContent).toContain("Fixture layout A");
});
