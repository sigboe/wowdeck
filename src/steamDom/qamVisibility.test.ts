/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// QAM close/reopen collapse (UI-02 story 33, ticket 06): when the QAM hides,
// the browse session has ended — the next open must show Get Addons collapsed
// on the nav bar. The watch lives at plugin-load scope because the panel
// unmounts when the QAM closes the same way it unmounts around a modal (G4):
// a component-level hook cannot be there when the close fires. The window
// reach is the same one @decky/ui's own useQuickAccessVisible resolves —
// the QuickAccess navigation tree's element's document — taken defensively
// so a Steam change degrades to "no watch" instead of an error.

/** Minimal QuickAccess-window stand-in: document.hidden plus listeners. */
function fakeQamWindow() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    document: { hidden: false },
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(hidden: boolean) {
      this.document.hidden = hidden;
      for (const fn of listeners.get("visibilitychange") ?? []) fn();
    },
  };
}

/** A gamepad nav-tree forest like Steam's, for the defensive reach. */
function navTreeWindowElement(qamWindow: object, treeId: string): object {
  return {
    id: treeId,
    m_Root: { m_element: { ownerDocument: { defaultView: qamWindow } } },
  };
}

const machine = await import("../browseSessionState");
const { isVirtualKeyboardShowing, startPluginExitWatch, startQamVisibilityWatch } =
  await import("./qamVisibility");

/** The widened mid-browse state a QAM close can interrupt. */
function openWidenedSession(): void {
  machine.resetBrowseSessionState();
  machine.widening.wide = false;
  machine.focusDestination("latest");
}

beforeEach(() => {
  machine.resetBrowseSessionState();
  machine.widening.wide = false;
  machine.pageState.tab = "search";
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("QAM close collapse (UI-02 story 33)", () => {
  test("the details carousel hiding the QAM is not a close (PC-09)", () => {
    const qamWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: {
              m_rgGamepadNavigationTrees: [navTreeWindowElement(qamWindow, "QuickAccess_uid2")],
            },
          },
        },
      },
    };
    openWidenedSession();
    machine.enterBrowsePane();
    const stop = startQamVisibilityWatch();

    const release = machine.holdBrowseSessionForModal();
    qamWindow.fire(true);
    expect(machine.widening.wide).toBe(true);
    release();
    qamWindow.fire(false);
    // The panel remounts after the modal: back in the pane.
    expect(machine.enterBrowseSession()).toBe("pane");

    // With the modal gone, a hide is a real close again.
    qamWindow.fire(true);
    expect(machine.widening.wide).toBe(false);
    release(); // idempotent: never goes below zero
    qamWindow.fire(true);
    expect(machine.browseZone.zone).toBe("nav");
    stop();
  });

  test("a menu opened from Get Addons hiding the QAM is not a close (GA-9)", () => {
    const qamWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: {
              m_rgGamepadNavigationTrees: [navTreeWindowElement(qamWindow, "QuickAccess_uid2")],
            },
          },
        },
      },
    };
    openWidenedSession();
    machine.enterBrowsePane();
    const stop = startQamVisibilityWatch();

    machine.popupOpening(); // the Category menu
    qamWindow.fire(true);
    expect(machine.widening.wide).toBe(true);
    qamWindow.fire(false); // picked or cancelled: the QAM shows again
    expect(machine.enterBrowseSession()).toBe("pane");

    // Showing again cleared it: the next hide is a real close.
    qamWindow.fire(true);
    expect(machine.widening.wide).toBe(false);
    expect(machine.browseZone.zone).toBe("nav");
    stop();
  });

  test("a QAM close ends the browse session: collapsed and on the nav bar", () => {
    const qamWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: {
              m_rgGamepadNavigationTrees: [navTreeWindowElement(qamWindow, "QuickAccess_uid2")],
            },
          },
        },
      },
    };
    openWidenedSession();
    expect(machine.widening.wide).toBe(true);

    const stop = startQamVisibilityWatch();
    qamWindow.fire(true);

    expect(machine.widening.wide).toBe(false);
    expect(machine.browseZone.zone).toBe("nav");
    stop();
  });

  test("the QAM reappearing alone never widens", () => {
    const qamWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: {
              m_rgGamepadNavigationTrees: [navTreeWindowElement(qamWindow, "QuickAccess_uid2")],
            },
          },
        },
      },
    };
    openWidenedSession();
    const stop = startQamVisibilityWatch();
    qamWindow.fire(true); // close
    qamWindow.fire(false); // reopen — mounting Get Addons lands, no widening from this

    expect(machine.widening.wide).toBe(false);
    stop();
  });

  test("finding the tree is by name prefix, not one hashed id", () => {
    const qamWindow = fakeQamWindow();
    const friendsWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_LastActiveContext: {
              m_rgGamepadNavigationTrees: [
                navTreeWindowElement(friendsWindow, "Friends_u1"),
                navTreeWindowElement(qamWindow, "QuickAccess_NA1"),
              ],
            },
          },
        },
      },
    };
    openWidenedSession();
    const stop = startQamVisibilityWatch();
    qamWindow.fire(true);

    expect(machine.widening.wide).toBe(false);
    expect(friendsWindow.document.hidden).toBe(false);
    stop();
  });

  test("stopping the watch undoes it: a close changes nothing", () => {
    const qamWindow = fakeQamWindow();
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: {
              m_rgGamepadNavigationTrees: [navTreeWindowElement(qamWindow, "QuickAccess_uid2")],
            },
          },
        },
      },
    };
    const stop = startQamVisibilityWatch();
    stop();
    openWidenedSession();
    qamWindow.fire(true);

    expect(machine.widening.wide).toBe(true);
  });
});

describe("resilience: the reach can fail in every way (never a throw)", () => {
  test("no window at all — a bare world", () => {
    openWidenedSession();
    const stop = startQamVisibilityWatch();
    expect(typeof stop).toBe("function");
    stop();
  });

  test("no nav-tree registry on the window", () => {
    (globalThis as { window?: unknown }).window = {};
    const stop = startQamVisibilityWatch();
    expect(typeof stop).toBe("function");
    stop();
  });

  test("empty forest, and a QuickAccess tree without an element", () => {
    (globalThis as { window?: unknown }).window = {
      GamepadNavTree: {
        m_context: {
          m_controller: {
            m_ActiveContext: { m_rgGamepadNavigationTrees: [{ id: "QuickAccess_x" }, []] },
          },
        },
      },
    };
    const stop = startQamVisibilityWatch();
    expect(typeof stop).toBe("function");
    stop();
  });

  test("a registry that explodes stays silent", () => {
    (globalThis as { window?: unknown }).window = {
      get GamepadNavTree() {
        throw new Error("steam changed");
      },
    };
    const stop = startQamVisibilityWatch();
    expect(typeof stop).toBe("function");
    stop();
  });
});

describe("leaving the plugin collapses (Decky's title-bar Back)", () => {
  /** Decky's DeckyState shape: an EventTarget bus plus publicState().activePlugin. */
  function fakeDeckyState(active: string | null) {
    const eventBus = new EventTarget();
    const state = {
      active,
      eventBus,
      publicState: () => ({ activePlugin: state.active ? { name: state.active } : null }),
      set(next: string | null) {
        state.active = next;
        eventBus.dispatchEvent(new Event("update"));
      },
    };
    (globalThis as { window?: unknown }).window = { DeckyPluginLoader: { deckyState: state } };
    return state;
  }

  test("closing our plugin ends the browse session", () => {
    const decky = fakeDeckyState("WoWDeck");
    const stop = startPluginExitWatch("WoWDeck");
    openWidenedSession();
    expect(machine.widening.wide).toBe(true);
    decky.set(null); // closeActivePlugin(): the Back pip
    expect(machine.widening.wide).toBe(false);
    stop();
  });

  test("updates that keep our plugin active (a modal round-trip) change nothing", () => {
    const decky = fakeDeckyState("WoWDeck");
    const stop = startPluginExitWatch("WoWDeck");
    openWidenedSession();
    decky.set("WoWDeck");
    expect(machine.widening.wide).toBe(true);
    stop();
  });

  test("stopping the watch undoes it", () => {
    const decky = fakeDeckyState("WoWDeck");
    startPluginExitWatch("WoWDeck")();
    openWidenedSession();
    decky.set(null);
    expect(machine.widening.wide).toBe(true);
  });

  test("no Decky state at all stays silent", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => startPluginExitWatch("WoWDeck")()).not.toThrow();
  });
});

describe("on-screen keyboard state", () => {
  test("reads Steam's keyboard observable", () => {
    const keyboard = { m_bIsVirtualKeyboardShowing: { m_currentValue: true } };
    (globalThis as { window?: unknown }).window = {
      SteamUIStore: {
        WindowStore: { GamepadUIMainWindowInstance: { m_VirtualKeyboardManager: keyboard } },
      },
    };
    expect(isVirtualKeyboardShowing()).toBe(true);
    keyboard.m_bIsVirtualKeyboardShowing.m_currentValue = false;
    expect(isVirtualKeyboardShowing()).toBe(false);
  });

  test("anything missing reads as no keyboard, never a throw", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isVirtualKeyboardShowing()).toBe(false);
    (globalThis as { window?: unknown }).window = {
      get SteamUIStore(): never {
        throw new Error("boom");
      },
    };
    expect(isVirtualKeyboardShowing()).toBe(false);
  });
});
