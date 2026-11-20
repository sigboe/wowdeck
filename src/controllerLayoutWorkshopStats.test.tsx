/// <reference types="bun-types" />
import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { ControllerLayout } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";

const revision = { number: 1, sha256: "1".repeat(64), contentFormat: 1, withdrawn: false };
const layout: ControllerLayout = {
  id: "fixture-layout",
  title: "Fixture layout",
  author: "Fixture author",
  controllerType: "controller_neptune",
  publishedFileId: "1000000000000000001",
  offer: "available",
  revision,
  revisions: [revision],
};

const workshop = {
  LoadPublishedFiles: async () => {},
  GetPublishedFile: () => ({
    file: { vote_data: { votes_up: 7 }, lifetime_playtime: "0" },
  }),
};

mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  findClassModule: (match: (value: object) => boolean) =>
    [
      {
        ConfigurationButton: "ConfigurationButton",
        InfoSection: "InfoSection",
        IconContainer: "IconContainer",
      },
    ].find(match),
  findModuleChild: (find: (value: object) => unknown) => find({ workshop }),
}));

test("the Steam-styled catalogue shows Workshop likes while omitting unverified playtime", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const env = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const old = {
    window: env.window,
    document: env.document,
    IS_REACT_ACT_ENVIRONMENT: env.IS_REACT_ACT_ENVIRONMENT,
  };
  env.window = dom.window;
  env.document = dom.window.document;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const { settingsStore } = await import("./settings");
  const { ControllerLayoutsTab } = await import("./components/ControllerLayoutsTab");
  connectEngine(
    createFakeEngine({
      "settings.get": () => ({
        settings: { ...defaultSettings(), controllerLayoutsEnabled: true },
      }),
      "controllerLayouts.catalogue": () => ({ state: "ready", layouts: [layout] }),
    }),
  );

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () => settingsStore.load());
    await act(async () =>
      root.render(<ControllerLayoutsTab view="qam.browse.controllerLayouts" />),
    );

    expect(container.querySelector('[aria-label="7 likes"]')?.textContent).toBe("7");
    expect(container.textContent).not.toMatch(/hours? played/);
  } finally {
    await act(async () => root.unmount());
    Object.assign(env, old);
    dom.window.close();
  }
});
