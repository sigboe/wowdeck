import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement, memo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { deckyUiStub } from "../deckyUiStub";

const classes = {
  ViewPlaceholder: "ViewPlaceholder",
  Expanded: "Expanded",
  QuickAccessMenuEmbeddedContainer: "Embedded",
};

const reducer = mock((count: number, increment: number) => count + increment);
function QuickAccessMenuBrowserView({ active }: { active: boolean }) {
  useReducer(reducer, 0);
  const [label] = useState("same view state");
  // Steam uses production React with mutable elements.
  return { ...createElement("div", { className: classes.ViewPlaceholder }, active && label) };
}
const BrowserView = memo(QuickAccessMenuBrowserView);

mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  findClassModule: (filter: (value: unknown) => boolean) => (filter(classes) ? classes : undefined),
  findModuleByExport: (filter: (value: unknown) => boolean) =>
    filter(BrowserView) ? { BrowserView } : undefined,
  getReactRoot: (node: HTMLElement) => {
    const key = Object.keys(node).find((name) => name.startsWith("__reactContainer$"));
    return key ? (node as unknown as Record<string, unknown>)[key] : undefined;
  },
  afterPatch(
    renderer: { type: typeof QuickAccessMenuBrowserView },
    key: "type",
    patch: (args: unknown[], result: unknown) => unknown,
  ) {
    const original = renderer[key];
    renderer[key] = (props) => patch([props], original(props)) as ReturnType<typeof original>;
    return { unpatch: () => (renderer[key] = original) };
  },
}));
const { QamExpandHook } = await import("./qamExpandHook");

test("the first patch refreshes an already open webpack QAM while it stays mounted", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const hook = new QamExpandHook();
  try {
    await act(() => root.render(<BrowserView active />));
    expect(hook.live).toBe(false);
    await act(() => {
      expect(hook.init()).toBe(true);
    });
    expect(hook.live).toBe(true);
    await act(() => hook.setExpanded(true));
    expect(container.firstElementChild?.classList.contains(classes.Expanded)).toBe(true);
    expect(container.textContent).toBe("same view state");
    expect(reducer).not.toHaveBeenCalled();
  } finally {
    await act(() => {
      root.unmount();
      hook.deinit();
    });
    Object.assign(globalThis, previous);
    delete globals.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
