/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";

/**
 * Options → Settings backup with its real FocusRows (#132): Use default
 * folder hides itself once saved, so focus must move on rather than fall
 * to nothing.
 */

mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  Focusable: ({ children, ref }: { children: ReactNode; ref: Ref<HTMLDivElement> }) => (
    <div ref={ref}>{children}</div>
  ),
  // A focusable Field is a Steam navigation node that takes focus.
  Field: ({
    label,
    focusable,
    children,
  }: {
    label?: ReactNode;
    focusable?: boolean;
    children?: ReactNode;
  }) =>
    focusable ? (
      <div className="Focusable" tabIndex={-1} aria-label={String(label)}>
        {children}
      </div>
    ) : (
      <div aria-label={String(label)}>{children}</div>
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

let saveOutcome: "saved" | "failed" = "saved";
const idle = {
  activity: null,
  job: null,
  outcome: null,
  errors: {},
  notices: {},
  settingsError: null,
  settingsUnknown: null,
};
const emptyList = { data: null, error: null, loading: false, refresh: async () => {} };
mock.module("./wtfSession", () => ({
  useWtfOperation: () => idle,
  useBackupList: () => emptyList,
  wtfLifecycle: {
    saveSettings: async (patch: Partial<Settings>) => {
      if (saveOutcome === "failed") return false;
      setSettings({ ...stored.settings, ...patch } as Settings);
      return true;
    },
  },
}));
mock.module("./components/WtfBackupModal", () => ({ openWtfBackupModal: () => {} }));

const { WtfBackupSection } = await import("./components/WtfBackupSection");
const { resetFocusMemory } = await import("./focusMemory");

const dom = new JSDOM('<div id="root"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
let root: Root;

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
  setSettings({ wtfBackupDir: "/run/media/sd/wtf", wtfKeepSnapshots: 3 });
  root = createRoot(doc.getElementById("root")!);
  await act(async () => root.render(<WtfBackupSection installation={null} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

const useDefault = () =>
  [...doc.querySelectorAll("button")].find((b) => b.textContent === "Use default folder") ?? null;

describe("Use default folder (#132)", () => {
  test("hides itself once saved and hands focus to Backup folder", async () => {
    const button = useDefault()!;
    button.focus();
    await act(async () => button.click());
    expect(useDefault()).toBeNull();
    expect(doc.activeElement).toBe(doc.querySelector('[aria-label="Backup folder"]'));
  });

  test("a save that failed keeps the button and focus on it", async () => {
    saveOutcome = "failed";
    const button = useDefault()!;
    button.focus();
    await act(async () => button.click());
    expect(useDefault()).toBe(button);
    expect(doc.activeElement).toBe(button);
  });
});
