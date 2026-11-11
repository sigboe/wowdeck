/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useSyncExternalStore, type ReactElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";

/**
 * Options → Settings backup (#204): Back up now keeps the action on the page
 * and its ⋯ opens Backup settings (folder, default folder, safety backups to
 * keep). Rendered with the real FocusRows and focus memory.
 */

let pickResult: { path: string } | "cancel" = "cancel";
mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: async () => {
    if (pickResult === "cancel") throw new Error("cancelled");
    return pickResult;
  },
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

let shownModal: ReactElement<{ closeModal?: () => void }> | null = null;
let modalCloses = 0;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  Focusable: ({ children, ref }: { children: ReactNode; ref: Ref<HTMLDivElement> }) => (
    <div ref={ref}>{children}</div>
  ),
  // A focusable Field is a Steam navigation node that takes focus; a plain
  // one is a row that only holds its controls.
  Field: ({
    label,
    description,
    focusable,
    disabled,
    onClick,
    children,
  }: {
    label?: ReactNode;
    description?: ReactNode;
    focusable?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <div
      className={focusable ? "Focusable" : undefined}
      tabIndex={focusable ? -1 : undefined}
      aria-label={String(label)}
      data-disabled={disabled ? "true" : undefined}
      onClick={onClick}
    >
      <i>{description}</i>
      {children}
    </div>
  ),
  ButtonItem: ({
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
  showModal: (el: ReactElement<{ closeModal?: () => void }>) => {
    shownModal = el;
    return {
      Close: () => {
        modalCloses++;
      },
    };
  },
}));

type Settings = { wtfBackupDir: string | null; wtfKeepSnapshots: number };
let stored = { loaded: true, settings: { wtfBackupDir: "/run/media/sd/wtf", wtfKeepSnapshots: 3 } };
const settingsListeners = new Set<() => void>();
const setSettings = (settings: Settings) => {
  stored = { loaded: true, settings: settings as typeof stored.settings };
  for (const l of settingsListeners) l();
};
mock.module("./settings", () => ({
  settingsStore: {
    get: () => stored,
    subscribe: (l: () => void) => {
      settingsListeners.add(l);
      return () => settingsListeners.delete(l);
    },
  },
}));

type Op = {
  activity: { phase: string } | null;
  job: { installationId: string; jobId: string; kind: string } | null;
  outcome: null;
  errors: Record<string, string>;
  notices: Record<string, string>;
  settingsError: string | null;
  settingsUnknown: string | null;
};
const IDLE: Op = {
  activity: null,
  job: null,
  outcome: null,
  errors: {},
  notices: {},
  settingsError: null,
  settingsUnknown: null,
};
let op: Op = IDLE;
const opListeners = new Set<() => void>();
const setOp = (next: Partial<Op>) => {
  op = { ...op, ...next };
  for (const l of opListeners) l();
};
const subscribeOp = (l: () => void) => {
  opListeners.add(l);
  return () => opListeners.delete(l);
};

let saveOutcome: "saved" | "failed" = "saved";
const calls: string[] = [];
const saved: Partial<Settings>[] = [];
const readyList = {
  data: {
    backups: [],
    dirAvailable: true,
    wtfExists: true,
    gameRunning: "notRunning",
  },
  error: null,
  loading: false,
  refresh: async () => {},
};
mock.module("./wtfSession", () => ({
  useWtfOperation: () => useSyncExternalStore(subscribeOp, () => op),
  useBackupList: () => readyList,
  wtfLifecycle: {
    create: async (id: string) => void calls.push(`create:${id}`),
    cancel: async () => void calls.push("cancel"),
    saveSettings: async (patch: Partial<Settings>) => {
      saved.push(patch);
      if (saveOutcome === "failed") return false;
      setSettings({ ...stored.settings, ...patch } as Settings);
      return true;
    },
  },
}));
mock.module("./components/WtfBackupModal", () => ({ openWtfBackupModal: () => {} }));

const { WtfBackupSection } = await import("./components/WtfBackupSection");
const { resetFocusMemory, restoreFocus } = await import("./focusMemory");
const { QAM_VIEW } = await import("./qamState");

const dom = new JSDOM('<div id="root"></div><div id="modal"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
let root: Root | null;
let modalRoot: Root | null;

const installation = { id: "retail", displayName: "Retail" } as never;

const renderSection = async () => {
  root = createRoot(doc.getElementById("root")!);
  await act(async () => root!.render(<WtfBackupSection installation={installation} />));
};
const unmountSection = async () => {
  await act(async () => root?.unmount());
  root = null;
};
const openSettings = async () => {
  await act(async () => backupSettingsButton()!.click());
  modalRoot = createRoot(doc.getElementById("modal")!);
  await act(async () => modalRoot!.render(shownModal!));
};
const closeSettings = async () => {
  await act(async () => shownModal!.props.closeModal!());
  await act(async () => modalRoot?.unmount());
  modalRoot = null;
};

const section = () => doc.getElementById("root")!;
const modal = () => doc.getElementById("modal")!;
const buttonNamed = (scope: Element, name: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent === name) ?? null;
const backUpButton = () => buttonNamed(section(), "Back up") ?? buttonNamed(section(), "Cancel");
const backupSettingsButton = () => buttonNamed(section(), "Backup settings");
const row = (scope: Element, label: string) => scope.querySelector(`[aria-label="${label}"]`);

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
beforeEach(async () => {
  resetFocusMemory(() => 0);
  saveOutcome = "saved";
  pickResult = "cancel";
  calls.length = 0;
  saved.length = 0;
  shownModal = null;
  modalCloses = 0;
  op = IDLE;
  setSettings({ wtfBackupDir: "/run/media/sd/wtf", wtfKeepSnapshots: 3 });
  await renderSection();
});
afterEach(async () => {
  await act(async () => modalRoot?.unmount());
  modalRoot = null;
  await unmountSection();
});

describe("Back up now row", () => {
  test("shows its status with a Back up button and a ⋯ named Backup settings", () => {
    const backUpRow = row(section(), "Back up now")!;
    expect(backUpRow.textContent).toContain("No backups yet.");
    // A row that only holds its two buttons: no nested focusables.
    expect(backUpRow.classList.contains("Focusable")).toBe(false);
    expect(backUpRow.contains(backUpButton())).toBe(true);
    expect(backUpRow.contains(backupSettingsButton())).toBe(true);
  });

  test("the set-once settings are no longer rows on the page", () => {
    expect(row(section(), "Backup folder")).toBeNull();
    expect(buttonNamed(section(), "Use default folder")).toBeNull();
    expect(section().querySelector('select[aria-label="Safety backups to keep"]')).toBeNull();
  });

  test("Back up starts a backup of the active installation", async () => {
    await act(async () => backUpButton()!.click());
    expect(calls).toEqual(["create:retail"]);
  });

  test("Back up becomes Cancel while a backup runs", async () => {
    await act(async () =>
      setOp({
        activity: { phase: "running" },
        job: { installationId: "retail", jobId: "j1", kind: "backup" },
      }),
    );
    const button = backUpButton()!;
    expect(button.textContent).toBe("Cancel");
    await act(async () => button.click());
    expect(calls).toEqual(["cancel"]);
  });

  test("Manage backups stays on the page", () => {
    expect(row(section(), "Manage backups")).not.toBeNull();
  });
});

describe("Backup settings modal", () => {
  test("holds Backup folder, Use default folder and Safety backups to keep", async () => {
    await openSettings();
    expect(row(modal(), "Backup folder")!.textContent).toContain("/run/media/sd/wtf");
    expect(buttonNamed(modal(), "Use default folder")).not.toBeNull();
    expect(modal().querySelector('select[aria-label="Safety backups to keep"]')).not.toBeNull();
  });

  test("Backup folder saves the picked folder through the backup lifecycle", async () => {
    pickResult = { path: "/run/media/sd/other" };
    await openSettings();
    await act(async () => (row(modal(), "Backup folder") as HTMLElement).click());
    expect(saved).toEqual([{ wtfBackupDir: "/run/media/sd/other" }]);
  });

  test("a rejected folder's error shows in the modal, not on the page", async () => {
    await openSettings();
    await act(async () => setOp({ settingsError: "That folder isn't writable." }));
    expect(modal().textContent).toContain("That folder isn't writable.");
    expect(section().textContent).not.toContain("That folder isn't writable.");
  });

  test("its settings are disabled while a backup or restore runs, also when reopened", async () => {
    await act(async () =>
      setOp({
        activity: { phase: "running" },
        job: { installationId: "retail", jobId: "j1", kind: "restore" },
      }),
    );
    await openSettings();
    const expectLocked = () => {
      expect(row(modal(), "Backup folder")!.getAttribute("data-disabled")).toBe("true");
      expect(buttonNamed(modal(), "Use default folder")!.disabled).toBe(true);
      expect(
        (modal().querySelector('select[aria-label="Safety backups to keep"]') as HTMLSelectElement)
          .disabled,
      ).toBe(true);
    };
    expectLocked();
    await act(async () => (row(modal(), "Backup folder") as HTMLElement).click());
    await closeSettings();
    await openSettings();
    expectLocked();
    expect(saved).toEqual([]);
  });

  test("Use default folder hides itself once saved and hands focus to Backup folder (#132)", async () => {
    await openSettings();
    const button = buttonNamed(modal(), "Use default folder")!;
    button.focus();
    await act(async () => button.click());
    expect(buttonNamed(modal(), "Use default folder")).toBeNull();
    expect(doc.activeElement).toBe(row(modal(), "Backup folder"));
  });

  test("a Use default folder save that failed keeps the button and focus on it", async () => {
    saveOutcome = "failed";
    await openSettings();
    const button = buttonNamed(modal(), "Use default folder")!;
    button.focus();
    await act(async () => button.click());
    expect(buttonNamed(modal(), "Use default folder")).toBe(button);
    expect(doc.activeElement).toBe(button);
  });
});

describe("focus return", () => {
  test("closing Backup settings puts focus back on the Back up now row", async () => {
    await openSettings();
    (doc.activeElement as HTMLElement | null)?.blur();
    await closeSettings();
    expect(modalCloses).toBe(1);
    expect(row(section(), "Back up now")!.contains(doc.activeElement)).toBe(true);
  });

  test("also when Options remounts while the modal is open", async () => {
    await openSettings();
    await unmountSection(); // the QAM panel is torn down behind a modal (G4)
    await closeSettings();
    await renderSection();
    restoreFocus(QAM_VIEW.settings);
    expect(row(section(), "Back up now")!.contains(doc.activeElement)).toBe(true);
  });
});
