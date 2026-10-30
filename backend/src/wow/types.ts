/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/types.ts
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — trimmed to the provider set this plugin uses; client
 *   group/game-type helpers moved to utils/gametype.ts.
 * See docs/wowup-provenance.md.
 */

/**
 * `PROVIDER_ID` (api/providers.ts) lists the providers we register.
 * `RaiderIO`, `WowUpCompanion` and `Wago` are kept as WowUp's own ids, so a
 * record written by desktop WowUp still type-checks; `Unknown` names a
 * provider before it is set.
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
  Forever,
  None,
}
