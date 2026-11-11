import { expect, mock, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
import type { Installation } from "./types";

mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  ToggleField: (p: {
    label: string;
    description: ReactNode;
    checked: boolean;
    disabled: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label>
      {p.label}
      <input
        type="checkbox"
        aria-label={p.label}
        checked={p.checked}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.checked)}
      />
      {p.description}
    </label>
  ),
}));
const { InstallationDetailsModal } = await import("./components/InstallationDetailsModal");

test("Hide locks Auto updates off and unhiding restores its remembered value", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let installation = {
    id: "A",
    displayName: "Retail",
    path: "/wow/_retail_",
    version: null,
    autoUpdateEnabled: true,
    hidden: false,
  } as Installation;
  await act(async () =>
    root.render(
      <InstallationDetailsModal
        installation={installation}
        counts={{ installed: 0, managed: 0 }}
        actions={{
          onRescan: () => {},
          onRemove: () => {},
          onUpdate: async (changes) => (installation = { ...installation, ...changes }),
        }}
      />,
    ),
  );
  const toggle = (name: string) =>
    container.querySelector<HTMLInputElement>('input[aria-label="' + name + '"]')!;
  expect(toggle("Auto updates").checked).toBe(true);
  expect(container.textContent).toContain("Options › Updates");
  await act(async () => toggle("Hide").click());
  expect(toggle("Auto updates").checked).toBe(false);
  expect(toggle("Auto updates").disabled).toBe(true);
  expect(container.textContent).toContain("Unhide this installation");
  await act(async () => toggle("Hide").click());
  expect(toggle("Auto updates").checked).toBe(true);
  expect(toggle("Auto updates").disabled).toBe(false);
  await act(async () => toggle("Auto updates").click());
  expect(container.textContent).toContain("Rescan checks it by hand");
  await act(async () => toggle("Hide").click());
  await act(async () => toggle("Hide").click());
  expect(toggle("Auto updates").checked).toBe(false);
  await act(async () => root.unmount());
});
