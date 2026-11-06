/**
 * The previous version of each addon, kept after an update so it can be
 * rolled back (BEYOND-02; WowUp has no rollback). One version per addon, in
 * `AddOns/.wowdeck/rollback/<addonId>/`: next to the addon on the same
 * disk, so keeping and restoring are renames even on an SD card, and inside
 * a dot folder that neither WoW nor our scanner loads. `meta.json` says what
 * the folders are. Keeping a version and Roll back itself move folders only
 * through the addon transaction (AddonTransaction.ts); this module reads,
 * measures and drops the cache, and says what of the record goes back
 * with the kept folders (keptRelease, restoredSource).
 */
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type { WowInstallation } from "../models";
import type { AddonPatch, AddonRecord } from "./AddonRecords";
import { installsByArchive } from "./archiveMatch";
import { getAddonsPath } from "../installation/InstallationDetector";
import { joinWithin, removeDirectory } from "../fs/safe-fs";

/** The plugin's own folder inside AddOns (install staging, the rollback cache). */
export const STAGING_DIR_NAME = ".wowdeck";
/** A version parked by an older build's Roll back (`<addonId>.current-<uuid>`); not a kept version. */
const CURRENT_MARKER = ".current-";
const ROLLBACK_DIR_NAME = "rollback";
const META = "meta.json";

/**
 * Where the kept version came from: the record's source fields when it was
 * kept. A file's or link's release is its path or link and its content
 * hash, so Manual Install's match (archiveMatch.ts) and the next keep need
 * them back; a file that took over a catalogue addon goes back to that
 * catalogue. Missing in meta.json written by older builds.
 */
export interface KeptSource {
  providerName?: string;
  externalId?: string;
  externalUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  summary?: string;
  archiveHash?: string;
  latestReleaseId?: string;
  latestVersion?: string;
}

export interface PreviousVersion {
  version: string | null;
  releaseId: string | null;
  source?: KeptSource;
  folders: string[];
  savedAt: number;
}

/** What an install or a Roll back writes about the version it moves into the cache. */
export type KeptRelease = Pick<PreviousVersion, "version" | "releaseId" | "source">;

/** The release a record has installed now, for the meta.json of the folders about to be kept. */
export function keptRelease(addon: AddonRecord): KeptRelease {
  return {
    version: addon.installedVersion ?? null,
    releaseId: addon.installedExternalReleaseId ?? null,
    // A record the install itself creates (an adopt) has no source yet.
    ...(addon.providerName && {
      source: {
        providerName: addon.providerName,
        externalId: addon.externalId,
        externalUrl: addon.externalUrl,
        downloadUrl: addon.downloadUrl,
        thumbnailUrl: addon.thumbnailUrl,
        summary: addon.summary,
        archiveHash: addon.installedArchiveHash,
        latestReleaseId: addon.externalLatestReleaseId,
        latestVersion: addon.latestVersion,
      },
    }),
  };
}

/**
 * The source fields a Roll back to `previous` writes on `addon`. A
 * catalogue addon rolled back on the same source keeps what the last
 * update check found. A file or link goes back to its own path and
 * content; another source, to that source. Kept by an older build (no
 * `source`), a file or link is its release id, and its content unknown:
 * no hash is better than the outgoing archive's, which would call the
 * newer file a reinstall.
 */
export function restoredSource(addon: AddonRecord, previous: PreviousVersion): AddonPatch {
  const source = previous.source;
  if (source) {
    if (source.providerName === addon.providerName && !installsByArchive(source.providerName ?? "")) {
      return {};
    }
    return {
      providerName: source.providerName,
      externalId: source.externalId,
      externalUrl: source.externalUrl,
      downloadUrl: source.downloadUrl,
      thumbnailUrl: source.thumbnailUrl,
      summary: source.summary,
      installedArchiveHash: source.archiveHash,
      externalLatestReleaseId: source.latestReleaseId,
      latestVersion: source.latestVersion,
    };
  }
  if (!installsByArchive(addon.providerName ?? "")) {
    return {};
  }
  const release = previous.releaseId ?? undefined;
  return {
    installedArchiveHash: undefined,
    externalLatestReleaseId: release,
    ...(release && { externalId: release, downloadUrl: release }),
  };
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
