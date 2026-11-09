import {
  CLIENT_DISPLAY_NAMES,
  CLIENT_FULL_NAMES,
} from "../backend/src/wow/utils/client-display-names";

/**
 * A patch version's friendly flavor name, for the Details header's
 * game-version tags (owner, 2026-11-09: tags on their own line, friendly
 * names only). Names come from our client-name tables where a client
 * exists; Wrath and Cataclysm have no client of ours and carry
 * CurseForge-style names. The live client's patch (11.x, 12.x) is Forever,
 * the live client (GLOSSARY "Forever"). A version with no entry — TukUI's
 * 1.60.1, CurseForge's 3.80.2 — keeps its raw string rather than a
 * guessed name.
 */
const FLAVOR_NAMES: Record<string, string> = {
  "1.14": CLIENT_DISPLAY_NAMES.ClassicEra,
  "1.15": CLIENT_DISPLAY_NAMES.ClassicEra,
  "2.5": CLIENT_FULL_NAMES.Anniversary,
  "3.4": "Wrath of the Lich King Classic",
  "4.4": "Cataclysm Classic",
  "5.5": CLIENT_FULL_NAMES.Classic,
  "11": CLIENT_DISPLAY_NAMES.Forever,
  "12": CLIENT_DISPLAY_NAMES.Forever,
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
