/**
 * The persisted addon records: lookups and writes. Every write is persisted
 * before it returns, and a record read from here is read-only — a change
 * only exists once it is written through `create` or `patch`. A write
 * replaces the stored object, so a record read earlier is a snapshot: it
 * never changes under its holder, and a patch merges into whatever is
 * stored when it runs (two writers never overwrite each other's fields).
 */

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

export class AddonRecords {
  constructor(
    private state: () => { addons: WowAddon[] },
    private persist: () => void,
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

  create(record: AddonRecord): AddonRecord {
    this.createMany([record]);
    return record;
  }

  createMany(records: readonly AddonRecord[]): void {
    if (records.length === 0) {
      return;
    }
    // The type is read-only for callers; the stored copy is the same data.
    this.state().addons.push(...(records as WowAddon[]));
    this.persist();
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
    const addons = this.state().addons;
    const indexes = entries.map(({ id }) => {
      const index = addons.findIndex((a) => a.id === id);
      if (index < 0) {
        throw new NotFoundError("addon", id);
      }
      return index;
    });
    entries.forEach(({ patch }, i) => {
      addons[indexes[i]!] = { ...addons[indexes[i]!]!, ...patch };
    });
    this.persist();
  }

  remove(id: string): void {
    this.#removeWhere((a) => a.id === id);
  }

  removeForInstallation(installationId: string): void {
    this.#removeWhere((a) => a.installationId === installationId);
  }

  #removeWhere(match: (record: WowAddon) => boolean): void {
    const state = this.state();
    const kept = state.addons.filter((a) => !match(a));
    if (kept.length !== state.addons.length) {
      state.addons = kept;
      this.persist();
    }
  }
}
