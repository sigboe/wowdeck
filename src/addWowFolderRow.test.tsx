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

const { InstallationsSection } = await import("./components/settings/InstallationsSection");

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
      root.render(
        <InstallationsSection installations={[]} selectedId={null} onChanged={async () => {}} />,
      ),
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
