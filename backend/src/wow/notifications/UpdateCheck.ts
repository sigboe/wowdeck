/**
 * The one "check an installation" flow (owner decision 2026-10-20): rescan
 * its AddOns folder, ask the providers, then rewrite its in-game companion
 * data. Checking every installation runs it for each, then automatic
 * updates when they are on. My Addons' refresh, installation discovery,
 * the daily check behind the update toast, the Steam page's "Check for
 * updates" and "Update all installations" all go through it. A caller that
 * must differ passes a named option with its reason at the call site;
 * options are added only when a caller needs one.
 */

import type { Addon, OperationResult } from "../../api/contracts";
import type { AddonService } from "../addons/AddonService";
import type { WowInstallation } from "../models";
import type { CompanionSyncCoordinator } from "./CompanionSync";

export interface CheckOptions {
  /** Run automatic updates after the check (default true). */
  autoUpdate?: boolean;
  /** Explicit manual checks include quiet installations. */
  manual?: boolean;
}

export class UpdateCheck {
  #checking = new Map<boolean, Promise<void>>();

  constructor(
    private service: AddonService,
    private companion: CompanionSyncCoordinator,
  ) {}

  /**
   * Check one installation. Its companion data is rewritten even when the
   * check fails: the addons it already knows still count.
   */
  async #checkInstallation(installation: WowInstallation): Promise<{ updated: number; failed: number }> {
    try {
      await this.service.scanInstallation(installation);
      return await this.service.refresh(installation);
    } finally {
      await this.companion.regenerate([installation.id]);
    }
  }

  /** My Addons' refresh: check the installation, then list it (addons.refresh). */
  async refresh(installation: WowInstallation): Promise<{ addons: Addon[]; updated: number; failed: number }> {
    const { updated, failed } = await this.#checkInstallation(installation);
    return { addons: await this.service.listAddons(installation), updated, failed };
  }

  /**
   * Check every installation. Concurrent callers share one scan/refresh
   * pass (no doubled provider traffic); each then asks for automatic
   * updates itself, which AddonService.autoUpdate also runs only once at a
   * time.
   */
  async checkAll(options: CheckOptions = {}): Promise<void> {
    const manual = options.manual === true;
    let checking = this.#checking.get(manual);
    if (!checking) {
      checking = this.#checkInstallations(manual).finally(() => { this.#checking.delete(manual); });
      this.#checking.set(manual, checking);
    }
    await checking;
    if (options.autoUpdate !== false) {
      await this.service.autoUpdate();
    }
  }

  async #checkInstallations(manual: boolean): Promise<void> {
    // Serially: one installation's provider calls never overlap another's.
    // A failing installation keeps its last known state; the rest go on.
    for (const installation of (manual ? this.service.installations.list() : this.service.installations.automatic())) {
      try {
        await this.#checkInstallation(installation);
      } catch (err) {
        console.error(`[check] update check failed for ${installation.displayName}: ${String(err)}`);
      }
    }
  }

  /**
   * Update all, across every installation (WF-13): each is checked first,
   * since only the selected one is refreshed when its list is shown and
   * another one's metadata may be days old. No automatic update in the
   * check: everything is updated right after.
   */
  async updateAllInstallations(): Promise<OperationResult[]> {
    await this.checkAll({ autoUpdate: false, manual: true });
    return this.service.updateAllInstallations();
  }

  /** Updates waiting per installation (Steam game-page section), checked first when asked. */
  async updateSummary(refresh: boolean, manual = false): Promise<ReturnType<AddonService["updateSummary"]>> {
    if (refresh) {
      await this.checkAll({ manual });
    }
    return this.service.updateSummary();
  }
}
