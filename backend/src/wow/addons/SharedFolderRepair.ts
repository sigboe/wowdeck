/**
 * The load-time repair of records that share folders (#127). Builds before
 * the install-time match (#126) gave a newer Manual Install file a second
 * record for the same addon, both claiming the same AddOns folders; removing
 * either deleted the folders the other used. When an installation's records
 * load, a record sharing a folder with a newer record that stays, where
 * either of the two came from a file or a link, is dropped with its kept
 * previous version; the newest install keeps its record and its own. The
 * addon folders are not touched. With no shared folders it changes nothing,
 * so running it on every load is the one-time repair.
 */
import type { WowInstallation } from "../models";
import { recordFolders, type AddonRecord, type AddonRecords } from "./AddonRecords";
import { dropPrevious } from "./RollbackCache";
import { installsByArchive } from "./archiveMatch";

interface Drop {
  dropped: AddonRecord;
  kept: AddonRecord;
}

/**
 * Each record that loses to a newer install sharing its folders. Only the
 * Manual Install duplicate counts: a pair where at least one record came
 * from a file or link (File/Zip provider). Catalogue records that share a
 * folder (an embedded library) are left alone. Records are taken newest
 * first; one is dropped only when it shares a folder directly with a newer
 * record that stays. A record overlapping only a dropped one stays: it
 * shares nothing with the survivor.
 */
function duplicates(records: readonly AddonRecord[]): Drop[] {
  // Newest install first; on a tie (or no install time) the record stored last, the one added last.
  const order = records
    .map((record, i) => ({ record, i, folders: new Set(recordFolders(record)) }))
    .sort((a, b) => (b.record.installedAt ?? 0) - (a.record.installedAt ?? 0) || b.i - a.i);
  const kept: typeof order = [];
  const drops: Drop[] = [];
  for (const candidate of order) {
    const winner = kept.find(
      (k) =>
        (isArchive(k.record) || isArchive(candidate.record)) &&
        [...candidate.folders].some((folder) => k.folders.has(folder)),
    );
    if (winner) {
      drops.push({ dropped: candidate.record, kept: winner.record });
    } else {
      kept.push(candidate);
    }
  }
  return drops;
}

const isArchive = (record: AddonRecord): boolean => !!record.providerName && installsByArchive(record.providerName);

/**
 * Drop the older records sharing folders with a newer install, then their
 * kept previous versions. The records go first, in one write: a failed write
 * changes nothing, and a cache folder left by a failed removal is only
 * disk space, never a record pointing at the wrong files.
 */
export async function repairSharedFolders(records: AddonRecords, installation: WowInstallation): Promise<void> {
  const drops = duplicates(records.forInstallation(installation.id));
  if (drops.length === 0) {
    return;
  }
  records.removeMany(drops.map((d) => d.dropped.id));
  for (const { dropped, kept } of drops) {
    await dropPrevious(installation, dropped.id);
    console.error(
      `[repair] installation ${installation.id}: dropped record ${dropped.id} (${JSON.stringify(dropped.name)}), ` +
        `it shared folders with the newer install ${kept.id}`,
    );
  }
}
