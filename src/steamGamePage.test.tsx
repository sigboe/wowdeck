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

const { LinkedWowGameSection, insertAfterPlayBar, createPlaySectionWrapper } =
  await import("./steamGamePage");
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

test("the section goes after Steam's Play bar and cloud status, where Steam puts its feedback box", () => {
  const overview = { appid: 42 };
  const playBar = { key: null, props: { overview } };
  const cloud = { key: null, props: { overview } };
  const feedback = { key: null, props: {} };
  const tabs = { key: null, props: { className: "tabs" } };
  const section = { key: "wowdeck-game-section", props: {} };
  const children: unknown[] = [playBar, cloud, feedback, tabs];
  expect(insertAfterPlayBar(children, section)).toBe(true);
  expect(children).toEqual([playBar, cloud, section, feedback, tabs]);

  // A render again replaces it in place, never adds a second.
  const again = { key: "wowdeck-game-section", props: { again: true } };
  expect(insertAfterPlayBar(children, again)).toBe(true);
  expect(children).toEqual([playBar, cloud, again, feedback, tabs]);

  // Children that don't start with the Play bar are left as Steam drew them.
  const other: unknown[] = [feedback, tabs];
  expect(insertAfterPlayBar(other, section)).toBe(false);
  expect(other).toEqual([feedback, tabs]);
  expect(insertAfterPlayBar(undefined, section)).toBe(false);
});

test("the Play section wrapper adds the section to Steam's output and keeps one identity per component", () => {
  const steam = (props: { overview: { appid: number } }) => ({
    props: {
      children: [
        { key: null, props: { overview: props.overview } },
        { key: null, props: {} },
      ],
    },
  });
  const added: number[] = [];
  const wrap = createPlaySectionWrapper((appId) => {
    added.push(appId);
    return appId === 42 ? { key: "wowdeck-game-section", props: {} } : null;
  });
  const wrapped = wrap(steam);
  expect(wrap(steam)).toBe(wrapped);

  const page = wrapped({ overview: { appid: 42 } });
  expect(page.props.children.map((c: { key: unknown }) => c.key)).toEqual([
    null,
    "wowdeck-game-section",
    null,
  ]);
  // Another game's page gets nothing.
  expect(wrapped({ overview: { appid: 7 } }).props.children).toHaveLength(2);
  expect(added).toEqual([42, 7]);
});
