/**
 * Depends on: SteamUI's gamepad navigation trees (`GamepadNavTree` /
 * `FocusNavController`, a tree id starting `QuickAccess`), the QAM window's
 * `visibilitychange`, the virtual keyboard manager
 * (`SteamUIStore.WindowStore.GamepadUIMainWindowInstance`), and Decky's
 * active plugin state (`DeckyPluginLoader.deckyState`).
 * Fails as: any of it missing -> the watch starts as a no-op; closing and
 * reopening the QAM may then keep Get Addons widened. Never throws.
 * Kill switch: the no-op fallback above.
 */

/**
 * QAM visibility watch (UI-02 story 33, ticket 06): when the Quick Access
 * Menu closes, the browse session has ended — the next open must show Get
 * Addons collapsed on the nav bar. Module state survives the close (the
 * machine is module scope on purpose, so a modal round-trip keeps widened
 * mode, guide G4), and the panel unmounts when the QAM closes exactly the way
 * it unmounts around a modal, so no component-level hook is there to catch
 * the close. This watch starts at plugin-load scope (definePlugin's factory,
 * like the home badge) and collapses the browse session whenever the QAM
 * window reports itself hidden.
 *
 * Window reach, documented per guide G13 — these are SteamUI globals this
 * plugin reaches through: `window.GamepadNavTree.m_context.m_controller` (or
 * `window.FocusNavController`) → `.m_ActiveContext` / `.m_LastActiveContext`
 * → `.m_rgGamepadNavigationTrees` → the tree whose id starts with
 * `QuickAccess` → `m_Root.m_element.ownerDocument.defaultView`. LIVE: this is
 * exactly the reach of @decky/ui's own `useQuickAccessVisible`
 * (custom-hooks/useQuickAccessVisible.js), which compiles against the
 * installed library; not yet re-proven on this device's Steam build — the
 * widened-mode regression drill covers it. If any of it is missing or changed
 * (Steam update, loader difference), the watch silently starts as no-op and
 * the close/reopen case degrades, never throws (ticket 06's fallback).
 */

import { leaveBrowseSession, qamHidden, qamShown } from "../browseSessionState";

/** The tree id is a prefix-matched name, not one built id: Steam hashes/suffixed it. */
const QUICK_ACCESS_TREE_PREFIX = "QuickAccess";

let warned = false;
function warnOnce(what: string, err?: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`wowdeck: QAM close collapse not watched (${what})`, err ?? "");
  }
}

interface QuickAccessWin {
  document?: { hidden?: boolean } | null;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

/** Resolve the QuickAccess window the same way @decky/ui's hook does. */
function findQuickAccessWindow(): QuickAccessWin | null {
  try {
    const steam = window as {
      GamepadNavTree?: {
        m_context?: { m_controller?: unknown } | null;
      } | null;
      FocusNavController?: unknown;
    };
    const focusNav = steam.GamepadNavTree?.m_context?.m_controller ?? steam.FocusNavController;
    const roots = focusNav as
      | {
          m_ActiveContext?: unknown;
          m_LastActiveContext?: unknown;
        }
      | null
      | undefined;
    const context = (roots?.m_ActiveContext ?? roots?.m_LastActiveContext) as
      | {
          m_rgGamepadNavigationTrees?: unknown;
        }
      | null
      | undefined;
    for (const tree of Array.from(
      (context?.m_rgGamepadNavigationTrees as ArrayLike<unknown>) ?? [],
    )) {
      const t = tree as {
        id?: unknown;
        m_Root?: { m_element?: { ownerDocument?: { defaultView?: unknown } | null } | null };
      };
      if (typeof t?.id !== "string" || !t.id.startsWith(QUICK_ACCESS_TREE_PREFIX)) {
        continue;
      }
      const win = t.m_Root?.m_element?.ownerDocument?.defaultView as QuickAccessWin | null;
      if (win && typeof win.addEventListener === "function") {
        return win;
      }
    }
  } catch (err) {
    warnOnce("quick access window not found", err);
  }
  return null;
}

/**
 * Start watching the QAM visibility until the returned stopper runs (the
 * plugin unload's teardown). When the QAM hides, the browse session ends:
 * widened mode collapses, the pane's last addon is cleared, and re-entry
 * lands on the nav bar (browseSessionState.leaveBrowseSession). On windows
 * where the reach fails, the stopper is still returned and nothing else
 * happens.
 */
export function startQamVisibilityWatch(): () => void {
  const qamWindow = findQuickAccessWindow();
  if (!qamWindow) {
    warnOnce("no quick access window");
    return () => {};
  }
  let stopped = false;
  const onHide = () => {
    if (stopped) {
      return;
    }
    try {
      if (qamWindow.document?.hidden) {
        qamHidden();
      } else {
        qamShown();
      }
    } catch (err) {
      warnOnce("close handler failed", err);
    }
  };
  try {
    qamWindow.addEventListener!("visibilitychange", onHide);
  } catch (err) {
    warnOnce("visibility listener failed", err);
    return () => {};
  }
  return () => {
    stopped = true;
    try {
      qamWindow.removeEventListener!("visibilitychange", onHide);
    } catch {
      // nothing left to detach
    }
  };
}

/**
 * Whether Steam's on-screen keyboard is up. B then closes the keyboard, but
 * the press also reaches the focused text field, so Get Addons must not take
 * it as "B out of the pane" (DEVICE 2026-10-20).
 *
 * Window reach (guide G13): `window.SteamUIStore.WindowStore
 * .GamepadUIMainWindowInstance.m_VirtualKeyboardManager
 * .m_bIsVirtualKeyboardShowing.m_currentValue` (a SteamUI observable; read on
 * the Deck 2026-10-20). Missing or changed, this reports false: B keeps
 * collapsing, as before.
 */
export function isVirtualKeyboardShowing(): boolean {
  try {
    const steam = window as {
      SteamUIStore?: {
        WindowStore?: {
          GamepadUIMainWindowInstance?: {
            m_VirtualKeyboardManager?: {
              m_bIsVirtualKeyboardShowing?: { m_currentValue?: unknown } | null;
            } | null;
          } | null;
        } | null;
      } | null;
    };
    const showing =
      steam.SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.m_VirtualKeyboardManager
        ?.m_bIsVirtualKeyboardShowing?.m_currentValue;
    return showing === true;
  } catch (err) {
    warnOnce("keyboard state not reachable", err);
    return false;
  }
}

interface DeckyStateReach {
  eventBus?: EventTarget | null;
  publicState?: () => { activePlugin?: { name?: unknown } | null };
}

/**
 * Leaving the plugin ends the browse session too: Decky's title-bar Back pip
 * (and Decky's own B) call `deckyState.closeActivePlugin()`, which unmounts
 * the panel exactly like a modal round-trip (G4) and passes through none of
 * our handlers, so the widened QAM stayed open over Decky's plugin list.
 * The difference from a modal is Decky's active plugin: when it stops being
 * ours, collapse (browseSessionState.leaveBrowseSession).
 *
 * Window reach (guide G13): `window.DeckyPluginLoader.deckyState` —
 * `eventBus` dispatches `"update"` on every change and `publicState()`
 * carries `activePlugin` (decky-loader frontend DeckyState.tsx; the same
 * object WowGameSection's `setActivePlugin` uses). Missing or changed, the
 * watch silently does nothing and never throws.
 */
export function startPluginExitWatch(pluginName: string): () => void {
  let state: DeckyStateReach | null | undefined;
  try {
    state = (window as { DeckyPluginLoader?: { deckyState?: DeckyStateReach | null } })
      .DeckyPluginLoader?.deckyState;
  } catch (err) {
    warnOnce("decky state not reachable", err);
    return () => {};
  }
  const bus = state?.eventBus;
  const publicState = state?.publicState?.bind(state);
  if (!publicState || !bus) {
    warnOnce("no decky state");
    return () => {};
  }
  const ours = (): boolean => {
    try {
      return publicState().activePlugin?.name === pluginName;
    } catch (err) {
      warnOnce("decky state read failed", err);
      return false;
    }
  };
  let wasOurs = ours();
  const onUpdate = () => {
    const isOurs = ours();
    if (wasOurs && !isOurs) {
      leaveBrowseSession();
    }
    wasOurs = isOurs;
  };
  try {
    bus.addEventListener("update", onUpdate);
  } catch (err) {
    warnOnce("decky state listener failed", err);
    return () => {};
  }
  return () => {
    try {
      bus.removeEventListener("update", onUpdate);
    } catch {
      // nothing left to detach
    }
  };
}
