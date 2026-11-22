/**
 * The addon gate: AddonService's serialized change queue (replaces WowUp's
 * rxjs install queue), and the only holder of the writable records: a
 * change gets them by running a turn, so no record changes outside one.
 *
 * A turn names the installation it works in. The gate resolves it when the
 * turn comes (one removed since the request is NotFoundError) and applies
 * the recovery guard (ADR 0006) before the turn's work runs: a
 * recovery-required installation is refused with RecoveryRequiredError, or
 * answered by the turn's read-only fallback when it has one. The way out of
 * recovery (`recover`) is the one turn the guard leaves alone.
 */

import type { WowInstallation } from "../models";
import type { InstallationService } from "../installation/InstallationService";
import type { AddonRecord, AddonRecordReader, AddonRecords } from "./AddonRecords";
import type { InstallationRecovery } from "./InstallationRecovery";

type Step<T> = T | Promise<T>;

export class AddonGate {
  #chain: Promise<unknown> = Promise.resolve();

  constructor(
    private records: AddonRecords,
    private installations: Pick<InstallationService, "require">,
    private recovery: Pick<InstallationRecovery, "require" | "required">,
  ) {}

  /**
   * A turn that changes one installation. `readOnly`, when given, answers
   * instead for a recovery-required installation, with the records it may
   * only read (the list's stored records, a skipped follow-up).
   */
  change<T>(
    installationId: string,
    fn: (records: AddonRecords, installation: WowInstallation) => Step<T>,
    readOnly?: (records: AddonRecordReader, installation: WowInstallation) => Step<T>,
  ): Promise<T> {
    return this.#turn(() => {
      const installation = this.installations.require(installationId);
      if (readOnly && this.recovery.required(installation.id)) {
        return readOnly(this.records, installation);
      }
      this.recovery.require(installation);
      return fn(this.records, installation);
    });
  }

  /** A turn that changes one addon: its record and its installation, guarded as `change`. */
  changeAddon<T>(
    addonId: string,
    fn: (records: AddonRecords, addon: AddonRecord, installation: WowInstallation) => Step<T>,
  ): Promise<T> {
    return this.#turn(() => {
      const addon = this.records.require(addonId);
      const installation = this.installations.require(addon.installationId);
      this.recovery.require(installation);
      return fn(this.records, addon, installation);
    });
  }

  /** Retry recovery and Verify recovery: the turns that act on a recovery-required installation. */
  recover<T>(installationId: string, fn: (records: AddonRecords, installation: WowInstallation) => Step<T>): Promise<T> {
    return this.#turn(() => fn(this.records, this.installations.require(installationId)));
  }

  #turn<T>(fn: () => Step<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => {});
    return next;
  }
}
