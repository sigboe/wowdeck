/**
 * Retry recovery (#108) and Verify recovery (#109), carried out (ADR 0006).
 * Both run on request only, inside the engine's addon change queue, over
 * the installation's unresolved markers, newest first: check the marker
 * (TransactionRecovery: every check, nothing touched), act when the check
 * allows it, then settle: put the original record back and only then clear
 * the marker. Both stop at the first refusal; what an earlier marker
 * recovered stays recovered.
 *
 * Retry acts by running the done moves back; a move back that fails leaves
 * a shorter run of done moves, which the next retry plans from. Verify
 * moves nothing: the player put the files back by hand. A marker that
 * can't be cleared keeps the block.
 */

import { rmdirSync } from "node:fs";
import { join } from "node:path";
import type { RecoveryRetryResult, RecoveryVerifyResult } from "../../api/contracts";
import type { StageFs } from "../fs/StageFs";
import { joinWithin } from "../fs/safe-fs";
import type { WowInstallation } from "../models";
import type { AddonRecords } from "./AddonRecords";
import { discardWork, renameFolder, resolveMarker, ROLLBACK_DIR_NAME, type AddonTransactions } from "./AddonTransaction";
import { STAGING_DIR_NAME } from "./RollbackCache";
import { addonName, type AddonTransactionMarker } from "./TransactionMarker";
import { checkRepair, planRestore, type RecoveryRefusal } from "./TransactionRecovery";

/** A marker a check allowed: what to settle, and (Retry) the renames to run first. */
type Allowed = { ok: true; marker: AddonTransactionMarker; addonsPath: string; undo?: { from: string; to: string }[] };

interface RecoveryRun {
  /** The addons whose markers were recovered, in order. */
  done: string[];
  refusal?: RecoveryRefusal;
  cleanupWarning?: string;
}

export class RecoveryActions {
  constructor(
    private fs: StageFs,
    private transactions: Pick<AddonTransactions, "unresolvedMarkers">,
  ) {}

  /** Retry recovery: put each stopped operation's original files and record back. */
  async retry(records: AddonRecords, installation: WowInstallation): Promise<RecoveryRetryResult> {
    const run = await this.#recover(records, installation, (stored) => planRestore(this.fs, installation, stored));
    const installationId = installation.id;
    return run.refusal
      ? { installationId, status: "refused", restored: run.done, ...run.refusal }
      : { installationId, status: "recovered", restored: run.done, ...(run.cleanupWarning && { cleanupWarning: run.cleanupWarning }) };
  }

  /** Verify recovery: check a manual repair put the original arrangement back, then put the record back. */
  async verify(records: AddonRecords, installation: WowInstallation): Promise<RecoveryVerifyResult> {
    const run = await this.#recover(records, installation, (stored) => checkRepair(this.fs, installation, stored));
    const installationId = installation.id;
    return run.refusal
      ? { installationId, status: "refused", verified: run.done, ...run.refusal }
      : { installationId, status: "verified", verified: run.done, ...(run.cleanupWarning && { cleanupWarning: run.cleanupWarning }) };
  }

  /** The loop both share: check, act, settle; stops at the first refusal. */
  async #recover(
    records: AddonRecords,
    installation: WowInstallation,
    check: (stored: unknown) => Promise<Allowed | ({ ok: false } & RecoveryRefusal)>,
  ): Promise<RecoveryRun> {
    const done: string[] = [];
    const warnings: string[] = [];
    for (const stored of this.transactions.unresolvedMarkers(records, installation.id).reverse()) {
      const allowed = await check(stored);
      if (!allowed.ok) {
        const { ok: _ok, ...refusal } = allowed;
        return { done, refusal };
      }
      const { marker, addonsPath } = allowed;
      try {
        for (const step of allowed.undo ?? []) {
          renameFolder(this.fs, "folder.restore", step.from, step.to);
        }
      } catch (err) {
        console.error(`[transaction] ${marker.transactionId}: retry stopped moving folders back: ${String(err)}`);
        return {
          done,
          refusal: {
            reason: "Couldn't move every folder back",
            nextStep: "Try again. The folders already moved back stay where they are",
            conflicts: [],
          },
        };
      }
      const settled = await this.#settle(records, marker, addonsPath);
      if ("refusal" in settled) {
        return { done, refusal: settled.refusal };
      }
      if (settled.warning) {
        warnings.push(settled.warning);
      }
      done.push(addonName(marker));
    }
    return { done, ...(warnings.length && { cleanupWarning: warnings.join(" ") }) };
  }

  /**
   * The end of a recovery, once the original folders are back: the original
   * record (or its absence) in one acknowledged write, then the marker
   * cleared, then the work folder removed. A failed write or clear keeps the
   * marker, so the installation stays guarded; a work folder that stays is
   * only a warning.
   */
  async #settle(
    records: AddonRecords,
    marker: AddonTransactionMarker,
    addonsPath: string,
  ): Promise<{ refusal: RecoveryRefusal } | { warning?: string }> {
    try {
      records.restoreRecord(marker.addonId, marker.originalRecord);
    } catch (err) {
      console.error(`[transaction] ${marker.transactionId}: recovery couldn't put the record back: ${String(err)}`);
      return {
        refusal: { reason: "The original files are back, but the addon list couldn't be saved", nextStep: "Try again", conflicts: [] },
      };
    }
    if (!resolveMarker(records, marker.transactionId)) {
      return {
        refusal: {
          reason: "The original files and addon list are back, but addon changes couldn't be resumed",
          nextStep: "Try again",
          conflicts: [],
        },
      };
    }
    const pluginDir = join(addonsPath, STAGING_DIR_NAME);
    // An update may have made the Roll back cache folder; an empty one holds nothing.
    try {
      rmdirSync(join(pluginDir, ROLLBACK_DIR_NAME));
    } catch {
      // not there, or it keeps previous versions
    }
    if (!(await discardWork(this.fs, joinWithin(addonsPath, ...marker.workDir.split("/")), pluginDir))) {
      return { warning: `Its temporary files are left in AddOns/${marker.workDir}. You can delete them.` };
    }
    return {};
  }
}
