/**
 * Libraries: addons installed only because another addon needs them
 * (AddonRecord.isDependency, apt's "automatically installed"). That bit is
 * all that is stored; who needs a library is derived here, for one
 * installation, and nowhere else (ADR 0008).
 *
 * An addon needs a library when
 * - its source lists the library as required (AddonRecord.dependencies,
 *   matched by provider and id: a source list names ids of its own
 *   provider), or
 * - one of its TOCs names one of the library's folders as a dependency
 *   (`Dependencies`, `RequiredDeps` or `OptionalDeps`). Folder names do not
 *   change with the source, so this need survives a source change in
 *   either direction. An unmanaged folder's TOC counts too.
 *
 * A library nothing needs is unneeded. It is removed only when the user
 * chooses to, and only by the Remove that left it unneeded (leftUnneeded).
 */

import type { AddonFolder } from "../models";
import type { WowClientType } from "../types";
import { getTocForGameType2 } from "../utils/toc";
import type { AddonRecord } from "./AddonRecords";

/** Who needs whom in one installation, from its records and its scanned AddOns folders. */
export interface LibraryNeeds {
  /** Names of the installed addons (managed or unmanaged) that need this one. */
  neededBy(addon: AddonRecord): string[];
  /**
   * The libraries left unneeded once every addon in `gone` is removed:
   * those only `gone` needed, then those only these and `gone` needed, and
   * so on. Never one that is unneeded already, never one in `gone`, never
   * one in `kept` (a library that stays, such as one whose removal failed,
   * so the libraries only it needed stay needed). Each comes after every
   * library that needed it, so removing them in order removes dependants
   * first.
   */
  leftUnneeded(gone: Iterable<string>, kept?: Iterable<string>): AddonRecord[];
}

/** An installed addon as a possible dependant: a record, or a folder no record owns. */
interface Dependant {
  id: string;
  name: string;
  record?: AddonRecord;
  /** Lower-cased folder names its TOCs name as dependencies, its own folders left out. */
  tocDependencies: Set<string>;
}

const lower = (names: Iterable<string>) => new Set([...names].map((n) => n.toLowerCase()));

/**
 * `folders` is the installation's AddOns scan; empty when it was not read
 * (a recovery-required installation's list), which leaves only the source
 * lists.
 */
export function libraryNeeds(
  records: readonly AddonRecord[],
  folders: readonly AddonFolder[],
  clientType: WowClientType,
): LibraryNeeds {
  const folderByName = new Map(folders.map((f) => [f.name.toLowerCase(), f]));
  const tocDependencies = (own: Set<string>): Set<string> => {
    const named = [...own].flatMap((name) => {
      const folder = folderByName.get(name);
      const toc = folder && getTocForGameType2(folder, clientType);
      return toc ? [...toc.dependencyList, ...toc.optionalDependencyList] : [];
    });
    return new Set([...lower(named)].filter((name) => !own.has(name)));
  };

  const owned = lower(records.flatMap((r) => r.installedFolderList ?? []));
  const dependants: Dependant[] = [
    ...records.map((record) => ({
      id: record.id,
      name: record.name,
      record,
      tocDependencies: tocDependencies(lower(record.installedFolderList ?? [])),
    })),
    ...folders
      .filter((f) => !owned.has(f.name.toLowerCase()))
      .map((f) => ({
        id: `unmanaged:${f.name}`,
        name: getTocForGameType2(f, clientType)?.title ?? f.name,
        tocDependencies: tocDependencies(lower([f.name])),
      })),
  ];

  const needs = (d: Dependant, library: AddonRecord): boolean => {
    if (d.id === library.id) {
      return false;
    }
    const listed =
      !!d.record &&
      !!library.externalId &&
      d.record.providerName === library.providerName &&
      (d.record.dependencies ?? []).some((dep) => dep.externalAddonId === library.externalId);
    return listed || (library.installedFolderList ?? []).some((f) => d.tocDependencies.has(f.toLowerCase()));
  };
  const dependantsOf = new Map(records.map((r) => [r.id, dependants.filter((d) => needs(d, r))]));
  const of = (addon: AddonRecord) => dependantsOf.get(addon.id) ?? [];

  return {
    neededBy: (addon) => of(addon).map((d) => d.name),
    leftUnneeded(gone, kept = []) {
      const removed = new Set(gone);
      const stays = new Set(kept);
      const left: AddonRecord[] = [];
      for (let found = true; found; ) {
        found = false;
        for (const library of records) {
          const by = library.isDependency && !removed.has(library.id) && !stays.has(library.id) ? of(library) : [];
          if (by.length > 0 && by.every((d) => removed.has(d.id))) {
            removed.add(library.id);
            left.push(library);
            found = true;
          }
        }
      }
      return left;
    },
  };
}

/**
 * The library flag of each addon an addon list just installed: a library
 * only if the list marks it as one AND something installed needs it. A
 * marked library nothing needs would otherwise sit unneeded from the start.
 * Returns only changes.
 */
export function libraryFlagsAfterImport(
  records: readonly AddonRecord[],
  needs: LibraryNeeds,
  imported: ReadonlyMap<string, boolean>,
): { id: string; isDependency: boolean }[] {
  return records.flatMap((r) => {
    const marked = imported.get(r.id);
    if (marked === undefined) {
      return [];
    }
    const isDependency = marked && needs.neededBy(r).length > 0;
    return !!r.isDependency === isDependency ? [] : [{ id: r.id, isDependency }];
  });
}
