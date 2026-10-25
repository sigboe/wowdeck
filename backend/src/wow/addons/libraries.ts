/**
 * Libraries: addons installed only to satisfy another addon's required
 * dependency (AddonRecord.isDependency, apt's "automatically installed").
 * That bit is all that is stored. Who needs a library is derived from the
 * required-dependency lists recorded at install and update
 * (AddonRecord.dependencies), always within one provider: a dependency is
 * installed from its dependant's provider.
 */

import type { AddonRecord } from "./AddonRecords";

const key = (providerName: string | null | undefined, externalId: string | null | undefined) =>
  `${providerName ?? ""}:${externalId ?? ""}`;

/** The installed addons that require each addon (one installation's records). */
export function dependantsIndex(records: readonly AddonRecord[]): (addon: AddonRecord) => AddonRecord[] {
  const index = new Map<string, AddonRecord[]>();
  for (const r of records) {
    for (const d of r.dependencies ?? []) {
      const k = key(r.providerName, d.externalAddonId);
      index.set(k, [...(index.get(k) ?? []), r]);
    }
  }
  return (addon) => (addon.externalId ? (index.get(key(addon.providerName, addon.externalId)) ?? []) : []);
}

/** Libraries nothing installed requires: what autoremove takes away. */
export function orphanedLibraries(records: readonly AddonRecord[]): AddonRecord[] {
  const dependants = dependantsIndex(records);
  return records.filter((r) => r.isDependency && dependants(r).length === 0);
}

/**
 * The library flag of each addon an addon list just installed: a library
 * only if the list marks it as one AND something installed requires it.
 * A marked library whose dependant was not in the list would otherwise be
 * an orphan, gone at the next Remove of any addon. Returns only changes.
 */
export function libraryFlagsAfterImport(
  records: readonly AddonRecord[],
  imported: ReadonlyMap<string, boolean>,
): { id: string; isDependency: boolean }[] {
  const dependants = dependantsIndex(records);
  return records.flatMap((r) => {
    const marked = imported.get(r.id);
    if (marked === undefined) {
      return [];
    }
    const isDependency = marked && dependants(r).length > 0;
    return !!r.isDependency === isDependency ? [] : [{ id: r.id, isDependency }];
  });
}
