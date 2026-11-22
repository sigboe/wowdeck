import type { LaunchState } from "../backend/src/api/contracts";
import type { EventRouter } from "./engineLink";
import type { Rpc } from "./services/envelope";

type RunGame = (
  gameId: string,
  launchOptions: string,
  show: number,
  flags: number,
) => void | boolean | Promise<void | boolean>;

interface SteamLaunchApi {
  getRunGame?(): RunGame | undefined;
  isStartingOrRunning?(appId: number): boolean;
  onError?(handler: (gameId: string, action: string) => void): (() => void) | undefined;
}

/**
 * Whether Play can start the selected client now, and why not. Steam's
 * running hint counts as the entry running, as it does for the label
 * (`playButtonView`) and for the engine's `launch.start`.
 */
export function launchControl(
  state: LaunchState | null,
  canStartSteam = false,
  steamEntryRunning = false,
): { label: string; reason: string | null } | null {
  if (!state) return null;
  let reason = null;
  if (state.gameRunning === "running") reason = "WoW is already running";
  else if (state.busy) reason = "Starting…";
  else if (state.gameRunning === "unknown") reason = "Couldn't check if WoW is running";
  else if (!state.entryRunning && !steamEntryRunning && !canStartSteam)
    reason = "Steam launch is unavailable";
  return { label: state.target.shortName, reason };
}

/**
 * How Steam's Play button looks on a page with launch state. The Steam
 * entry is Battle.net, so it running isn't WoW running: Steam's labels
 * (Resume, Stop, Stream) take over only while WoW runs, a stream target is
 * selected, or Battle.net is both the target and already open (Steam's
 * Resume brings it forward; the engine has nothing to start). A WoW client
 * chosen while Battle.net is open keeps our label, and "Play" replaces
 * Steam's "Resume", because Play starts that client.
 */
export function playButtonView(
  state: LaunchState,
  steam: { remote: boolean; steamEntryRunning: boolean },
): { steamLabels: boolean; playText?: string } {
  const entryRunning = state.entryRunning || steam.steamEntryRunning;
  if (steam.remote || state.gameRunning === "running") return { steamLabels: true };
  if (!entryRunning) return { steamLabels: false };
  return state.target.kind === "battlenet"
    ? { steamLabels: true }
    : { steamLabels: false, playText: "Play" };
}

export function createLaunchActions(
  rpc: Rpc,
  events: Pick<EventRouter, "on">,
  toast: (title: string, body: string) => void,
  steam: SteamLaunchApi = {},
) {
  let watch: { appId: number; stop: () => void } | undefined;
  const stopWatching = () => {
    const current = watch;
    watch = undefined;
    current?.stop();
  };
  events.on("launch.completed", ({ appId, clientName, outcome }) => {
    if (watch?.appId === appId) stopWatching();
    if (outcome === "steam-refused") {
      toast(`Couldn't launch ${clientName}`, "Steam couldn’t start the library entry");
    } else if (outcome === "never-ready") {
      toast(`Couldn't launch ${clientName}`, "Battle.net didn’t become ready");
    } else if (outcome === "ask-failed") {
      toast(`Couldn't launch ${clientName}`, "WoWDeck couldn’t send the request to Battle.net");
    } else if (outcome === "not-started") {
      // Battle.net stays open, so its own Play is one press away.
      toast(`Battle.net didn't start ${clientName}`, "Press Play in Battle.net");
    }
  });
  return {
    select: async (appId: number, targetId: string) =>
      (await rpc("launch.select", { appId, targetId })).target,
    state: async (appId: number) => (await rpc("launch.state", { appId })).state,
    icon: async (appId: number, targetId: string) =>
      (await rpc("launch.icon", { appId, targetId })).icon,
    canStartSteam: () => Boolean(steam.getRunGame?.()),
    stopWatching,
    async start(appId: number) {
      const runGame = steam.getRunGame?.();
      const { state, steamStart } = await rpc("launch.start", {
        appId,
        ...(runGame && { canStartSteam: true }),
        ...(steam.isStartingOrRunning?.(appId) && { steamEntryRunning: true }),
      });
      if (!steamStart || !runGame || steam.isStartingOrRunning?.(appId)) return state;

      const { gameId, attemptId } = steamStart;
      let reported = false;
      const refuse = () => {
        if (reported) return;
        reported = true;
        void rpc("launch.steamRefused", { attemptId }).catch(() => {
          console.warn("WoWDeck could not report a Steam launch failure");
        });
      };
      stopWatching();
      const stop = steam.onError?.((id, action) => {
        if (id === gameId && action === "LaunchApp") refuse();
      });
      if (stop) watch = { appId, stop };
      try {
        void Promise.resolve(runGame(gameId, "", -1, 0)).then((result) => {
          if (result === false) refuse();
        }, refuse);
      } catch {
        refuse();
      }
      return state;
    },
  };
}
