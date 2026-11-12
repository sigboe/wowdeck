/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";

/**
 * Options › Updates › Previous versions (#207): one row whose description
 * sums up retention and space used, opening a modal with the toggle, the
 * space and Clear. The panel is torn down while the modal is open (G4), so
 * the tests unmount it the same way and check what it shows on return.
 */

mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

let modals: ReactElement[] = [];
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  // Steam's gamepad focus reaches focus memory as a DOM focus here.
  Focusable: ({
    children,
    ref,
    onGamepadFocus,
  }: {
    children: ReactNode;
    ref: Ref<HTMLDivElement>;
    onGamepadFocus?: () => void;
  }) => (
    <div ref={ref} onFocus={onGamepadFocus}>
      {children}
    </div>
  ),
  // A focusable Field is a Steam navigation node that takes focus.
  Field: ({
    label,
    disabled,
    description,
    focusable,
    onClick,
    children,
  }: {
    label?: ReactNode;
    disabled?: boolean;
    description?: ReactNode;
    focusable?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <div
      className={focusable ? "Focusable" : undefined}
      tabIndex={focusable ? -1 : undefined}
      role={focusable ? "button" : undefined}
      aria-label={String(label)}
      onClick={disabled ? undefined : onClick}
      data-disabled={disabled ? "true" : undefined}
    >
      <i>{description}</i>
      {children}
    </div>
  ),
  ToggleField: ({
    label,
    checked,
    disabled,
    onChange,
  }: {
    label?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (on: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  ),
  showModal: (element: ReactElement) => {
    modals.push(element);
    return { Close: () => {} };
  },
}));

let stored = { loaded: true, settings: { autoUpdate: true, keepPreviousVersions: true } };
const settingsListeners = new Set<() => void>();
const saved: object[] = [];
mock.module("./settings", () => ({
  settingsStore: {
    get: () => stored,
    subscribe: (l: () => void) => {
      settingsListeners.add(l);
      return () => settingsListeners.delete(l);
    },
    save: async (patch: object) => {
      saved.push(patch);
      stored = { loaded: true, settings: { ...stored.settings, ...patch } };
      for (const l of settingsListeners) l();
      return true;
    },
  },
}));

const selfUpdate = { info: null, prState: null, checking: false };
mock.module("./selfUpdate", () => ({
  selfUpdateStore: {
    get: () => selfUpdate,
    subscribe: () => () => {},
    refresh: async () => {},
  },
}));

let usage = { bytes: 12_000_000, count: 4 };
let pendingStatus: Promise<{ bytes: number; count: number }> | null = null;
let statusFails = false;
const calls: string[] = [];
mock.module("./services/backend", () => ({
  rpc: async (method: string) => {
    calls.push(method);
    if (method === "rollback.status") {
      if (pendingStatus) return pendingStatus;
      if (statusFails) throw new Error("Unavailable");
      return usage;
    }
    if (method === "rollback.clear") {
      usage = { bytes: 0, count: 0 };
      return usage;
    }
    throw new Error(`unexpected ${method}`);
  },
}));

const toasts: string[] = [];
mock.module("./toast", () => ({
  pluginToast: (title: string) => toasts.push(title),
  toastError: (title: string) => toasts.push(title),
}));

const { loadPreviousVersionsUsage } = await import("./components/PreviousVersionsModal");
const { UpdatesSection } = await import("./components/settings/UpdatesSection");
const { resetFocusMemory } = await import("./focusMemory");
const { useRestoreFocus } = await import("./components/FocusSlot");
const { VIEW } = await import("./components/settings/common");

/** The section as Options mounts it: Options restores the remembered row (S21). */
function Options() {
  useRestoreFocus(VIEW);
  return <UpdatesSection />;
}

const dom = new JSDOM('<div id="panel"></div><div id="modal"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
let panel: Root | null = null;
let modal: Root | null = null;

beforeAll(() => {
  env.window = dom.window;
  env.document = doc;
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});

const openPanel = async () => {
  panel = createRoot(doc.getElementById("panel")!);
  await act(async () => panel!.render(<Options />));
};
const closePanel = async () => {
  await act(async () => panel?.unmount());
  panel = null;
};
const closeModal = async () => {
  await act(async () => modal?.unmount());
  modal = null;
};

beforeEach(async () => {
  resetFocusMemory(() => 0);
  statusFails = false;
  pendingStatus = null;
  modals = [];
  saved.length = 0;
  calls.length = 0;
  toasts.length = 0;
  usage = { bytes: 12_000_000, count: 4 };
  stored = { loaded: true, settings: { autoUpdate: true, keepPreviousVersions: true } };
  await openPanel();
});
afterEach(async () => {
  await closeModal();
  await closePanel();
});

const row = () => doc.querySelector<HTMLElement>('#panel [aria-label="Previous versions"]');
const summary = () => row()?.querySelector("i")?.textContent;

/** Press A on the row: Decky tears the panel down and shows the modal. */
const openModal = async () => {
  await act(async () => row()!.click());
  expect(modals).toHaveLength(1);
  await closePanel();
  modal = createRoot(doc.getElementById("modal")!);
  await act(async () => modal!.render(modals[0]));
};
const inModal = (label: string) => doc.querySelector<HTMLElement>(`#modal [aria-label="${label}"]`);
const clearButton = () => inModal("Clear previous versions");

describe("Previous versions row (#207)", () => {
  test("one row sums up retention and space; the two old rows are gone", () => {
    expect(summary()).toBe("On · 12 MB for 4 addons");
    expect(doc.querySelector('#panel [aria-label="Keep previous versions"]')).toBeNull();
    expect(doc.querySelector('#panel [aria-label="Previous versions kept"]')).toBeNull();
  });

  test("says Off when retention is off and nothing is kept", async () => {
    await closePanel();
    stored = { loaded: true, settings: { autoUpdate: true, keepPreviousVersions: false } };
    usage = { bytes: 0, count: 0 };
    await openPanel();
    expect(summary()).toBe("Off");
  });

  test("the modal holds the toggle, the space used and Clear", async () => {
    await openModal();
    const toggle = inModal("Keep previous versions") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(inModal("Space used")?.textContent).toContain("12 MB for 4 addons");
    expect(clearButton()?.getAttribute("data-disabled")).toBeNull();
  });

  test("turning retention off saves the setting and the row says so on return", async () => {
    usage = { bytes: 0, count: 0 };
    await closePanel();
    await openPanel();
    await openModal();
    await act(async () => (inModal("Keep previous versions") as HTMLInputElement).click());
    expect(saved).toEqual([{ keepPreviousVersions: false }]);
    await closeModal();
    await openPanel();
    expect(summary()).toBe("Off");
  });

  test("Clear empties the kept versions, then stays disabled; the row refreshes", async () => {
    await openModal();
    await act(async () => clearButton()!.click());
    expect(calls).toContain("rollback.clear");
    expect(toasts).toEqual(["Previous versions cleared"]);
    expect(inModal("Space used")?.textContent).toContain("None kept");
    expect(clearButton()?.getAttribute("data-disabled")).toBe("true");
    await closeModal();
    await openPanel();
    expect(summary()).toBe("On · None kept");
  });

  test("Clear is disabled when nothing is kept", async () => {
    usage = { bytes: 0, count: 0 };
    await closePanel();
    await openPanel();
    await openModal();
    expect(clearButton()?.getAttribute("data-disabled")).toBe("true");
  });

  test("a failed usage load shows an error and can be retried", async () => {
    statusFails = true;
    await openModal();
    expect(doc.getElementById("modal")!.textContent).toContain("Couldn't load previous versions");
    expect(clearButton()?.getAttribute("data-disabled")).toBe("true");
    statusFails = false;
    const retry = inModal("Try again")!;
    await act(async () => retry.click());
    expect(inModal("Space used")?.textContent).toContain("12 MB for 4 addons");
  });

  test("a late failed load cannot replace the modal's successful usage load", async () => {
    let reject!: (error: Error) => void;
    pendingStatus = new Promise((_, no) => {
      reject = no;
    });
    let oldLoad!: Promise<void>;
    await act(async () => {
      oldLoad = loadPreviousVersionsUsage();
    });
    pendingStatus = null;
    await openModal();
    await act(async () => {
      reject(new Error("Old request failed"));
      await oldLoad;
    });
    expect(inModal("Space used")?.textContent).toContain("12 MB for 4 addons");
    expect(doc.getElementById("modal")!.textContent).not.toContain(
      "Couldn't load previous versions",
    );
    expect(clearButton()?.getAttribute("data-disabled")).toBeNull();
  });

  test("closing the modal puts focus back on Previous versions", async () => {
    await openModal();
    await closeModal();
    await openPanel();
    expect(doc.activeElement).toBe(row());
  });
});
