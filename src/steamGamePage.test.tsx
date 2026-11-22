import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkedGames } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, type FakeEngine } from "./testSupport/fakeEngine";

mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  QuickAccessTab: {},
  afterPatch: () => ({ unpatch: () => {} }),
  appDetailsClasses: {},
  createReactTreePatcher: () => () => {},
  findInReactTree: () => undefined,
  findModule: () => undefined,
  findSP: () => undefined,
  getReactInstance: () => undefined,
}));
mock.module("@decky/api", () => ({
  toaster: { toast: () => {} },
  routerHook: { addPatch: () => ({}), removePatch: () => {} },
}));

const { LinkedWowGameSection } = await import("./steamGamePage");
const { settingsStore } = await import("./settings");
const { linkedGamesStore, shownLinkedGames } = await import("./linkedGames");

const WOW = { appId: 42, name: "World of Warcraft", source: "found" } as const;
const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;

let dom: JSDOM;
let root: Root;
let fake: FakeEngine;
let disconnect: () => void;

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "launch.state": { state: null },
  });
  disconnect = connectEngine(fake);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  disconnect();
  dom.window.close();
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
});

const section = () => dom.window.document.querySelector(".wowdeck-game-section");
const render = (appId = 42) =>
  act(async () =>
    root.render(<LinkedWowGameSection appId={appId} attachLaunch={() => () => {}} />),
  );
const linked = (games: LinkedGames) => act(async () => fake.next("linkedGames.get").resolve(games));
const settingsLoaded = async () => {
  const loading = settingsStore.load();
  await act(async () => fake.next("settings.get").resolve({ settings: defaultSettings() }));
  await loading;
};

test("the section renders nothing until both the settings and the linked games have loaded", async () => {
  void linkedGamesStore.load();
  await render();
  expect(section()).toBeNull();
  await settingsLoaded();
  expect(section()).toBeNull();
  await linked({ enabled: true, games: [WOW], removed: [], playOwner: "wowdeck" });
  expect(section()).not.toBeNull();
});

test("shownLinkedGames: nothing until both have loaded, nothing while Show in Steam is off", () => {
  const settings = (loaded: boolean) => ({ settings: defaultSettings(), loaded });
  const games = (loaded: boolean, enabled = true) => ({
    enabled,
    games: [WOW],
    removed: [],
    playOwner: "wowdeck" as const,
    loaded,
    error: null,
  });
  expect(shownLinkedGames(settings(false), games(false))).toEqual([]);
  expect(shownLinkedGames(settings(true), games(false))).toEqual([]);
  expect(shownLinkedGames(settings(false), games(true))).toEqual([]);
  expect(shownLinkedGames(settings(true), games(true, false))).toEqual([]);
  expect(shownLinkedGames(settings(true), games(true))).toEqual([WOW]);
});

test("the section follows linkedGames.changed: Show in Steam off hides it, other pages never get it", async () => {
  void linkedGamesStore.load();
  await linked({ enabled: true, games: [WOW], removed: [], playOwner: "wowdeck" });
  await settingsLoaded();
  await render(7);
  expect(section()).toBeNull();
  await render(42);
  expect(section()).not.toBeNull();
  await act(async () =>
    fake.emit({
      event: "linkedGames.changed",
      params: { enabled: false, games: [WOW], removed: [], playOwner: "wowdeck" },
    }),
  );
  expect(section()).toBeNull();
});

test("the linked games say who owns Play, from linkedGames.get and linkedGames.changed", async () => {
  linkedGamesStore.reset();
  void linkedGamesStore.load();
  await linked({ enabled: true, games: [WOW], removed: [], playOwner: "droiddeck" });
  expect(linkedGamesStore.get().playOwner).toBe("droiddeck");
  await act(async () =>
    fake.emit({
      event: "linkedGames.changed",
      params: { enabled: false, games: [WOW], removed: [], playOwner: "wowdeck" },
    }),
  );
  expect(linkedGamesStore.get().playOwner).toBe("wowdeck");
});
