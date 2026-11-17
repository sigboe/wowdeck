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
let operationAnswer: import("../backend/src/api/contracts").ControllerLayoutOperation | null = null;
const fake = createFakeEngine({
  "controllerLayouts.operationStatus": () => operationAnswer,
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

test("A opens a preview-only pane with scope disclosure and no apply action", async () => {
  await show();
  const row =
    doc.querySelector(".wowdeck-layout-row") ??
    [...doc.querySelectorAll("b")].find((node) => node.textContent === "Fixture layout A")
      ?.parentElement;
  expect(row).toBeDefined();
  await act(async () =>
    row?.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true })),
  );
  const text = doc.getElementById("root")!.textContent ?? "";
  expect(text).toContain("Preview only");
  expect(text).toContain("Entries with the same name may share controls");
  expect(text).not.toContain("Apply layout");
  await act(async () =>
    [...doc.querySelectorAll("b")]
      .find((node) => node.textContent === "Back to layouts")
      ?.parentElement?.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true })),
  );
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
  expect(session.resource.get(key).data).toEqual({ state: "ready", model });
  expect(
    engine.calls.filter((call) => call.method === "controllerLayouts.preparePreview"),
  ).toHaveLength(1);
  session.reset();
  expect(clock.activeTimers()).toBe(0);
});

test("chosen target discloses equal-name entries and unknown wider scope, with correction but no Apply", async () => {
  const { previewChoice } = await import("./controllerLayoutPreviewSession");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "appStore");
  Object.assign(globalThis, {
    appStore: {
      allApps: [
        { appid: 42, display_name: "WoW", app_type: 1073741824 },
        { appid: 43, display_name: "WoW", app_type: 1073741824 },
        { appid: 44, display_name: "Other", app_type: 1073741824 },
      ],
    },
  });
  try {
    await act(async () => previewChoice.select(LAYOUT_A, 42));
    const text = await show();
    expect(text).toContain("WoW (42), WoW (43)");
    expect(text).toContain("Entries with other names may also share controls");
    expect(text).toContain("Applying unavailable");
    expect(text).not.toContain("Apply layout");
    const change = [...doc.querySelectorAll("b")].find(
      (n) => n.textContent === "Change library entry",
    )!;
    await act(async () =>
      change.parentElement!.dispatchEvent(
        new doc.defaultView!.MouseEvent("click", { bubbles: true }),
      ),
    );
    expect(doc.getElementById("root")!.textContent).toContain("Choose a library entry");
    expect(doc.getElementById("root")!.textContent).toContain("Other");
  } finally {
    await act(async () => previewChoice.select(null));
    if (previous) Object.defineProperty(globalThis, "appStore", previous);
    else Reflect.deleteProperty(globalThis, "appStore");
  }
});

test("preference uses the active installation and current account, leaving ambiguous or legacy links for correction", async () => {
  const { previewChoice, layoutTargetContext } = await import("./controllerLayoutPreviewSession");
  const { addonSession } = await import("./session");
  const keys = ["appStore", "SteamClient", "controllerConfiguratorStore"];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.assign(globalThis, {
    appStore: {
      allApps: [42, 43].map((appid) => ({ appid, display_name: "WoW", app_type: 1073741824 })),
    },
    SteamClient: {
      User: { GetSteamID: () => "76561197960265851" },
      Input: {
        GetConfigForAppAndController: async () => ({
          accountID: 0,
          nControllerType: 4,
          unControllerIndex: 15,
        }),
        PreviewConfigForAppAndController: async () => new Uint8Array(),
        FreeControllerConfig: () => {},
      },
    },
    controllerConfiguratorStore: { EditingConfigurationControllerIndex: 15 },
  });
  try {
    await layoutTargetContext.refresh("42");
    for (const scenario of ["legacy", "another account", "ambiguous", "unique"] as const) {
      const accountId =
        scenario === "legacy" ? undefined : scenario === "another account" ? 456 : 123;
      const steamGames = [
        { appId: 42, name: "WoW", accountId },
        ...(scenario === "ambiguous" ? [{ appId: 43, name: "WoW", accountId }] : []),
      ];
      fake.answers["installations.list"] = {
        installations: [
          {
            id: "active",
            selected: true,
            steamGames,
          } as import("../backend/src/api/contracts").Installation,
          {
            id: "other",
            selected: false,
            steamGames: [{ appId: 43, name: "WoW", accountId: 123 }],
          } as import("../backend/src/api/contracts").Installation,
        ],
      };
      await act(async () => {
        await addonSession.reloadInstallations();
        previewChoice.select(LAYOUT_A);
      });
      const text = await show();
      expect(text.includes("Selected library entry")).toBe(scenario === "unique");
      expect(text.includes("Choose a library entry")).toBe(scenario !== "unique");
    }
  } finally {
    await act(async () => {
      previewChoice.select(null);
      fake.answers["installations.list"] = { installations: [] };
      await addonSession.reloadInstallations();
    });
    layoutTargetContext.forget("42");
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
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
