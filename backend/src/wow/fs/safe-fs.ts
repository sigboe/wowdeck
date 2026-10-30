/**
 * Safe filesystem primitives for the addon engine (project-owned).
 *
 * Every path that derives from untrusted input (archive entries, addon
 * folder names, provider data) must pass through `joinWithin` /
 * `resolveWithin` so that `../`, absolute paths and symlink tricks cannot
 * escape the containing root (AGENTS.md rules 7-9).
 */

import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { FileSystemError } from "../errors";

export class PathEscapeError extends FileSystemError {
  constructor(
    public root: string,
    public target: string,
  ) {
    super(`Path escapes allowed root: ${target} (root ${root})`, target);
    this.name = "PathEscapeError";
  }
}

/**
 * Validate that `target` (already joined) stays inside `root` after
 * normalization. Rejects `..` traversal and absolute-path smuggling.
 */
export function assertWithin(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, target);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootPrefix)) {
    throw new PathEscapeError(root, target);
  }
  return resolvedTarget;
}

/**
 * Join segments onto root, asserting the result stays within root.
 * Segments must not be absolute or contain traversal that escapes.
 */
export function joinWithin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new PathEscapeError(root, segment);
    }
    if (segment.startsWith("/") || segment.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(segment)) {
      throw new PathEscapeError(root, segment);
    }
  }
  const joined = join(root, ...segments);
  return assertWithin(root, joined);
}

/** Lexical zip-entry safety: no absolute paths, no `..` segments. */
export function isSafeArchiveEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.startsWith("/") || entryPath.startsWith("\\") || /^[a-zA-Z]:/.test(entryPath)) {
    return false;
  }
  const parts = entryPath.replace(/\\/g, "/").split("/");
  return parts.every((p) => p !== ".." && p !== "" && p !== ".");
}

export async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function readTextFile(target: string): Promise<string> {
  return Bun.file(target).text();
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

/** List a directory with type info; never throws for missing dirs (returns []). */
export async function listDirectory(target: string): Promise<DirEntry[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.map((e) => ({
    name: e.name,
    path: join(target, e.name),
    isDirectory: e.isDirectory(),
    isSymlink: e.isSymbolicLink(),
  }));
}

export async function createDirectory(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

/** Rename with parent-directory guarantee (callers validate containment). */
export async function renameSafe(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}

/**
 * Temp-write + rename: a crash or kill mid-write leaves either the
 * previous file or the fully-written new one, never a
 * truncated one. The temp file lives next to its target, so the rename
 * is same-directory and never crosses a filesystem boundary. Creates the
 * parent directory.
 */
export async function writeFileAtomic(targetPath: string, contents: string): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dirname(targetPath), { recursive: true });
  await Bun.write(tmpPath, contents);
  await renameSafe(tmpPath, targetPath);
}

export async function removeDirectory(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

/** Stats reduced to the serializable shape used by the domain model. */
export async function statEntry(target: string) {
  const s = await stat(target);
  return {
    size: s.size,
    atimeMs: s.atimeMs,
    mtimeMs: s.mtimeMs,
    ctimeMs: s.ctimeMs,
    birthtimeMs: s.birthtimeMs,
    isDirectory: s.isDirectory(),
  };
}

/**
 * Atomic-ish replacement: rename new -> target, with cross-device fallback
 * (copy + delete) when source and destination live on different mounts.
 */
export async function replaceDirectory(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "ENOTEMPTY" && code !== "EEXIST") {
      throw err;
    }
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      // rename(2) onto a non-empty dir fails; do a swap via temp holding dir
      const holding = join(dirname(target), `.${basename(target)}.replaced-${Date.now()}`);
      await rename(target, holding);
      try {
        await rename(source, target);
      } catch (innerErr) {
        await rename(holding, target); // restore
        throw innerErr;
      }
      await removeDirectory(holding);
      return;
    }
    // EXDEV: copy then remove
    const tempTarget = join(dirname(target), `.${basename(target)}.copytmp-${Date.now()}`);
    await copyDirectory(source, tempTarget);
    await removeDirectory(target);
    await rename(tempTarget, target);
    await removeDirectory(source);
  }
}

/** Recursive copy of a directory tree. Symlinks are not followed. */
export async function copyDirectory(source: string, target: string): Promise<void> {
  await createDirectory(target);
  const entries = await listDirectory(source);
  for (const entry of entries) {
    if (entry.isSymlink) {
      continue;
    }
    const dest = joinWithin(target, entry.name);
    if (entry.isDirectory) {
      await copyDirectory(entry.path, dest);
    } else {
      await Bun.write(dest, Bun.file(entry.path));
    }
  }
}
