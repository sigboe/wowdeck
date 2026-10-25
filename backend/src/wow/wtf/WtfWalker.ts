/**
 * Deterministic WTF tree walk (project-owned).
 *
 * Paths are reported the way WowUp's backup metadata does: relative to
 * the WTF root with a leading "/" and forward slashes. Symlinks are never
 * followed or stored. `*.lua.bak` files are excluded by default: WoW
 * rewrites a throw-away `.bak` of every SavedVariables file on each
 * logout, which roughly doubles the size (measured: 48 % of the bytes on a
 * real Deck WTF) and carries no information the `.lua` doesn't.
 */

import { listDirectory } from "../fs/safe-fs";
import { BACKUP_META_NAME } from "./WtfPaths";

export interface WalkEntry {
  /** "/Account/X/SavedVariables/Y.lua" */
  rel: string;
  abs: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface WalkResult {
  /** Directories and files, parents before children, names sorted. The root itself is not included. */
  entries: WalkEntry[];
  fileCount: number;
  dirCount: number;
  totalBytes: number;
}

export interface WalkOptions {
  excludeBak?: boolean;
}

export function isExcludedBak(name: string): boolean {
  return name.toLowerCase().endsWith(".lua.bak");
}

export async function walkWtf(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const excludeBak = options.excludeBak ?? true;
  const { stat } = await import("node:fs/promises");
  const entries: WalkEntry[] = [];
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;

  async function walk(dir: string, rel: string): Promise<void> {
    const children = (await listDirectory(dir)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      if (child.isSymlink) {
        continue;
      }
      // A stray metadata file at the root (left by an interrupted desktop WowUp backup) must not be backed up.
      if (rel === "" && !child.isDirectory && child.name === BACKUP_META_NAME) {
        continue;
      }
      const childRel = `${rel}/${child.name}`;
      let st;
      try {
        st = await stat(child.path);
      } catch {
        continue; // vanished while walking (WoW running)
      }
      if (child.isDirectory) {
        dirCount += 1;
        entries.push({ rel: childRel, abs: child.path, isDirectory: true, size: 0, mtimeMs: st.mtimeMs });
        await walk(child.path, childRel);
      } else {
        if (excludeBak && isExcludedBak(child.name)) {
          continue;
        }
        fileCount += 1;
        totalBytes += st.size;
        entries.push({ rel: childRel, abs: child.path, isDirectory: false, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }

  await walk(root, "");
  return { entries, fileCount, dirCount, totalBytes };
}
