/**
 * Version families for Settings copy (project-owned; see GLOSSARY.md
 * "Settings copy"). The only place that decides whether two WoW versions are
 * "related": a copy between them keeps addons and keybinds meaningful.
 */

import { getClientTypeForFolderName } from "../toc/toc";
import { WowClientType } from "../types";
import { getClientTypeForGameType, getClientTypeLabel } from "../utils/gametype";

const FAMILIES: readonly (readonly string[])[] = [
  ["_retail_", "_ptr_", "_xptr_", "_beta_"],
  ["_classic_", "_classic_ptr_"],
  ["_classic_era_", "_classic_era_ptr_", "_anniversary_"],
  ["_forever_", "_classic_beta_"],
];

function familyOf(flavor: string): number {
  return FAMILIES.findIndex((family) => family.includes(flavor));
}

/** Same family. A flavor key outside every family (the coarse game-type fallback) is related to nothing. */
export function areRelated(a: string, b: string): boolean {
  const family = familyOf(a);
  return family !== -1 && family === familyOf(b);
}

/**
 * The client display name for a flavor key (folder name or game-type fallback), or null when this build
 * doesn't know the version. Never the key itself: players never see folder names (UI guide C05).
 */
export function flavorDisplayName(flavor: string): string | null {
  const byFolder = getClientTypeForFolderName(flavor);
  const clientType = byFolder !== WowClientType.None ? byFolder : getClientTypeForGameType(flavor);
  return clientType !== WowClientType.None ? getClientTypeLabel(clientType) : null;
}
