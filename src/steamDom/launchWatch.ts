/**
 * Depends on: `SteamClient.GameSessions.RegisterForAppLifetimeNotifications`
 * (`{ unAppID, bRunning }` as an app starts and stops; what Decky plugins
 * that track play time use), `SteamUIStore.RunningApps` (the running-apps
 * store; runningApp.ts) and Steam's library (`listSteamShortcuts`).
 * Fails as: no notification -> no proven link is recorded; links found
 * from the Wine prefix still work. Never throws.
 * Verified: INFERRED. The notification shape is what play-time plugins
 * read; a device run (#279, regression row L-14) still has to confirm that
 * a shortcut start notifies with the shortcut's app id. `RunningApps` is
 * LIVE (runningApp.ts, 2026-10-22).
 * Kill switch: none needed; it only reads Steam, and the engine records a
 * link only when WoW runs from a listed installation. Drop the
 * startLaunchWatch call in index.tsx.
 */

import type { Clock } from "../clock";
import type { SteamGame } from "../steamLibrary";

/** How often, and for how long after a shortcut starts, the engine looks for WoW. */
export const LOOK_EVERY_MS = 15_000;
/**
 * A shortcut often opens Battle.net, and WoW only starts when the player
 * presses Play there: the engine looks again for this long.
 */
export const LOOK_FOR_MS = 10 * 60_000;
const MAX_LOOKS = 1 + LOOK_FOR_MS / LOOK_EVERY_MS;

export interface LaunchWatchDeps {
  /** `globalThis.SteamClient`. */
  steamClient: unknown;
  /** App ids Steam lists as running now; null when it can't be read. */
  runningApps: () => number[] | null;
  /** Non-Steam shortcuts in the library. */
  shortcuts: () => SteamGame[];
  /** The Steam account signed in now. */
  accountId: () => Promise<number>;
  /** `installations.recordLaunch`: one look at the running processes. */
  record: (params: { appId: number; accountId?: number }) => Promise<{ recorded: boolean }>;
  /** A proven link was recorded: read the installations again. */
  recorded: () => void;
  clock: Clock;
}

interface LifetimeNotification {
  unAppID?: unknown;
  bRunning?: unknown;
}

interface GameSessions {
  RegisterForAppLifetimeNotifications?: (
    cb: (n: LifetimeNotification) => void,
  ) => { unregister?: () => void } | undefined;
}

let warned = false;
function warnOnce(what: string, err?: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`wowdeck: shortcut launches not watched (${what})`, err ?? "");
  }
}

/**
 * Proven links (GLOSSARY): when a non-Steam shortcut starts, ask the engine
 * to look for WoW launched through it (`installations.recordLaunch`), now
 * and every LOOK_EVERY_MS while the shortcut runs, for at most LOOK_FOR_MS
 * or until a link is recorded. Nothing runs between shortcut starts.
 * Starts at plugin load (definePlugin), like the home badge.
 */
export function startLaunchWatch(deps: LaunchWatchDeps): () => void {
  const looking = new Map<number, unknown>();

  const stopLooking = (appId: number) => {
    if (!looking.has(appId)) return;
    deps.clock.clearInterval(looking.get(appId));
    looking.delete(appId);
  };

  const startLooking = (appId: number) => {
    // Unknown account: the engine takes the shortcut from any account.
    const account = deps.accountId().then(
      (id) => id,
      () => undefined,
    );
    let looks = 0;
    let busy = false;
    const look = async () => {
      if (busy || !looking.has(appId)) return;
      const running = deps.runningApps();
      if (looks >= MAX_LOOKS || (looks > 0 && running && !running.includes(appId))) {
        stopLooking(appId);
        return;
      }
      looks += 1;
      busy = true;
      try {
        const accountId = await account;
        const { recorded } = await deps.record(
          accountId === undefined ? { appId } : { appId, accountId },
        );
        if (recorded && looking.has(appId)) {
          stopLooking(appId);
          deps.recorded();
        }
      } catch {
        // The engine may be busy or restarting; the next look asks again.
      } finally {
        busy = false;
      }
    };
    looking.set(
      appId,
      deps.clock.setInterval(() => void look(), LOOK_EVERY_MS),
    );
    void look();
  };

  let registration: { unregister?: () => void } | undefined;
  try {
    const sessions = (deps.steamClient as { GameSessions?: GameSessions } | undefined)
      ?.GameSessions;
    if (typeof sessions?.RegisterForAppLifetimeNotifications !== "function") {
      warnOnce("no app lifetime notifications");
      return () => {};
    }
    registration = sessions.RegisterForAppLifetimeNotifications((n) => {
      try {
        const appId = n?.unAppID;
        if (typeof appId !== "number") return;
        if (n.bRunning !== true) {
          stopLooking(appId);
          return;
        }
        if (looking.has(appId) || !deps.shortcuts().some((g) => g.appId === appId)) return;
        startLooking(appId);
      } catch (err) {
        warnOnce("notification", err);
      }
    });
  } catch (err) {
    warnOnce("register", err);
  }
  return () => {
    for (const appId of [...looking.keys()]) stopLooking(appId);
    try {
      registration?.unregister?.();
    } catch {
      // Steam is going away with the plugin.
    }
  };
}

/** The running-apps store's app ids (runningApp.ts reads the same store). */
export function steamRunningApps(): number[] | null {
  try {
    const apps = (window as { SteamUIStore?: { RunningApps?: Array<{ appid?: unknown }> | null } })
      .SteamUIStore?.RunningApps;
    return Array.isArray(apps)
      ? apps.flatMap((a) => (typeof a.appid === "number" ? [a.appid] : []))
      : null;
  } catch {
    return null;
  }
}
