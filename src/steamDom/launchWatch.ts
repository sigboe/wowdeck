/**
 * Steam's GameSessions.RegisterForAppLifetimeNotifications reports shortcut
 * starts and stops ({ unAppID, bRunning }). Verified live on Deck in L-14.
 * When missing, prefix detection still supplies links.
 */

import { isLikelyWow, type SteamGame } from "../steamLibrary";

interface LaunchWatchDeps {
  steamClient: unknown;
  shortcuts: () => SteamGame[];
  /** Hand-set and detected shortcut IDs, regardless of auto-link settings. */
  linked: () => number[];
  accountId: () => Promise<number>;
  watch: (params: { appId: number; accountId?: number; running: boolean }) => Promise<unknown>;
}

interface LifetimeNotification {
  unAppID?: unknown;
  bRunning?: unknown;
}

interface GameSessions {
  RegisterForAppLifetimeNotifications?: (
    cb: (notification: LifetimeNotification) => void,
  ) => { unregister?: () => void } | undefined;
}

export function startLaunchWatch(deps: LaunchWatchDeps): () => void {
  const active = new Map<number, { started: boolean }>();
  let disposed = false;

  const stop = (appId: number) => {
    const launch = active.get(appId);
    active.delete(appId);
    if (launch?.started) void deps.watch({ appId, running: false }).catch(() => {});
  };

  const start = async (appId: number) => {
    const launch = { started: false };
    active.set(appId, launch);
    const accountId = await deps.accountId().catch(() => undefined);
    if (active.get(appId) !== launch) return;
    launch.started = true;
    await deps.watch({ appId, accountId, running: true });
  };

  let registration: ReturnType<NonNullable<GameSessions["RegisterForAppLifetimeNotifications"]>>;
  try {
    const sessions = (deps.steamClient as { GameSessions?: GameSessions } | undefined)
      ?.GameSessions;
    registration = sessions?.RegisterForAppLifetimeNotifications?.((notification) => {
      const appId = notification?.unAppID;
      if (disposed || typeof appId !== "number") return;
      if (notification.bRunning !== true) {
        stop(appId);
        return;
      }
      if (active.has(appId)) return;
      const shortcut = deps.shortcuts().find((game) => game.appId === appId);
      if (shortcut && (deps.linked().includes(appId) || isLikelyWow(shortcut.name))) {
        void start(appId).catch(() => {});
      }
    });
  } catch {
    // Steam can remove this undocumented API.
  }

  return () => {
    disposed = true;
    for (const appId of active.keys()) stop(appId);
    try {
      registration?.unregister?.();
    } catch {
      // Steam is going away with the plugin.
    }
  };
}
