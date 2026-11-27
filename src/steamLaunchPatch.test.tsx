import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// Decky's own patcher, so the wrapper patch runs against the real one.
import { afterPatch } from "@decky/ui/dist/utils/patcher.js";
import { JSDOM } from "jsdom";
import {
  act,
  Component,
  createElement,
  createRef,
  forwardRef,
  Fragment,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LaunchClient, LaunchState } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";
import { saveSetting } from "./testSupport/saveSetting";

/*
 * Steam's private Play button, shaped like the Deck's (ADR 0016,
 * docs/ui/device-notes.md §8.4e): an exported forwardRef wrapper renders a
 * mobx observer class, whose prototype render locks each instance's own
 * render on first render. Its "Play from…" menu is built through the jsx
 * runtime module at call time.
 */

/** Steam's jsx runtime module: Steam calls `runtime.jsx(...)` when it builds the menu. */
const jsxRuntime = {
  jsx: (type: never, props: Record<string, unknown>, key?: string) =>
    createElement(type, key === undefined ? props : { ...props, key }),
  jsxs: () => null,
  Fragment,
};
const steamJsx = jsxRuntime.jsx;

/** The CSS module's class names, each the key itself. */
const cssModule = Object.fromEntries(
  [
    "PlayButtonContainer",
    "PlayButton",
    "ButtonChild",
    "HasRemoteText",
    "ShowingStreaming",
    "ButtonText",
    "ButtonRemoteText",
    "StreamingSelector",
    "StreamingContextMenuItem",
    "CheckContainer",
    "StreamingTargetLabel",
  ].map((key) => [key, key]),
);

interface Overview {
  appid: number;
  BIsSelectedClientLocal: () => boolean;
}

const Steam = {
  Label: (p: { text: string; remoteText?: ReactNode; showThrobber: boolean }) => (
    <div className="ButtonText">{p.remoteText ?? p.text}</div>
  ),
  Selector: (p: { overview: unknown; onClick?: (event: unknown) => void }) => (
    <button className="StreamingSelector" aria-label="Play from…" onClick={p.onClick} />
  ),
  Row: (p: { client: { clientid: string; client_name: string }; isLocalClient: boolean }) => (
    <div role="menuitem">
      {p.isLocalClient ? "Play on this Steam Deck" : `Stream from ${p.client.client_name}`}
    </div>
  ),
  Menu: (_: { onStreamingTargetSelected: () => void }) => (
    <div role="menu">
      {[
        [
          <Steam.Row key="0" client={{ clientid: "0", client_name: "steamdeck" }} isLocalClient />,
          <Steam.Row
            key="77"
            client={{ clientid: "77", client_name: "Kaptan" }}
            isLocalClient={false}
          />,
        ],
      ]}
    </div>
  ),
};

let shownMenu: ReactNode = null;
let menuFails = false;

class SteamPlayButton extends Component<{
  overview: Overview;
  navigator?: unknown;
  instance?: unknown;
}> {
  ShowStreamingMenu(event: { stopPropagation(): void; preventDefault(): void }) {
    event.stopPropagation();
    event.preventDefault();
    const menu = jsxRuntime.jsx(Steam.Menu as never, { onStreamingTargetSelected: () => {} });
    if (menuFails) throw new Error("Steam's menu failed");
    shownMenu = menu;
  }
  GetTextForRemoteClientAction() {
    return "";
  }
  // mobx-react's installer: the instance's own render, locked on first render.
  render(): ReactNode {
    Object.defineProperty(this, "render", {
      configurable: false,
      writable: false,
      value: () => (
        <div className="PlayButtonContainer Green ShowingStreaming">
          {[
            <button key="play" className="PlayButton ButtonChild">
              {[
                <svg key="icon" data-icon="play" />,
                <Steam.Label key="label" text="Play" showThrobber={false} />,
              ]}
            </button>,
            <Steam.Selector key="selector" overview={this.props.overview} onClick={() => {}} />,
          ]}
        </div>
      ),
    });
    return this.render();
  }
}

const steamClassRender = SteamPlayButton.prototype.render;

// Steam's wrapper adds `navigator` and `instance`; the patch finds it by those props.
const SteamPlayWrapper = forwardRef<unknown, { overview: Overview }>(
  function PlayWrapper(props, ref) {
    return createElement(SteamPlayButton, { ...props, navigator: null, instance: ref });
  },
);

/** The game page: Steam's Play block, then the addon section's anchor. */
class GamePage extends Component<{ appId: number }> {
  render() {
    const overview = { appid: this.props.appId, BIsSelectedClientLocal: () => true };
    return (
      <div className="InnerContainer">
        <SteamPlayWrapper overview={overview} />
        <div className="wowdeck-anchor" />
      </div>
    );
  }
}

/** Decky's `getReactInstance` (its module reads `window` on import): the DOM node's fiber. */
const getReactInstance = (node: object) =>
  (node as Record<string, unknown>)[
    Object.keys(node).find((key) => key.startsWith("__reactFiber")) ?? ""
  ];

mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  QuickAccessTab: {},
  afterPatch,
  getReactInstance,
  appDetailsClasses: { InnerContainer: "InnerContainer" },
  findClassModule: (filter: (module: Record<string, unknown>) => boolean) =>
    filter(cssModule) ? cssModule : undefined,
  findModule: (filter: (module: unknown) => boolean) =>
    filter(jsxRuntime) ? jsxRuntime : undefined,
  findModuleExport: (filter: (candidate: unknown) => boolean) =>
    [Steam.Menu, SteamPlayWrapper].find(filter),
}));
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

const { createSteamLaunchPatch, createSteamLaunchSwitch } = await import("./steamLaunchPatch");
const { settingsStore } = await import("./settings");
const { linkedGamesStore } = await import("./linkedGames");

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
const state: LaunchState = {
  clients: [battlenet, forever],
  target: forever,
  entryRunning: false,
  gameRunning: "not_running",
  busy: false,
};

const FOREVER_ICON = "data:image/x-icon;base64,AAABAA==";

let dom: JSDOM;
let root: Root;
let menuRoot: Root;
let disconnect: () => void;
let fake: ReturnType<typeof createFakeEngine>;
let patch: ReturnType<typeof createSteamLaunchPatch>;
const page = createRef<GamePage>();
const env = globalThis as {
  window?: unknown;
  CSS?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const oldWindow = env.window;
const oldDebug = console.debug;

beforeEach(async () => {
  dom = new JSDOM('<div id="root"></div><div id="menu"></div>');
  env.window = dom.window;
  env.CSS = { escape: (value: string) => value };
  env.IS_REACT_ACT_ENVIRONMENT = true;
  // Decky's patcher logs every patch and unpatch.
  console.debug = () => {};
  shownMenu = null;
  menuFails = false;
  fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "settings.get": {
      settings: {
        ...defaultSettings(),
        steamAutoCheck: false,
      },
    },
    "linkedGames.get": {
      enabled: true,
      games: [{ appId: 42, name: "WoW", source: "found" }],
      removed: [],
      playOwner: "wowdeck",
    },
    "launch.state": { state },
    "launch.icon": ({ targetId }) => ({ icon: targetId === "forever" ? FOREVER_ICON : null }),
  });
  disconnect = connectEngine(fake);
  await settingsStore.load();
  await linkedGamesStore.load();
  root = createRoot(dom.window.document.getElementById("root")!);
  menuRoot = createRoot(dom.window.document.getElementById("menu")!);
  patch = createSteamLaunchPatch();
});

afterEach(async () => {
  patch.dispose();
  await act(async () => {
    root.unmount();
    menuRoot.unmount();
  });
  disconnect();
  dom.window.close();
  env.window = oldWindow;
  delete env.CSS;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  console.debug = oldDebug;
});

const doc = () => dom.window.document;
const playText = () => doc().querySelector("#root .PlayButton")?.textContent;
const anchor = () => doc().querySelector(".wowdeck-anchor") as HTMLElement;

async function showPage(appId = 42) {
  await act(async () => root.render(<GamePage ref={page} appId={appId} />));
}

/** The addon section mounted: attach, then let the launch state arrive. */
async function attach(appId = 42) {
  await act(async () => patch.attach(anchor(), appId));
  await act(async () => {});
}

async function openMenu() {
  await act(async () => (doc().querySelector('[aria-label="Play from…"]') as HTMLElement).click());
}

test("a page open when the plugin loads remounts Play through the patch, and disposal restores Steam's", async () => {
  await showPage();
  expect(playText()).toBe("Play");

  patch.install();
  await attach();
  expect(playText()).toBe("PlayForever");
  expect(doc().querySelector("#root .PlayButton")?.className).toContain("HasRemoteText");

  patch.dispose();
  // Steam's export gets its own render back, not an inert patch.
  expect((SteamPlayWrapper as unknown as { render: { name: string } }).render.name).toBe(
    "PlayWrapper",
  );
  await act(async () => page.current!.forceUpdate());
  expect(playText()).toBe("Play");
  expect(doc().querySelector("#root .PlayButton")?.className).not.toContain("HasRemoteText");
});

test("Play draws the target's icon from its own read, once per page open", async () => {
  patch.install();
  await showPage();
  await attach();
  const icon = () => doc().querySelector("#root .PlayButton image")?.getAttribute("href");
  expect(icon()).toBe(FOREVER_ICON);
  expect(JSON.stringify(state)).not.toContain("data:");
  expect(fake.paramsOf("launch.icon")).toEqual([{ appId: 42, targetId: "forever" }]);

  // Reopening the page reads again: an icon that failed to read gets another try.
  await act(async () => root.render(null));
  await showPage();
  await attach();
  expect(icon()).toBe(FOREVER_ICON);
  expect(fake.paramsOf("launch.icon")).toHaveLength(2);
});

test("a page opened after the plugin loads renders patched, and other games keep Steam's Play", async () => {
  patch.install();
  await showPage();
  await attach();
  expect(playText()).toBe("PlayForever");

  await showPage(7);
  await attach(7);
  expect(playText()).toBe("Play");
});

test("a linked page with no launch state (DroidDeck owns Play) keeps Steam's Play", async () => {
  fake.answers["launch.state"] = { state: null };
  patch.install();
  await showPage();
  await attach();
  expect(fake.paramsOf("launch.state")).toEqual([{ appId: 42 }]);
  expect(playText()).toBe("Play");
  expect(doc().querySelector("#root .PlayButton")?.className).not.toContain("HasRemoteText");
});

test("Play from… shows Steam's menu with our rows in place of the local one, then restores Steam's jsx", async () => {
  patch.install();
  await showPage();
  await attach();

  await openMenu();
  expect(jsxRuntime.jsx).toBe(steamJsx);
  await act(async () => menuRoot.render(shownMenu));
  await act(async () => {});
  const rows = [...doc().querySelectorAll('#menu [role="menuitem"]')].map((row) => row.textContent);
  expect(rows).toEqual(["Battle.net", "World of Warcraft: Forever", "Stream from Kaptan"]);
});

test("a menu that throws while it is built still gets Steam's jsx back", async () => {
  patch.install();
  await showPage();
  await attach();

  menuFails = true;
  // The chevron's handler, called directly: a click would rethrow through React's dispatch.
  const chevron = doc().querySelector('[aria-label="Play from…"]')!;
  const { onClick } = (getReactInstance(chevron) as { memoizedProps: { onClick: () => void } })
    .memoizedProps;
  expect(() => onClick()).toThrow("Steam's menu failed");
  expect(jsxRuntime.jsx).toBe(steamJsx);
  expect(shownMenu).toBeNull();
});

/** Steam's Play button has no WoWDeck hook: its wrapper and class render are Steam's own. */
function steamUnhooked(): boolean {
  return (
    (SteamPlayWrapper as unknown as { render: { name: string } }).render.name === "PlayWrapper" &&
    SteamPlayButton.prototype.render === steamClassRender
  );
}

/** Options' "Choose the WoW version from Play" toggle, then the launch state arrives. */
async function setLaunchMenu(on: boolean) {
  await saveSetting(settingsStore, fake, { steamLaunchMenu: on });
  await act(async () => {});
}

describe("Choose the WoW version from Play", () => {
  let launchSwitch: ReturnType<typeof createSteamLaunchSwitch> | undefined;
  afterEach(() => {
    launchSwitch?.dispose();
    launchSwitch = undefined;
  });

  /** The addon section mounted on the open page and handed it to the switch. */
  async function attachToSwitch(appId = 42) {
    await act(async () => void launchSwitch!.attach(anchor(), appId));
    await act(async () => {});
  }

  test("off: a linked page keeps Steam's Play button, with no hook and no launch reads", async () => {
    await setLaunchMenu(false);
    launchSwitch = createSteamLaunchSwitch();
    await showPage();
    await attachToSwitch();
    expect(playText()).toBe("Play");
    expect(steamUnhooked()).toBe(true);
    expect(fake.paramsOf("launch.state")).toEqual([]);
    expect(fake.paramsOf("launch.icon")).toEqual([]);
  });

  test("flipped with the page open: on remounts Play through the patch, off restores Steam's, on again keeps the target", async () => {
    await setLaunchMenu(false);
    launchSwitch = createSteamLaunchSwitch();
    await showPage();
    await attachToSwitch();

    await setLaunchMenu(true);
    expect(playText()).toBe("PlayForever");
    expect(steamUnhooked()).toBe(false);

    await setLaunchMenu(false);
    expect(playText()).toBe("Play");
    expect(doc().querySelector("#root .PlayButton")?.className).not.toContain("HasRemoteText");
    expect(steamUnhooked()).toBe(true);

    await setLaunchMenu(true);
    expect(playText()).toBe("PlayForever");
    expect(fake.paramsOf("launch.select")).toEqual([]);
  });

  test("after off then on, the next page open renders through the patch", async () => {
    launchSwitch = createSteamLaunchSwitch();
    await showPage();
    let detach: () => void = () => {};
    await act(async () => {
      detach = launchSwitch!.attach(anchor(), 42);
    });
    detach();
    await setLaunchMenu(false);
    await setLaunchMenu(true);
    await act(async () => root.render(null));
    await showPage();
    await attachToSwitch();
    expect(playText()).toBe("PlayForever");
  });
});

test("an icon-change event updates the open Play button and ignores another target", async () => {
  patch.install();
  await showPage();
  await attach();
  const icon = () => doc().querySelector("#root .PlayButton image")?.getAttribute("href");
  const svg = "data:image/svg+xml;base64,PHN2Zy8+";
  fake.answers["launch.icon"] = { icon: svg };
  await act(async () =>
    fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: "retail" } }),
  );
  expect(icon()).toBe(FOREVER_ICON);
  await act(async () =>
    fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: "forever" } }),
  );
  expect(icon()).toBe(svg);
});

test("switching targets discards artwork still arriving for the old target", async () => {
  patch.install();
  await showPage();
  await attach();
  delete fake.answers["launch.icon"];
  await act(async () =>
    fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: "forever" } }),
  );
  const old = fake.next("launch.icon");
  fake.answers["launch.state"] = { state: { ...state, target: state.clients[0]! } };
  await act(async () =>
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Battle.net", outcome: "confirmed" },
    }),
  );
  await act(async () => old.resolve({ icon: "data:image/svg+xml;base64,c3RhbGU=" }));
  expect(doc().querySelector("#root .PlayButton image")?.getAttribute("href")).not.toBe(
    "data:image/svg+xml;base64,c3RhbGU=",
  );
});

test("an image render failure retains the generic Play glyph", async () => {
  patch.install();
  await showPage();
  await attach();
  const image = doc().querySelector("#root .PlayButton image")!;
  await act(async () => {
    image.dispatchEvent(new dom.window.Event("error"));
  });
  expect(doc().querySelector("#root .PlayButton image")).toBeNull();
  expect(playText()).toBe("PlayForever");
});

for (const id of ["classic", "forever", "battlenet"]) {
  test(`${id} keeps its icon dimensions and accepts only its own artwork updates`, async () => {
    const target: LaunchClient =
      id === "battlenet"
        ? battlenet
        : {
            kind: "wow",
            id,
            name: id === "classic" ? "World of Warcraft Classic" : forever.name,
            shortName: id === "classic" ? "Classic" : "Forever",
          };
    fake.answers["launch.state"] = { state: { ...state, clients: [battlenet, target], target } };
    fake.answers["launch.icon"] = { icon: FOREVER_ICON };
    patch.install();
    await showPage();
    await attach();
    await act(async () =>
      fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: id } }),
    );
    const image = () => doc().querySelector("#root .PlayButton image");
    const dimensions = [image()?.getAttribute("width"), image()?.getAttribute("height")];
    expect(image()?.getAttribute("href")).toBe(FOREVER_ICON);
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    if (id !== "battlenet") fake.answers["launch.icon"] = { icon: svg };
    await act(async () =>
      fake.emit({ event: "launch.iconChanged", params: { appId: 99, targetId: id } }),
    );
    expect(image()?.getAttribute("href")).toBe(FOREVER_ICON);
    await act(async () =>
      fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: id } }),
    );
    expect(image()?.getAttribute("href")).toBe(id === "battlenet" ? FOREVER_ICON : svg);
    expect([image()?.getAttribute("width"), image()?.getAttribute("height")]).toEqual(dimensions);
    expect(dimensions).toEqual(["24", "24"]);
  });
}

test("switching from Classic to Forever rejects a late Classic SVG", async () => {
  const classic: LaunchClient = {
    kind: "wow",
    id: "classic",
    name: "World of Warcraft Classic",
    shortName: "Classic",
  };
  fake.answers["launch.state"] = {
    state: { ...state, target: classic, clients: [battlenet, classic, forever] },
  };
  patch.install();
  await showPage();
  await attach();
  delete fake.answers["launch.icon"];
  await act(async () =>
    fake.emit({ event: "launch.iconChanged", params: { appId: 42, targetId: "classic" } }),
  );
  const old = fake.next("launch.icon");
  fake.answers["launch.state"] = { state };
  fake.answers["launch.icon"] = { icon: FOREVER_ICON };
  await act(async () =>
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Forever", outcome: "confirmed" },
    }),
  );
  await act(async () => old.resolve({ icon: "data:image/svg+xml;base64,c3RhbGU=" }));
  expect(playText()).toBe("PlayForever");
  expect(doc().querySelector("#root .PlayButton image")?.getAttribute("href")).toBe(FOREVER_ICON);
});
