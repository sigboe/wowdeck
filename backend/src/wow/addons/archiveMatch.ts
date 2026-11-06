/**
 * The match rule for archive installs (project-owned): which installed
 * record a picked file (File provider) or a direct link (Zip provider)
 * installs into. Such an archive's id is its path or link, so a newer file
 * never finds the record an older one made; without this rule it would add
 * a second listing claiming the same folders.
 *
 * "The same archive" is the same content (installedArchiveHash), never
 * the same path: a browser saves the next release under the old name, and
 * that is an update, whose install keeps the replaced files for Roll back.
 *
 * One rule for the preview (`addons.inspectArchive`, the card's Install
 * label) and the install itself (AddonService#installUnlocked), so what the
 * card promised is what Install does.
 */

import { PROVIDER_ID } from "../../api/providers";
import { recordFolders, type AddonRecord } from "./AddonRecords";

/** Providers whose addon id is the archive itself, so a new release is a new id. */
export function installsByArchive(providerId: string): boolean {
  return providerId === PROVIDER_ID.File || providerId === PROVIDER_ID.Zip;
}

/** The archive's content identity (installedArchiveHash): SHA-256 of its bytes, streamed. */
export async function archiveHash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

/**
 * Where an archive installs, among one installation's records:
 * - "reinstall": `record` is the one it installs into (same path or link,
 *   or the one owner of its folders) and its installed archive has the
 *   same content (`hash`);
 * - "update": `record` is the one it installs into, with other content
 *   (or none recorded, as a record from before the hash was kept): a
 *   sub-folder is enough, as a release may rename or drop its main folder;
 * - "conflict": two or more records own them (`owners`, each with the
 *   folders it shares with the archive, sorted); the install is refused;
 * - "new": no record owns them.
 */
export type ArchiveTarget =
  | { kind: "new" }
  | { kind: "update"; record: AddonRecord }
  | { kind: "reinstall"; record: AddonRecord }
  | { kind: "conflict"; owners: { record: AddonRecord; folders: string[] }[] };

export function archiveTarget(
  records: readonly AddonRecord[],
  providerId: string,
  externalId: string,
  folders: readonly string[],
  hash: string | undefined,
): ArchiveTarget {
  const into = (record: AddonRecord): ArchiveTarget =>
    hash !== undefined && record.installedArchiveHash === hash ? { kind: "reinstall", record } : { kind: "update", record };
  // A reused path or URL can now ship other addons: folder ownership wins.
  const same = records.find((r) => r.providerName === providerId && r.externalId === externalId);
  const wanted = new Set(folders);
  const owners = records
    .map((record) => ({ record, folders: recordFolders(record).filter((folder) => wanted.has(folder)).sort() }))
    .filter((owner) => owner.folders.length > 0);
  if (owners.length === 0) {
    return same ? into(same) : { kind: "new" };
  }
  return owners.length === 1 ? into(owners[0]!.record) : { kind: "conflict", owners };
}

/** The refusal of an install whose archive conflicts with several records. */
export function conflictMessage(owners: readonly { record: AddonRecord }[]): string {
  const names = owners.map((o) => o.record.name);
  const listed = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const fix = names.length === 2 ? "Remove one, and the file will update the other." : "Remove all but one, and the file will update the one left.";
  return `This file matches ${names.length} installed addons (${listed}). ${fix}`;
}
