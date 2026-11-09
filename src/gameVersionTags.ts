import {
  GAME_VERSION_CLIENT_TAGS,
  GAME_VERSION_TAGS,
} from "../backend/src/wow/utils/client-display-names";
import type { GameVersionClient } from "../backend/src/api/contracts";

/**
 * A Details header tag: its label and, for game versions, the two colors
 * that paint it (owner, 2026-11-09). Provider and status tags pass null
 * colors and keep the neutral tag style.
 */
export type VersionTag = {
  label: string;
  primary: string | null;
  secondary: string | null;
};

/**
 * The Details header's version tags (owner, 2026-11-09: tags below the
 * facts, short names, one palette per expansion). The names and colors
 * live with the other hand-edited tables in client-display-names.ts, and
 * docs/game-version-tags.md records their origin and contrast checks.
 *
 * A version is matched by the client the provider identified first (its
 * CurseForge type id), so any new patch of a known client matches without
 * a new entry — 3.80.0/1/2 all take Titan Reforged. Only versions with no
 * client id (TukUI, installed addons) or Retail's per-expansion names
 * fall back to reading the version number. A version that still matches
 * nothing keeps its raw string and the neutral tag style.
 */

/** `major` or `major.minor` of a version string, when it starts with one. */
function versionKey(version: string): { exact: string; major: string } | null {
  const m = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) {
    return null;
  }
  return { exact: m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1], major: m[1] };
}

/** The flavor tag for one version: its friendly name and colors, or the raw string. */
export function gameVersionTag(version: string, client?: GameVersionClient | null): VersionTag {
  if (client && client !== "retail") {
    return GAME_VERSION_CLIENT_TAGS[client];
  }
  const key = versionKey(version);
  if (key) {
    const tag = GAME_VERSION_TAGS[key.exact] ?? GAME_VERSION_TAGS[key.major];
    if (tag) {
      return tag;
    }
  }
  return { label: version, primary: null, secondary: null };
}

/**
 * The Details header's game-version tags: every version the release
 * targets (the provider list when it has one, else the single version),
 * named and without repeats, in list order.
 */
export function gameVersionTagList(result: {
  gameVersion: string | null;
  gameVersions: string[] | null;
  gameVersionClients?: Record<string, GameVersionClient> | null;
}): VersionTag[] {
  const versions =
    result.gameVersions && result.gameVersions.length > 0
      ? result.gameVersions
      : result.gameVersion
        ? [result.gameVersion]
        : [];
  const seen = new Set<string>();
  return versions
    .map((version) => gameVersionTag(version, result.gameVersionClients?.[version]))
    .filter((tag) => {
      if (seen.has(tag.label)) {
        return false;
      }
      seen.add(tag.label);
      return true;
    });
}
