/// <reference types="bun-types" />
/**
 * Options' WoW installations section through its real seam: the addon
 * session. No engine is connected in this file — an engine call from the
 * section would reject with "The engine isn't connected yet", so these tests
 * passing is the proof the section writes through the session alone.
 */
import { expect, mock, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
import type { Installation, InstallationPreferences } from "./types";
import type { InstallationsSession } from "./components/settings/InstallationsSection";

mock.module("@decky/api", () => ({
  FileSelectionType: { FILE: 0, FOLDER: 1 },
  toaster: { toast: () => {} },
  openFilePicker: async () => {
    throw new Error("cancel");
  },
}));

const toasts: string[] = [];
mock.module("./toast", () => ({
  pluginToast: (title: string, body = "") => toasts.push(body ? `${title} | ${body}` : title),
  toastError: (title: string) => toasts.push(`error: ${title}`),
}));

/** The details dialog's actions, captured instead of opened. */
let details: {
  installation: Installation;
  counts: { installed: number; managed: number };
  actions: {
    onUpdate: (changes: InstallationPreferences) => Promise<Installation>;
    onRescan: () => void;
    onRemove: () => void;
    recoveryRequired: boolean;
  };
} | null = null;
mock.module("./components/InstallationDetailsModal", () => ({
  openInstallationDetails: (
    installation: Installation,
    counts: { installed: number; managed: number },
    actions: unknown,
  ) => {
    details = { installation, counts, actions } as never;
  },
}));

let confirmed: (() => Promise<void>) | null = null;
mock.module("./components/confirmRemove", () => ({
  confirmRemoveInstallation: (_name: string, onOK: () => void) => {
    confirmed = onOK as () => Promise<void>;
  },
}));

// FocusRow's Y action (Installation details) as a button the test can press.
mock.module("./components/FocusSlot", () => ({
  FocusRow: ({
    children,
    actions,
  }: {
    children: ReactNode;
    actions?: { onOptionsButton?: () => void };
  }) => (
    <div>
      {children}
      {actions?.onOptionsButton && <button onClick={actions.onOptionsButton}>details</button>}
    </div>
  ),
}));

mock.module("@decky/ui", () => deckyUiStub);

const { InstallationsSection } = await import("./components/settings/InstallationsSection");

const retail = { id: "r1", displayName: "Retail", version: "11.0.5.1234" } as Installation;

/** A recording session stub: the section's only collaborator here. */
function recordingSession(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const state = {
    installations: [retail],
    selectedId: "r1",
    addons: [{ id: "a1", providerId: "Curse" }],
    recoveryRequired: {},
    findingWow: false,
    installing: {},
    installingElsewhere: 0,
    ...overrides,
  };
  const session = {
    get: () => state,
    subscribe: () => () => {},
    findWow: async () => void calls.push("findWow"),
    selectInstallation: async (id: string) => void calls.push(`select ${id}`),
    addInstallation: async (params: unknown) => (calls.push(`add ${JSON.stringify(params)}`), []),
    updateInstallation: async (id: string, changes: InstallationPreferences) => {
      calls.push(`update ${id} ${JSON.stringify(changes)}`);
      return retail;
    },
    removeInstallation: async (id: string) => void calls.push(`remove ${id}`),
    rescanInstallation: async (id: string) => {
      calls.push(`rescan ${id}`);
      return "refreshed" as const;
    },
  };
  return { session: session as unknown as InstallationsSession, calls, state };
}

async function render(session: InstallationsSession, selectedId: string | null = "r1") {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const done = async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, old);
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  };
  await act(async () =>
    root.render(
      <InstallationsSection installations={[retail]} selectedId={selectedId} session={session} />,
    ),
  );
  return { container, done };
}

test("Installation details writes through the addon session", async () => {
  const h = recordingSession();
  const view = await render(h.session);
  try {
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(details?.installation.id).toBe("r1");
    // The counts come from the session's addon list.
    expect(details?.counts).toEqual({ installed: 1, managed: 1 });
    expect(details?.actions.recoveryRequired).toBe(false);

    await details!.actions.onUpdate({ hidden: true });
    expect(h.calls).toEqual(['update r1 {"hidden":true}']);

    h.calls.length = 0;
    toasts.length = 0;
    await details!.actions.onRescan();
    await act(async () => {});
    expect(h.calls).toEqual(["rescan r1"]);
    expect(toasts).toEqual(["Addons rescanned | Retail"]);

    h.calls.length = 0;
    toasts.length = 0;
    details!.actions.onRemove();
    await confirmed!();
    expect(h.calls).toEqual(["remove r1"]);
    expect(toasts).toEqual(["Installation removed | WoW files weren't touched"]);
  } finally {
    await view.done();
  }
});

test("a rescan the session answers with recovery shows no toast", async () => {
  const h = recordingSession();
  h.session.rescanInstallation = async (id: string) => {
    void id;
    return "recovery";
  };
  const view = await render(h.session);
  try {
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>("button")!.click();
    });
    toasts.length = 0;
    await details!.actions.onRescan();
    await act(async () => {});
    expect(toasts).toEqual([]);
  } finally {
    await view.done();
  }
});

test("recovery required reaches the details dialog from the session state", async () => {
  const h = recordingSession({ recoveryRequired: { r1: true } });
  const view = await render(h.session);
  try {
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(details?.actions.recoveryRequired).toBe(true);
  } finally {
    await view.done();
  }
});

test("Find WoW installations asks the session, not the engine", async () => {
  const h = recordingSession();
  const view = await render(h.session, null);
  try {
    const row = [...view.container.querySelectorAll("b")].find((b) =>
      b.textContent!.startsWith("Find WoW installations"),
    )!;
    await act(async () => {
      (row.parentElement as HTMLElement).click();
    });
    expect(h.calls).toEqual(["findWow"]);
  } finally {
    await view.done();
  }
});
