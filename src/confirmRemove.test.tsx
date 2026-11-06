import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";

let modal: ReactElement | null = null;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  ConfirmModal: () => null,
  showModal: (element: ReactElement) => {
    modal = element;
    return { Close: () => {} };
  },
}));

const { confirmRemoveAddon } = await import("./components/confirmRemove");
const { browseZone, enterBrowsePane, leaveBrowseSession, qamHidden, widening } =
  await import("./browseSessionState");

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;
beforeAll(() => {
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
afterEach(() => {
  modal = null;
  leaveBrowseSession();
});

/** Mount the modal confirmRemoveAddon showed; the result unmounts it (OK, Cancel or B). */
async function showConfirm(): Promise<() => Promise<void>> {
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(modal!));
  return () => act(async () => root.unmount());
}

describe("Remove's confirmation and the browse session (MI-130-1)", () => {
  test("from Manual Install, the modal hiding the QAM is not a close until it shuts", async () => {
    enterBrowsePane();
    confirmRemoveAddon("WDBundle", false, () => {}, [], { holdBrowseSession: true });
    const close = await showConfirm();
    qamHidden();
    expect(widening.wide).toBe(true);
    expect(browseZone.zone).toBe("pane");

    await close();
    qamHidden();
    expect(widening.wide).toBe(false);
    expect(browseZone.zone).toBe("nav");
  });

  test("from My Addons, no hold is taken", async () => {
    enterBrowsePane();
    confirmRemoveAddon("WDBundle", false, () => {});
    qamHidden();
    expect(widening.wide).toBe(false);
  });
});
