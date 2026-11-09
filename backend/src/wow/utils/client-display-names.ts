/**
 * The editable tables of WoW client names: CLIENT_DISPLAY_NAMES, the
 * short player-facing name used everywhere (CurseForge's style),
 * CLIENT_FULL_NAMES below, WowUp's full strings ("World of Warcraft:
 * Forever Beta") shown in Installation details, and
 * FORMER_CLIENT_NAMES, the names a renamed client used to carry, and
 * GAME_VERSION_TAGS, the expansion name and color of each game version
 * for the Details header's version tags. Edit them by hand whenever
 * WowUp/CurseForge rename a client or an expansion opens: move the old
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
 * The expansion each game version belongs to, for the Details header's
 * version tags: the short label to show and the expansion's color. Keyed
 * by version prefix, so "11" covers every 11.x release. Retail spans
 * several expansions, so its versions take the expansion's name instead
 * of the client's ("War Within", "Midnight"); the classic flavors reuse
 * the short client names above. Edit by hand when Blizzard opens a new
 * expansion. A version with no entry keeps its raw string and the
 * neutral tag color (see src/gameVersionTags.ts).
 */
export const GAME_VERSION_TAGS: Record<string, { label: string; color: string }> = {
  "1.14": { label: CLIENT_DISPLAY_NAMES.ClassicEra, color: "#C39B52" },
  "1.15": { label: CLIENT_DISPLAY_NAMES.ClassicEra, color: "#C39B52" },
  "1.60": { label: CLIENT_DISPLAY_NAMES.Forever, color: "#178CA8" },
  "2.5": { label: CLIENT_DISPLAY_NAMES.Anniversary, color: "#4FAF58" },
  "3.4": { label: "Wrath", color: "#68B7DA" },
  "4.4": { label: "Cataclysm", color: "#D65A3A" },
  "5.5": { label: "MoP", color: "#5CA48A" },
  "6": { label: "Warlords", color: "#9C6551" },
  "7": { label: "Legion", color: "#91C83E" },
  "8": { label: "BfA", color: "#3679A8" },
  "9": { label: "Shadowlands", color: "#9885C5" },
  "10": { label: "Dragonflight", color: "#B98154" },
  "11": { label: "War Within", color: "#B15B5E" },
  "12": { label: "Midnight", color: "#6F5BC7" },
  "13": { label: "Last Titan", color: "#D6AB4B" },
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
