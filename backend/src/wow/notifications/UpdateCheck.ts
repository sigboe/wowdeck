/**
 * The one "check every installation" flow (owner decision 2026-10-20): for
 * each installation rescan its AddOns folder and ask the providers, then
 * rewrite the in-game companion data, then run automatic updates when they
 * are on. Installation discovery, the daily check behind the update toast,
 * the Steam page's "Check for updates" and "Update all installations" all
 * go through it. A caller that must differ passes a named option with its
 * reason at the call site; options are added only when a caller needs one.
 */

import type { AddonService } from "../addons/AddonService";
import type { CompanionSyncCoordinator } from "./CompanionSync";

export interface CheckOptions {
  /** Run automatic updates after the check (default true). */
  autoUpdate?: boolean;
}

export class UpdateCheck {
  #checking: Promise<void> | null = null;

  constructor(
    private service: AddonService,
    private companion: CompanionSyncCoordinator,
  ) {}

  /**
   * Check every installation. Concurrent callers share one scan/refresh
   * pass (no doubled provider traffic); each then asks for automatic
   * updates itself, which AddonService.autoUpdate also runs only once at a
   * time.
   */
  async checkAll(options: CheckOptions = {}): Promise<void> {
    this.#checking ??= this.#checkInstallations().finally(() => {
      this.#checking = null;
    });
    await this.#checking;
    if (options.autoUpdate !== false) {
      await this.service.autoUpdate();
    }
  }

  async #checkInstallations(): Promise<void> {
    // Serially: one installation's provider calls never overlap another's.
    // A failing installation keeps its last known state; the rest go on.
    for (const installation of this.service.installations.list()) {
      try {
        await this.service.scanInstallation(installation);
        await this.service.refresh(installation);
      } catch (err) {
        console.error(`[check] update check failed for ${installation.displayName}: ${String(err)}`);
      }
    }
    await this.companion.regenerate();
  }
}
