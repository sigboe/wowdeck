/**
 * The editable tables of WoW client names: CLIENT_DISPLAY_NAMES, the
 * short player-facing name used everywhere (CurseForge's style),
 * CLIENT_FULL_NAMES below, WowUp's full strings ("World of Warcraft:
 * Forever Beta") shown in Installation details, and
 * FORMER_CLIENT_NAMES, the names a renamed client used to carry. Edit
 * them by hand whenever WowUp/CurseForge rename a client: move the old
 * names into FORMER_CLIENT_NAMES; nothing else needs to change.
 *
 * `ClassicBeta` -> "Forever Beta" matches WowUp's own rename in v2.24.1
 * (upstream commit 41352f97), once WoW Forever launched and took the
 * name "Forever" for the live client. The `_classic_beta_` install was
 * called plain "Forever" from WowUp v2.24.0 until then. See
 * getClientTypeLabel() in gametype.ts for how this is looked up, and
 * isLegacyAutoDisplayName() for how an already-detected installation
 * picks up a renamed entry here.
 */
export const CLIENT_DISPLAY_NAMES: Record<string, string> = {
  Retail: "Retail",
  RetailPtr: "Retail PTR",
  RetailXPtr: "Retail XPTR",
  Beta: "Retail Beta",
  Classic: "Classic",
  ClassicPtr: "Classic PTR",
  Forever: "Forever",
  ClassicBeta: "Forever Beta",
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
  Forever: "World of Warcraft: Forever",
  ClassicBeta: "World of Warcraft: Forever Beta",
  ClassicEra: "World of Warcraft Classic",
  ClassicEraPtr: "PTR (Classic Era)",
  Anniversary: "Burning Crusade Anniversary",
};

/**
 * Names the plugin once generated for a client and no longer does. An
 * installation still carrying one is refreshed to the current short name;
 * the names are per client because a former name can become another
 * client's current one ("Forever" is now the live client's).
 */
export const FORMER_CLIENT_NAMES: Record<string, readonly string[]> = {
  ClassicBeta: ["Forever", "World of Warcraft: Forever"],
};
