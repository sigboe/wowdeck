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

const { AddInstallationSection } = await import("./components/settings/AddInstallationSection");

// Focus labels and screen readers name the focused control by its accessible
// name; the Field's visible label is not tied to the input, and Browse is an icon.
// A client render: the form reads its draft with useSyncExternalStore, which
// a server render refuses without a server snapshot.
test("Add installation's text fields and Browse button have accessible names", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(<AddInstallationSection onChanged={async () => {}} />));
  const names = (selector: string) =>
    [...container.querySelectorAll(selector)].map((el) => el.getAttribute("aria-label"));
  expect(names("input")).toEqual(["WoW folder", "Display name"]);
  expect(names("button")).toContain("Browse for the WoW folder");
  await act(async () => root.unmount());
});
