/**
 * The game types a WoW installation can be added as by hand (the Options
 * "Game version" dropdown), named with the engine's own short client names.
 * The frontend imports this module; it only reaches pure data (no I/O), so
 * the bundle carries the names instead of a copy that can drift.
 */

import type { GameType } from "./contracts";
import { getClientTypeForGameType, getClientTypeLabel } from "../wow/utils/gametype";

/** Dropdown order. */
export const MANUAL_GAME_TYPES: readonly GameType[] = [
  "retail",
  "classic_era",
  "classic",
  "classic_beta",
  "beta",
  "ptr",
];

/** The short client name for a game type, e.g. "Forever Beta" for `classic_beta`. */
export function gameTypeLabel(gameType: GameType): string {
  return getClientTypeLabel(getClientTypeForGameType(gameType));
}
