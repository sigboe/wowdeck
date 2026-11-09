import { CLIENT_DISPLAY_NAMES } from "../backend/src/wow/utils/client-display-names";

/**
 * A patch version's friendly flavor name, for the Details header's
 * game-version tags (owner, 2026-11-09: tags below the facts, friendly
 * short names only). Names come from our client-name tables where a
 * client exists; Wrath, Cataclysm and MoP carry short CurseForge-style
 * names of their own. 1.60.x is Forever (the classic-branch client that
 * launched 2026-11-04), and 11.x/12.x is Retail (Midnight) — the live
 * Retail expansion, not Forever (owner's correction, 2026-11-09). A
 * version with no entry (CurseForge's 3.80.2) keeps its raw string
 * rather than a guessed name.
 */
const FLAVOR_NAMES: Record<string, string> = {
  "1.14": CLIENT_DISPLAY_NAMES.ClassicEra,
  "1.15": CLIENT_DISPLAY_NAMES.ClassicEra,
  "1.60": CLIENT_DISPLAY_NAMES.Forever,
  "2.5": CLIENT_DISPLAY_NAMES.Anniversary,
  "3.4": "Wrath",
  "4.4": "Cataclysm",
  "5.5": "MoP",
  "11": CLIENT_DISPLAY_NAMES.Retail,
  "12": CLIENT_DISPLAY_NAMES.Retail,
};

/** `major` or `major.minor` of a version string, when it starts with one. */
function versionKey(version: string): { exact: string; major: string } | null {
  const m = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) {
    return null;
  }
  return { exact: m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1], major: m[1] };
}

/** The flavor tag for one version: its friendly name, or the raw string when unknown. */
export function gameVersionTag(version: string): string {
  const key = versionKey(version);
  if (!key) {
    return version;
  }
  return FLAVOR_NAMES[key.exact] ?? FLAVOR_NAMES[key.major] ?? version;
}

/**
 * The Details header's game-version tags: every version the release
 * targets (the provider list when it has one, else the single version),
 * named and without repeats, in list order.
 */
export function gameVersionTagList(result: {
  gameVersion: string | null;
  gameVersions: string[] | null;
}): string[] {
  const versions =
    result.gameVersions && result.gameVersions.length > 0
      ? result.gameVersions
      : result.gameVersion
        ? [result.gameVersion]
        : [];
  return [...new Set(versions.map(gameVersionTag))];
}
