/**
 * When the player leaves Steam's browser (`Navigation.NavigateToExternalWeb`).
 *
 * Steam's main window keeps a history (`window.SteamUIStore.WindowStore
 * .GamepadUIMainWindowInstance.m_history`, React Router's history: `listen`
 * gets each location and its action). Guide G13: undocumented. DEVICE
 * 2026-11-26 (Deck, a listener in SharedJSContext): opening the browser
 * pushed `/externalweb` (then replaced it three times while the page
 * loaded); B popped back to the route behind it, `/library/app/<id>`.
 * Missing, `mainWindowHistory` returns null and the caller keeps its
 * fallback: the player comes back on their own.
 */

/** The part of Steam's history this module uses. */
export interface SteamHistory {
  location: { pathname: string };
  listen(listener: (location: { pathname: string }, action: string) => void): () => void;
}

/** Steam's main-window history, or null where Steam has none. */
export function mainWindowHistory(): SteamHistory | null {
  try {
    const history = (
      window as {
        SteamUIStore?: {
          WindowStore?: { GamepadUIMainWindowInstance?: { m_history?: Partial<SteamHistory> } };
        };
      }
    ).SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.m_history;
    return typeof history?.listen === "function" ? (history as SteamHistory) : null;
  } catch {
    return null;
  }
}

const inBrowser = (pathname: string) => pathname.endsWith("/externalweb");

/**
 * Call `onLeave` once, when the browser the caller is about to open closes:
 * `back` is true for B (Steam pops back to the route behind the browser),
 * false for any other way out (the Steam button opening Home). A browser
 * that never opens counts as left at once, without `back`, so the caller
 * never waits on it; the caller opens the browser right after this. `later`
 * schedules that check (tests pass their own). Returns the stop function.
 */
export function watchExternalWebLeave(
  history: SteamHistory,
  onLeave: (back: boolean) => void,
  later: (callback: () => void, ms: number) => unknown = setTimeout,
): () => void {
  let opened = inBrowser(history.location.pathname);
  let done = false;
  const finish = (back: boolean) => {
    if (done) return;
    done = true;
    stop();
    onLeave(back);
  };
  const stop = history.listen((location, action) => {
    if (inBrowser(location.pathname)) {
      opened = true;
    } else if (opened) {
      finish(action === "POP");
    }
  });
  // A browser still not open a second later never opened.
  later(() => {
    if (!opened) finish(false);
  }, 1000);
  return () => {
    done = true;
    stop();
  };
}
