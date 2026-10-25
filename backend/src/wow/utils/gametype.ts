/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/utils/wow-client.utils.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — client group helpers dropped (unused), display-name
 *   helper added for the plugin.
 * See docs/wowup-provenance.md.
 */

import type { GameType } from "../../api/contracts";
import { WowClientType } from "../types";
import { CLIENT_DISPLAY_NAMES, CLIENT_FULL_NAMES } from "./client-display-names";

export enum WowGameType {
  Retail = "retail",
  Classic = "classic",
  BurningCrusade = "burningCrusade",
  WOTLK = "wotlk",
  Cata = "cata",
  Mists = "mists",
}

export function getWowGameType(clientType: WowClientType): WowGameType {
  switch (clientType) {
    case WowClientType.ClassicEra:
    case WowClientType.ClassicEraPtr:
      return WowGameType.Classic;
    case WowClientType.Classic:
    case WowClientType.ClassicPtr:
    case WowClientType.ClassicBeta:
      return WowGameType.Mists;
    case WowClientType.Anniversary:
      return WowGameType.BurningCrusade;
    case WowClientType.Retail:
    case WowClientType.RetailPtr:
    case WowClientType.RetailXPtr:
    case WowClientType.Beta:
    default:
      return WowGameType.Retail;
  }
}

/**
 * Short, CurseForge-style player-facing names — the actual table lives
 * in client-display-names.ts (edit that file, not this function, when a
 * client gets renamed again). `ClassicBeta` -> "Forever" matches WowUp's
 * own rename as of v2.24.0 ("WoW Forever support", 2026-10-10) and
 * CurseForge's existing name for the same client.
 *
 * Deliberately NOT changed alongside this: `getWowGameType()` below
 * still groups `ClassicBeta` under `Mists`, even though current WowUp
 * now has a distinct `Forever` WowGameType/WowClientGroup for it
 * upstream. That upstream regrouping feeds WowUp's own addon-provider
 * compatibility queries — our `getWowGameType()` feeds the exact same
 * kind of query in WowUpHubProvider.ts. Changing it would be a provider
 * compatibility change, out of scope for a display-name rename — the
 * display name and the compatibility grouping are intentionally
 * allowed to diverge here.
 */
export function getClientTypeLabel(clientType: WowClientType): string {
  const key = WowClientType[clientType];
  return (key && CLIENT_DISPLAY_NAMES[key]) || "Unknown";
}

/** WowUp's full player-facing names (see CLIENT_FULL_NAMES). */
export function getClientFullName(clientType: WowClientType): string {
  const key = WowClientType[clientType];
  if (key && Object.prototype.hasOwnProperty.call(CLIENT_FULL_NAMES, key)) {
    return CLIENT_FULL_NAMES[key]!;
  }
  return getClientTypeLabel(clientType);
}

/**
 * Catches a `displayName` this plugin generated automatically under an
 * earlier naming scheme, so re-detecting an installation can safely
 * refresh it to the current short name — without ever touching a name
 * the user set explicitly (`InstallationService.addManual`'s
 * `opts.displayName`). Two earlier auto-generated schemes exist in the
 * wild: the original `World of Warcraft (${shortLabel})` composition,
 * and a brief intermediate version that used WowUp's full names bare
 * (e.g. "World of Warcraft: Forever") before they were shortened again
 * here. A name matching neither set is either already the current
 * short name or a genuine custom name — leave it alone either way.
 */
const LEGACY_SHORT_LABELS = [
  "Retail",
  "Classic",
  "Classic Era",
  "Classic Era PTR",
  "Retail Beta",
  "Classic Beta",
  "Retail PTR",
  "Classic PTR",
  "Retail XPTR",
  "Anniversary",
];
const LEGACY_WRAPPED_NAMES = new Set(LEGACY_SHORT_LABELS.map((l) => `World of Warcraft (${l})`));
const LEGACY_FULL_WOWUP_NAMES = new Set(Object.values(CLIENT_FULL_NAMES));

export function isLegacyAutoDisplayName(name: string): boolean {
  return LEGACY_WRAPPED_NAMES.has(name) || LEGACY_FULL_WOWUP_NAMES.has(name);
}

/** Map a wire GameType back to a client type (for manual installs). */
/**
 * A client's wire `GameType`. Several clients share one (the PTRs, Classic
 * Era and Anniversary): the wire type is the addon family, and WTF backup
 * flavor keys are derived from it, so these values must never change.
 */
export function getGameTypeForClientType(clientType: WowClientType): GameType {
  switch (clientType) {
    case WowClientType.Classic:
    case WowClientType.ClassicPtr:
      return "classic";
    case WowClientType.RetailPtr:
    case WowClientType.RetailXPtr:
      return "ptr";
    case WowClientType.Beta:
      return "beta";
    case WowClientType.ClassicBeta:
      return "classic_beta";
    case WowClientType.ClassicEra:
    case WowClientType.ClassicEraPtr:
    case WowClientType.Anniversary:
      return "classic_era";
    case WowClientType.Retail:
    default:
      return "retail";
  }
}

/** The client a manually added installation's `GameType` stands for (the reverse of the above). */
export function getClientTypeForGameType(gameType: string): WowClientType {
  switch (gameType) {
    case "retail":
      return WowClientType.Retail;
    case "classic":
      return WowClientType.Classic;
    case "classic_era":
      return WowClientType.ClassicEra;
    case "classic_beta":
      return WowClientType.ClassicBeta;
    case "ptr":
      return WowClientType.RetailPtr;
    case "beta":
      return WowClientType.Beta;
    default:
      return WowClientType.None;
  }
}
