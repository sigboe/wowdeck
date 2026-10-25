/**
 * Depends on: Steam's `window.SteamUIStore` keeping `RunningApps`,
 * `SetRunningApp(appid)` and `NavigateToRunningApp()` (what its own game
 * switcher does; read on the Deck 2026-10-22).
 * Fails as: returns false and nothing changes; the caller says where to look.
 */

interface RunningAppReach {
  RunningApps?: Array<{ appid?: unknown }> | null;
  SetRunningApp?: (appid: number) => void;
  NavigateToRunningApp?: () => void;
}

/**
 * Brings a running Steam app to the front, like picking it in Steam's game
 * switcher: Dolphin added as a non-Steam game, after Show opened a window
 * in it (WF-20). False when the app isn't running or Steam's store changed.
 */
export function switchToRunningApp(appId: number): boolean {
  try {
    const store = (window as { SteamUIStore?: RunningAppReach | null }).SteamUIStore;
    if (
      !store?.RunningApps?.some((a) => a.appid === appId) ||
      typeof store.SetRunningApp !== "function" ||
      typeof store.NavigateToRunningApp !== "function"
    ) {
      return false;
    }
    store.SetRunningApp(appId);
    store.NavigateToRunningApp();
    return true;
  } catch (err) {
    console.warn("wowdeck: can't switch to the running app", err);
    return false;
  }
}
