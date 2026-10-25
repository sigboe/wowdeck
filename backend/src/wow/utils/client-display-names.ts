/**
 * The two editable tables of WoW client names: CLIENT_DISPLAY_NAMES, the
 * short player-facing name used everywhere (CurseForge's style), and
 * CLIENT_FULL_NAMES below, WowUp's full strings ("World of Warcraft:
 * Forever") shown in Installation details. Edit them by hand whenever
 * WowUp/CurseForge rename a client; nothing else needs to change.
 *
 * `ClassicBeta` -> "Forever" matches WowUp's own rename as of v2.24.0
 * ("WoW Forever support", 2026-10-10) and CurseForge's existing short
 * name for the same client (both referring to the `_classic_beta_`
 * install — not a new client, just a new name for the one that's
 * always lived there). See getClientTypeLabel() in gametype.ts for how
 * this is looked up, and isLegacyAutoDisplayName() for how an
 * already-detected installation picks up a renamed entry here.
 */
export const CLIENT_DISPLAY_NAMES: Record<string, string> = {
  Retail: "Retail",
  RetailPtr: "Retail PTR",
  RetailXPtr: "Retail XPTR",
  Beta: "Retail Beta",
  Classic: "Classic",
  ClassicPtr: "Classic PTR",
  ClassicBeta: "Forever",
  ClassicEra: "Classic Era",
  ClassicEraPtr: "Classic Era PTR",
  Anniversary: "Anniversary",
};

/**
 * WowUp's full client names, shown in Installation details; edit by
 * hand when WowUp renames a client.
 */
export const CLIENT_FULL_NAMES: Record<string, string> = {
  Retail: "World of Warcraft",
  RetailPtr: "PTR (Midnight)",
  RetailXPtr: "PTR (TWW 11.2.7)",
  Beta: "The War Within Beta",
  Classic: "Mists of Pandaria Classic",
  ClassicPtr: "PTR (MoP Classic)",
  ClassicBeta: "World of Warcraft: Forever",
  ClassicEra: "World of Warcraft Classic",
  ClassicEraPtr: "PTR (Classic Era)",
  Anniversary: "Burning Crusade Anniversary",
};
