/**
 * The Addon folder rule (project-owned), shared by archive preview
 * (ArchiveInspector) and installation (AddonInstaller) so the two can never
 * disagree about what makes a folder an addon.
 *
 * A folder is an addon folder when it holds at least one direct,
 * non-directory entry whose name ends in `.toc`, in any letter case. Only
 * the TOC's presence counts here: whether it can be read, or suits a
 * particular WoW client, is a separate matter. The caller supplies the
 * root and the folders, in the order it wants them examined; nothing is
 * selected or sorted in this module. Failures come back as data, free of
 * player-facing wording: each caller words them in its own error classes.
 *
 * The same module owns the reading side: the TOC that represents the
 * folders for a WoW client (readAddonToc). Both callers read it from the
 * folders and in the order they supply, so a preview can only pick other
 * metadata than an installation where their folder policies differ.
 */

import type { AddonFolder } from "../models";
import type { Toc } from "../toc/toc";
import type { WowClientType } from "../types";
import { joinWithin, listDirectory } from "../fs/safe-fs";
import { parseTocFile } from "../toc/TocParser";
import { getTocForGameType2 } from "../utils/toc";

const TOC_FILE_RE = /\.toc$/i;

export interface AddonFolderCheck {
  /** Folders with at least one direct TOC file, in the caller's order. */
  addonFolders: string[];
  /** Folders with no direct TOC file, in the caller's order. */
  notAddonFolders: string[];
}

/** The direct TOC files of one folder, in directory order. */
async function listTocFiles(folderPath: string): Promise<string[]> {
  const entries = await listDirectory(folderPath);
  return entries.filter((e) => !e.isDirectory && TOC_FILE_RE.test(e.name)).map((e) => e.path);
}

/** Sort `folders` (relative to `root`) into addon folders and the rest. */
export async function checkAddonFolders(root: string, folders: readonly string[]): Promise<AddonFolderCheck> {
  const addonFolders: AddonFolderCheck["addonFolders"] = [];
  const notAddonFolders: string[] = [];
  for (const name of folders) {
    if ((await listTocFiles(joinWithin(root, name))).length > 0) {
      addonFolders.push(name);
    } else {
      notAddonFolders.push(name);
    }
  }
  return { addonFolders, notAddonFolders };
}

/**
 * The TOC that represents `folders` (relative to `root`, in the caller's
 * order) for `clientType`, or undefined when they hold no TOC at all.
 *
 * All the folders' TOCs are pooled, each folder's in directory order, and
 * the client-aware pick runs over the pool with the first folder's name; a
 * pool with no match falls back to its first TOC. Nothing about a TOC's
 * client or content makes it unfit. A TOC that cannot be read throws: what
 * to do about that is the caller's call.
 */
export async function readAddonToc(
  root: string,
  folders: readonly string[],
  clientType: WowClientType,
): Promise<Toc | undefined> {
  const tocs: Toc[] = [];
  for (const folder of folders) {
    for (const path of await listTocFiles(joinWithin(root, folder))) {
      tocs.push(await parseTocFile(path));
    }
  }
  const stub: AddonFolder = { name: folders[0] ?? "", path: "", status: "", tocs };
  return getTocForGameType2(stub, clientType) ?? tocs[0];
}
