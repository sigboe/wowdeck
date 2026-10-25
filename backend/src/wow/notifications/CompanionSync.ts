/**
 * Orchestrates the WowUp.Addon companion-data bridge across every known
 * installation. Unconditional — there is no Options setting for this
 * bridge; it simply keeps the real companion addon's data current in
 * any installation where it's actually installed, exactly as WowUp's
 * own desktop client does.
 *
 * `regenerate()` rewrites companion files from whatever addon state is
 * ALREADY persisted — no network calls. Cheap enough to run after any
 * local addon-state change (install/update/remove/ignore) and after a
 * provider-enablement change. Fetching new provider metadata first is
 * UpdateCheck's job (every check ends by regenerating).
 */

import { scanAddons } from "../addons/AddonScanner";
import type { AddonService } from "../addons/AddonService";
import type { WowInstallation } from "../models";
import { toInterfaceVersion } from "../utils/gameversion";
import { writeCompanionData } from "./CompanionWriter";
import { COMPANION_DATA_VERSION, WOWUP_ADDON_FOLDER_NAME } from "./constants";

export class CompanionSyncCoordinator {
  constructor(private service: AddonService) {}

  /**
   * Whether the real WowUp.Addon companion is present for this
   * installation — identified by its actual installed folder name
   * (`WowUp`), matching WowUp's own detection
   * (`findAddonByFolderName(addons, WOWUP_ADDON_FOLDER_NAME)` in
   * wowup-addon.service.ts), never a display-name guess. Read-only;
   * reuses the same scanner every other addon listing already pays for.
   */
  async isCompanionInstalled(installation: WowInstallation): Promise<boolean> {
    const folders = await scanAddons(installation);
    return folders.some((f) => f.name === WOWUP_ADDON_FOLDER_NAME);
  }

  /**
   * Rewrite companion files for the given installations (default: all
   * currently known ones) from already-persisted addon state. No
   * network. Safe to call liberally; failures for one installation
   * never abort the others.
   */
  async regenerate(installationIds?: string[]): Promise<void> {
    const installations = this.service.installations.list();
    const targets = installationIds
      ? installations.filter((i) => installationIds.includes(i.id))
      : installations;
    for (const installation of targets) {
      try {
        await this.regenerateOne(installation);
      } catch (err) {
        console.error(`[companion] regenerate failed for installation ${installation.id}: ${String(err)}`);
      }
    }
  }

  private async regenerateOne(installation: WowInstallation): Promise<void> {
    const companionPresent = await this.isCompanionInstalled(installation);
    if (!companionPresent) {
      // No misleading partial integration — never create the data
      // folder (or an orphaned addon entry) when the real companion
      // addon isn't actually installed for this client.
      return;
    }

    const interfaceVersion = installation.version ? toInterfaceVersion(installation.version) : undefined;
    if (!interfaceVersion) {
      // Handle this without crashing — leave whatever was last written
      // in place rather than writing a broken Interface line. Rare in
      // practice: only installations without a readable
      // `.build.info` (unusual manual/custom layouts) hit this.
      console.error(
        `[companion] cannot determine a WoW Interface version for ${installation.displayName} (${installation.id}); skipping in-game notification sync`,
      );
      return;
    }

    const updates = this.service.eligibleUpdatesFor(installation).map((addon) => ({
      name: addon.name,
      currentVersion: addon.installedVersion ?? "",
      newVersion: addon.latestVersion ?? "",
    }));

    await writeCompanionData(this.service.addonsPathFor(installation), {
      updates,
      interfaceVersion,
      dataVersion: COMPANION_DATA_VERSION,
    });
  }
}
