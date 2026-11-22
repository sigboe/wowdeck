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
}));
mock.module("@decky/ui", () => deckyUiStub);

const { InstallationsSection } = await import("./components/settings/InstallationsSection");

/** A session stub: the section's seam. No engine is connected in this file. */
const stubState = {
  installations: [],
  addons: [],
  recoveryRequired: {},
  findingWow: false,
};
const session = {
  get: () => stubState,
  subscribe: () => () => {},
  findWow: async () => {},
  selectInstallation: async () => {},
  addInstallation: async () => [],
  updateInstallation: async () => ({}) as never,
  removeInstallation: async () => {},
  rescanInstallation: async () => "refreshed" as const,
} as unknown as Parameters<typeof InstallationsSection>[0]["session"];

test("Options places Add WoW folder directly below Find WoW installations", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const env = globalThis as { window?: unknown; document?: unknown };
  const old = { window: env.window, document: env.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<InstallationsSection installations={[]} selectedId={null} session={session} />),
    );
    const labels = [...container.querySelectorAll("b")].map((b) => b.textContent);
    expect(labels).toEqual(["Find WoW installations", "Add WoW folder"]);
    // The typed-path form is gone from Options.
    expect(container.querySelectorAll("input")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, old);
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    dom.window.close();
  }
});
