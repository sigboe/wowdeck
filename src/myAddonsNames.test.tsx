import { expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
import type { Addon } from "./types";

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

const { InstalledView } = await import("./components/InstalledView");

// Focus labels, the device test tool and screen readers name a control by its
// accessible name; My Addons' refresh and ⋯ buttons are glyphs only (#132).
test("My Addons' glyph-only buttons have accessible names", async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const addon = {
    id: "a1",
    name: "Details!",
    providerId: "Curse",
    externalId: "61284",
    ignored: false,
    updateAvailable: false,
    folders: ["Details"],
  } as unknown as Addon;
  await act(async () =>
    root.render(
      <InstalledView
        addons={[addon]}
        loading={false}
        restoreRows={false}
        multipleInstallations={false}
      />,
    ),
  );
  const names = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(names).toContain("Check for updates");
  expect(names).toContain("Filter");
  expect(names).toContain("Options");
  await act(async () => root.unmount());
});
