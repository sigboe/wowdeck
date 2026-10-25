/**
 * WowUp.Addon companion-data bridge (project-owned).
 *
 * Folder names verified against WowUp/WowUp (GPL-3.0) at commit
 * 4fdae600 (local `wowup/` reference checkout; confirmed byte-identical to
 * upstream master as of 2026-10-11):
 *   wowup-electron/src/common/constants.ts
 *   wowup-electron/src/app/services/wowup/wowup-addon.service.ts
 * The companion addon itself (WowUp.Addon, a separate, not-vendored
 * GPL-3.0 repository) was read live at WowUp/WowUp.Addon@6c9304b — see
 * docs/wowup-provenance.md.
 */

/** The official in-game companion addon's own folder name (AddOns/WowUp). */
export const WOWUP_ADDON_FOLDER_NAME = "WowUp";

/** The manager-generated data folder this bridge owns exclusively. */
export const WOWUP_DATA_ADDON_FOLDER_NAME = "wowup_data_addon";

/** This manager's identity in the WOWUP_DATA payload (AddonManagers.md). */
export const MANAGER_NAME = "WoWDeck Addon Manager";

/**
 * Matches the "update available" accent already used for addon rows in
 * My Addons (InstalledView.tsx's `#7bbf5f`), so the in-game notification
 * reads as the same manager rather than an unrelated color.
 */
export const MANAGER_ACCENT_RGB: readonly [number, number, number] = [123 / 255, 191 / 255, 95 / 255];

/** Schema version of the data this bridge generates (not the companion's own version). */
export const COMPANION_DATA_VERSION = "1";
