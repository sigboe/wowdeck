import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import { createLaunchActions } from "./steamLaunch";
import { pluginToast } from "./toast";

/**
 * Steam is starting or running the entry on this device. G13: Running (4)
 * was observed on Deck. Launching (1) is inferred from Steam's app overview
 * schema and bridges the gap before a reaper appears. See
 * docs/ui/device-notes.md §8.4d. Missing data falls back to the engine.
 */
export function steamEntryRunning(overview: unknown): boolean {
  const status = (overview as { local_per_client_data?: { display_status?: unknown } } | null)
    ?.local_per_client_data?.display_status;
  return status === 1 || status === 4;
}

/**
 * Point Steam's Play at one of the app's clients, as Steam's own "Play
 * from…" rows do. G13: `SetStreamingClientForApp(appId, clientId)` is what
 * Steam's menu calls (Steam UI source, 2026-11-18; INFERRED for our rows
 * until a Deck run). Missing, it does nothing: Play keeps Steam's choice.
 */
export function setSteamStreamingClient(appId: number, clientId: unknown): void {
  const apps = window.SteamClient?.Apps as
    { SetStreamingClientForApp?: (appId: number, clientId: unknown) => void } | undefined;
  if (typeof apps?.SetStreamingClientForApp !== "function") return;
  try {
    apps.SetStreamingClientForApp(appId, clientId);
  } catch {
    console.warn("wowdeck: couldn't switch Steam's Play back to this device");
  }
}

// DEVICE 2026-11-18: a shortcut launches with its decimal game ID string.
// Without RunGame, only the already-running Battle.net path is available.
// See docs/hardware/2026-11-18-steam-launch-delivery.
export const steamLaunch = createLaunchActions(engine.rpc, engine.events, pluginToast, {
  getRunGame() {
    const apps = window.SteamClient?.Apps;
    return typeof apps?.RunGame === "function" ? apps.RunGame.bind(apps) : undefined;
  },
  isStartingOrRunning(appId) {
    try {
      const store = window.appStore;
      if (typeof store?.GetAppOverviewByAppID !== "function") return false;
      return steamEntryRunning(store.GetAppOverviewByAppID(appId));
    } catch {
      return false;
    }
  },
  onError(handler) {
    const apps = window.SteamClient?.Apps;
    if (typeof apps?.RegisterForGameActionShowError !== "function") return;
    try {
      const registration = apps.RegisterForGameActionShowError((_id, gameId, action) => {
        handler(gameId, action);
      });
      return () => registration?.unregister?.();
    } catch {
      // Process observation still works when Steam cannot register this listener.
      return undefined;
    }
  },
});

export const steamLaunchState = createKeyedResource({
  read: (key) => steamLaunch.state(Number(key)),
  errorText: () => "Couldn't check WoW launch status",
  clock: systemClock,
  pollMs: 2000,
});

/** The key of one client's icon in `steamLaunchIcon`. */
export const launchIconKey = (appId: number, targetId: string) => JSON.stringify([appId, targetId]);

/**
 * Each client's Play button icon, kept out of the polled launch state. No
 * poll: a key reads when its first viewer mounts (each page open) and keeps
 * the last icon meanwhile, so an icon that failed to read comes back on the
 * next page open.
 */
export const steamLaunchIcon = createKeyedResource({
  read: (key) => {
    const [appId, targetId] = JSON.parse(key) as [number, string];
    return steamLaunch.icon(appId, targetId);
  },
  errorText: () => "Couldn't read the client's icon",
  clock: systemClock,
});

engine.events.on("launch.completed", ({ appId }) => {
  steamLaunchState.invalidate((key) => key === String(appId));
});

engine.events.on("launch.iconChanged", ({ appId, targetId }) => {
  steamLaunchIcon.invalidate((key) => key === launchIconKey(appId, targetId));
});
