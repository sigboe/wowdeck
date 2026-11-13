import { expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";

mock.module("@decky/api", () => ({
  FileSelectionType: { FILE: 0, FOLDER: 1 },
  toaster: { toast: () => {} },
  openFilePicker: async () => {
    throw new Error("cancel");
  },
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
}));
mock.module("@decky/ui", () => deckyUiStub);

const { UpdatesSection } = await import("./components/settings/UpdatesSection");

// Focus labels, the device test tool and screen readers name a control by its
// accessible name; the WoWDeck row's ⋯ in Options › Updates is a glyph only
// (#146, after #132). Its name is visually hidden text inside the button.
test("the WoWDeck row's ⋯ names the modal it opens", async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(<UpdatesSection />));
  // Hidden text, not aria-label: the device tool's seek reads text nodes only.
  const names = [...container.querySelectorAll("button")].map((b) => b.textContent);
  expect(names).toContain("Update channel");
  await act(async () => root.unmount());
});
