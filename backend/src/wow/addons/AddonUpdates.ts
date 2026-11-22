/**
 * The addon updates module: the one update check (owner decision
 * 2026-10-20) and the update policy around it. Checking an installation
 * rescans its AddOns folder, asks the providers, then rewrites its in-game
 * companion data. Checking every installation runs that for each, then
 * automatic updates when they are on. It also decides which addons have an
 * update on offer (eligibility), and runs Update all and the update summary.
 *
 * My Addons' refresh, installation discovery, the daily check behind the
 * update toast, the Steam page's "Check for updates" and "Update all
 * installations" all go through it. Checks share one pass: a caller that
 * arrives while a pass is running joins it, and checks afterwards only the
 * installations that pass left out.
 *
 * The addon module (AddonService) keeps the gate turns: the scan, the
 * provider metadata sync and updating one addon.
 */

import type { Addon, AutoUpdateResult, OperationResult, UpdateAllProgress } from "../../api/contracts";
import type { WowInstallation } from "../models";
import { CompanionSyncCoordinator } from "../notifications/CompanionSync";
import type { ProviderRegistry } from "../providers/provider-registry";
import type { StateStore } from "../storage/StateStore";
import { SingleFlight } from "../utils/SingleFlight";
import { detectGameRunning, type GameRunning } from "../wtf/GameProcessGuard";
import type { AddonRecord } from "./AddonRecords";
import type { AddonService } from "./AddonService";
import { updateStatus } from "./addonStatus";

export interface AddonUpdatesEvents {
  /** An automatic update ran (WF-02). */
  autoUpdated?: (result: AutoUpdateResult) => void;
  /** How far an Update all run has got (addons.updateAllProgress). */
  updateAllProgress?: (progress: UpdateAllProgress) => void;
}

export interface CheckOptions {
  /** Run automatic updates after the check (default true). */
  autoUpdate?: boolean;
  /** Explicit manual checks include quiet installations. */
  manual?: boolean;
}

/** How checking one installation went: what the providers answered, or why it failed. */
type CheckOutcome = { updated: number; failed: number } | { error: unknown };

/** Updates waiting in one installation (Steam game-page section). */
export interface UpdateSummaryEntry {
  installationId: string;
  displayName: string;
  updates: number;
}

export class AddonUpdates {
  /** The in-game companion data, rewritten after each check and from eligibility here. */
  readonly companion: CompanionSyncCoordinator;
  /** One pass of checks at a time; its answer is each checked installation's outcome. */
  readonly #checking = new SingleFlight<Map<string, CheckOutcome>>();
  /** One automatic update run at a time. */
  readonly #autoUpdating = new SingleFlight<AutoUpdateResult | null>();

  constructor(
    private service: AddonService,
    private registry: ProviderRegistry,
    private store: Pick<StateStore, "settings" | "updateSettings">,
    private events: AddonUpdatesEvents = {},
  ) {
    this.companion = new CompanionSyncCoordinator(service, this);
  }

  /**
   * The updates on offer in an installation (updateStatus): what Update
   * all updates and what the toast, the update summary and the in-game
   * companion data count.
   */
  eligibleFor(installation: WowInstallation): AddonRecord[] {
    return this.service.addonsFor(installation.id).filter((addon) => updateStatus(addon, this.registry).canUpdate);
  }

  /** My Addons' refresh: check the installation, then list it (addons.refresh). */
  async refresh(installation: WowInstallation): Promise<{ addons: Addon[]; updated: number; failed: number }> {
    const outcome = (await this.#check([installation])).get(installation.id)!;
    if ("error" in outcome) {
      throw outcome.error;
    }
    return { addons: await this.service.listAddons(installation), ...outcome };
  }

  /**
   * Check every installation (manual: quiet ones too), then run automatic
   * updates unless asked not to. Each caller asks for automatic updates
   * itself; concurrent callers share that run as well.
   */
  async checkAll(options: CheckOptions = {}): Promise<void> {
    const installations = options.manual === true ? this.service.installations.list() : this.service.installations.automatic();
    await this.#check(installations);
    if (options.autoUpdate !== false) {
      await this.autoUpdate();
    }
  }

  /**
   * Check these installations, joining a pass already running: what it
   * checks counts, and a pass of our own then checks what it left out.
   */
  async #check(installations: WowInstallation[]): Promise<Map<string, CheckOutcome>> {
    const outcomes = new Map<string, CheckOutcome>();
    let missing = installations;
    while (missing.length > 0) {
      const wanted = missing;
      const pass = await this.#checking.run(() => this.#pass(wanted));
      for (const installation of wanted) {
        const outcome = pass.get(installation.id);
        if (outcome) {
          outcomes.set(installation.id, outcome);
        }
      }
      missing = missing.filter((installation) => !outcomes.has(installation.id));
    }
    return outcomes;
  }

  /**
   * One pass. Serially: one installation's provider calls never overlap
   * another's. A failing installation keeps its last known state; the rest
   * go on.
   */
  async #pass(installations: WowInstallation[]): Promise<Map<string, CheckOutcome>> {
    const outcomes = new Map<string, CheckOutcome>();
    for (const installation of installations) {
      try {
        outcomes.set(installation.id, await this.#checkInstallation(installation));
      } catch (error) {
        console.error(`[check] update check failed for ${installation.displayName}: ${String(error)}`);
        outcomes.set(installation.id, { error });
      }
    }
    return outcomes;
  }

  /**
   * Check one installation. Its companion data is rewritten even when the
   * check fails: the addons it already knows still count.
   */
  async #checkInstallation(installation: WowInstallation): Promise<{ updated: number; failed: number }> {
    try {
      await this.service.scanInstallation(installation);
      return await this.service.refreshMetadata(installation);
    } finally {
      await this.companion.regenerate([installation.id]);
    }
  }

  /** Update all in one installation, from what the last check found. */
  async updateAll(installation: WowInstallation): Promise<OperationResult[]> {
    return this.#updateCandidates(this.eligibleFor(installation));
  }

  /**
   * Update all, across every installation (WF-13; upstream's "Update All
   * Clients"): each is checked first, since only the selected one is
   * refreshed when its list is shown and another one's metadata may be
   * days old. No automatic update in the check: everything is updated
   * right after, as one run with one total.
   */
  async updateAllInstallations(): Promise<OperationResult[]> {
    await this.checkAll({ autoUpdate: false, manual: true });
    return this.#updateCandidates(this.service.installations.list().flatMap((installation) => this.eligibleFor(installation)));
  }

  /**
   * Update each candidate that still qualifies when its turn comes, as one
   * run. Progress (addons.updateAllProgress) reports the total once, then a
   * step as each turn ends, whatever its outcome. A failed update never
   * stops the others.
   */
  async #updateCandidates(candidates: AddonRecord[]): Promise<OperationResult[]> {
    const operations: OperationResult[] = [];
    const total = candidates.length;
    const report = (done: number) => {
      if (total === 0) {
        return;
      }
      this.events.updateAllProgress?.({
        done,
        total,
        failed: operations.filter((o) => o.status === "failed").length,
        addonName: candidates[done]?.name ?? null,
      });
    };
    report(0);
    for (const [index, candidate] of candidates.entries()) {
      const operation = await this.service.updateIfStill(candidate.id, (a) => updateStatus(a, this.registry).canUpdate);
      if (operation) {
        operations.push({ ...operation, addonName: candidate.name });
      }
      report(index + 1);
    }
    return operations;
  }

  /**
   * Updates waiting per installation that takes part in automatic checks
   * (Steam game-page section, BEYOND-05; the update toast), counted like
   * Update all (eligibleFor). Checked first when asked; otherwise from what
   * the last check found.
   */
  async updateSummary(refresh = false, manual = false): Promise<UpdateSummaryEntry[]> {
    if (refresh) {
      await this.checkAll({ manual });
    }
    return this.service.installations.automatic().map((installation) => ({
      installationId: installation.id,
      displayName: installation.displayName,
      updates: this.eligibleFor(installation).length,
    }));
  }

  /**
   * Automatic update (WF-02): with the option on, update every candidate
   * (updateStatus.canAutoUpdate) in every installation that takes part in
   * automatic checks, one failure never stopping the rest. Runs after a
   * check, never on its own timer. Not while WoW is running (same /proc
   * check as the WTF restore): the files would change under a running
   * client. Records the outcome for Options and emits it for a toast.
   * Concurrent callers share one run. Null when off or when nothing was
   * waiting.
   */
  autoUpdate(detect: () => Promise<GameRunning> = detectGameRunning): Promise<AutoUpdateResult | null> {
    if (!this.store.settings.autoUpdate) {
      return Promise.resolve(null);
    }
    return this.#autoUpdating.run(() => this.#runAutoUpdate(detect));
  }

  async #runAutoUpdate(detect: () => Promise<GameRunning>): Promise<AutoUpdateResult | null> {
    const automatic = (installationId: string) => this.service.installations.automatic().some((i) => i.id === installationId);
    // A recovery-required installation is refused (its addons are not candidates).
    const candidates = this.service.installations
      .automatic()
      .filter((i) => !this.service.recovery.required(i.id))
      .flatMap((installation) => this.service.addonsFor(installation.id).filter((a) => updateStatus(a, this.registry).canAutoUpdate));
    if (candidates.length === 0) {
      return null;
    }
    const result: AutoUpdateResult = { at: Date.now(), updated: [], failed: [], skipped: null };
    if ((await detect().catch(() => "unknown" as const)) === "running") {
      result.skipped = "WoW was running";
    } else {
      for (const addon of candidates) {
        const operation = await this.service.updateIfStill(
          addon.id,
          (a) => automatic(a.installationId) && updateStatus(a, this.registry).canAutoUpdate,
        );
        if (operation?.status === "updated") {
          result.updated.push(addon.name);
        } else if (operation?.status === "failed") {
          result.failed.push(addon.name);
        }
      }
    }
    this.store.updateSettings({ lastAutoUpdate: result });
    this.events.autoUpdated?.(result);
    return result;
  }
}
