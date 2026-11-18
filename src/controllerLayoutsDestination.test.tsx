/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import type {
  ControllerLayout,
  ControllerLayoutCatalogue,
  Installation,
  PluginSettings,
} from "../backend/src/api/contracts";
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
let operationAnswer: import("../backend/src/api/contracts").ControllerLayoutOperation | null = null;
let linkSettings: Partial<PluginSettings> = {};
const fake = createFakeEngine({
  "controllerLayouts.operationStatus": () => operationAnswer,
  "settings.get": () => ({
    settings: { ...defaultSettings(), controllerLayoutsEnabled: sourceOn, ...linkSettings },
  }),
  "controllerLayouts.catalogue": () => answer,
});
connectEngine(fake);
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));
mock.module("@decky/ui", () => deckyUiStub);
// Steam's own preview needs Steam; the pane's part is which entry it opens for.
const previews: [string, number][] = [];
mock.module("./nativeLayoutPreview", () => ({
  openNativePreview: async (layout: ControllerLayout, target: number) => {
    previews.push([layout.id, target]);
    return null;
  },
}));

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
const { addonSession } = await import("./session");
const { layoutTargetPicks } = await import("./controllerLayoutTargets");
const { steamAccount, layoutOperationContext } = await import("./controllerLayoutPreviewSession");

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  sourceOn = true;
  answer = { state: "ready", layouts: [LAYOUT_A, LAYOUT_B] };
  linkSettings = {};
  previews.length = 0;
  layoutTargetPicks.reset();
  fake.calls.length = 0;
  controllerLayoutsModule.catalogue.forget(controllerLayoutsModule.KEY);
  root = createRoot(doc.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  restoreSteam?.();
  restoreSteam = undefined;
  fake.answers["installations.list"] = { installations: [] };
  await act(async () => addonSession.reloadInstallations());
});

async function show(): Promise<string> {
  await act(async () => settingsStore.load());

  await act(async () => root.render(<ControllerLayoutsTab view="qam.browse.controllerLayouts" />));
  await act(async () => {});
  return doc.getElementById("root")!.textContent ?? "";
}

const SHORTCUT = 1073741824;
let restoreSteam: (() => void) | undefined;

/**
 * Steam's library shortcuts and the built-in controller, signed in as
 * account 123. `url` is the controls the entries have now: the player's own
 * saved controls by default, which WoWDeck can apply over.
 */
function steam(
  apps: [number, string][],
  url = "usercloud://fixture-saved-controls",
  secondController = false,
) {
  const keys = ["appStore", "SteamClient", "controllerConfiguratorStore"];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.assign(globalThis, {
    appStore: {
      allApps: apps.map(([appid, display_name]) => ({ appid, display_name, app_type: SHORTCUT })),
    },
    SteamClient: {
      User: { GetSteamID: () => "76561197960265851" },
      Input: {
        GetConfigForAppAndController: async (appid: number) => ({
          accountID: 0,
          nControllerType: 4,
          unControllerIndex: 15,
          eSelectionType: 0,
          // "per-entry": each entry has its own saved controls.
          URL: url === "per-entry" ? `usercloud://fixture-saved-controls-${appid}` : url,
        }),
        PreviewConfigForAppAndController: async () => new Uint8Array(),
        FreeControllerConfig: () => {},
      },
    },
    controllerConfiguratorStore: {
      m_controllerList: [
        { nControllerIndex: 15, eControllerType: 4, strSerialNumber: "FIXTURE" },
        ...(secondController ? [{ nControllerIndex: 16, eControllerType: 45 }] : []),
      ],
    },
  });
  restoreSteam = () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    steamAccount.forget("current");
    layoutOperationContext.retainOnly([]);
  };
}

/** Installations with their detected links; the first is selected. */
async function installations(...list: [string, [number, string, number?][]][]) {
  fake.answers["installations.list"] = {
    installations: list.map(
      ([id, links], index) =>
        ({
          id,
          selected: index === 0,
          steamGames: links.map(([appId, name, accountId]) => ({ appId, name, accountId })),
        }) as Installation,
    ),
  };
  await act(async () => addonSession.reloadInstallations());
}

/** Lets the account and shared-controls reads settle. */
async function settle() {
  // Steam's native reads and the identity digest settle on later tasks.
  for (let i = 0; i < 10; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

const root$ = () => doc.getElementById("root")!;
const targetButton = () =>
  root$().querySelector<HTMLButtonElement>('button[aria-label="Library entry"]');
/** The open menu's entries: every button but the dropdown's own. */
const menuItems = () =>
  [...root$().querySelectorAll<HTMLButtonElement>("button[aria-label]")].filter(
    (b) => b !== targetButton(),
  );
async function targetChoices(): Promise<string[]> {
  await act(async () => targetButton()!.click());
  const labels = menuItems().map((item) => item.getAttribute("aria-label") ?? "");
  await act(async () => targetButton()!.click());
  return labels;
}
async function pickTarget(label: string) {
  await act(async () => targetButton()!.click());
  const item = menuItems().find((b) => b.getAttribute("aria-label") === label)!;
  await act(async () => item.click());
}
async function pressA(title: string) {
  const row = [...root$().querySelectorAll("b")].find((b) => b.textContent === title)!;
  await act(async () =>
    row.parentElement!.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true })),
  );
  await settle();
}
async function showSettled() {
  const text = await show();
  await settle();
  return root$().textContent ?? text;
}

const catalogueRequests = () =>
  fake.calls.filter((c) => c.method === "controllerLayouts.catalogue").length;

test("the reviewed layouts appear in the maintainers' order and preview in Steam", async () => {
  const text = await show();

  expect(text).toContain("Reviewed layouts");
  expect(text.indexOf("Fixture layout A")).toBeLessThan(text.indexOf("Fixture layout B"));
  expect(text).toContain("by WoWDeck fixtures");
  expect(text).toContain("Steam Deck");
  expect(text).toContain("A synthetic layout for tests.");
  expect(text).toContain("by Another fixture");
  expect(text).toContain("Steam Controller");
  expect(text).not.toMatch(/Apply layout/);
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

test("the dropdown lists the hand-set link and this installation's detected links for this account", async () => {
  steam([
    [42, "World of Warcraft"],
    [43, "WoW Classic"],
    [44, "Battle.net"],
    [45, "Warcraft Logs"],
    [46, "WoW Legacy"],
    [47, "Unrelated game"],
  ]);
  linkSettings = { steamGame: { appId: 44, name: "Battle.net" }, steamAutoLink: true };
  await installations(
    [
      "active",
      [
        [42, "World of Warcraft", 123],
        [45, "Warcraft Logs", 456], // another Steam account's link
        [46, "WoW Legacy"], // a link from before links carried an account
      ],
    ],
    ["other", [[43, "WoW Classic", 123]]],
  );

  await showSettled();

  expect(await targetChoices()).toEqual(["Battle.net", "World of Warcraft"]);

  linkSettings = { ...linkSettings, steamAutoLink: false };
  await act(async () => root.render(null));
  await showSettled();

  expect(await targetChoices()).toEqual(["Battle.net"]);
});

test("links match by app id: a renamed entry shows its new name, a deleted entry is gone", async () => {
  steam([
    [42, "WoW (Proton)"],
    [44, "Blizzard App"],
  ]);
  linkSettings = { steamGame: { appId: 44, name: "Battle.net" }, steamAutoLink: true };
  await installations([
    "active",
    [
      [42, "World of Warcraft", 123],
      [43, "WoW Classic", 123], // deleted from the library since detection
    ],
  ]);

  await showSettled();

  expect(targetButton()?.textContent).toBe("Blizzard App");
  expect(await targetChoices()).toEqual(["Blizzard App", "WoW (Proton)"]);
});

test.each<[string, number | null, [number, string, number][], string]>([
  ["the hand-set link", 42, [[44, "Battle.net", 123]], "World of Warcraft"],
  ["the only detected entry", null, [[42, "World of Warcraft", 123]], "World of Warcraft"],
  [
    "the first A–Z",
    null,
    [
      [42, "World of Warcraft", 123],
      [44, "Battle.net", 123],
    ],
    "Battle.net",
  ],
])("the dropdown starts on %s", async (_case, handSet, detected, shown) => {
  steam([
    [42, "World of Warcraft"],
    [44, "Battle.net"],
  ]);
  linkSettings = {
    steamGame: handSet ? { appId: handSet, name: "World of Warcraft" } : null,
    steamAutoLink: true,
  };
  await installations(["active", detected]);

  await showSettled();

  expect(targetButton()?.textContent).toBe(shown);
});

test("a pick is kept per installation when the QAM closes or the destination changes", async () => {
  steam([
    [42, "World of Warcraft"],
    [44, "Battle.net"],
  ]);
  linkSettings = { steamGame: { appId: 44, name: "Battle.net" }, steamAutoLink: true };
  await installations(["active", [[42, "World of Warcraft", 123]]], ["other", []]);
  await showSettled();

  await pickTarget("World of Warcraft");
  await act(async () => root.render(null)); // QAM closed, or another destination
  await showSettled();
  expect(targetButton()?.textContent).toBe("World of Warcraft");

  await installations(["other", []], ["active", [[42, "World of Warcraft", 123]]]);
  await settle();
  expect(targetButton()?.textContent).toBe("Battle.net");

  await installations(["active", [[42, "World of Warcraft", 123]]], ["other", []]);
  await settle();
  expect(targetButton()?.textContent).toBe("World of Warcraft");
});

test("A on a layout opens Steam's preview for the selected entry, with no menu between", async () => {
  steam([
    [42, "World of Warcraft"],
    [44, "Battle.net"],
  ]);
  linkSettings = { steamGame: { appId: 44, name: "Battle.net" }, steamAutoLink: true };
  await installations(["active", [[42, "World of Warcraft", 123]]]);
  await showSettled();
  await pickTarget("World of Warcraft");

  await pressA("Fixture layout B");

  expect(previews).toEqual([[LAYOUT_B.id, 42]]);
  const text = root$().textContent ?? "";
  expect(text).toContain("Reviewed layouts");
  expect(text).not.toContain("Choose a library entry");
  expect(text).not.toContain("Back to layouts");
});

test("the pane reads dropdown, warning line, heading, then the layouts", async () => {
  steam([[42, "WoW"]], "workshop://fixture-community-layout");
  linkSettings = { steamGame: { appId: 42, name: "WoW" } };
  await installations(["active", []]);

  const text = await showSettled();

  const order = ["WoW", "Preview only", "Reviewed layouts", "Fixture layout A"].map((s) =>
    text.indexOf(s),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((i) => i >= 0)).toBe(true);
});

test.each<[string, [number, string][], string | undefined, string[], string[]]>([
  [
    "a plain entry WoWDeck can apply to",
    [
      [42, "World of Warcraft"],
      [43, "WoW Classic"],
    ],
    undefined,
    [],
    ["Preview only", "Shares controls"],
  ],
  [
    "an entry sharing controls by name",
    [
      [42, "World of Warcraft"],
      [43, "world of warcraft"],
      [44, "World of Warcraft"],
    ],
    undefined,
    ["Shares controls with 2 other entries", "“World of Warcraft”"],
    ["Preview only"],
  ],
  [
    "an entry WoWDeck can only preview for",
    [[42, "World of Warcraft"]],
    "workshop://fixture-community-layout",
    ["Preview only", "only over your own saved controls, not over a template or Workshop layout"],
    ["Shares controls"],
  ],
  [
    "an entry whose name WoWDeck can't apply to",
    [[42, "World of Warcraft Ünïcode"]],
    undefined,
    ["Preview only", "accented or non-Latin letters"],
    ["Shares controls"],
  ],
  [
    "same-named entries whose controls differ",
    [
      [42, "World of Warcraft"],
      [43, "World of Warcraft"],
    ],
    "per-entry",
    ["Preview only", "have different controls", "Shares controls with 1 other entry"],
    [],
  ],
])("the warning line for %s", async (_case, apps, url, shown, hidden) => {
  steam(apps, url);
  linkSettings = { steamGame: { appId: 42, name: "World of Warcraft" } };
  await installations(["active", []]);

  const text = await showSettled();

  for (const line of shown) expect(text).toContain(line);
  for (const line of hidden) expect(text).not.toContain(line);
  expect(root$().querySelector('[role="note"]') !== null).toBe(shown.length > 0);
});

test("a second controller keeps the detected links and explains that only preview is possible", async () => {
  steam([[42, "World of Warcraft"]], undefined, true);
  linkSettings = { steamGame: null, steamAutoLink: true };
  await installations(["active", [[42, "World of Warcraft", 123]]]);

  const text = await showSettled();

  expect(await targetChoices()).toEqual(["World of Warcraft"]);
  expect(text).toContain("Preview only");
});

test("with nothing linked, the pane says so and A previews nothing", async () => {
  steam([[42, "World of Warcraft"]]);
  linkSettings = { steamGame: null, steamAutoLink: true };
  await installations(["active", []]);

  const text = await showSettled();
  await pressA("Fixture layout A");

  expect(text).toContain("No linked game");
  expect(targetButton()).toBeNull();
  expect(previews).toEqual([]);
});

import { createManualClock } from "./testSupport/manualClock";

test("preview reconnects to its typed preparation job across pane teardown", async () => {
  const { createLayoutPreviewSession } = await import("./controllerLayoutPreviewSession");
  let ready = false;
  const model = { controller_type: 4, sets: [{ name: "Default" }], modes: [{ button: 3 }] };
  const native = {
    context: async () => ({
      target: 42,
      accountId: 123,
      controllerIndex: 15,
      controllerType: 4,
      selection: "inherited",
    }),
    preview: async () => ({ model, release: () => {} }),
  };
  const engine = createFakeEngine({
    "controllerLayouts.preparePreview": () => ({ jobId: "recorded-job" }),
    "controllerLayouts.previewStatus": () =>
      ready
        ? {
            state: "ready",
            preview: {
              accountId: 123,
              url: "usercloud://wowdeck-approved/" + "a".repeat(64),
              title: "Approved",
              sha256: "a".repeat(64),
              mappings: { "4": "7580191d0c2d91371f278d5743f7bc406c0fffd80c13ed51f662ca95fd0c4ffb" },
            },
          }
        : { state: "preparing" },
  });
  const clock = createManualClock();
  const session = createLayoutPreviewSession({ rpc: engine.rpc, native, clock });
  const key = session.key(LAYOUT_A, 42);
  await session.resource.refresh(key);
  expect(session.resource.get(key).data).toEqual({ state: "preparing" });
  ready = true;
  await session.resource.refresh(key);
  expect(session.resource.get(key).data).toMatchObject({ state: "ready", model });
  expect(
    engine.calls.filter((call) => call.method === "controllerLayouts.preparePreview"),
  ).toHaveLength(1);
  session.reset();
  expect(clock.activeTimers()).toBe(0);
});

test("interrupted recovery discloses uncertainty without offering Apply", async () => {
  operationAnswer = {
    id: "interrupted",
    phase: "recovery-required",
    recoveryId: "saved",
    context: {} as never,
    approved: {} as never,
  };
  const { layoutRecovery } = await import("./controllerLayoutRecoverySession");
  await act(async () => {
    await layoutRecovery.refresh("current");
  });
  await show();
  expect(doc.body.textContent).toContain("Previous controls need recovery");
  expect(doc.body.textContent).toContain("same account, controller and shared entries");
  expect(doc.body.textContent).not.toContain("Apply layout");
  const recovery = [...doc.querySelectorAll("b")].find(
    (node) => node.textContent === "Previous controls need recovery",
  )!;
  await act(async () => {
    recovery.parentElement!.dispatchEvent(
      new doc.defaultView!.MouseEvent("click", { bubbles: true }),
    );
  });
  await act(async () => {});
  expect(doc.body.textContent).toContain("Couldn't restore previous controls");
  expect(operationAnswer.recoveryId).toBe("saved");
  operationAnswer = null;
  await act(async () => {
    await layoutRecovery.refresh("current");
  });
});
