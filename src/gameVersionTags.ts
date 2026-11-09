import { GAME_VERSION_TAGS } from "../backend/src/wow/utils/client-display-names";

/**
 * A Details header tag: its label and, for game versions, the expansion's
 * color (owner, 2026-11-09). Provider and status tags pass no color and
 * keep the neutral tag style.
 */
export type VersionTag = { label: string; color: string | null };

/**
 * The Details header's version tags (owner, 2026-11-09: tags below the
 * facts, short names, one color per expansion). The version-to-name table
 * lives with the other hand-edited name tables in client-display-names.ts
 * (GAME_VERSION_TAGS). A version with no entry keeps its raw string and
 * the neutral tag color rather than a guessed name.
 */

/** `major` or `major.minor` of a version string, when it starts with one. */
function versionKey(version: string): { exact: string; major: string } | null {
  const m = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) {
    return null;
  }
  return { exact: m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1], major: m[1] };
}

/** The flavor tag for one version: its friendly name and color, or the raw string. */
export function gameVersionTag(version: string): VersionTag {
  const key = versionKey(version);
  if (!key) {
    return { label: version, color: null };
  }
  return (
    GAME_VERSION_TAGS[key.exact] ?? GAME_VERSION_TAGS[key.major] ?? { label: version, color: null }
  );
}

/**
 * The Details header's game-version tags: every version the release
 * targets (the provider list when it has one, else the single version),
 * named and without repeats, in list order.
 */
export function gameVersionTagList(result: {
  gameVersion: string | null;
  gameVersions: string[] | null;
}): VersionTag[] {
  const versions =
    result.gameVersions && result.gameVersions.length > 0
      ? result.gameVersions
      : result.gameVersion
        ? [result.gameVersion]
        : [];
  const seen = new Set<string>();
  return versions.map(gameVersionTag).filter((tag) => {
    if (seen.has(tag.label)) {
      return false;
    }
    seen.add(tag.label);
    return true;
  });
}
