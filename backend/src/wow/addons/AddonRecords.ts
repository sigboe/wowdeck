/**
 * The persisted addon records: lookups and writes. A write builds the
 * candidate records, writes them to the state file atomically and publishes
 * them in memory only once that succeeded; a failed write throws and leaves
 * both the stored and the in-memory records as they were. A record read
 * from here is read-only — a change only exists once it is written through
 * `create`, `patch`, `remove` or `commit`. A write
 * replaces the stored object, so a record read earlier is a snapshot: it
 * never changes under its holder, and a patch merges into whatever is
 * stored when it runs (two writers never overwrite each other's fields).
 */

import { ADDON_OPERATIONS, type AddonOperationKind } from "../../api/contracts";
import { NotFoundError } from "../errors";
import type { WowAddon } from "../models";

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** A stored addon record; change it through AddonRecords. */
export type AddonRecord = DeepReadonly<WowAddon>;

/**
 * The folders a record installed in AddOns, main folder first: the list, or
 * the comma-joined field older records (and WowUp's own) carry alone.
 */
export function recordFolders(record: Pick<AddonRecord, "installedFolderList" | "installedFolders">): string[] {
  if (record.installedFolderList?.length) {
    return [...record.installedFolderList];
  }
  return (record.installedFolders ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f !== "");
}

/** Fields to change on a record: a shallow merge, `undefined` clears a field. */
export type AddonPatch = Partial<Omit<WowAddon, "id" | "installationId">>;

/** The lookups alone: what a holder that must not write gets. */
export type AddonRecordReader = Pick<AddonRecords, "all" | "get" | "require" | "forInstallation" | "find">;

/** The addon operations a transaction commits (ADR 0006). */
export type AddonOperation = AddonOperationKind;

/**
 * Proof that an addon operation committed, written atomically with its
 * record change. It outlives the change's record (a removal leaves none, an
 * unmanaged folder never had one), so recovery can tell a committed
 * operation whose cleanup failed from an unfinished one. Kept until the
 * operation's marker and leftovers are gone (`releaseCommit`).
 */
export interface AddonCommitEvidence {
  /** The transaction's id; its marker carries the same id. */
  transactionId: string;
  installationId: string;
  operation: AddonOperation;
  /** The record written or removed; absent when no record was involved (an unmanaged folder). */
  addonId?: string;
  /** The AddOns folders the operation changed. */
  folders: string[];
}

/** A record change committed in one write: patches, then creations, then removals. */
export interface AddonRecordChange {
  patch?: readonly { id: string; patch: AddonPatch }[];
  create?: readonly AddonRecord[];
  remove?: readonly string[];
}

/** What an addon write replaces in the engine state; everything else is kept. */
export interface AddonRecordsState {
  addons: WowAddon[];
  addonCommits?: AddonCommitEvidence[];
  /** Unresolved transaction markers, as stored (AddonTransaction parses them). */
  addonTransactions?: unknown[];
}

/** The transaction id a stored marker names, if it names one (any marker, readable or not). */
export function markerId(marker: unknown): string | undefined {
  const id = (marker as { transactionId?: unknown } | null)?.transactionId;
  return typeof id === "string" ? id : undefined;
}

/** The installation a stored marker names, if it names one (any marker, readable or not). */
export function markerOwner(marker: unknown): string | undefined {
  const owner = (marker as { installationId?: unknown } | null)?.installationId;
  return typeof owner === "string" ? owner : undefined;
}

/**
 * Commit evidence as stored, or null when malformed. Dropping a bad entry
 * is the safe direction: without evidence an operation counts as unfinished.
 */
export function normalizeCommitEvidence(value: unknown): AddonCommitEvidence | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { transactionId, installationId, operation, addonId, folders } = value as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && v !== "";
  if (
    !text(transactionId) ||
    !text(installationId) ||
    !(ADDON_OPERATIONS as readonly unknown[]).includes(operation) ||
    (addonId !== undefined && !text(addonId)) ||
    !Array.isArray(folders) ||
    !folders.every(text)
  ) {
    return null;
  }
  return {
    transactionId,
    installationId,
    operation: operation as AddonOperation,
    ...(addonId !== undefined && { addonId }),
    folders: [...folders],
  };
}

export class AddonRecords {
  constructor(
    private state: () => AddonRecordsState,
    /** Writes `next` atomically and publishes it; throws, publishing nothing, on failure. */
    private write: (next: AddonRecordsState, purpose: "records" | "marker") => void,
  ) {}

  all(): readonly AddonRecord[] {
    return this.state().addons;
  }

  get(id: string): AddonRecord | undefined {
    return this.state().addons.find((a) => a.id === id);
  }

  require(id: string): AddonRecord {
    const record = this.get(id);
    if (!record) {
      throw new NotFoundError("addon", id);
    }
    return record;
  }

  forInstallation(installationId: string): AddonRecord[] {
    return this.state().addons.filter((a) => a.installationId === installationId);
  }

  /** The record of one provider addon in an installation. */
  find(installationId: string, providerName: string, externalId: string): AddonRecord | undefined {
    return this.state().addons.find(
      (a) => a.installationId === installationId && a.providerName === providerName && a.externalId === externalId,
    );
  }

  /**
   * Write `change` and acknowledge `evidence` in the same atomic write: both
   * are stored, or (on a throw) neither. Committing a transaction id twice
   * throws.
   */
  commit(change: AddonRecordChange, evidence: AddonCommitEvidence): void {
    const state = this.state();
    const commits = state.addonCommits ?? [];
    if (commits.some((c) => c.transactionId === evidence.transactionId)) {
      throw new Error(`Addon transaction ${evidence.transactionId} is already committed`);
    }
    const removed = new Set(change.remove ?? []);
    const addons = [...patched(state.addons, change.patch ?? []), ...((change.create ?? []) as WowAddon[])].filter(
      (a) => !removed.has(a.id),
    );
    this.write(
      { ...this.#rest(), addons, addonCommits: [...commits, { ...evidence, folders: [...evidence.folders] }] },
      "records",
    );
  }

  /** Every stored transaction marker, unparsed (unreadable ones included). */
  markers(): readonly unknown[] {
    return this.state().addonTransactions ?? [];
  }

  /**
   * Store a transaction marker before the transaction's first live change;
   * throws, storing nothing, when the write fails. A marker with the id of
   * one already stored replaces it.
   */
  writeMarker(marker: { transactionId: string }): void {
    const kept = this.markers().filter((m) => markerId(m) !== marker.transactionId);
    this.write({ ...this.#rest(), addonTransactions: [...kept, structuredClone(marker)] }, "marker");
  }

  /**
   * Resolve a transaction once its leftovers are gone: drop its marker. Its
   * commit evidence (if it committed) stays as the addon's latest proof of a
   * committed operation; evidence it supersedes (older commits of the same
   * addon whose markers are gone, or of the same unmanaged folders) is
   * dropped in the same write, so evidence stays at one entry per addon.
   * Throws when the write fails, changing nothing.
   */
  resolveTransaction(transactionId: string): void {
    const state = this.state();
    const stored = this.markers();
    const markers = stored.filter((m) => markerId(m) !== transactionId);
    const open = new Set(markers.map(markerId));
    const commits = state.addonCommits ?? [];
    const own = commits.find((c) => c.transactionId === transactionId);
    const kept = commits.filter(
      (c) =>
        !own ||
        c === own ||
        open.has(c.transactionId) ||
        c.installationId !== own.installationId ||
        c.addonId !== own.addonId ||
        // No addon (an unmanaged folder's removal): the same folders' older evidence goes.
        (c.addonId === undefined && c.folders.join("/") !== own.folders.join("/")),
    );
    if (markers.length !== stored.length || kept.length !== commits.length) {
      this.write({ ...this.#rest(), addonCommits: kept, addonTransactions: markers }, "marker");
    }
  }

  /** The evidence a committed transaction left, if it is still kept. */
  commitEvidence(transactionId: string): AddonCommitEvidence | undefined {
    return this.state().addonCommits?.find((c) => c.transactionId === transactionId);
  }

  /** Every kept commit evidence for an installation. */
  commitsFor(installationId: string): readonly AddonCommitEvidence[] {
    return (this.state().addonCommits ?? []).filter((c) => c.installationId === installationId);
  }

  /** Forget a transaction's evidence once its marker and leftovers are gone; throws if the write fails. */
  releaseCommit(transactionId: string): void {
    const state = this.state();
    const commits = state.addonCommits ?? [];
    const kept = commits.filter((c) => c.transactionId !== transactionId);
    if (kept.length !== commits.length) {
      this.write({ ...this.#rest(), addonCommits: kept }, "records");
    }
  }

  /**
   * Put an addon's record back as it was before a transaction (Retry
   * recovery): `original`, or no record when it is null. One acknowledged
   * write, none when the stored record already is that; throws on failure,
   * changing nothing.
   */
  restoreRecord(addonId: string, original: AddonRecord | null): void {
    const id = original?.id ?? addonId;
    const addons = this.state().addons;
    const current = addons.find((a) => a.id === id);
    if (original === null) {
      if (current) {
        this.#writeRecords(addons.filter((a) => a.id !== id));
      }
      return;
    }
    if (current && JSON.stringify(current) === JSON.stringify(original)) {
      return;
    }
    const restored = structuredClone(original) as WowAddon;
    this.#writeRecords(current ? addons.map((a) => (a.id === id ? restored : a)) : [...addons, restored]);
  }

  create(record: AddonRecord): AddonRecord {
    this.createMany([record]);
    return record;
  }

  createMany(records: readonly AddonRecord[]): void {
    if (records.length === 0) {
      return;
    }
    // The type is read-only for callers; the stored copy is the same data.
    this.#writeRecords([...this.state().addons, ...(records as WowAddon[])]);
  }

  patch(id: string, patch: AddonPatch): AddonRecord {
    this.patchMany([{ id, patch }]);
    return this.require(id);
  }

  /** Several patches, persisted once; a patch of a missing record throws before anything changes. */
  patchMany(entries: readonly { id: string; patch: AddonPatch }[]): void {
    if (entries.length === 0) {
      return;
    }
    this.#writeRecords(patched(this.state().addons, entries));
  }

  remove(id: string): void {
    this.#removeWhere((a) => a.id === id);
  }

  removeForInstallation(installationId: string): void {
    this.#removeWhere((a) => a.installationId === installationId);
  }

  #removeWhere(match: (record: WowAddon) => boolean): void {
    const addons = this.state().addons;
    const kept = addons.filter((a) => !match(a));
    if (kept.length !== addons.length) {
      this.#writeRecords(kept);
    }
  }

  /** A record change without evidence; kept evidence and markers stay as they are. */
  #writeRecords(addons: WowAddon[]): void {
    this.write({ ...this.#rest(), addons }, "records");
  }

  /** The stored addon state as it is, to write with one part replaced. */
  #rest(): AddonRecordsState {
    const { addons, addonCommits, addonTransactions } = this.state();
    return { addons, addonCommits, addonTransactions };
  }
}

/** `addons` with each patch merged in; a patch of a missing record throws. */
function patched(addons: readonly WowAddon[], entries: readonly { id: string; patch: AddonPatch }[]): WowAddon[] {
  const next = [...addons];
  for (const { id, patch } of entries) {
    const index = next.findIndex((a) => a.id === id);
    if (index < 0) {
      throw new NotFoundError("addon", id);
    }
    next[index] = { ...next[index]!, ...patch };
  }
  return next;
}
