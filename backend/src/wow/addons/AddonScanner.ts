/**
 * Addon folder scanner (project-owned, semantics follow WowUp).
 *
 * Extracted/adapted from WowUp (GPL-3.0):
 *   wowup-electron/src/app/services/warcraft/warcraft.service.ts
 *   (listAddons/getAddonFolder/getAddonFolderPath)
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — path safety via safe-fs; git-repo marking inlined;
 *   Raider.IO client marking from addon-providers/raiderio-provider.ts
 *   (isRaiderIo/isRaiderIoDependant, as a folder ignore reason instead of a
 *   provider); never modifies the installation (read-only scan).
 * See docs/wowup-provenance.md.
 */

import type { AddonFolder, WowInstallation } from "../models";
import type { Toc } from "../toc/toc";
import { parseTocFile } from "../toc/TocParser";
import { getAddonsPath } from "../installation/InstallationDetector";
import { isDirectory, listDirectory, pathExists, statEntry } from "../fs/safe-fs";

export interface ScanOptions {
  /** Follow symlinked addon directories (default false). */
  scanSymlinks?: boolean;
}

/**
 * Scan an installation's Interface/AddOns directory and produce one
 * AddonFolder per addon directory containing at least one .toc file.
 * Directories without a toc, hidden dirs and (optionally) symlinks are
 * skipped. This operation is read-only.
 */
export async function scanAddons(
  installation: WowInstallation,
  options: ScanOptions = {},
): Promise<AddonFolder[]> {
  const addonsPath = getAddonsPath(installation);
  if (!(await pathExists(addonsPath))) {
    return [];
  }

  const folders: AddonFolder[] = [];
  const entries = await listDirectory(addonsPath);

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }
    if (!options.scanSymlinks && entry.isSymlink) {
      continue;
    }
    if (entry.name.startsWith(".")) {
      continue;
    }

    const folder = await scanAddonFolder(entry.name, entry.path);
    if (!folder) {
      console.error(`[scanner] no toc found for addon folder: ${entry.name}`);
      continue;
    }
    try {
      folder.fileStats = await statEntry(entry.path);
    } catch {
      // stats are optional
    }
    folders.push(folder);
  }

  markRaiderIoClient(folders);
  return folders;
}

/**
 * Raider.IO's own desktop client (Windows, macOS and a Linux AppImage) keeps
 * its addon and the regional database folders it downloads up to date. We
 * must never match or update them: mark the client's `RaiderIO` folder and
 * every folder requiring it (upstream's scan-only Raider.IO provider). A
 * `RaiderIO` from an addon site lacks the client's TOC fields and stays
 * matchable like any other addon.
 */
function markRaiderIoClient(folders: AddonFolder[]): void {
  const client = folders.find(
    (f) =>
      f.name === RAIDERIO_FOLDER &&
      f.tocs.some((t) => t.website === "https://raider.io" && t.addonProvider === "raiderio-client"),
  );
  if (!client) {
    return;
  }
  for (const folder of folders) {
    if (folder === client || folder.tocs.some((t) => t.dependencyList.includes(RAIDERIO_FOLDER))) {
      folder.status = "Ignored";
      folder.ignoreReason ??= "raiderio_client";
    }
  }
}

const RAIDERIO_FOLDER = "RaiderIO";

/** Parse every .toc in one addon directory. Returns undefined when none. */
export async function scanAddonFolder(name: string, dirPath: string): Promise<AddonFolder | undefined> {
  if (!(await isDirectory(dirPath))) {
    return undefined;
  }

  // Git checkouts are informational only for us; still scan them but mark.
  const isGitRepo = await pathExists(`${dirPath}/.git`);

  const files = await listDirectory(dirPath);
  const tocFiles = files.filter((f) => !f.isDirectory && f.name.toLowerCase().endsWith(".toc"));
  if (tocFiles.length === 0) {
    return undefined;
  }

  const tocs: Toc[] = [];
  for (const tocFile of tocFiles) {
    try {
      tocs.push(await parseTocFile(tocFile.path));
    } catch (err) {
      console.error(`[scanner] failed to parse ${tocFile.path}: ${String(err)}`);
    }
  }
  if (tocs.length === 0) {
    return undefined;
  }

  return {
    name,
    path: dirPath,
    status: isGitRepo ? "Ignored" : "Pending",
    ignoreReason: isGitRepo ? "git_repo" : undefined,
    tocs,
  };
}
