import { describe, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import type { Installation, SearchResult } from "./types";

type RowActions = {
  onSecondaryButton?: () => void;
  onMenuButton?: () => void;
  onClick?: () => void;
  onSecondaryActionDescription?: string;
  label?: ReactNode;
  children?: ReactNode;
};
type ModalActions = {
  releaseHold?: () => void;
  onOK?: () => void;
  onInstall?: () => Promise<void>;
  strCancelButtonText?: string;
  strOKButtonText?: string;
};
let row: RowActions;
let modal: ReactElement<ModalActions> | null = null;
let menu: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
const requests: string[] = [];
const modalReleases: (() => void)[] = [];
let listedInstallations: Installation[] = [];
mock.module("@decky/api", () => ({
  addEventListener: () => {},
  removeEventListener: () => {},
  callable: () => async (method: string) => {
    requests.push(method);
    if (method === "installations.list") return { installations: listedInstallations };
    if (method === "addons.install") return { operation: { status: "completed" } };
    return { addons: [] };
  },
  toaster: { toast: () => {} },
  FileSelectionType: { FILE: 0 },
  openFilePicker: () => {},
}));

// Steam supplies these controls at runtime. Keep their visible labels and
// disabled state while rendering outside Steam.
mock.module("@decky/ui", () => ({
  Field: (props: RowActions) => {
    row = props;
    return (
      <div>
        {props.label}
        {props.children}
      </div>
    );
  },
  ConfirmModal: () => null,
  showModal: (element: ReactElement<ModalActions>) => {
    modal = element;
    if (element.props.releaseHold) modalReleases.push(element.props.releaseHold);
    return { Close: () => {} };
  },
  Menu: () => null,
  MenuItem: () => null,
  showContextMenu: (element: typeof menu) => {
    menu = element;
  },
  ModalRoot: () => null,
  Navigation: {},
  GamepadButton: {},
  TextField: () => null,
  Spinner: () => <span role="progressbar" />,
  PanelSection: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  PanelSectionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogButton: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { ResultList } = await import("./components/browseTabs");
const { addonSession } = await import("./session");
const { startInstallationJump, installationJump, clearInstallationJump } =
  await import("./optionsJump");
const { rememberedFocus } = await import("./focusMemory");
const { QAM_VIEW } = await import("./qamState");
const { fileImport, installArchive, resetFileImport } = await import("./fileImportState");
const { requireInstallation } = await import("./components/requireInstallation");
const { qamShown } = await import("./browseSessionState");

test("every browse install action and Manual Install warn without sending an install", async () => {
  const previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const dom = new JSDOM('<div id="test-root"></div>');
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  const root = createRoot(document.getElementById("test-root")!);
  const previous = addonSession.get();
  const result = {
    providerId: "Curse",
    externalId: "123",
    name: "Example",
    downloadCount: 0,
    channelReleases: [{ channel: "stable", version: "1", fileChannel: "stable" }],
  } as SearchResult;
  try {
    listedInstallations = [];
    await addonSession.reloadAll();
    requests.length = 0;
    const render = () =>
      act(async () => {
        root.render(<ResultList results={[result]} onFindInstallations={startInstallationJump} />);
      });
    await render();
    expect(row.onSecondaryActionDescription).toBe("Find WoW install");
    row.onSecondaryButton!();
    expect(modal?.props.strCancelButtonText).toBe("Cancel");
    expect(modal?.props.strOKButtonText).toBe("Find WoW installations");
    expect(requests).toEqual([]);
    expect(installationJump()).toBeNull();
    modal = null;
    row.onMenuButton!();
    menu.props.children[0]!.props.onClick();
    expect(modal).not.toBeNull();
    expect(requests).toEqual([]);
    row.onClick!();
    await modal!.props.onInstall!();
    expect(modal!.props.strOKButtonText).toBe("Find WoW installations");
    modal!.props.onOK!();
    expect(rememberedFocus(QAM_VIEW.settings)).toBe("detect");
    expect(installationJump()).not.toBeNull();
    expect(requests).toEqual([]);

    fileImport.set({
      phase: "ready",
      preview: {
        providerId: "File",
        externalId: "/addon.zip",
        fileName: "addon.zip",
        name: "Example",
        folders: [],
        author: null,
        version: null,
      },
      error: null,
    });
    await installArchive(
      async () => {
        requests.push("addons.install");
        throw new Error("must not install");
      },
      () => requireInstallation(startInstallationJump),
    );
    expect(fileImport.get().phase).toBe("ready");
    expect(requests).toEqual([]);

    listedInstallations = [{ id: "wow", selected: true } as Installation];
    await act(async () => {
      await addonSession.reloadInstallations();
    });
    modal = null;
    await render();
    expect(row.onSecondaryActionDescription).toBe("Install");
    await act(async () => {
      const settled = new Promise<void>((resolve) => {
        let loading = false;
        const unsubscribe = addonSession.subscribe(() => {
          if (addonSession.get().loads > 0) loading = true;
          else if (loading) {
            unsubscribe();
            resolve();
          }
        });
      });
      row.onSecondaryButton!();
      await settled;
    });
    expect(modal).toBeNull();
    expect(requests).toContain("addons.install");
  } finally {
    for (const release of modalReleases.splice(0)) release();
    qamShown();
    clearInstallationJump();
    resetFileImport();
    await act(async () => {
      root.unmount();
    });
    listedInstallations = previous.installations;
    await addonSession.reloadAll();
    dom.window.close();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    if (previousActEnvironment)
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

const { FindWowWidget } = await import("./components/FindWowWidget");
const props = {
  installationCount: 0,
  detecting: false,
  result: null as string | null,
  onDetect: () => {},
  onOpenOptions: () => {},
};

describe("My Addons Find WoW widget", () => {
  test("offers detection and Steam library setup only without an installation", () => {
    const empty = renderToStaticMarkup(<FindWowWidget {...props} />);
    expect(empty).toContain("Find WoW");
    expect(empty).toContain("Steam library");
    expect(empty).toContain("WoW or Battle.net");
    expect(renderToStaticMarkup(<FindWowWidget {...props} installationCount={1} />)).toBe("");
  });

  test("shows the empty scan result and where to add a folder manually", () => {
    const html = renderToStaticMarkup(<FindWowWidget {...props} result="Found 0 installations" />);
    expect(html).toContain("Found 0 installations");
    expect(html).toContain("add its folder in Options");
  });

  test("shows progress with scanning disabled, and displays a failed scan", () => {
    const pending = renderToStaticMarkup(<FindWowWidget {...props} detecting />);
    expect(pending).toContain("Finding WoW");
    expect(pending).toContain("progressbar");
    expect(pending).toContain("disabled");
    const failure = renderToStaticMarkup(<FindWowWidget {...props} result="Couldn’t find WoW" />);
    expect(failure).toContain("Couldn’t find WoW");
  });
});
