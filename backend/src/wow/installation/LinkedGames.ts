/**
 * The linked games (GLOSSARY: Linked game): the Steam library games WoWDeck
 * adds its game page section, tile badge and Play button to. One answer for
 * the frontend and the launch code alike, so they can't disagree.
 *
 * The list is derived on every read from what detection found (each
 * installation's Steam games, hidden installations included), less the found
 * games the player removed (settings `steamRemovedGames`), plus the games
 * the player added (settings `steamAddedGames`). Show in Steam
 * (`steamEnabled`) decides whether any of it counts; off keeps the list.
 */

import type { FoundGames, LinkedGame, LinkedGames, PlayOwner, SteamGameLink } from "../../api/contracts";
import { ValidationError } from "../errors";
import type { StateStore } from "../storage/StateStore";
import { normalizeSteamGame } from "../storage/settings";

export class LinkedGameList {
  constructor(
    private readonly store: Pick<
      StateStore,
      "settings" | "updateSettings" | "saveSettings" | "settingsListeners"
    >,
    /** Every installation, hidden ones too, with the Steam games detection found for it. */
    private readonly installations: () => Array<{ steamGames?: SteamGameLink[] }>,
    /** Hears every change: linkedGames.changed. */
    private readonly changed: (games: LinkedGames) => void,
    /**
     * Every app id in any Steam user's shortcuts; null when that isn't
     * known (a shortcuts file couldn't be read), so nothing is forgotten.
     */
    private readonly shortcutAppIds: () => Promise<ReadonlySet<number> | null>,
    /** Who owns Play on this machine, decided at engine startup (PlayOwner). */
    private readonly playOwner: PlayOwner,
  ) {
    store.settingsListeners.add(({ before, after }) => {
      if (
        before.steamEnabled !== after.steamEnabled ||
        before.steamAddedGames !== after.steamAddedGames ||
        before.steamRemovedGames !== after.steamRemovedGames
      ) {
        this.changed(this.get());
      }
    });
  }

  /** The list, the removed games, the master switch and who owns Play (linkedGames.get). */
  get(): LinkedGames {
    const games = new Map<number, LinkedGame>();
    const removed = new Set(this.store.settings.steamRemovedGames.map(({ appId }) => appId));
    for (const [appId, { name }] of detectedSteamGames(this.installations())) {
      if (!removed.has(appId)) games.set(appId, { appId, name, source: "found" });
    }
    for (const { appId, name } of this.store.settings.steamAddedGames) {
      if (!games.has(appId)) games.set(appId, { appId, name, source: "added" });
    }
    return {
      enabled: this.store.settings.steamEnabled,
      games: [...games.values()].sort((a, b) => a.appId - b.appId),
      removed: this.store.settings.steamRemovedGames,
      playOwner: this.playOwner,
    };
  }

  /** Whether this app id is a linked game right now: false for every app id while Show in Steam is off. */
  isLinked(appId: number): boolean {
    const { enabled, games } = this.get();
    return enabled && games.some((game) => game.appId === appId);
  }

  /**
   * Link a game from Steam's library. A removed game comes off the removed
   * list, so a game detection finds is found again; a game detection found
   * stays found; any other game is added. Throws when the state file can't
   * take it.
   */
  async add(sent: unknown): Promise<LinkedGames> {
    const game = normalizeSteamGame(sent);
    if (!game) throw new ValidationError("Pick a game from your Steam library");
    const { steamAddedGames, steamRemovedGames } = this.store.settings;
    const wasRemoved = steamRemovedGames.some(({ appId }) => appId === game.appId);
    const isLinked = this.get().games.some(({ appId }) => appId === game.appId);
    if (wasRemoved || !isLinked) {
      const isFound = detectedSteamGames(this.installations()).has(game.appId);
      await this.store.saveSettings({
        ...(wasRemoved && { steamRemovedGames: steamRemovedGames.filter(({ appId }) => appId !== game.appId) }),
        ...(!isFound && !isLinked && { steamAddedGames: [...steamAddedGames, game] }),
      });
    }
    return this.get();
  }

  /**
   * Unlink a linked game: a found one goes on the removed list, so automatic
   * scans leave it out; an added one is deleted (a found game the player had
   * also added, from both). Throws when the state file can't take it.
   */
  async remove(appId: number): Promise<LinkedGames> {
    const game = this.get().games.find((linked) => linked.appId === appId);
    if (!game) throw new ValidationError("That game isn't linked");
    const { steamAddedGames, steamRemovedGames } = this.store.settings;
    await this.store.saveSettings({
      steamAddedGames: steamAddedGames.filter((added) => added.appId !== appId),
      ...(game.source === "found" && {
        steamRemovedGames: [...steamRemovedGames, { appId, name: game.name }],
      }),
    });
    return this.get();
  }

  /**
   * Find games (linkedGames.find): run `scan` (detection), then clear the
   * removed list, so every found game comes back. Answers with the linked
   * games this brought back or found for the first time.
   */
  async find(scan: () => Promise<unknown>): Promise<FoundGames> {
    const before = new Set(this.get().games.map(({ appId }) => appId));
    await scan();
    if (this.store.settings.steamRemovedGames.length > 0) {
      await this.store.saveSettings({ steamRemovedGames: [] });
    }
    const after = this.get();
    return {
      ...after,
      found: after.games.filter(({ appId, source }) => source === "found" && !before.has(appId)),
    };
  }

  /**
   * Forget added and removed games whose app id no longer appears in any
   * Steam user's shortcuts. Returns whether anything was forgotten (which
   * already fired linkedGames.changed).
   */
  async forgetDeleted(): Promise<boolean> {
    const present = await this.shortcutAppIds().catch(() => null);
    if (!present) return false;
    const { steamAddedGames, steamRemovedGames } = this.store.settings;
    const added = steamAddedGames.filter(({ appId }) => present.has(appId));
    const removed = steamRemovedGames.filter(({ appId }) => present.has(appId));
    if (added.length === steamAddedGames.length && removed.length === steamRemovedGames.length) return false;
    this.store.updateSettings({
      ...(added.length !== steamAddedGames.length && { steamAddedGames: added }),
      ...(removed.length !== steamRemovedGames.length && { steamRemovedGames: removed }),
    });
    return true;
  }

  /** A scan refreshed what detection found: forget deleted games, and say what changed. */
  async scanned(): Promise<void> {
    if (!(await this.forgetDeleted())) this.changed(this.get());
  }
}

/**
 * Every game detection found, by app id: the first installation's name
 * wins. Reads installations as stored defensively (StateStore's migration
 * reads them before anything checked them).
 */
export function detectedSteamGames(installations: unknown): Map<number, SteamGameLink> {
  const found = new Map<number, SteamGameLink>();
  for (const installation of Array.isArray(installations) ? installations : []) {
    const games: unknown = (installation as { steamGames?: unknown } | null)?.steamGames;
    for (const game of Array.isArray(games) ? (games as SteamGameLink[]) : []) {
      if (typeof game?.appId === "number" && !found.has(game.appId)) found.set(game.appId, game);
    }
  }
  return found;
}
