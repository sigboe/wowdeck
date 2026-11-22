/**
 * The Addon view: an installation's addons as the wire rows My Addons shows,
 * built from its records and one AddOns scan. `addons.list` answers its rows,
 * and every addon method answers the row of the addon it changed, so a row
 * is the same whichever call returned it.
 *
 * A record does not keep its TOC: the main folder's is read for the
 * dependencies, missing dependencies and interface version, who needs whom
 * comes from libraryNeeds (ADR 0008), and the game version is the one this
 * installation runs.
 */

import type { Addon } from "../../api/contracts";
import type { AddonFolder, WowInstallation } from "../models";
import { getTocForGameType2 } from "../utils/toc";
import { gameVersionForInstallation } from "../utils/gameversion";
import type { AddonRecord } from "./AddonRecords";
import { libraryNeeds } from "./libraries";
import { listedIgnoreReason, missingDependencies, toWireUnmanaged } from "./wire";
import { WOWUP_DATA_ADDON_FOLDER_NAME } from "../notifications/constants";

export interface AddonView {
  /**
   * The row of `record`, read as the view's records have it when they hold
   * it (a change may have written it since), else as given (a failed fresh
   * install, never stored).
   */
  row(record: AddonRecord): Addon;
  /** The list: every record's row, then the unmanaged folders'. */
  rows(): Addon[];
}

export function addonView({
  installation,
  records,
  folders,
  wire,
}: {
  installation: WowInstallation;
  records: readonly AddonRecord[];
  /**
   * The installation's AddOns scan; null when it is not read (a
   * recovery-required installation's read-only list): then only the source
   * lists say who needs whom, no TOC is read and no folder is listed.
   */
  folders: readonly AddonFolder[] | null;
  /** A record's wire form with what only the service knows (provider capabilities). */
  wire: (record: AddonRecord) => Addon;
}): AddonView {
  const byId = new Map(records.map((r) => [r.id, r]));
  const present = new Set((folders ?? []).map((f) => f.name));
  const folderByName = new Map((folders ?? []).map((f) => [f.name, f]));
  const needs = libraryNeeds(records, folders ?? [], installation.clientType);

  const row = (given: AddonRecord): Addon => {
    const record = byId.get(given.id) ?? given;
    const addon: Addon = {
      ...wire(record),
      neededBy: needs.neededBy(record),
      leavesUnneeded: needs.leftUnneeded([record.id]).map((l) => l.name),
    };
    if (!folders) {
      return addon;
    }
    // Dependencies on the addon's own folders (a suite's libraries) are not worth showing.
    const main = folderByName.get(record.installedFolderList?.[0] ?? "");
    const toc = main ? getTocForGameType2(main, installation.clientType) : undefined;
    if (toc) {
      const own = new Set(record.installedFolderList ?? []);
      addon.dependencies = toc.dependencyList.filter((d) => !own.has(d));
      addon.optionalDependencies = toc.optionalDependencyList.filter((d) => !own.has(d));
      addon.missingDependencies = missingDependencies(addon.dependencies, present);
      addon.interfaceVersion = toc.interface?.[0] ?? null;
    }
    // The one version this installation runs, not the TOC's whole list
    // (the installer stores it joined: "16001, 16002, …").
    addon.gameVersion = gameVersionForInstallation(
      toc?.interface ?? record.gameVersion?.split(",") ?? [],
      installation.version,
    );
    return addon;
  };

  return {
    row,
    rows: () => [
      ...records.map(row),
      ...(folders ? unmanagedFolders(folders, records).map((f) => toWireUnmanaged(f, installation, present)) : []),
    ],
  };
}

/**
 * The AddOns folders My Addons lists as unmanaged: no record owns them, and
 * not the companion bridge's generated folder (wowup_data_addon has a real
 * .toc; see backend/src/wow/notifications/CompanionWriter.ts). A git checkout
 * or a Raider.IO client folder is listed too (as ignored, with its reason) so
 * the user can see why it is never matched or updated; other ignored folders
 * stay hidden.
 */
export function unmanagedFolders(folders: readonly AddonFolder[], records: readonly AddonRecord[]): AddonFolder[] {
  const managed = new Set(records.flatMap((r) => r.installedFolderList ?? []));
  return folders.filter(
    (f) =>
      !managed.has(f.name) &&
      f.name !== WOWUP_DATA_ADDON_FOLDER_NAME &&
      (f.ignoreReason === undefined || listedIgnoreReason(f) !== null),
  );
}
