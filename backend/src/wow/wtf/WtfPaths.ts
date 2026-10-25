/**
 * Path rules for WTF backups (project-owned).
 *
 * Derived from wowup-electron/src/app/services/wtf/wtf.service.ts
 * (GPL-3.0, commit 4fdae600): `wtf_<epochMs>.zip` naming and the
 * `wowup-meta.json` entry name are kept so backups interoperate with
 * desktop WowUp. Everything else is reimplemented. See
 * docs/wowup-provenance.md and docs/wtf-backup.md.
 */

import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { WtfBackupError } from "./errors";

export const WTF_DIR_NAME = "WTF";
export const BACKUP_META_NAME = "wowup-meta.json";
export const PARTIAL_SUFFIX = ".partial";

/** The WTF folder of an installation. `location` is the flavor dir (…/_retail_). */
export function wtfPathFor(installationLocation: string): string {
  return join(installationLocation, WTF_DIR_NAME);
}

/**
 * The flavor key for an installation: its flavor folder name (`_retail_`,
 * `_classic_ptr_`, `_anniversary_`, …) so Classic and its PTR — or Era and
 * Anniversary — never share a backup list. Falls back to the coarse game
 * type for manually added folders with an unusual name.
 */
export function flavorKeyFor(installationLocation: string, fallbackGameType: string): string {
  const base = basename(installationLocation).toLowerCase();
  return /^_[a-z0-9_]+_$/.test(base) ? base : fallbackGameType;
}

/** Backups live in one folder per flavor (NOT per installation id — ids are path hashes and change when WoW moves). */
export function flavorBackupDir(backupRoot: string, flavor: string): string {
  if (!/^[a-z0-9_]+$/.test(flavor)) {
    throw new WtfBackupError("backup_dir_invalid", "invalid flavor");
  }
  return join(backupRoot, flavor);
}

/** A bare `*.zip` file name: no separators, not hidden, not a partial. Anything else must never reach the filesystem. */
export function isBareZipName(name: string): boolean {
  return (
    name.length > 4 &&
    name.length < 200 &&
    !name.startsWith(".") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    name.toLowerCase().endsWith(".zip")
  );
}

export function assertBareZipName(name: string): string {
  if (!isBareZipName(name)) {
    throw new WtfBackupError("not_found", "backup file name is not valid");
  }
  return name;
}

export function backupFileName(epochMs: number): string {
  return `wtf_${epochMs}.zip`;
}

/**
 * Validate a user-chosen backup folder (settings). Must be an absolute path
 * to an existing, writable directory that is not inside an installation's
 * WTF or Interface folder (a restore replaces WTF wholesale).
 */
export async function validateBackupDir(dir: string, installationLocations: string[]): Promise<string> {
  const { stat, unlink, writeFile } = await import("node:fs/promises");
  if (dir.includes("\0") || !isAbsolute(dir)) {
    throw new WtfBackupError("backup_dir_invalid", "Choose a full folder path.");
  }
  const resolved = resolve(dir);
  for (const location of installationLocations) {
    for (const protectedDir of [join(location, WTF_DIR_NAME), join(location, "Interface")]) {
      if (resolved === protectedDir || resolved.startsWith(protectedDir + sep)) {
        throw new WtfBackupError("backup_dir_invalid", "Backups can't be stored inside the game's WTF or Interface folders.");
      }
    }
  }
  const st = await stat(resolved).catch(() => null);
  if (!st?.isDirectory()) {
    throw new WtfBackupError("backup_dir_unavailable", "That folder doesn't exist. Is the SD card inserted?");
  }
  const probe = join(resolved, `.wowdeck-write-test-${process.pid}`);
  try {
    await writeFile(probe, "");
    await unlink(probe);
  } catch {
    throw new WtfBackupError("backup_dir_invalid", "That folder isn't writable.");
  }
  return resolved;
}
