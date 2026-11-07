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

const UNMANAGED = { name: "WDBundle", providerId: null, leavesUnneeded: [] };

/** The ConfirmModal props the shown modal passes on (RemoveConfirmModal wraps it). */
const shown = () =>
  modal!.props as Record<string, unknown> & { onOK(): void; onMiddleButton?(): void };

/** Mount the modal confirmRemoveAddon showed; the result unmounts it (OK, Cancel or B). */
async function showConfirm(): Promise<() => Promise<void>> {
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(modal!));
  return () => act(async () => root.unmount());
}

describe("Remove's confirmation and the browse session (MI-130-1)", () => {
  test("from Manual Install, the modal hiding the QAM is not a close until it shuts", async () => {
    enterBrowsePane();
    confirmRemoveAddon(UNMANAGED, () => {}, { holdBrowseSession: true });
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
    confirmRemoveAddon(UNMANAGED, () => {});
    qamHidden();
    expect(widening.wide).toBe(false);
  });
});

describe("Remove's choice about the libraries it leaves unneeded (#135)", () => {
  test("names them; OK, focused when it opens, keeps them, the middle button removes them too", () => {
    const chosen: boolean[] = [];
    confirmRemoveAddon(
      { name: "Baganator", providerId: "Curse", leavesUnneeded: ["Syndicator"] },
      (removeLibraries) => chosen.push(removeLibraries),
    );
    expect(shown().strDescription).toContain("Nothing else needs Syndicator");
    // Steam's ConfirmModal starts focus on its OK button.
    expect(shown().strOKButtonText).toBe("Remove Baganator only");
    expect(shown().strMiddleButtonText).toBe("Remove both");
    shown().onOK();
    shown().onMiddleButton!();
    expect(chosen).toEqual([false, true]);
  });

  test("with none, one Remove button, as before", () => {
    const chosen: boolean[] = [];
    confirmRemoveAddon({ name: "Bagnon", providerId: "Curse", leavesUnneeded: [] }, (r) =>
      chosen.push(r),
    );
    expect(shown().strOKButtonText).toBe("Remove");
    expect(shown().strMiddleButtonText).toBeUndefined();
    shown().onOK();
    expect(chosen).toEqual([false]);
  });
});
