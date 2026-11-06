/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useEffect, type ReactElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchivePreview } from "./types";
import { deckyUiStub } from "./deckyUiStub";

/**
 * Manual Install's conflict card with its real FocusSlots (#130, #132): a
 * confirmed Remove that leaves one match must end with focus on Install,
 * whether the re-check settles before or after the panel comes back from
 * the confirmation modal (guide G4).
 */

const conflict: ArchivePreview = {
  fileName: "RestedXP-5.0.zip",
  name: "RestedXP Guide",
  author: "",
  version: "5.0",
  folders: ["RestedXP"],
  providerId: "File",
  externalId: "/home/deck/Downloads/RestedXP-5.0.zip",
  match: {
    kind: "conflict",
    records: [
      { addonId: "rxp", name: "RestedXP Guide", folders: ["RestedXP"] },
      { addonId: "rxpc", name: "RXP Classic", folders: ["RestedXP"] },
    ],
  },
};
const updatesClassic: ArchivePreview = {
  ...conflict,
  match: { kind: "update", addonId: "rxpc", name: "RXP Classic" },
};

let inspected: ArchivePreview = updatesClassic;
mock.module("@decky/api", () => ({
  callable: (name: string) => async (method: string) =>
    name === "rpc" && method === "addons.inspectArchive" ? { result: inspected, error: null } : {},
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
}));

/**
 * Steam's Focusable, as far as #132 needs it: when a navigation node goes
 * away, Steam handles that after React's commit, and focus can end up on
 * nothing (MI-130-1 on the device). Modelled as a blur from a passive
 * cleanup, which runs after the commit's ref callbacks.
 */
let steamDropsFocusOnRemoval = false;
function SteamFocusable({ children, ref }: { children: ReactNode; ref: Ref<HTMLDivElement> }) {
  useEffect(
    () => () => {
      if (steamDropsFocusOnRemoval) {
        (globalThis.document.activeElement as HTMLElement | null)?.blur();
      }
    },
    [],
  );
  return <div ref={ref}>{children}</div>;
}

let modal: ReactElement<{ onOK: () => void }> | null = null;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  DialogButton: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button className="Focusable" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Focusable: SteamFocusable,
  showModal: (element: ReactElement<{ onOK: () => void }>) => {
    modal = element;
    return { Close: () => {} };
  },
}));

let finishRemove!: () => void;
const addons = [
  { id: "rxp", name: "RestedXP Guide", providerId: null },
  { id: "rxpc", name: "RXP Classic", providerId: null },
];
const sessionState = { addons, selectedId: null, recoveryRequired: {}, installations: [] };
mock.module("./session", () => ({
  addonSession: {
    get: () => sessionState,
    subscribe: () => () => {},
    reloadAddons: async () => {},
    actions: {
      remove: () =>
        new Promise<void>((resolve) => {
          finishRemove = resolve;
        }),
    },
  },
}));

const { useRestoreFocus } = await import("./components/FocusSlot");
const { ManualInstallTab } = await import("./components/browseTabs");
const { fileImport, resetFileImport } = await import("./fileImportState");
const { resetFocusMemory } = await import("./focusMemory");
const { browseFocusView } = await import("./browseSessionState");

const view = browseFocusView("url");

/** The pane as GetAddonsTab mounts it: the remembered row comes back on mount. */
function Pane() {
  useRestoreFocus(view);
  return (
    <ManualInstallTab
      sources={{ openInstallations: () => {}, openSources: () => {}, providers: [], loaded: true }}
    />
  );
}

const dom = new JSDOM('<div id="root"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
let root: Root | null = null;

beforeEach(() => {
  env.window = dom.window;
  env.document = doc;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  resetFocusMemory(() => 0);
  resetFileImport();
  inspected = updatesClassic;
  modal = null;
  steamDropsFocusOnRemoval = false;
});
afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
    root = null;
  }
  resetFileImport();
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
});

const mount = async () => {
  root = createRoot(doc.getElementById("root")!);
  const r = root;
  await act(async () => r.render(<Pane />));
};
const unmount = async () => {
  const r = root!;
  await act(async () => r.unmount());
  root = null;
};
const button = (text: string) =>
  [...doc.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;

describe("Manual Install: focus after a confirmed Remove on the conflict card (MI-130-1)", () => {
  test.each(["after", "before"])(
    "lands on the enabled Install when the re-check settles %s the panel comes back",
    async (when) => {
      fileImport.set({ phase: "ready", preview: conflict, error: null });
      await mount();
      const buttons = doc.querySelectorAll("button");
      expect(buttons[buttons.length - 1]!.disabled).toBe(true);
      const remove = button("Remove")!;
      remove.focus();

      await act(async () => remove.click());
      expect(modal).not.toBeNull();
      // The modal unmounts the panel (G4); OK runs the removal.
      await unmount();
      await act(async () => modal!.props.onOK());
      if (when === "after") {
        await mount();
        await act(async () => finishRemove());
      } else {
        await act(async () => finishRemove());
        await mount();
      }

      expect(fileImport.get()).toEqual({ phase: "ready", preview: updatesClassic, error: null });
      expect(button("Remove")).toBeNull();
      const updates = button("Updates RXP Classic")!;
      expect(updates.disabled).toBe(false);
      expect(doc.activeElement).toBe(updates);
    },
  );

  test("Install is the same element before and after the card's last Remove goes", async () => {
    fileImport.set({ phase: "inspecting", preview: conflict, error: null });
    await mount();
    const before = doc.querySelectorAll("button");
    const install = before[before.length - 1]!;
    await act(async () => fileImport.set({ phase: "ready", preview: updatesClassic, error: null }));
    expect(button("Remove")).toBeNull();
    const after = doc.querySelectorAll("button");
    expect(after[after.length - 1]).toBe(install);
    expect(install.disabled).toBe(false);
  });

  test("focus is asked for again after the render, when Steam drops it as the Remove rows go", async () => {
    fileImport.set({ phase: "ready", preview: conflict, error: null });
    await mount();
    const remove = button("Remove")!;
    remove.focus();
    await act(async () => remove.click());
    await act(async () => modal!.props.onOK());
    steamDropsFocusOnRemoval = true;
    await act(async () => finishRemove());
    const updates = button("Updates RXP Classic")!;
    expect(updates.disabled).toBe(false);
    expect(doc.activeElement).toBe(updates);
  });

  test("a mount does not pull focus to a turn that settled while the pane was away", async () => {
    fileImport.set({ phase: "ready", preview: conflict, error: null });
    await act(async () => {
      // Settles with no pane mounted, e.g. the user went back to the list.
      await (
        await import("./fileImportState")
      ).removeConflicting(
        async () => {},
        async () => ({ result: updatesClassic, error: null }),
      );
    });
    const { forgetFocus } = await import("./focusMemory");
    forgetFocus(view);
    await mount();
    expect(doc.activeElement).toBe(doc.body);
  });
});
