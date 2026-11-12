import { expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";

mock.module("@decky/api", () => ({
  FileSelectionType: { FILE: 0, FOLDER: 1 },
  toaster: { toast: () => {} },
  openFilePicker: async () => null,
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
}));
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  QuickAccessTab: { Decky: 999 },
  NavEntryPositionPreferences: { MAINTAIN_X: 1 },
}));
const sessionState = { installations: [] };
mock.module("./session", () => ({
  addonSession: { get: () => sessionState, subscribe: () => () => {} },
}));
mock.module("./services/backend", () => ({
  rpc: async () => {
    throw new Error("Engine offline");
  },
}));
const { SettingsView } = await import("./components/SettingsView");

test("Options has exactly eight sections in the player's navigation order", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <SettingsView
          installations={[]}
          selectedId={null}
          onChanged={async () => {}}
          restoreRows={false}
        />,
      ),
    );
    expect([...dom.window.document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "WoW installations",
      "Addon list",
      "Settings backup",
      "Addon sources",
      "Updates",
      "Steam library",
      "Notifications",
      "About",
    ]);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, old);
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
