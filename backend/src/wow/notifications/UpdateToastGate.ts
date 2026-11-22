/**
 * Decides whether the SteamOS "updates available" toast should fire.
 * Showing it is a frontend-only concern
 * (`@decky/api`'s `toaster.toast`, called from src/index.tsx) — this
 * class owns the actual decision: whether the feature is on, whether
 * it's been checked too recently, and (when a check is actually due)
 * running it across every known installation and wording what's
 * on offer (AddonUpdates, UpdateToastText). The "too recently" rule is
 * shared with the plugin's own release check (CheckCadence).
 *
 * Deliberately NOT tied to My Addons' navigation lifecycle — the
 * frontend calls `checkNow()` exactly twice: once when the plugin
 * loads (definePlugin's factory), and once each time
 * `SteamClient.System.RegisterForOnResumeFromSuspend` fires.
 */

import type { AddonUpdates } from "../addons/AddonUpdates";
import type { StateStore } from "../storage/StateStore";
import { SingleFlight } from "../utils/SingleFlight";
import { DAY_MS, isDue } from "./CheckCadence";
import { updateToastText, type UpdateToast } from "./UpdateToastText";

export interface UpdateToastResult {
  /** The toast to show, or null when none is due. */
  toast: UpdateToast | null;
}

export class UpdateToastGate {
  #flight = new SingleFlight<UpdateToastResult>();

  constructor(
    private store: StateStore,
    private updates: Pick<AddonUpdates, "checkAll" | "updateSummary">,
  ) {}

  /**
   * Concurrent callers (plugin load firing at nearly the same moment as
   * a resume-from-suspend, say) collapse onto one in-flight check
   * instead of running the all-installations refresh twice.
   */
  async checkNow(): Promise<UpdateToastResult> {
    return this.#flight.run(() => this.#run());
  }

  async #run(): Promise<UpdateToastResult> {
    const none: UpdateToastResult = { toast: null };

    // The daily check also drives automatic updates (WF-02): it runs when
    // either the toast or auto-update is on.
    const toastOn = this.store.settings.updateToastEnabled;
    if (!toastOn && !this.store.settings.autoUpdate) {
      return none;
    }

    const now = Date.now();
    if (!isDue(this.store.settings.lastUpdateCheckAt, now, DAY_MS)) {
      return none;
    }

    // The one check every installation goes through (AddonUpdates): it also
    // applies updates when auto-update is on (WF-02), so the toast then
    // counts only what is left (skipped while WoW runs, or failed).
    await this.updates.checkAll();
    this.store.updateSettings({ lastUpdateCheckAt: now });
    if (!toastOn) {
      return none;
    }

    return { toast: updateToastText(await this.updates.updateSummary()) };
  }
}
