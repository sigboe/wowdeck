/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/types.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — trimmed to the provider set this plugin uses; client
 *   group/game-type helpers moved to utils/gametype.ts.
 * See docs/wowup-provenance.md.
 */

export type AddonProviderType = "TukUI" | "WowInterface" | "WowUpHub" | "GitHub" | "RaiderIO" | "Zip" | "File" | "WowUpCompanion" | "Wago" | "Curse" | "Unknown";
export enum AddonChannelType {
  Stable,
  Beta,
  Alpha,
}

export enum AddonDependencyType {
  Embedded = 1,
  Required = 2,
  Optional = 3,
  Other = 4,
}

export type AddonIgnoreReason = "git_repo" | "raiderio_client" | "missing_dependency" | "unknown";

/** WoW client flavors. Numeric values must stay stable (persisted). */
export enum WowClientType {
  Retail = 0,
  Classic,
  RetailPtr,
  ClassicPtr,
  Beta,
  ClassicBeta,
  ClassicEra,
  ClassicEraPtr,
  RetailXPtr,
  Anniversary,
  None,
}
