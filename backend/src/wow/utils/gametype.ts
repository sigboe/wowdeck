/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/utils/wow-client.utils.ts
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — client group helpers dropped (unused), display-name
 *   helper added for the plugin; the lookups read the client table
 *   (wow/clients.ts), which now holds WowGameType and upstream's switch.
 * See docs/wowup-provenance.md.
 */

import type { GameType } from "../../api/contracts";
import { WowClientType } from "../types";
import { WowGameType, wowClient, wowClientForGameType } from "../clients";

export { WowGameType };

/**
 * A client's WowUp Hub game type. Forever and Forever Beta share their own
 * `Forever` game type, as upstream v2.24.1 does; it is what
 * WowUpHubProvider.ts asks the hub for and what addon-list imports compare.
 */
export function getWowGameType(clientType: WowClientType): WowGameType {
  return wowClient(clientType)?.wowGameType ?? WowGameType.Retail;
}

/**
 * Short, CurseForge-style player-facing names. They live in the client
 * table (wow/clients.ts): edit the table, not this function, when a client
 * is renamed.
 */
export function getClientTypeLabel(clientType: WowClientType): string {
  return wowClient(clientType)?.shortName ?? "Unknown";
}

/** WowUp's full player-facing names, from the client table. */
export function getClientFullName(clientType: WowClientType): string {
  return wowClient(clientType)?.fullName ?? getClientTypeLabel(clientType);
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
 * Beyond those, a renamed client's former names (the client table's
 * `formerNames`) count for that client only. A name matching none of these
 * is either already the current short name or a genuine custom name —
 * leave it alone either way.
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
  const client = wowClient(clientType);
  return LEGACY_WRAPPED_NAMES.has(name) || name === client?.fullName || (client?.formerNames.includes(name) ?? false);
}

/**
 * A client's wire `GameType`. Several clients share one (the PTRs, Classic
 * Era and Anniversary): the wire type is the addon family, and WTF backup
 * flavor keys are derived from it, so these values must never change.
 */
export function getGameTypeForClientType(clientType: WowClientType): GameType {
  return wowClient(clientType)?.gameType ?? "retail";
}

/** The client a manually added installation's `GameType` stands for (the reverse of the above). */
export function getClientTypeForGameType(gameType: string): WowClientType {
  return wowClientForGameType(gameType)?.clientType ?? WowClientType.None;
}
