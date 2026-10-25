/**
 * Decides whether the SteamOS "updates available" toast should fire.
 * The toast itself is a frontend-only concern
 * (`@decky/api`'s `toaster.toast`, called from src/index.tsx) — this
 * class owns the actual decision: whether the feature is on, whether
 * it's been checked too recently, and (when a check is actually due)
 * running it across every known installation and counting what's
 * eligible.
 *
 * Deliberately NOT tied to My Addons' navigation lifecycle — the
 * frontend calls `checkNow()` exactly twice: once when the plugin
 * loads (definePlugin's factory), and once each time
 * `SteamClient.System.RegisterForOnResumeFromSuspend` fires.
 */

import type { AddonService } from "../addons/AddonService";
import type { StateStore } from "../storage/StateStore";
import type { UpdateCheck } from "./UpdateCheck";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateToastResult {
  shouldToast: boolean;
  updateCount: number;
  installationCount: number;
}

export class UpdateToastGate {
  #pending: Promise<UpdateToastResult> | null = null;

  constructor(
    private service: AddonService,
    private store: StateStore,
    private check: UpdateCheck,
  ) {}

  /**
   * Concurrent callers (plugin load firing at nearly the same moment as
   * a resume-from-suspend, say) collapse onto one in-flight check
   * instead of running the all-installations refresh twice.
   */
  async checkNow(): Promise<UpdateToastResult> {
    if (!this.#pending) {
      this.#pending = this.#run().finally(() => {
        this.#pending = null;
      });
    }
    return this.#pending;
  }

  async #run(): Promise<UpdateToastResult> {
    const none: UpdateToastResult = { shouldToast: false, updateCount: 0, installationCount: 0 };

    // The daily check also drives automatic updates (WF-02): it runs when
    // either the toast or auto-update is on.
    const toastOn = this.store.settings.updateToastEnabled;
    if (!toastOn && !this.store.settings.autoUpdate) {
      return none;
    }

    const last = this.store.settings.lastUpdateCheckAt;
    const now = Date.now();
    if (last !== null && now - last < ONE_DAY_MS) {
      return none;
    }

    // The one check every installation goes through (UpdateCheck): it also
    // applies updates when auto-update is on (WF-02), so the toast then
    // counts only what is left (skipped while WoW runs, or failed).
    await this.check.checkAll();
    this.store.updateSettings({ lastUpdateCheckAt: now });
    if (!toastOn) {
      return none;
    }

    let updateCount = 0;
    let installationCount = 0;
    for (const installation of this.service.installations.list()) {
      const eligible = this.service.eligibleUpdatesFor(installation).length;
      if (eligible > 0) {
        updateCount += eligible;
        installationCount += 1;
      }
    }

    return { shouldToast: updateCount > 0, updateCount, installationCount };
  }
}
