/**
 * The previous version of each addon, kept after an update so it can be
 * rolled back (BEYOND-02; WowUp has no rollback). One version per addon, in
 * `AddOns/.wowdeck/rollback/<addonId>/`: next to the addon on the same
 * disk, so keeping and restoring are renames even on an SD card, and inside
 * a dot folder that neither WoW nor our scanner loads. `meta.json` says what
 * the folders are.
 */
import { join } from "node:path";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { WowInstallation } from "../models";
import { getAddonsPath } from "../installation/InstallationDetector";
import { createDirectory, joinWithin, pathExists, removeDirectory, renameSafe } from "../fs/safe-fs";
import { InstallError, plainSystemError } from "../errors";

/** The plugin's own folder inside AddOns (install staging, the rollback cache). */
export const STAGING_DIR_NAME = ".wowdeck";
/** Marks the version parked while a swap runs (`<addonId>.current-<uuid>`). */
const CURRENT_MARKER = ".current-";
const ROLLBACK_DIR_NAME = "rollback";
const META = "meta.json";

export interface PreviousVersion {
  version: string | null;
  releaseId: string | null;
  folders: string[];
  savedAt: number;
}

function cacheRoot(installation: WowInstallation): string {
  return join(getAddonsPath(installation), STAGING_DIR_NAME, ROLLBACK_DIR_NAME);
}

/** The cache folder of one addon; the id is ours (a UUID), still kept inside the root. */
export function rollbackDir(installation: WowInstallation, addonId: string): string {
  return joinWithin(cacheRoot(installation), addonId);
}

export async function readPrevious(installation: WowInstallation, addonId: string): Promise<PreviousVersion | null> {
  try {
    const meta = JSON.parse(await readFile(join(rollbackDir(installation, addonId), META), "utf-8")) as PreviousVersion;
    return Array.isArray(meta.folders) && meta.folders.length > 0 ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Make `sourceDir` (holding the previous version's folders) the addon's
 * previous version, replacing the one kept before.
 */
export async function keepPrevious(
  installation: WowInstallation,
  addonId: string,
  sourceDir: string,
  meta: PreviousVersion,
): Promise<void> {
  const dir = rollbackDir(installation, addonId);
  await removeDirectory(dir).catch(() => {});
  await createDirectory(cacheRoot(installation));
  await renameSafe(sourceDir, dir);
  await writeFile(join(dir, META), JSON.stringify(meta, null, 2));
}

export async function dropPrevious(installation: WowInstallation, addonId: string): Promise<void> {
  await removeDirectory(rollbackDir(installation, addonId)).catch(() => {});
}

/**
 * Swap the addon's current folders with the kept previous version. The
 * current version becomes the kept one, so a rollback can be undone the same
 * way. Any failure puts every folder back where it was.
 */
export async function swapWithPrevious(
  installation: WowInstallation,
  addonId: string,
  current: { version: string | null; releaseId: string | null; folders: string[] },
): Promise<PreviousVersion> {
  const previous = await readPrevious(installation, addonId);
  if (!previous) {
    throw new InstallError("No previous version is kept for this addon", addonId);
  }
  const addonsPath = getAddonsPath(installation);
  const dir = rollbackDir(installation, addonId);
  const parked = joinWithin(cacheRoot(installation), `${addonId}${CURRENT_MARKER}${crypto.randomUUID()}`);
  await createDirectory(parked);
  const movedOut: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const folder of current.folders) {
      const target = joinWithin(addonsPath, folder);
      if (await pathExists(target)) {
        await renameSafe(target, joinWithin(parked, folder));
        movedOut.push(folder);
      }
    }
    for (const folder of previous.folders) {
      await renameSafe(joinWithin(dir, folder), joinWithin(addonsPath, folder));
      movedIn.push(folder);
    }
  } catch (err) {
    for (const folder of movedIn) {
      await renameSafe(joinWithin(addonsPath, folder), joinWithin(dir, folder)).catch(() => {});
    }
    for (const folder of movedOut) {
      await renameSafe(joinWithin(parked, folder), joinWithin(addonsPath, folder)).catch(() => {});
    }
    await removeDirectory(parked).catch(() => {});
    throw new InstallError(plainSystemError(err, "Couldn't roll back. Nothing was changed", "rollback"), addonId);
  }
  await keepPrevious(installation, addonId, parked, {
    version: current.version,
    releaseId: current.releaseId,
    folders: movedOut,
    savedAt: Date.now(),
  });
  return previous;
}

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info) {
    return 0;
  }
  if (!info.isDirectory()) {
    return info.size;
  }
  let total = 0;
  for (const name of await readdir(path).catch(() => [] as string[])) {
    total += await sizeOf(join(path, name));
  }
  return total;
}

/** Disk space and number of kept versions, over every installation. */
export async function cacheUsage(installations: WowInstallation[]): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  for (const installation of installations) {
    const root = cacheRoot(installation);
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (name.includes(CURRENT_MARKER)) {
        continue;
      }
      count += 1;
      bytes += await sizeOf(join(root, name));
    }
  }
  return { bytes, count };
}

export async function clearAll(installations: WowInstallation[]): Promise<void> {
  for (const installation of installations) {
    await removeDirectory(cacheRoot(installation)).catch(() => {});
  }
}
