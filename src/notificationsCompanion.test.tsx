/// <reference types="bun-types" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";
import type { Diagnostics, Installation, ProviderInfo } from "./types";

/**
 * Options › Notifications › Updates inside WoW (#208): the row takes D-pad
 * focus, keeps its place in focus memory, and offers WowUp Companion for the
 * active installation only.
 */

mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

let modal: ReactElement | null = null;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  // Focus memory's slot: Steam's onGamepadFocus fires when the row takes focus.
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
      <i>{description}</i>
      {children}
    </div>
  ),
  showModal: (element: ReactElement) => {
    modal = element;
    return { Close: () => {} };
  },
}));

const { NotificationsSection } = await import("./components/settings/NotificationsSection");
const { sourcesStore, resetSourcesStore } = await import("./sourcesStore");
const { rememberedFocus, resetFocusMemory } = await import("./focusMemory");
const { VIEW } = await import("./components/settings/common");

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
beforeEach(() => {
  modal = null;
  resetFocusMemory(() => 0);
  resetSourcesStore();
  root = createRoot(doc.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  resetSourcesStore();
});

const hub = (enabled: boolean) =>
  ({ id: "WowUpHub", name: "WowUp Hub", enabled, available: enabled }) as ProviderInfo;

const retail = { id: "r", displayName: "Retail" } as Installation;

const diagnostics = (retailHasIt: boolean) =>
  ({
    installations: [
      { id: "r", clientLabel: "Retail", path: "/r", companionAddonDetected: retailHasIt },
      { id: "c", clientLabel: "Classic", path: "/c", companionAddonDetected: false },
    ],
  }) as Diagnostics;

async function render(retailHasIt: boolean, hubOn = true) {
  sourcesStore.patch({ providers: [hub(hubOn)], loaded: true });
  await act(async () =>
    root.render(
      <NotificationsSection
        diagnostics={diagnostics(retailHasIt)}
        installation={retail}
        onChanged={async () => {}}
      />,
    ),
  );
  return doc.querySelector<HTMLElement>('[aria-label="Updates inside WoW"]')!;
}

const shown = () =>
  modal!.props as {
    strTitle?: string;
    strDescription?: string;
    strOKButtonText?: string;
    strCancelButtonText?: string;
    bAlertDialog?: boolean;
  };

describe("Updates inside WoW (#208)", () => {
  test("takes focus and keeps its place in focus memory", async () => {
    const row = await render(false);
    expect(row.className).toBe("Focusable");
    await act(async () => row.focus());
    expect(rememberedFocus(VIEW)).toBe("updatesInsideWow");
  });

  test("missing from the active installation: A asks to install it there", async () => {
    const row = await render(false);
    expect(row.textContent).toContain("Not installed in Retail and Classic");
    await act(async () => row.click());
    expect(rememberedFocus(VIEW)).toBe("updatesInsideWow");
    expect(shown().strTitle).toBe("Install WowUp Companion into Retail?");
    expect(shown().strOKButtonText).toBe("Install");
    expect(shown().strCancelButtonText).toBe("Cancel");
    expect(shown().bAlertDialog).toBeFalsy();
  });

  test("with WowUp Hub off, A explains how to turn it on and offers only Close", async () => {
    const row = await render(false, false);
    await act(async () => row.click());
    expect(shown().strDescription).toBe("Turn on WowUp Hub in Addon sources to install it.");
    expect(shown().strOKButtonText).toBe("Close");
    expect(shown().bAlertDialog).toBe(true);
    expect(sourcesStore.get().providers![0].enabled).toBe(false);
  });

  test("already in the active installation: says so, still names the others, A does nothing", async () => {
    const row = await render(true);
    expect(row.textContent).toContain("Installed in Retail");
    expect(row.textContent).toContain("Not installed in Classic");
    await act(async () => row.click());
    expect(modal).toBeNull();
  });
});
