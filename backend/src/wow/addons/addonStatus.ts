/**
 * The update rule: whether an addon can update, whether automatic updates
 * may take it, and why not. Every place that decides "update available"
 * asks `updateStatus`: Update all, auto-update, the toast, the update
 * summary, the in-game bridge (AddonService) and the wired flag (wire.ts).
 * Based on WowUp wowup-addon.service.ts canUpdateAddon (GPL-3.0, commit
 * 4fdae600); see docs/wowup-provenance.md.
 */

import type { AddonRecord } from "./AddonRecords";
import type { ProviderRegistry } from "../providers/provider-registry";

/** Automatic updates paused for this addon (the old skip mark counts too). */
export function isAutoUpdatePaused(addon: AddonRecord): boolean {
  return !!addon.autoUpdatePaused || !!addon.skipReleaseId;
}

export interface UpdateStatus {
  /** An update is on offer: Update all, the toast, the summary and the row take it. */
  canUpdate: boolean;
  /** Automatic updates may take it: on offer and not paused. */
  canAutoUpdate: boolean;
  /**
   * Why `canAutoUpdate` is false, the first that applies: ignored, its
   * source off in Options (or gone, or never set), up to date, or paused
   * (which still leaves `canUpdate`). Null when it can auto-update.
   */
  reason: "ignored" | "source_off" | "up_to_date" | "paused" | null;
}

/**
 * The rule for one addon record. A source that is off can't update it, so
 * whatever `latestVersion` was fetched before it was turned off is not on
 * offer; a rollback to an older version pauses automatic updates only.
 */
export function updateStatus(addon: AddonRecord, registry: Pick<ProviderRegistry, "usable">): UpdateStatus {
  const reason = addon.isIgnored
    ? "ignored"
    : !registry.usable(addon.providerName)
      ? "source_off"
      : !needsUpdate(addon)
        ? "up_to_date"
        : isAutoUpdatePaused(addon)
          ? "paused"
          : null;
  return { canUpdate: reason === null || reason === "paused", canAutoUpdate: reason === null, reason };
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
