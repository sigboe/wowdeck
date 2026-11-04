import { expect, mock, test } from "bun:test";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { deckyUiStub } from "./deckyUiStub";

let opened: ReactElement | null = null;
let loadFile: (() => Promise<void>) | undefined;
let importFile: (() => Promise<void>) | undefined;
const picks: unknown[][] = [];
let pickedPath: string | null = null;
let backendCall: (method: string, ...args: unknown[]) => Promise<unknown> = async () => ({});
mock.module("@decky/api", () => ({
  FileSelectionType: { FILE: 0 },
  toaster: { toast: () => {} },
  openFilePicker: async (...args: unknown[]) => {
    picks.push(args);
    if (pickedPath) return { path: pickedPath };
    throw new Error("cancel");
  },
  callable:
    (method: string) =>
    (...args: unknown[]) =>
      backendCall(method, ...args),
  addEventListener: () => {},
  removeEventListener: () => {},
}));
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  DialogBodyText: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToggleField: () => null,
  showModal: (element: ReactElement) => {
    opened = element;
  },
  ModalRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Field: ({ label, onClick }: { label: string; onClick?: () => Promise<void> }) => {
    if (label === "Import from file…") importFile = onClick;
    if (label === "Load from file") loadFile = onClick;
    return <div>{label}</div>;
  },
  DialogButtonPrimary: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Spinner: () => null,
}));
mock.module("./wtfSession", () => ({
  useWtfOperation: () => ({ activity: null, job: null, errors: {}, notices: {} }),
  useBackupList: () => ({ data: null, loading: false, refresh: async () => {} }),
  useCopySources: () => ({ data: null }),
  wtfLifecycle: {},
}));
const { openWtfBackupModal } = await import("./components/WtfBackupModal");
test("backup import can reach ZIPs in nested folders and cancellation sends no import", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {} });
  try {
    openWtfBackupModal({ id: "fixture", displayName: "Fixture" } as Parameters<
      typeof openWtfBackupModal
    >[0]);
    renderToStaticMarkup(opened!);
    expect(importFile).toBeDefined();
    await importFile!();
    const [, , files, folders, , extensions, , allFiles] = picks[picks.length - 1];
    expect(files).toBe(true);
    expect(folders).toBe(true);
    expect(extensions).toEqual(["zip"]);
    expect(allFiles).toBe(false);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

const { openAddonPortabilityModal } = await import("./components/AddonPortabilityModal");
test("addon list import navigates nested folders and restricts selection to text files", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const dom = new JSDOM('<div id="root"></div>');
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    openAddonPortabilityModal({
      mode: "import",
      installations: [],
      selectedInstallationId: null,
      onInstalled: () => {},
    });
    await act(async () => root.render(opened!));
    expect(loadFile).toBeDefined();
    await act(async () => loadFile!());
    const [, , files, folders, , extensions, , allFiles] = picks[picks.length - 1];
    expect(files).toBe(true);
    expect(folders).toBe(true);
    expect(extensions).toEqual(["txt"]);
    expect(allFiles).toBe(false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("partial import keeps failure details and cleanup warnings after the list refreshes", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const dom = new JSDOM('<div id="root"></div>');
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let previews = 0;
  pickedPath = "/fixture/list.txt";
  backendCall = async (method, ...args) => {
    if (method === "read_text_file") return { ok: true, content: "fixture payload", message: "" };
    if (method === "rpc" && args[0] === "addons.previewImport") {
      previews++;
      return {
        summary: {
          addedCt: previews === 1 ? 2 : 1,
          noChangeCt: previews === 1 ? 0 : 1,
          conflictCt: 0,
          unresolvedCt: 0,
          comparisons: [],
        },
        error: null,
      };
    }
    if (method === "rpc" && args[0] === "addons.importAddonList")
      return {
        operations: [
          {
            operationId: "1",
            addonName: "Alpha",
            status: "failed",
            error: "Couldn't save the addon list",
          },
          {
            operationId: "2",
            addonName: "Zeta",
            status: "installed",
            error: null,
            cleanupWarning: "fixture leftovers",
          },
        ],
        error: null,
      };
    return {};
  };
  try {
    openAddonPortabilityModal({
      mode: "import",
      installations: [],
      selectedInstallationId: null,
      onInstalled: () => {},
    });
    await act(async () => root.render(opened!));
    await act(async () => loadFile!());
    const install = dom.window.document.querySelector("button")!;
    expect(install.textContent).toBe("Install 2 new");
    await act(async () => install.click());
    expect(previews).toBe(2);
    expect(dom.window.document.body.textContent).toContain(
      "Alpha: failed, Couldn't save the addon list",
    );
    expect(dom.window.document.body.textContent).toContain("Zeta: installed");
    expect(dom.window.document.body.textContent).toContain("Zeta: installed. fixture leftovers");
    await act(async () => loadFile!());
    expect(dom.window.document.body.textContent).not.toContain("Alpha: failed");
    expect(dom.window.document.body.textContent).not.toContain("fixture leftovers");
  } finally {
    pickedPath = null;
    backendCall = async () => ({});
    await act(async () => root.unmount());
    dom.window.close();
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
