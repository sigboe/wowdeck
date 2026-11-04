/**
 * The installation recovery guard (ADR 0006): an installation whose addon
 * transaction could not put its files back is **recovery required** until
 * recovery. Its stored markers and the recovery copies they describe must
 * not change, so the engine refuses there, before anything is touched:
 * addon mutations, scans and record reconciliation, import follow-up
 * writes, Roll back cache clearing and installation removal. Browsing,
 * read-only recovery information, unrelated settings and switching
 * installations stay allowed; other installations are unaffected.
 *
 * The status is derived from persisted state on every check (the stored
 * markers and commit evidence, see AddonTransactions.unresolved), never
 * cached, so it is right after a restart and the moment a marker goes.
 */

import type { InstallationRecoveryDetails, InstallationRecoveryStatus, StateFileRecoveryStatus } from "../../api/contracts";
import { RecoveryRequiredError } from "../errors";
import type { WowInstallation } from "../models";
import type { AddonRecords } from "./AddonRecords";
import type { AddonTransactions } from "./AddonTransaction";
import { recoveryDetails } from "./RecoveryDetails";
import { isUnreadableState } from "./TransactionMarker";
import { retryUnavailable, UNREADABLE_STATE_FILE } from "./TransactionRecovery";

export class InstallationRecovery {
  constructor(
    private records: AddonRecords,
    private transactions: Pick<AddonTransactions, "unresolved" | "unresolvedMarkers">,
  ) {}

  /** Whether the installation is recovery required. */
  required(installationId: string): boolean {
    return this.transactions.unresolved(this.records, installationId).length > 0;
  }

  /** The installation's recovery status, as the contracts carry it. */
  status(installationId: string): InstallationRecoveryStatus {
    return { installationId, status: this.required(installationId) ? "recoveryRequired" : "ready" };
  }

  /**
   * Whether the state file could be read. One that can't stands as a marker
   * naming no installation (StateStore), so every installation is blocked;
   * this says so even when no installation is listed.
   */
  stateFile(): StateFileRecoveryStatus {
    return this.records.markers().some(isUnreadableState)
      ? { status: "unreadable", ...UNREADABLE_STATE_FILE }
      : { status: "readable" };
  }

  /** What the recovery is about, for display (read-only; see RecoveryDetails). */
  details(installation: WowInstallation): InstallationRecoveryDetails {
    const markers = this.transactions.unresolvedMarkers(this.records, installation.id);
    const unavailable = markers.map(retryUnavailable).find((r) => r !== null);
    const availability: InstallationRecoveryDetails["retry"] =
      markers.length === 0
        ? { available: false, reason: `${installation.displayName} doesn't need recovery`, nextStep: "" }
        : unavailable
          ? { available: false, reason: unavailable.reason, nextStep: unavailable.nextStep }
          : { available: true };
    return { ...recoveryDetails(installation, markers), retry: availability, verify: availability };
  }

  /** Throws RecoveryRequiredError when the installation is recovery required. */
  require(installation: Pick<WowInstallation, "id" | "displayName">): void {
    if (this.required(installation.id)) {
      throw new RecoveryRequiredError(installation.id, installation.displayName);
    }
  }
}
