/**
 * Filesystem side effects for the companion-data bridge. Every write
 * stays inside `<addonsPath>/wowup_data_addon/`, a folder
 * this bridge exclusively owns (nothing else ever lives there), so
 * always rewriting both files it generates is safe — there is no
 * foreign content to preserve or clobber.
 */

import { join } from "node:path";
import { createDirectory, renameSafe } from "../fs/safe-fs";
import { WOWUP_DATA_ADDON_FOLDER_NAME } from "./constants";
import { buildCompanionToc, buildDataLua, type CompanionUpdateEntry } from "./companion-data";

export interface CompanionWritePayload {
  updates: CompanionUpdateEntry[];
  interfaceVersion: string;
  dataVersion: string;
}

/**
 * Temp-write + rename: a crash or kill mid-write leaves either the
 * previous file or the fully-written new one, never a
 * truncated one. The temp file lives next to its target, so the rename
 * is same-directory and never crosses a filesystem boundary.
 */
async function writeFileAtomic(targetPath: string, contents: string): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await Bun.write(tmpPath, contents);
  await renameSafe(tmpPath, targetPath);
}

/** Absolute path of the manager-generated companion-data folder for one installation's AddOns dir. */
export function companionDataPath(addonsPath: string): string {
  return join(addonsPath, WOWUP_DATA_ADDON_FOLDER_NAME);
}

/**
 * Write both companion-data files for one installation. Idempotent;
 * creates the folder on first write. Both files are fully owned by
 * this integration, so a plain rewrite is always correct — there is
 * never a partial-ownership merge to perform.
 */
export async function writeCompanionData(addonsPath: string, payload: CompanionWritePayload): Promise<void> {
  const dir = companionDataPath(addonsPath);
  await createDirectory(dir);
  await writeFileAtomic(join(dir, "data.lua"), buildDataLua(payload.updates, new Date()));
  await writeFileAtomic(
    join(dir, "wowup_data_addon.toc"),
    buildCompanionToc({ interfaceVersion: payload.interfaceVersion, dataVersion: payload.dataVersion }),
  );
}
