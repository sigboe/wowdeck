/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";
import type { CurseForgeAuthStatus, ProviderInfo } from "./types";

/**
 * The CurseForge key modal (#206): one modal with the status first, the key
 * field and every key action from the old CurseForge section. A fake rpc
 * stands in for the engine; the assertions are on what it is asked to do,
 * what the player sees, and the toasts.
 */

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

const opened: string[] = [];
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  Navigation: { NavigateToExternalWeb: (url: string) => opened.push(url) },
  Field: ({
    label,
    description,
    disabled,
    onClick,
    children,
  }: {
    label?: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <div role="row" aria-disabled={disabled ? "true" : undefined} onClick={onClick}>
      <b>{label}</b>
      <i>{description}</i>
      {children}
    </div>
  ),
  TextField: ({
    value,
    onChange,
    "aria-label": ariaLabel,
    type,
  }: {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    "aria-label"?: string;
    type?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      type={type}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
    />
  ),
}));

const calls: Array<{ method: string; params: unknown }> = [];
let testResult: { ok: boolean; confirmed?: boolean; message?: string } = { ok: true };
let authAfter: CurseForgeAuthStatus;
let pendingStatus: Promise<CurseForgeAuthStatus> | null = null;
const curse = (configured: boolean, enabled: boolean): ProviderInfo => ({
  id: "Curse",
  name: "CurseForge",
  enabled,
  available: configured && enabled,
  requiresApiKey: true,
  configured,
  allowEdit: true,
  catalogSearch: true,
  discovers: true,
});
mock.module("./services/backend", () => ({
  rpc: async (method: string, params?: unknown) => {
    calls.push({ method, params });
    switch (method) {
      case "providers.testApiKey":
        return testResult;
      case "settings.set":
        return { settings: (params as { settings: object }).settings };
      case "providers.setEnabled":
        return { providers: [curse(true, true)] };
      case "providers.list":
        return { providers: [curse(true, true)] };
      case "curseforge.authStatus":
        return pendingStatus ?? authAfter;
      case "curseforge.recheckBundledKey":
        return authAfter;
      default:
        return {};
    }
  },
}));

// The DOM exists before react-dom loads: it decides at load time whether
// it can listen for input events, and typing in the key field needs them.
const dom = new JSDOM('<div id="root"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
env.window = dom.window;
env.document = doc;
env.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { CurseForgeKeyModal } = await import("./components/settings/CurseForgeKeyModal");
const { sourcesStore, resetSourcesStore } = await import("./sourcesStore");

const rejected: CurseForgeAuthStatus = {
  activeSource: "none",
  bundledPresent: true,
  bundledStatus: "invalid",
  userConfigured: false,
  userStatus: "unvalidated",
};
const ownKey: CurseForgeAuthStatus = {
  activeSource: "user",
  bundledPresent: true,
  bundledStatus: "invalid",
  userConfigured: true,
  userStatus: "valid",
};

let root: Root;
let closed = 0;
let changed = 0;

afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
beforeEach(() => {
  pendingStatus = null;
  calls.length = 0;
  toasts.length = 0;
  opened.length = 0;
  closed = 0;
  changed = 0;
  testResult = { ok: true };
  resetSourcesStore();
  sourcesStore.patch({ providers: [curse(false, false)], loaded: true });
  root = createRoot(doc.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

async function show(auth: CurseForgeAuthStatus) {
  authAfter = auth;
  await act(async () =>
    root.render(
      <CurseForgeKeyModal
        auth={auth}
        onChanged={async () => {
          changed++;
        }}
        closeModal={() => closed++}
      />,
    ),
  );
}

const rows = () =>
  [...doc.querySelectorAll('[role="row"]')].map((r) => r.querySelector("b")!.textContent);
const row = (label: string) =>
  [...doc.querySelectorAll<HTMLElement>('[role="row"]')].find(
    (r) => r.querySelector("b")!.textContent === label,
  )!;
const press = (label: string) => act(async () => row(label).click());
const keyField = () =>
  doc.querySelector<HTMLInputElement>('input[aria-label="CurseForge API key"]')!;
async function type(value: string) {
  const input = keyField();
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const methods = () => calls.map((c) => c.method).filter((m) => m !== "curseforge.authStatus");

describe("the CurseForge key modal", () => {
  test("shows the key status first, then the key field and every key action that applies", async () => {
    await show(rejected);
    expect(rows()[0]).toBe("No CurseForge key saved yet");
    expect(keyField().type).toBe("password");
    expect(rows()).toContain("Save key");
    expect(rows()).toContain("Try built-in access again");
    expect(rows()).toContain("Get a CurseForge API key");
    expect(rows()).not.toContain("Clear key");
  });

  test("a late initial status cannot undo a successful built-in recheck", async () => {
    let resolve!: (auth: CurseForgeAuthStatus) => void;
    pendingStatus = new Promise((r) => {
      resolve = r;
    });
    await show(rejected);
    authAfter = { ...rejected, activeSource: "bundled", bundledStatus: "valid" };
    await press("Try built-in access again");
    expect(rows()).not.toContain("Try built-in access again");
    await act(async () => resolve(rejected));
    expect(rows()).not.toContain("Try built-in access again");
    expect(doc.body.textContent).toContain("Built-in CurseForge access works.");
  });

  test("a late initial status cannot restore a cleared key", async () => {
    let resolve!: (auth: CurseForgeAuthStatus) => void;
    pendingStatus = new Promise((r) => {
      resolve = r;
    });
    await show(ownKey);
    pendingStatus = null;
    authAfter = rejected;
    await press("Clear key");
    expect(rows()).not.toContain("Clear key");
    await act(async () => resolve(ownKey));
    expect(rows()).not.toContain("Clear key");
    expect(rows()[0]).toBe("No CurseForge key saved yet");
  });

  test("with a key saved it offers Replace key and Clear key", async () => {
    await show(ownKey);
    expect(rows()[0]).toBe("Your key works");
    expect(rows()).toContain("Replace key");
    expect(rows()).toContain("Clear key");
    expect(rows()).not.toContain("Save key");
  });

  test("Try built-in access again only while built-in access is rejected", async () => {
    await show({ ...rejected, bundledPresent: false, bundledStatus: "unvalidated" });
    expect(rows()).not.toContain("Try built-in access again");
  });

  test("Save key stays off until a key is typed", async () => {
    await show(rejected);
    expect(row("Save key").getAttribute("aria-disabled")).toBe("true");
    await press("Save key");
    expect(methods()).toEqual([]);
    await type("  my-key  ");
    expect(row("Save key").getAttribute("aria-disabled")).toBeNull();
  });

  test("a working key is checked, saved, turns CurseForge on and closes the modal", async () => {
    await show(rejected);
    authAfter = ownKey;
    await type("  my-key  ");
    await press("Save key");
    expect(calls.find((c) => c.method === "providers.testApiKey")?.params).toEqual({
      providerId: "Curse",
      apiKey: "my-key",
    });
    expect(calls.find((c) => c.method === "settings.set")?.params).toEqual({
      settings: { curseApiKey: "my-key" },
    });
    expect(calls.find((c) => c.method === "providers.setEnabled")?.params).toEqual({
      providerId: "Curse",
      enabled: true,
    });
    expect(methods().indexOf("settings.set")).toBeLessThan(
      methods().indexOf("providers.setEnabled"),
    );
    expect(sourcesStore.get().providers?.[0]).toMatchObject({ enabled: true, configured: true });
    expect(toasts).toContain("CurseForge key saved and verified");
    expect(changed).toBe(1);
    expect(closed).toBe(1);
  });

  test("a key CurseForge rejects is not saved, nothing turns on and the modal stays", async () => {
    await show(rejected);
    testResult = { ok: false, confirmed: true, message: "Rejected" };
    await type("bad-key");
    await press("Save key");
    expect(methods()).toEqual(["providers.testApiKey"]);
    expect(toasts).toEqual(["Couldn't check the key"]);
    expect(closed).toBe(0);
  });

  test("a key that couldn't be checked just now is saved anyway and turns CurseForge on", async () => {
    await show(rejected);
    testResult = { ok: false, confirmed: false, message: "Network" };
    await type("my-key");
    await press("Save key");
    expect(methods()).toContain("settings.set");
    expect(methods()).toContain("providers.setEnabled");
    expect(toasts).toContain("CurseForge key saved");
    expect(closed).toBe(1);
  });

  test("Clear key removes the saved key, shows the new status and stays open", async () => {
    await show(ownKey);
    authAfter = rejected;
    await press("Clear key");
    expect(calls.find((c) => c.method === "settings.set")?.params).toEqual({
      settings: { curseApiKey: null },
    });
    expect(methods()).not.toContain("providers.setEnabled");
    expect(toasts).toContain("CurseForge key cleared");
    expect(rows()[0]).toBe("No CurseForge key saved yet");
    expect(changed).toBe(1);
    expect(closed).toBe(0);
  });

  test("Try built-in access again asks the engine and shows its answer", async () => {
    await show(rejected);
    authAfter = { ...rejected, activeSource: "bundled", bundledStatus: "valid" };
    await press("Try built-in access again");
    expect(methods()).toContain("curseforge.recheckBundledKey");
    expect(rows()).not.toContain("Try built-in access again");
    expect(changed).toBe(1);
  });

  test("Get a CurseForge API key opens the CurseForge console", async () => {
    await show(rejected);
    await press("Get a CurseForge API key");
    expect(opened).toEqual(["https://console.curseforge.com/#/api-keys"]);
  });
});
