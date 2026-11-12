/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Diagnostics } from "./types";
import { deckyUiStub } from "./deckyUiStub";

/**
 * Options › About › Diagnostics (#209): the last About row opens the
 * diagnostics text with Copy in a modal, and focus comes back to the row.
 */

const diagnostics: Diagnostics = {
  backendVersion: "1.1.1",
  protocolVersion: 1,
  platform: "linux",
  deckyVersion: "3.2.10",
  pluginVersion: "1.1.1",
  installations: [
    {
      id: "a1",
      clientLabel: "Retail",
      path: "/home/deck/Applications/World of Warcraft/_retail_",
      companionAddonDetected: true,
    },
  ],
  providers: [],
  recentErrors: [],
  tradeSkillMaster: {
    enabled: true,
    signedIn: true,
    tier: "free",
    connected: true,
    lastPush: Date.UTC(2026, 10, 12, 9, 30),
    followedCount: 2,
  },
} as unknown as Diagnostics;

let diagnosticsFails = false;
const calls: string[] = [];
const toasts: string[] = [];
mock.module("@decky/api", () => ({
  callable: (name: string) => async (method: string) => {
    if (name !== "rpc") return {};
    calls.push(method);
    if (method === "system.diagnostics") {
      return diagnosticsFails
        ? { __error: { code: "internal", message: "engine stopped" } }
        : diagnostics;
    }
    if (method === "about.get") return { notices: null, funding: [], supporters: [] };
    return {};
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

let modal: ReactElement | null = null;
let modalClosed = false;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  NavEntryPositionPreferences: { MAINTAIN_X: 1 },
  Focusable: ({ children, ref }: { children: ReactNode; ref: Ref<HTMLDivElement> }) => (
    <div ref={ref}>{children}</div>
  ),
  // A focusable Field is a Steam navigation node that takes focus.
  Field: ({
    label,
    description,
    focusable,
    onClick,
    children,
  }: {
    label?: ReactNode;
    description?: ReactNode;
    focusable?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <div
      className={focusable ? "Focusable" : undefined}
      tabIndex={focusable ? -1 : undefined}
      aria-label={String(label)}
      onClick={onClick}
    >
      {label}
      {description}
      {children}
    </div>
  ),
  showModal: (element: ReactElement) => {
    modal = element;
    modalClosed = false;
    return {
      Close: () => {
        modalClosed = true;
      },
    };
  },
}));

const { AboutSection } = await import("./components/settings/AboutSection");
const { useRestoreFocus } = await import("./components/FocusSlot");
const { VIEW } = await import("./components/settings/common");
const { resetFocusMemory } = await import("./focusMemory");
const { diagnosticsText } = await import("./diagnostics");

const dom = new JSDOM('<div id="root"></div><div id="modal"></div>', { pretendToBeVisual: true });
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
let root: Root;
let modalRoot: Root | null = null;
let copied: string | null = null;

function Options() {
  useRestoreFocus(VIEW);
  return <AboutSection />;
}

beforeAll(() => {
  env.window = dom.window;
  env.document = doc;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no execCommand: record what the copy put on the clipboard.
  (doc as unknown as { execCommand: (c: string) => boolean }).execCommand = (command) => {
    copied = command === "copy" ? doc.querySelector("textarea")!.value : null;
    return true;
  };
});
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
beforeEach(async () => {
  resetFocusMemory(() => 0);
  diagnosticsFails = false;
  calls.length = 0;
  toasts.length = 0;
  modal = null;
  copied = null;
  root = createRoot(doc.getElementById("root")!);
  await act(async () => root.render(<Options />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  if (modalRoot) {
    await act(async () => modalRoot!.unmount());
    modalRoot = null;
  }
});

const rows = () => [...doc.querySelectorAll("#root .Focusable")];
const diagnosticsRow = () => doc.querySelector<HTMLElement>('#root [aria-label="Diagnostics"]');

async function openDiagnostics() {
  await act(async () => diagnosticsRow()!.click());
  expect(modal).not.toBeNull();
  modalRoot = createRoot(doc.getElementById("modal")!);
  await act(async () => modalRoot!.render(modal!));
  return doc.getElementById("modal")!;
}

describe("Options › About › Diagnostics (#209)", () => {
  test("is the last row in About", () => {
    expect(rows().slice(-1)[0]).toBe(diagnosticsRow()!);
  });

  test("A loads the diagnostics afresh and shows their text in a modal", async () => {
    calls.length = 0;
    const shown = await openDiagnostics();
    expect(calls).toEqual(["system.diagnostics"]);
    expect(shown.querySelector("h2")!.textContent).toBe("Diagnostics");
    expect(shown.textContent).toContain("WoWDeck version");
    expect(shown.textContent).toContain(diagnostics.pluginVersion!);
    expect(shown.querySelector("pre")).toBeNull();
    // The copyable text never carries local paths (diagnostics.ts allowlist).
    expect(shown.textContent).not.toContain("/home/deck");
  });

  test("nested values read as words: sentence-case keys, dates, not milliseconds", async () => {
    const shown = await openDiagnostics();
    const text = shown.textContent!;
    expect(text).toContain("Signed in: Yes");
    expect(text).toContain("Followed realms: 2");
    expect(text).toContain("Client: Retail");
    expect(text).toContain("Companion addon: Yes");
    expect(text).toContain(
      `Last push: ${new Date(Date.UTC(2026, 10, 12, 9, 30)).toLocaleString()}`,
    );
    expect(text).not.toContain(String(Date.UTC(2026, 10, 12, 9, 30)));
    expect(text).not.toContain("signed In");
  });

  test("Copy puts the diagnostics text on the clipboard and says so", async () => {
    const shown = await openDiagnostics();
    const copy = [...shown.querySelectorAll("button")].find(
      (b) => b.textContent === "Copy diagnostics",
    )!;
    await act(async () => copy.click());
    expect(copied).toBe(diagnosticsText(diagnostics));
    expect(toasts).toEqual(["Diagnostics copied"]);
    expect(modalClosed).toBe(false);
  });

  test("Close closes the modal", async () => {
    const shown = await openDiagnostics();
    const close = [...shown.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    expect(modalClosed).toBe(true);
  });

  test("diagnostics that can't load give an error toast and no modal", async () => {
    diagnosticsFails = true;
    await act(async () => diagnosticsRow()!.click());
    expect(modal).toBeNull();
    expect(toasts).toEqual(["Couldn't load diagnostics"]);
  });

  test("after the modal closes and Options comes back, focus is on the Diagnostics row", async () => {
    await openDiagnostics();
    // The modal unmounts the panel (guide G4) and Options mounts again.
    await act(async () => root.unmount());
    root = createRoot(doc.getElementById("root")!);
    await act(async () => root.render(<Options />));
    expect(doc.activeElement).toBe(diagnosticsRow()!);
  });
});
