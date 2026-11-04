/**
 * Archive preview inspection (project-owned): what Manual Install's From
 * a file shows before anything is installed. Unpacks the archive with the
 * same extractor an install uses (zip-slip containment, junk filtering,
 * host tools for RAR/7z) into a throwaway directory, then reads the addon
 * folders' TOCs. Nothing here installs anything, and the directory is
 * always removed again — the install itself re-runs the whole pipeline
 * transactionally (AddonInstaller).
 */

import { basename, join } from "node:path";
import type { WowClientType } from "../types";
import { ArchiveError, InstallError } from "../errors";
import { createDirectory, removeDirectory } from "../fs/safe-fs";
import { checkAddonFolders, readAddonToc } from "./addonFolders";
import { archiveFormatOf, extractArchive } from "./ArchiveExtractor";

export interface ArchiveInspection {
  /** The archive's own file name, e.g. Foo-1.2.zip. */
  fileName: string;
  /** The addon's TOC title, falling back to the file name (extension off). */
  name: string;
  author: string | null;
  /** The addon's own version from its TOC, when it states one. */
  version: string | null;
  /** The addon folders the archive installs — top-level folders with a TOC, the installer's own rule. */
  folders: string[];
}

/**
 * What the archive holds, for the preview card. `workRoot` is a
 * scratch directory on the engine's data filesystem (never inside
 * AddOns); one `inspect-<id>` directory is created under it and removed
 * before this returns.
 */
export async function inspectAddonArchive(
  archivePath: string,
  clientType: WowClientType,
  workRoot: string,
): Promise<ArchiveInspection> {
  const fileName = basename(archivePath);
  // The bytes decide whether this is an archive at all, never the name —
  // the same first rule an install applies.
  if ((await archiveFormatOf(archivePath)) === null) {
    throw new ArchiveError("That file isn't a zip, RAR or 7z archive", "archive_not_supported");
  }

  const workDir = join(workRoot, `inspect-${crypto.randomUUID()}`);
  await createDirectory(workRoot);
  await removeDirectory(workDir);
  try {
    let topLevelDirs: string[];
    try {
      ({ topLevelDirs } = await extractArchive(archivePath, workDir));
    } catch (err) {
      if (err instanceof InstallError) {
        // The extractor's own messages are already user sentences about
        // the archive (damaged, password-protected, a missing host tool).
        throw new ArchiveError(err.message, "archive_extraction_failed");
      }
      throw err;
    }

    // The installer's own rule, applied here so the preview can never
    // promise an install that validation would refuse: every top-level
    // folder is installed (the File provider lists no release folders),
    // and every installed folder must contain a TOC.
    const { addonFolders, notAddonFolders } = await checkAddonFolders(workDir, topLevelDirs);
    // Sorted: readdir order is whatever the filesystem feels like, and a
    // bundle's folder list reaches the preview card verbatim.
    const folders = [...addonFolders].sort();
    // The addon's own TOC, picked the way the installer picks the record's
    // (all folders' TOCs together, the installation's game version deciding),
    // here in sorted folder order. A TOC that can't be read fails the
    // preview, ahead of the structural refusals below.
    const toc = await readAddonToc(workDir, folders, clientType);
    if (folders.length === 0) {
      throw new ArchiveError("That archive doesn't contain any WoW addon folders", "archive_no_addons");
    }
    if (notAddonFolders.length > 0) {
      throw new ArchiveError(
        `That archive contains folders that aren't WoW addon folders (no .toc inside ${notAddonFolders[0]})`,
        "archive_no_addons",
      );
    }

    // At least one folder passed the check, so at least one TOC was read.
    const { title, author, version } = toc!;
    return {
      fileName,
      name: title || fileName.replace(/\.[^.]+$/, ""),
      author: author ?? null,
      version: version ?? null,
      folders,
    };
  } finally {
    await removeDirectory(workDir).catch(() => {});
  }
}
