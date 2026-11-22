import type { LinkedGame, LinkedGames, SteamGameLink } from "../backend/src/api/contracts";
import { engine } from "./engineLink";
import { errorText } from "./errors";
import type { Rpc } from "./services/envelope";
import { settingsStore } from "./settings";
import type { SettingsState } from "./settingsStore";
import { createStore, type Store } from "./store";
import { pluginToast } from "./toast";

/**
 * The linked games (GLOSSARY: Linked game) as the engine answers them, and
 * Show in Steam. Module scope: Steam's pages read it while the QAM is
 * closed, and the engine's `linkedGames.changed` keeps it current.
 */
export interface LinkedGamesState extends LinkedGames {
  /** The engine answered at least once: until then Steam's pages show nothing of WoWDeck. */
  loaded: boolean;
  /** Why the engine's last read failed, while it has never answered (A9: an error, not an empty list). */
  error: string | null;
}

export interface LinkedGamesStore extends Pick<Store<LinkedGamesState>, "get" | "subscribe"> {
  /** Read the engine's list; a failure keeps what is shown, or is the error while nothing is. */
  load(): Promise<void>;
  /** The engine's `linkedGames.changed`. */
  changed(linked: LinkedGames): void;
  /** Link a game from Steam's library (a removed one is found again); toasts the outcome. Resolves to whether it was linked. */
  add(game: SteamGameLink): Promise<boolean>;
  /** Unlink any linked game (a found one stays removed); toasts the outcome. Resolves to whether it was removed. */
  remove(game: SteamGameLink): Promise<boolean>;
  /** Find games: detect again and bring back removed games; toasts what was found. */
  find(): Promise<void>;
  /** Back to never read (tests). */
  reset(): void;
}

const UNREAD: LinkedGamesState = {
  enabled: false,
  games: [],
  removed: [],
  // Until the engine answers, nothing reads it: Steam's pages show nothing of WoWDeck.
  playOwner: "wowdeck",
  loaded: false,
  error: null,
};

export function createLinkedGamesStore(deps: {
  rpc: Rpc;
  toast(title: string, body: string): void;
}): LinkedGamesStore {
  const store = createStore<LinkedGamesState>(UNREAD);
  const replace = ({ enabled, games, removed, playOwner }: LinkedGames) =>
    store.set({ enabled, games, removed, playOwner, loaded: true, error: null });
  /** One change through the engine: its answer replaces the list, and a toast says how it went. */
  const change = async (call: () => Promise<LinkedGames>, done: string, failed: string) => {
    try {
      replace(await call());
    } catch (e) {
      deps.toast(failed, errorText(e));
      return false;
    }
    deps.toast(done, "");
    return true;
  };
  return {
    get: store.get,
    subscribe: store.subscribe,
    async load() {
      // A read after a failure (Retry) shows Loading… again.
      if (!store.get().loaded) store.patch({ error: null });
      try {
        replace(await deps.rpc("linkedGames.get"));
      } catch (e) {
        if (!store.get().loaded) store.patch({ error: errorText(e) });
      }
    },
    changed: replace,
    add: (game) =>
      change(
        () => deps.rpc("linkedGames.add", { appId: game.appId, name: game.name }),
        `Added ${game.name}`,
        `Couldn't add ${game.name}`,
      ),
    remove: (game) =>
      change(
        () => deps.rpc("linkedGames.remove", { appId: game.appId }),
        `Removed ${game.name}`,
        `Couldn't remove ${game.name}`,
      ),
    async find() {
      try {
        const { found, ...linked } = await deps.rpc("linkedGames.find");
        replace(linked);
        deps.toast(foundGamesText(found), "");
      } catch (e) {
        deps.toast("Couldn't look for games", errorText(e));
      }
    },
    reset: () => store.set(UNREAD),
  };
}

/**
 * Find games' toast: "Found Battle.net", "Found World of Warcraft and
 * Battle.net", "Found 3 games", or "No new games found".
 */
function foundGamesText(found: SteamGameLink[]): string {
  const [first, second] = found;
  if (!first) return "No new games found";
  if (!second) return `Found ${first.name}`;
  return found.length === 2
    ? `Found ${first.name} and ${second.name}`
    : `Found ${found.length} games`;
}

/**
 * The games Steam's pages show WoWDeck on right now: none until both the
 * settings and the linked games have loaded, none while Show in Steam is off.
 * Reads the stores unless a component passes what it subscribed to.
 */
export function shownLinkedGames(
  settings: SettingsState = settingsStore.get(),
  linked: LinkedGamesState = linkedGamesStore.get(),
): LinkedGame[] {
  return settings.loaded && linked.loaded && linked.enabled ? linked.games : [];
}

/** Steam's pages show WoWDeck on this app right now (`shownLinkedGames`). */
export function isShownLinkedGame(
  appId: number,
  settings: SettingsState = settingsStore.get(),
  linked: LinkedGamesState = linkedGamesStore.get(),
): boolean {
  return shownLinkedGames(settings, linked).some((game) => game.appId === appId);
}

/**
 * Options' Steam library status line: "On · World of Warcraft" (the one
 * linked game), "On · 2 games", "On · No games" or "Off"; "Loading…"
 * until the engine has answered, and the error when its read failed.
 */
export function steamLibraryStatus({ enabled, games, loaded, error }: LinkedGamesState): string {
  if (!loaded) return error ? LOAD_FAILED : "Loading…";
  if (!enabled) return "Off";
  const [only] = games;
  if (games.length === 1 && only) return `On · ${only.name}`;
  return games.length === 0 ? "On · No games" : `On · ${games.length} games`;
}

/** A failed first read, on the Options row and the modal's Retry row. */
export const LOAD_FAILED = "Couldn't load linked games";

/** The one linked-games store, wired to the engine. */
export const linkedGamesStore = createLinkedGamesStore({ rpc: engine.rpc, toast: pluginToast });

engine.events.on("linkedGames.changed", linkedGamesStore.changed);
