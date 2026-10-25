/**
 * Backup metadata (`wowup-meta.json`) — a superset of desktop WowUp's.
 *
 * Compatibility rules, VERIFIED against upstream's real restore path
 * (adm-zip 0.5.12 / yauzl 3.4.0, spike S6 — see WF-01 plan §17):
 *  - `contents` must list the WTF root (`path: ""`), EVERY directory and
 *    EVERY file, with a leading "/". Upstream compares
 *    `contents.length` with the number of nodes it finds after
 *    extracting (root + dirs + files) and throws on a mismatch.
 *  - the zip must carry explicit `dir/` entries so empty directories are
 *    recreated.
 *  - directory `hash` is optional (upstream only logs a warning).
 * The extra `wowupDecky` block is ignored by upstream.
 */

import { WtfBackupError } from "./errors";

export type BackupKind = "manual" | "pre-restore" | "auto" | "unknown";

export interface BackupMetaEntry {
  path: string;
  isDirectory: boolean;
  size: number;
  hash?: string;
}

export interface BackupMeta {
  createdBy: string;
  createdAt: number;
  contents: BackupMetaEntry[];
  wowupDecky?: {
    formatVersion: number;
    /** Flavor key of the installation the backup was made for (`_retail_`, …). */
    flavor: string;
    /** Random id of the plugin install that made the backup (see StateStore.deviceId). */
    deviceId?: string;
    pluginVersion?: string;
  };
}

export function kindOf(createdBy: string): BackupKind {
  return createdBy === "manual" || createdBy === "pre-restore" || createdBy === "auto" ? createdBy : "unknown";
}

function invalid(reason: string): never {
  console.error(`[wtf] backup metadata is not valid (${reason})`);
  throw new WtfBackupError("backup_invalid", "This backup is damaged");
}

/** Parse and validate; upstream-made metadata (no `wowupDecky`) is accepted. */
export function parseBackupMeta(text: string): BackupMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid("not JSON");
  }
  if (typeof raw !== "object" || raw === null) {
    return invalid("not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.contents)) {
    return invalid("no contents list");
  }
  if (typeof obj.createdAt !== "number" || !Number.isFinite(obj.createdAt)) {
    return invalid("no creation time");
  }
  if (typeof obj.createdBy !== "string") {
    return invalid("no creator");
  }
  const contents: BackupMetaEntry[] = [];
  for (const item of obj.contents) {
    if (typeof item !== "object" || item === null) {
      return invalid("bad entry");
    }
    const e = item as Record<string, unknown>;
    if (typeof e.path !== "string" || typeof e.isDirectory !== "boolean" || typeof e.size !== "number" || !(e.size >= 0)) {
      return invalid("bad entry");
    }
    contents.push({
      path: e.path,
      isDirectory: e.isDirectory,
      size: e.size,
      ...(typeof e.hash === "string" && e.hash !== "" ? { hash: e.hash } : {}),
    });
  }
  const meta: BackupMeta = { createdBy: obj.createdBy, createdAt: obj.createdAt, contents };
  const dk = obj.wowupDecky;
  if (typeof dk === "object" && dk !== null) {
    const d = dk as Record<string, unknown>;
    if (typeof d.flavor === "string") {
      meta.wowupDecky = {
        formatVersion: typeof d.formatVersion === "number" ? d.formatVersion : 1,
        flavor: d.flavor,
        ...(typeof d.deviceId === "string" && d.deviceId ? { deviceId: d.deviceId } : {}),
        ...(typeof d.pluginVersion === "string" ? { pluginVersion: d.pluginVersion } : {}),
      };
    }
  }
  return meta;
}
