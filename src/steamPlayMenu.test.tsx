import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { LaunchClient, LaunchState } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";

// A link counts only while its shortcut is in Steam's library.
const steam = globalThis as { appStore?: unknown };
let oldAppStore: unknown;
beforeEach(() => {
  oldAppStore = steam.appStore;
  steam.appStore = { allApps: [{ appid: 42, display_name: "WoW", app_type: 1073741824 }] };
});
afterEach(() => {
  steam.appStore = oldAppStore;
});

mock.module("@decky/ui", () => ({ ...deckyUiStub, QuickAccessTab: {} }));
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

const { WowPlayMenu } = await import("./components/WowPlayButton");
const { settingsStore } = await import("./settings");
const { steamLaunchState } = await import("./steamLaunchActions");

// Steam's "Play from…" menu as the Deck renders it: one row per client.
const SteamRow = (p: {
  client: { clientid: string; client_name: string };
  isLocalClient: boolean;
  onSelected: () => void;
}) => (
  <div role="menuitem" onClick={p.onSelected}>
    {p.isLocalClient ? "Play on this Steam Deck" : `Stream from ${p.client.client_name}`}
  </div>
);
const steamMenu = (): ReactNode => (
  <div role="menu">
    {[
      [
        <SteamRow
          key="0"
          client={{ clientid: "0", client_name: "steamdeck" }}
          isLocalClient
          onSelected={() => {}}
        />,
        <SteamRow
          key="77"
          client={{ clientid: "77", client_name: "Kaptan" }}
          isLocalClient={false}
          onSelected={() => {}}
        />,
      ],
    ]}
  </div>
);

const battlenet: LaunchClient = {
  kind: "battlenet",
  id: "battlenet",
  name: "Battle.net",
  shortName: "Battle.net",
};
const forever: LaunchClient = {
  kind: "wow",
  id: "forever",
  name: "World of Warcraft: Forever",
  shortName: "Forever",
};
const classic: LaunchClient = {
  kind: "wow",
  id: "classic",
  name: "World of Warcraft Classic",
  shortName: "Classic",
};
const state: LaunchState = {
  clients: [battlenet, forever, classic],
  target: battlenet,
  entryRunning: false,
  gameRunning: "not_running",
  busy: false,
};

test("picking a row selects it and switches Steam back to this Deck, leaving My Addons alone", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const oldWindow = env.window;
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  const streaming: [number, unknown][] = [];
  (dom.window as unknown as { SteamClient: unknown }).SteamClient = {
    Apps: { SetStreamingClientForApp: (appId: number, id: unknown) => streaming.push([appId, id]) },
  };
  const fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "settings.get": {
      settings: {
        ...defaultSettings(),
        steamGame: { appId: 42, name: "WoW" },
        steamAutoCheck: false,
      },
    },
    "launch.state": { state },
    "launch.select": ({ targetId }) => ({
      target: state.clients.find((client) => client.id === targetId)!,
    }),
  });
  const disconnect = connectEngine(fake);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const row = (name: string) =>
    [...container.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith(name),
    ) as HTMLElement | undefined;
  const rows = () =>
    [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);

  try {
    await settingsStore.load();
    await act(async () => {
      root.render(<WowPlayMenu appId={42} state={state} steamMenu={steamMenu} localSelected />);
    });

    expect(rows()).toEqual([
      "Battle.net",
      "World of Warcraft: Forever",
      "World of Warcraft Classic",
      "Stream from Kaptan",
    ]);
    // Steam's checkmark marks the selected row only.
    expect(row("Battle.net")?.querySelector("svg")).not.toBeNull();
    expect(row("World of Warcraft: Forever")?.querySelector("svg")).toBeNull();

    await act(async () => row("World of Warcraft Classic")?.click());
    expect(streaming).toEqual([[42, "0"]]);
    expect(fake.paramsOf("launch.select")).toEqual([{ appId: 42, targetId: "classic" }]);

    await act(async () => row("World of Warcraft: Forever")?.click());
    expect(fake.paramsOf("launch.select")).toEqual([
      { appId: 42, targetId: "classic" },
      { appId: 42, targetId: "forever" },
    ]);
    expect(fake.paramsOf("installations.select")).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("while open, our rows follow the launch state but Steam's menu never updates", async () => {
  // Steam's menu component must not update while open: other plugins patch
  // its updates (SteamGridDB adds "Change Artwork..." on every update).
  const dom = new JSDOM('<div id="root"></div>');
  const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const oldWindow = env.window;
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  let current = state;
  const fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "settings.get": {
      settings: {
        ...defaultSettings(),
        steamGame: { appId: 42, name: "WoW" },
        steamAutoCheck: false,
      },
    },
    "launch.state": () => ({ state: current }),
  });
  const disconnect = connectEngine(fake);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let renders = 0;
  const countingMenu = () => {
    renders += 1;
    return steamMenu();
  };
  try {
    await settingsStore.load();
    await act(async () => {
      root.render(<WowPlayMenu appId={42} state={state} steamMenu={countingMenu} localSelected />);
    });
    const before = renders;
    current = { ...state, target: forever };
    await act(async () => {
      await steamLaunchState.refresh("42");
      await settingsStore.load();
    });
    expect(renders).toBe(before);
    const checked = [...container.querySelectorAll('[role="menuitem"]')].filter((item) =>
      item.querySelector("svg"),
    );
    expect(checked.map((item) => item.textContent)).toEqual(["World of Warcraft: Forever"]);
  } finally {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  }
});
