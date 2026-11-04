/**
 * The addon transaction marker (ADR 0006): its stored shape and the one
 * reader every part of the engine trusts it through. The runner writes it
 * (AddonTransaction), recovery plans and checks from it
 * (TransactionRecovery), and the recovery details describe it
 * (RecoveryDetails); all three read it here, so they never disagree about
 * whether a marker can be read or where its paths lead.
 */

import { ADDON_OPERATIONS } from "../../api/contracts";
import type { AddonOperation, AddonRecord } from "./AddonRecords";
import type { FolderEvidence } from "./FolderEvidence";
import { safeRelative } from "./folderChecks";
import { STAGING_DIR_NAME } from "./RollbackCache";

/** The marker format this build writes; recovery refuses one it doesn't know. */
export const TRANSACTION_MARKER_VERSION = 1;

/** One planned rename, AddOns-relative (`.wowdeck/...` for the plugin's own folders). */
export interface PlannedMove {
  from: string;
  to: string;
  /**
   * backup: live folder aside; install: staged (or previous) folder in;
   * retain: into or out of the Roll back cache (best-effort for an update,
   * mandatory for a rollback).
   */
  kind: "backup" | "install" | "retain";
}

/**
 * Stored in the state file before the first live change (AddonRecords
 * `writeMarker`) and kept until the transaction resolves. Everything a
 * recovery needs to tell what the original arrangement was and whether
 * what it finds is still that.
 */
export interface AddonTransactionMarker {
  version: typeof TRANSACTION_MARKER_VERSION;
  transactionId: string;
  installationId: string;
  operation: AddonOperation;
  addonId: string;
  /** When the transaction began (epoch ms); for display only, never for ordering. */
  startedAt: number;
  /** The installation's physical identity when the transaction began. */
  root: {
    /** The game folder (installation.location); never recreated. */
    location: string;
    addonsPath: string;
    /** `dev:ino` of the game folder and of AddOns, as decimal strings. */
    locationId: string;
    addonsId: string;
  };
  /** The work folder, AddOns-relative: `.wowdeck/tx-<id>`. */
  workDir: string;
  /** The record before the transaction; null when there was none. */
  originalRecord: AddonRecord | null;
  /** Every planned move, in order; an update's Roll back cache moves are best-effort. */
  moves: PlannedMove[];
  /** Content evidence of every move's source and destination before the first move, AddOns-relative. */
  evidence: Record<string, FolderEvidence>;
}

/**
 * What an unreadable state file stands as in this run's markers
 * (StateStore): it names no installation, so it blocks every one.
 */
export const UNREADABLE_STATE_MARKER = { unreadable: "stateFile" } as const;

/** Whether `stored` is the stand-in for an unreadable state file. */
export function isUnreadableState(stored: unknown): boolean {
  return (stored as { unreadable?: unknown } | null)?.unreadable === UNREADABLE_STATE_MARKER.unreadable;
}

/** The work folder of a transaction, AddOns-relative. */
export function workDirOf(transactionId: string): string {
  return `${STAGING_DIR_NAME}/tx-${transactionId}`;
}

/** A transaction id that can name a work folder: text, no path separator. */
export function isTransactionId(id: unknown): id is string {
  return typeof id === "string" && id !== "" && !id.includes("/") && !id.includes("\\") && id !== "." && id !== "..";
}

/** The marker as this build writes it, or null when anything about it is off. */
export function readMarker(stored: unknown): AddonTransactionMarker | null {
  if (!stored || typeof stored !== "object") {
    return null;
  }
  const m = stored as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && v !== "";
  const root = (m.root ?? null) as Record<string, unknown> | null;
  const record = m.originalRecord as { id?: unknown } | null | undefined;
  const evidence = m.evidence as Record<string, unknown> | null | undefined;
  if (
    m.version !== TRANSACTION_MARKER_VERSION ||
    !isTransactionId(m.transactionId) ||
    !text(m.installationId) ||
    !(ADDON_OPERATIONS as readonly unknown[]).includes(m.operation) ||
    !text(m.addonId) ||
    typeof m.startedAt !== "number" ||
    m.workDir !== workDirOf(m.transactionId) ||
    !root ||
    typeof root !== "object" ||
    ![root.location, root.addonsPath, root.locationId, root.addonsId].every(text) ||
    (record !== null && (typeof record !== "object" || !text(record.id))) ||
    !Array.isArray(m.moves) ||
    !m.moves.every(
      (mv: Partial<PlannedMove> | null) =>
        !!mv && safeRelative(mv.from) && safeRelative(mv.to) && ["backup", "install", "retain"].includes(mv.kind as string),
    ) ||
    !evidence ||
    typeof evidence !== "object" ||
    !Object.entries(evidence).every(([path, e]) => safeRelative(path) && isEvidence(e))
  ) {
    return null;
  }
  return stored as AddonTransactionMarker;
}

/** The addon a marker is about: its original record's name, else its main folder, else its id. */
export function addonName(marker: AddonTransactionMarker): string {
  return (
    marker.originalRecord?.name ??
    marker.moves.find((m) => m.kind === "install" && !m.to.includes("/"))?.to ??
    marker.addonId
  );
}

function isEvidence(value: unknown): value is FolderEvidence {
  const e = value as Partial<{ kind: string; digest: unknown }> | null;
  return !!e && (e.kind === "absent" || (e.kind === "folder" && typeof e.digest === "string"));
}
