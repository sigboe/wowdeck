/**
 * What "a local addon archive on this Deck" means engine-side (Manual
 * Install, From a file; project-owned — WowUp upstream has no local-file
 * import anywhere in its history, verified at the pinned reference
 * 2026-10-24).
 *
 * Lives beside the extractor because it is the archive layer's question:
 * the File provider answers ids with it, the preview (addons.inspectArchive)
 * and the install (DownloadService.copyLocal) validate what they were given
 * with it, and the installer never needs to guess from a URL's shape.
 */

import { open, realpath, stat } from "node:fs/promises";
import { ArchiveError } from "../errors";

const ARCHIVE_EXTENSION_RE = /\.(zip|rar|7z)$/i;

/**
 * An absolute path naming a zip, RAR or 7z file — Steam's picker filter,
 * enforced again engine-side: the frontend never touches the filesystem,
 * so this is where untrusted input is first judged.
 */
export function isSupportedArchivePath(path: string): boolean {
  return path.startsWith("/") && ARCHIVE_EXTENSION_RE.test(path);
}

/**
 * The canonical, validated path of a picked archive: it must exist, be a
 * regular file of a supported kind and be readable. Both the preview
 * (`addons.inspectArchive`) and the install pass through here, so a file
 * deleted or moved between them fails before anything touches the AddOns
 * folder, and the addon's id is always the canonical path however the file
 * was reached.
 */
export async function canonicalLocalArchive(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!isSupportedArchivePath(trimmed)) {
    throw new ArchiveError("That file isn't a zip, RAR or 7z archive", "archive_not_supported");
  }
  let regular = false;
  try {
    regular = (await stat(trimmed)).isFile();
  } catch {
    throw new ArchiveError("That file is missing. Was it moved or deleted?", "archive_unreadable");
  }
  if (!regular) {
    throw new ArchiveError("That path isn't an archive file", "archive_unreadable");
  }
  const canonical = await realpath(trimmed);
  try {
    const fh = await open(canonical, "r");
    await fh.close();
  } catch {
    throw new ArchiveError("That file can't be read", "archive_unreadable");
  }
  return canonical;
}
