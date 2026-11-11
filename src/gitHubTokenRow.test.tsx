/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode, type Ref } from "react";
import type { Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";
import type { ProviderInfo } from "./types";

/**
 * Options › Addon sources › GitHub (#205): the last row of the section opens
 * the token modal; the token is checked before it is stored. The fake engine
 * behind `rpc` answers settings and providers.testApiKey.
 */

type Call = { method: string; params?: Record<string, unknown> };
const calls: Call[] = [];
let storedToken: string | null = null;
let tokenCheck = { ok: true, httpStatus: 200, message: "OK" };
const engine = async (method: string, params?: Record<string, unknown>) => {
  calls.push({ method, params });
  if (method === "settings.get") return { settings: { githubAccessToken: storedToken } };
  if (method === "settings.set") {
    const patch = params!.settings as { githubAccessToken?: string | null };
    if ("githubAccessToken" in patch) storedToken = patch.githubAccessToken ?? null;
    // The engine redacts tokens in its answer.
    return { settings: { githubAccessToken: storedToken ? "********" : null } };
  }
  if (method === "providers.testApiKey") return tokenCheck;
  if (method === "tradeskillmaster.status") return { state: "signedOut", account: null };
  return {};
};
const toasts: string[] = [];
mock.module("@decky/api", () => ({
  callable: () => engine,
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
  QuickAccessTab: {},
  Router: {},
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
      data-row={String(label)}
      onClick={onClick}
    >
      <b>{label}</b>
      <i>{description}</i>
      {children}
    </div>
  ),
  ToggleField: ({ label }: { label?: ReactNode }) => (
    <div data-row={String(label)} data-toggle="true" />
  ),
  TextField: ({
    label,
    description,
    value,
    onChange,
    type,
  }: {
    label?: ReactNode;
    description?: ReactNode;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    type?: string;
  }) => (
    <label>
      {description}
      <input
        aria-label={String(label)}
        type={type}
        value={value}
        onChange={(e) => onChange?.({ target: { value: e.target.value } })}
      />
    </label>
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

const dom = new JSDOM('<div id="root"></div><div id="modal"></div>');
const doc = dom.window.document;
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
// Before React DOM loads: it decides at import whether input events exist.
env.window = dom.window;
env.document = doc;
env.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const { SourcesSection } = await import("./components/settings/SourcesSection");
const { settingsStore } = await import("./settings");
const { resetFocusMemory, restoreFocus } = await import("./focusMemory");
const { VIEW } = await import("./components/settings/common");

const provider = (id: string, allowEdit = true): ProviderInfo => ({
  id,
  name: id,
  enabled: true,
  available: true,
  requiresApiKey: false,
  configured: true,
  allowEdit,
  catalogSearch: true,
  discovers: false,
});
const providers = [provider("WowUpHub"), provider("GitHub", false), provider("WowInterface")];

let root: Root;
let modalRoot: Root | null = null;

afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});

const renderSection = async () => {
  root = createRoot(doc.getElementById("root")!);
  await act(async () =>
    root.render(
      <SourcesSection
        providers={providers}
        reloadProviders={async () => {}}
        curseForgeAuth={null}
        onCurseForgeKeyChanged={async () => {}}
      />,
    ),
  );
};
const startWith = async (token: string | null) => {
  storedToken = token;
  await settingsStore.load();
  await renderSection();
};

beforeEach(() => {
  resetFocusMemory(() => 0);
  calls.length = 0;
  toasts.length = 0;
  modal = null;
  tokenCheck = { ok: true, httpStatus: 200, message: "OK" };
});
afterEach(async () => {
  await act(async () => root.unmount());
  if (modalRoot) {
    const r = modalRoot;
    await act(async () => r.unmount());
    modalRoot = null;
  }
});

const rows = () =>
  [...doc.querySelectorAll("#root [data-row]")].map((r) => r.getAttribute("data-row"));
const gitHubRow = () => doc.querySelector<HTMLElement>('#root [data-row="GitHub"]')!;
const openModal = async () => {
  await act(async () => gitHubRow().click());
  expect(modal).not.toBeNull();
  modalRoot = createRoot(doc.getElementById("modal")!);
  const r = modalRoot;
  await act(async () => r.render(modal!));
};
const inModal = (text: string) =>
  [...doc.querySelectorAll<HTMLButtonElement>("#modal button")].find(
    (b) => b.textContent === text,
  ) ?? null;
const typeToken = async (value: string) => {
  const input = doc.querySelector<HTMLInputElement>("#modal input")!;
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};

describe("the GitHub row in Addon sources", () => {
  test("is the last row, after the editable providers, and never a toggle", async () => {
    await startWith(null);
    expect(rows()).toEqual(["WowUp Hub", "WoWInterface", "GitHub"]);
    expect(gitHubRow().getAttribute("data-toggle")).toBeNull();
  });

  test("says it works without a token when none is saved", async () => {
    await startWith(null);
    expect(gitHubRow().textContent).not.toContain("No token, works without one");
  });

  test("omits token help text when one is saved", async () => {
    await startWith("ghp_saved");
    expect(gitHubRow().textContent).not.toContain("Using your token");
  });
});

describe("the GitHub token modal", () => {
  test("has a password field and Save, and no Remove token without a token", async () => {
    await startWith(null);
    await openModal();
    expect(doc.querySelector<HTMLInputElement>("#modal input")!.type).toBe("password");
    expect(inModal("Save")).not.toBeNull();
    expect(inModal("Remove token")).toBeNull();
  });

  test("checks the token before saving it, then updates the row", async () => {
    await startWith(null);
    await openModal();
    await typeToken("  ghp_new  ");
    await act(async () => inModal("Save")!.click());
    const methods = calls.map((c) => c.method);
    expect(methods.indexOf("providers.testApiKey")).toBeLessThan(methods.indexOf("settings.set"));
    expect(calls.find((c) => c.method === "providers.testApiKey")!.params).toEqual({
      providerId: "GitHub",
      apiKey: "ghp_new",
    });
    expect(storedToken).toBe("ghp_new");
    expect(modalClosed).toBe(true);
    expect(gitHubRow().textContent).not.toContain("Using your token");
  });

  test("does not save a token GitHub rejects and says why in the modal", async () => {
    tokenCheck = { ok: false, httpStatus: 401, message: "Bad credentials" };
    await startWith(null);
    await openModal();
    await typeToken("ghp_bad");
    await act(async () => inModal("Save")!.click());
    expect(calls.some((c) => c.method === "settings.set")).toBe(false);
    expect(storedToken).toBeNull();
    expect(modalClosed).toBe(false);
    expect(doc.getElementById("modal")!.textContent).toContain("Bad credentials");
    // The token stays in the field to correct or try again.
    expect(doc.querySelector<HTMLInputElement>("#modal input")!.value).toBe("ghp_bad");
    expect(gitHubRow().textContent).not.toContain("No token, works without one");
  });

  test("Save stays disabled until a token is typed", async () => {
    await startWith(null);
    await openModal();
    expect(inModal("Save")!.disabled).toBe(true);
    await typeToken("ghp_x");
    expect(inModal("Save")!.disabled).toBe(false);
  });

  test("offers Remove token when one is saved, and clearing updates the row", async () => {
    await startWith("ghp_saved");
    await openModal();
    await act(async () => inModal("Remove token")!.click());
    expect(storedToken).toBeNull();
    expect(modalClosed).toBe(true);
    expect(gitHubRow().textContent).not.toContain("No token, works without one");
  });
});

describe("focus after the modal (guide S21)", () => {
  test("returns to the GitHub row when the panel comes back", async () => {
    await startWith(null);
    await act(async () => gitHubRow().click());
    // showModal unmounts the panel (guide G4); Options remounts and restores.
    await act(async () => root.unmount());
    await renderSection();
    await act(async () => {
      restoreFocus(VIEW);
    });
    expect(doc.activeElement).toBe(gitHubRow());
  });
});
