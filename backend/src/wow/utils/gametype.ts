/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/utils/wow-client.utils.ts
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — client group helpers dropped (unused), display-name
 *   helper added for the plugin.
 * See docs/wowup-provenance.md.
 */

import type { GameType } from "../../api/contracts";
import { WowClientType } from "../types";
import { CLIENT_DISPLAY_NAMES, CLIENT_FULL_NAMES, FORMER_CLIENT_NAMES } from "./client-display-names";

export enum WowGameType {
  Retail = "retail",
  Classic = "classic",
  BurningCrusade = "burningCrusade",
  WOTLK = "wotlk",
  Cata = "cata",
  Mists = "mists",
  Forever = "forever",
}

export function getWowGameType(clientType: WowClientType): WowGameType {
  switch (clientType) {
    case WowClientType.ClassicEra:
    case WowClientType.ClassicEraPtr:
      return WowGameType.Classic;
    case WowClientType.Classic:
    case WowClientType.ClassicPtr:
      return WowGameType.Mists;
    case WowClientType.Forever:
    case WowClientType.ClassicBeta:
      return WowGameType.Forever;
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
 * client gets renamed again). `ClassicBeta` -> "Forever Beta" matches
 * WowUp's own rename in v2.24.1.
 *
 * `getWowGameType()` above groups Forever and Forever Beta under their
 * own `Forever` game type, as upstream v2.24.1 does. Until then both sat
 * under `Mists`, because the WowUp Hub had no Forever lists; it has them
 * now, and the game type is what WowUpHubProvider.ts asks the hub for
 * and what addon-list imports compare.
 */
export function getClientTypeLabel(clientType: WowClientType): string {
  return clientEntry(CLIENT_DISPLAY_NAMES, clientType) || "Unknown";
}

/** WowUp's full player-facing names (see CLIENT_FULL_NAMES). */
export function getClientFullName(clientType: WowClientType): string {
  return clientEntry(CLIENT_FULL_NAMES, clientType) ?? getClientTypeLabel(clientType);
}

/** A client's entry in one of the client-display-names.ts tables, keyed by its enum name. */
function clientEntry<T>(table: Record<string, T>, clientType: WowClientType): T | undefined {
  const key = WowClientType[clientType];
  return key && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * Catches a `displayName` this plugin generated automatically under an
 * earlier naming scheme, so re-detecting an installation can safely
 * refresh it to the current short name — without ever touching a name
 * the user set explicitly (`InstallationService.addManual`'s
 * `opts.displayName`). Two earlier auto-generated schemes exist in the
 * wild: the original `World of Warcraft (${shortLabel})` composition,
 * and a brief intermediate version that used WowUp's full names bare
 * (e.g. "Mists of Pandaria Classic") before they were shortened again here;
 * a full name counts for its own client only ("World of Warcraft: Forever"
 * is Forever's, so on Retail the player typed it).
 * Beyond those, a renamed client's former names (FORMER_CLIENT_NAMES)
 * count for that client only. A name matching none of these is either
 * already the current short name or a genuine custom name — leave it
 * alone either way.
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

export function isLegacyAutoDisplayName(name: string, clientType: WowClientType): boolean {
  const former = clientEntry(FORMER_CLIENT_NAMES, clientType) ?? [];
  return LEGACY_WRAPPED_NAMES.has(name) || name === clientEntry(CLIENT_FULL_NAMES, clientType) || former.includes(name);
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
    case WowClientType.Forever:
      return "forever";
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
    case "forever":
      return WowClientType.Forever;
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
