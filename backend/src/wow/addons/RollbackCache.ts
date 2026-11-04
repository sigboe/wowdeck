/**
 * The previous version of each addon, kept after an update so it can be
 * rolled back (BEYOND-02; WowUp has no rollback). One version per addon, in
 * `AddOns/.wowdeck/rollback/<addonId>/`: next to the addon on the same
 * disk, so keeping and restoring are renames even on an SD card, and inside
 * a dot folder that neither WoW nor our scanner loads. `meta.json` says what
 * the folders are. Keeping a version and Roll back itself move folders only
 * through the addon transaction (AddonTransaction.ts); this module reads,
 * measures and drops the cache.
 */
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type { WowInstallation } from "../models";
import { getAddonsPath } from "../installation/InstallationDetector";
import { joinWithin, removeDirectory } from "../fs/safe-fs";

/** The plugin's own folder inside AddOns (install staging, the rollback cache). */
export const STAGING_DIR_NAME = ".wowdeck";
/** A version parked by an older build's Roll back (`<addonId>.current-<uuid>`); not a kept version. */
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

export async function dropPrevious(installation: WowInstallation, addonId: string): Promise<void> {
  await removeDirectory(rollbackDir(installation, addonId)).catch(() => {});
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
