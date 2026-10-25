/**
 * Whether an addon has a real update waiting, and whether automatic updates
 * may take it. Shared by AddonService (Update all, auto-update, the toast and
 * the in-game bridge) and the wire mapping (`updateAvailable`).
 */

import type { AddonRecord } from "./AddonRecords";

/** Automatic updates paused for this addon (the old skip mark counts too). */
export function isAutoUpdatePaused(addon: AddonRecord): boolean {
  return !!addon.autoUpdatePaused || !!addon.skipReleaseId;
}

/**
 * What auto-update updates: an update waiting, not ignored, its provider
 * enabled, and not paused (a rollback to an older version pauses it).
 */
export function autoUpdateCandidate(addon: AddonRecord, providerEnabled: boolean): boolean {
  return providerEnabled && needsUpdate(addon) && !isAutoUpdatePaused(addon);
}

/**
 * Based on WowUp addon.utils.ts needsUpdate — deliberately not
 * verbatim. Upstream's release-id check only ever short-circuits to
 * `true`: it falls through to the version-string comparison even when the
 * release ids match. That's safe for upstream because their install flow
 * copies the provider's own reported string straight into
 * installedVersion (`addon.installedVersion = addon.latestVersion`), so
 * the strings are trivially equal by construction. Our installer instead
 * re-reads the just-installed TOC for installedVersion (ground truth from
 * the actual files on disk, not the provider's metadata) — which is more
 * correct but means the TOC's version string and the provider's version
 * string can legitimately differ for the exact same release (addon
 * authors format these independently; see AddonInstaller's comment).
 *
 * So here, when both release ids are known, they are authoritative in
 * BOTH directions: equal ids means no update, full stop, regardless of
 * what the version strings say. Only fall back to the string heuristic
 * when a provider doesn't expose release ids at all (TukUI has no
 * per-file id — see docs/wow-client-identity.md's provider notes).
 */
export function needsUpdate(addon: AddonRecord): boolean {
  if (addon.isIgnored) {
    return false;
  }
  if (addon.externalLatestReleaseId && addon.installedExternalReleaseId) {
    return addon.externalLatestReleaseId !== addon.installedExternalReleaseId;
  }
  const installedVer = (addon.installedVersion ?? "").trim().replace(/^v/i, "");
  const latestVer = (addon.latestVersion ?? "").trim().replace(/^v/i, "");
  return installedVer.length > 0 && installedVer !== latestVer;
}
