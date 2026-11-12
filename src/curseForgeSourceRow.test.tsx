/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useSyncExternalStore, type ReactElement, type ReactNode, type Ref } from "react";
import type { Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";
import type { CurseForgeAuthStatus, ProviderInfo } from "./types";

/**
 * CurseForge's row in Options › Addon sources (#206): a `>` row that opens
 * the key modal while no key is usable, a toggle with the Options button
 * (≡) "API key" while the player's own key is in use, a plain toggle while
 * built-in access works. Closing the modal puts focus back on the row, also
 * when saving a key turned it into a toggle.
 */

mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

// showModal draws the modal in its own root, as Steam draws it in its own window.
let modalRoot: Root | null = null;
let modalsShown = 0;
type Actions = { onOptionsButton?: () => void; onOptionsActionDescription?: string };
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  QuickAccessTab: { Decky: 999 },
  // A row group: its footer's Options action is a hidden test handle.
  Focusable: ({
    children,
    ref,
    onOptionsButton,
    onOptionsActionDescription,
  }: Actions & { children: ReactNode; ref: Ref<HTMLDivElement> }) => (
    <div ref={ref} data-options={onOptionsActionDescription}>
      {onOptionsButton && (
        <button data-options-button="" onClick={onOptionsButton} hidden>
          {onOptionsActionDescription}
        </button>
      )}
      {children}
    </div>
  ),
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
      role="row"
      className={focusable ? "Focusable" : undefined}
      tabIndex={focusable ? -1 : undefined}
      aria-label={typeof label === "string" ? label : undefined}
      aria-disabled={disabled ? "true" : undefined}
      onClick={onClick}
    >
      <b>{label}</b>
      <i>{description}</i>
      {children}
    </div>
  ),
  ToggleField: ({
    label,
    description,
    disabled,
  }: {
    label?: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
  }) => (
    <button role="switch" className="Focusable" disabled={disabled}>
      {label}
      <small>{description}</small>
    </button>
  ),
  TextField: ({
    value,
    onChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
    />
  ),
  showModal: (element: ReactElement) => {
    modalsShown++;
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    modalRoot = createRoot(host);
    modalRoot.render(element);
    return {
      Close: () => {
        modalRoot?.unmount();
        host.remove();
        modalRoot = null;
      },
    };
  },
}));

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
const hub: ProviderInfo = { ...curse(true, true), id: "WowUpHub", requiresApiKey: false };

const calls: string[] = [];
let auth: CurseForgeAuthStatus;
// The engine's source list: a saved key makes CurseForge configured.
let engineProviders: ProviderInfo[] = [];
mock.module("./services/backend", () => ({
  rpc: async (method: string) => {
    calls.push(method);
    switch (method) {
      case "providers.testApiKey":
        return { ok: true };
      case "settings.set":
        engineProviders = [hub, curse(true, engineProviders[1]!.enabled)];
        return { settings: {} };
      case "providers.setEnabled":
        engineProviders = [hub, curse(true, true)];
        return { providers: engineProviders };
      case "providers.list":
        return { providers: engineProviders };
      case "curseforge.authStatus":
        return auth;
      case "tradeskillmaster.status":
        return { state: "signedOut" };
      default:
        return {};
    }
  },
}));

// The DOM exists before react-dom loads (it decides then whether it can
// listen for input events, and the key field needs them).
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
const { SourcesSection } = await import("./components/settings/SourcesSection");
const { sourcesStore, resetSourcesStore, loadSources } = await import("./sourcesStore");
const api = await import("./services/backend");
const { resetFocusMemory } = await import("./focusMemory");

// Stable, as SettingsView's useCallback: the section's polling effect depends on it.
const reloadProviders = () => loadSources(api.rpc);
function Sources() {
  const { providers } = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.get);
  return (
    <SourcesSection
      providers={providers}
      reloadProviders={reloadProviders}
      curseForgeAuth={auth}
      onCurseForgeKeyChanged={async () => {}}
    />
  );
}

const rejected: CurseForgeAuthStatus = {
  activeSource: "none",
  bundledPresent: true,
  bundledStatus: "invalid",
  userConfigured: false,
  userStatus: "unvalidated",
};
const ownKey: CurseForgeAuthStatus = {
  ...rejected,
  activeSource: "user",
  userConfigured: true,
  userStatus: "valid",
};
const builtIn: CurseForgeAuthStatus = {
  ...rejected,
  activeSource: "bundled",
  bundledStatus: "valid",
};

let root: Root;
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
beforeEach(() => {
  calls.length = 0;
  modalsShown = 0;
  resetFocusMemory(() => 0);
  resetSourcesStore();
  root = createRoot(doc.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => {
    modalRoot?.unmount();
    root.unmount();
  });
});

async function show(state: CurseForgeAuthStatus, configured: boolean, enabled = configured) {
  auth = state;
  engineProviders = [hub, curse(configured, enabled)];
  sourcesStore.patch({ providers: engineProviders, loaded: true });
  await act(async () => root.render(<Sources />));
}

const keyRow = () => doc.querySelector<HTMLElement>('[role="row"][aria-label="CurseForge"]');
const curseToggle = () =>
  [...doc.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((t) =>
    t.textContent?.startsWith("CurseForge"),
  ) ?? null;
const optionsAction = (el: HTMLElement) =>
  el.closest("[data-options]")?.getAttribute("data-options") ?? null;

describe("CurseForge's source row", () => {
  test("with no usable key it is a > row, not a toggle, and points nowhere else", async () => {
    await show(rejected, false);
    expect(keyRow()).not.toBeNull();
    expect(keyRow()!.className).toContain("Focusable");
    expect(curseToggle()).toBeNull();
    expect(doc.body.textContent).not.toContain("see CurseForge above");
  });

  test("the > row opens the key modal", async () => {
    await show(rejected, false);
    await act(async () => keyRow()!.click());
    expect(modalsShown).toBe(1);
    expect(doc.body.textContent).toContain("CurseForge API key");
  });

  test("with the player's own key it is a toggle whose Options button opens the key modal", async () => {
    await show(ownKey, true);
    expect(keyRow()).toBeNull();
    const toggle = curseToggle()!;
    expect(toggle.disabled).toBe(false);
    expect(optionsAction(toggle)).toBe("API key");
    const options = toggle
      .closest("[data-options]")!
      .querySelector<HTMLElement>("[data-options-button]")!;
    await act(async () => options.click());
    expect(modalsShown).toBe(1);
  });

  test("with working built-in access it is a plain toggle", async () => {
    await show(builtIn, true);
    expect(curseToggle()).not.toBeNull();
    expect(optionsAction(curseToggle()!)).toBeNull();
    expect(curseToggle()!.textContent).not.toContain("Using your API key");
  });

  test("saving a key turns CurseForge on and focus lands back on its row, now a toggle", async () => {
    await show(rejected, false, false);
    keyRow()!.focus();
    await act(async () => keyRow()!.click());
    const input = doc.querySelector<HTMLInputElement>('input[aria-label="CurseForge API key"]')!;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "my-key");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    auth = ownKey;
    const save = [...doc.querySelectorAll<HTMLElement>('[role="row"]')].find(
      (r) => r.getAttribute("aria-label") === "Save key",
    )!;
    await act(async () => save.click());
    expect(calls).toContain("providers.setEnabled");
    expect(modalRoot).toBeNull();
    expect(keyRow()).toBeNull();
    expect(doc.activeElement).toBe(curseToggle());
  });

  test("closing the modal without saving puts focus back on the > row", async () => {
    await show(rejected, false);
    await act(async () => keyRow()!.click());
    const close = [...doc.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    expect(modalRoot).toBeNull();
    expect(doc.activeElement).toBe(keyRow());
  });
});
