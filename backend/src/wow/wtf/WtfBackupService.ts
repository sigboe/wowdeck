/**
 * WTF backup service (project-owned; behaviour derived from
 * wowup-electron wtf.service.ts, GPL-3.0, commit 4fdae600 — see
 * docs/wowup-provenance.md and docs/wtf-backup.md).
 *
 * create / list / delete / measure / restore (safety snapshot, staged
 * extract + verify, atomic swap) / recover (interrupted operations).
 *
 * Everything here is independent of installations: callers pass a
 * `WtfTarget` (the WTF folder + game flavor), which keeps the logic
 * unit-testable on temp directories.
 */

import { copyFile, rename as fsRename, stat, statfs, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { GameRunning, WtfBackupInfo, WtfCopySource, WtfPhase } from "../../api/contracts";
import { createDirectory, isDirectory, listDirectory, pathExists, removeDirectory } from "../fs/safe-fs";
import { kindOf, parseBackupMeta, type BackupKind, type BackupMeta, type BackupMetaEntry } from "./BackupMeta";
import { WtfBackupError } from "./errors";
import { assertBareZipName, backupFileName, BACKUP_META_NAME, flavorBackupDir, isBareZipName, PARTIAL_SUFFIX } from "./WtfPaths";
import { listZipEntries, readZipEntryText } from "./ZipReader";
import { extractBackupZip } from "./ZipExtractor";
import { detectGameRunning } from "./GameProcessGuard";
import { throwIfAborted, writeBackupZip } from "./ZipWriter";
import { walkWtf } from "./WtfWalker";
import { areRelated, flavorDisplayName } from "./VersionFamilies";

export interface WtfTarget {
  /** Absolute path of the WTF folder. */
  wtfPath: string;
  /** Flavor key, see flavorKeyFor(). */
  flavor: string;
}

export interface BackupRoot {
  path: string;
  /** User-chosen folder (may live on removable storage) vs the plugin's own data dir. */
  custom: boolean;
}

export interface WtfServiceOptions {
  backupRoot: () => BackupRoot;
  now?: () => number;
  pluginVersion?: () => string | undefined;
  /** Id of this plugin install, written into backups it makes. */
  deviceId?: () => string;
  /** Free bytes on the volume holding `path`, or null when unknown. Injectable for tests. */
  freeBytes?: (path: string) => Promise<number | null>;
  /**
   * Whether WoW is running, asked about the WTF folder an operation would overwrite. Defaults to a /proc
   * scan, which sees one state for every version (it can't tell which installation is running).
   */
  gameStatus?: (target?: WtfTarget) => Promise<GameRunning>;
  /** How many "pre-restore" safety snapshots to keep per flavor (default 3). */
  keepSnapshots?: () => number;
  /** Rename used for the restore swap. Injectable so failure handling can be tested. */
  rename?: (from: string, to: string) => Promise<void>;
}


export interface CreateOptions {
  kind: Exclude<BackupKind, "unknown">;
  signal?: AbortSignal;
  onProgress?: (phase: WtfPhase, done: number, total: number | null) => void;
}

export interface RestoreOptions {
  /** Required to restore a backup that doesn't record its game flavor (made by desktop WowUp). */
  acceptUnknownFlavor?: boolean;
  /** Keep this device's current Config.wtf (graphics/display settings) instead of the backup's. Default: on for a copy, off otherwise. */
  keepCurrentConfig?: boolean;
  /**
   * Settings copy: restore a backup of this other version (flavor key) instead of one of the target's
   * own. The backup is read from that version's folder and must record that version (or none).
   */
  sourceFlavor?: string;
  signal?: AbortSignal;
  onProgress?: (phase: WtfPhase, done: number, total: number | null) => void;
}

export interface RestoreResult {
  restoredFileName: string;
  /** The automatic safety backup of the settings that were replaced (null when there was no WTF yet). */
  snapshotFileName: string | null;
}

export interface ListResult {
  backupDir: string;
  dirAvailable: boolean;
  backups: WtfBackupInfo[];
  totalBackupBytes: number;
}

/** An installed WoW version, as Settings copy sees it. */
export interface InstalledFlavor {
  installationId: string;
  flavor: string;
  /** Its WTF folder (its current settings, when present). */
  wtfPath: string;
}

export interface CopyCurrentOptions {
  /** As RestoreOptions.keepCurrentConfig (default on for a copy). */
  keepCurrentConfig?: boolean;
  signal?: AbortSignal;
  onProgress?: (phase: WtfPhase, done: number, total: number | null) => void;
}

export interface CopySourcesResult {
  dirAvailable: boolean;
  sources: WtfCopySource[];
}

export interface MeasureResult {
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  freeBytes: number | null;
}

/** Extra headroom on top of the conservative compression estimate. */
const SPACE_SLACK_BYTES = 64 * 1024 * 1024;
const SPACE_RATIO = 0.6;
const META_READ_CONCURRENCY = 4;
const STAGE_PREFIX = ".WTF-restore-";
const OLD_PREFIX = "WTF-pre-restore-";
const STAGE_RE = /^\.WTF-restore-\d+$/;
const OLD_RE = /^WTF-pre-restore-\d+$/;
const CONFIG_FILE = "Config.wtf";

async function defaultFreeBytes(path: string): Promise<number | null> {
  try {
    let probe = path;
    while (!(await pathExists(probe))) {
      const parent = dirname(probe);
      if (parent === probe) {
        return null;
      }
      probe = parent;
    }
    const s = await statfs(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** A WTF folder's current settings for Settings copy, or null when there is no folder. */
async function currentSettings(wtfPath: string): Promise<WtfCopySource["current"]> {
  if (!(await isDirectory(wtfPath))) {
    return null;
  }
  const config = await stat(join(wtfPath, CONFIG_FILE)).catch(() => null);
  const modified = config?.isFile() ? config : await stat(wtfPath);
  return { modifiedAt: Math.floor(modified.mtimeMs), hasConfig: config?.isFile() ?? false };
}

export class WtfBackupService {
  readonly #opts: WtfServiceOptions;
  readonly #now: () => number;
  readonly #metaCache = new Map<string, { key: string; info: WtfBackupInfo }>();
  #busy = false;
  /** Set once a restore reaches the swap: from then on it cannot be cancelled. */
  #committed = false;

  constructor(opts: WtfServiceOptions) {
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
  }

  /** True while a create/restore runs (one WTF job at a time per engine). */
  #deviceId(): string {
    return this.#opts.deviceId?.() ?? "local";
  }

  get busy(): boolean {
    return this.#busy;
  }

  get committed(): boolean {
    return this.#committed;
  }

  async #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#busy) {
      throw new WtfBackupError("job_in_progress", "Another backup or restore is already running.");
    }
    this.#busy = true;
    this.#committed = false;
    try {
      return await fn();
    } finally {
      this.#busy = false;
      this.#committed = false;
    }
  }

  async gameStatus(target?: WtfTarget): Promise<GameRunning> {
    return this.#opts.gameStatus ? this.#opts.gameStatus(target) : detectGameRunning();
  }

  #freeBytes(path: string): Promise<number | null> {
    return (this.#opts.freeBytes ?? defaultFreeBytes)(path);
  }

  /** Resolve (and for the default root, create) the flavor backup folder. */
  async #prepareBackupDir(target: WtfTarget): Promise<string> {
    const root = this.#opts.backupRoot();
    if (root.custom) {
      // Never mkdir -p a user-chosen root: if removable storage is unmounted that would silently create the path on the internal disk.
      if (!(await isDirectory(root.path))) {
        throw new WtfBackupError("backup_dir_unavailable", "The backup folder isn't available. Is the SD card inserted?");
      }
    }
    const dir = flavorBackupDir(root.path, target.flavor);
    await createDirectory(dir);
    return dir;
  }

  async measure(target: WtfTarget): Promise<MeasureResult> {
    const exists = await isDirectory(target.wtfPath);
    const root = this.#opts.backupRoot();
    const freeBytes = await this.#freeBytes(root.path);
    if (!exists) {
      return { exists: false, fileCount: 0, totalBytes: 0, freeBytes };
    }
    const walk = await walkWtf(target.wtfPath);
    return { exists: true, fileCount: walk.fileCount, totalBytes: walk.totalBytes, freeBytes };
  }

  async createBackup(target: WtfTarget, options: CreateOptions): Promise<WtfBackupInfo> {
    return this.#exclusive(() => this.#createUnlocked(target, options));
  }

  async #createUnlocked(target: WtfTarget, options: CreateOptions): Promise<WtfBackupInfo> {
    if (!(await isDirectory(target.wtfPath))) {
      throw new WtfBackupError("wtf_missing", "There's no WTF folder to back up yet. Start WoW and log in once first.");
    }
    const dir = await this.#prepareBackupDir(target);

    options.onProgress?.("scan", 0, null);
    const walk = await walkWtf(target.wtfPath);

    const free = await this.#freeBytes(dir);
    const needed = Math.floor(walk.totalBytes * SPACE_RATIO) + SPACE_SLACK_BYTES;
    if (free !== null && free < needed) {
      throw new WtfBackupError("insufficient_space", "Not enough free space for this backup.");
    }

    let createdAt = this.#now();
    while (await pathExists(join(dir, backupFileName(createdAt)))) {
      createdAt += 1;
    }
    const fileName = backupFileName(createdAt);
    const finalPath = join(dir, fileName);
    const partialPath = `${finalPath}${PARTIAL_SUFFIX}`;

    const result = await writeBackupZip({
      outPath: partialPath,
      entries: walk.entries,
      totalBytes: walk.totalBytes,
      signal: options.signal,
      onProgress: (done, total) => options.onProgress?.("compress", done, total),
      buildMeta: (contents): BackupMeta => ({
        createdBy: options.kind,
        createdAt,
        contents,
        wowupDecky: {
          formatVersion: 1,
          flavor: target.flavor,
          deviceId: this.#deviceId(),
          ...(this.#opts.pluginVersion?.() ? { pluginVersion: this.#opts.pluginVersion() } : {}),
        },
      }),
    });

    try {
      // Cheap read-back: the central directory must account for every entry we wrote (+ the metadata).
      const entries = await listZipEntries(partialPath);
      if (entries.length !== result.dirCount + result.fileCount + 1) {
        throw new WtfBackupError("backup_invalid", "The backup could not be verified after writing.");
      }
      await fsRename(partialPath, finalPath);
    } catch (err) {
      await unlink(partialPath).catch(() => {});
      throw err;
    }
    const info = await this.#readInfo(finalPath, fileName);
    if (options.kind === "pre-restore") {
      await this.#prune(target, "pre-restore", this.#opts.keepSnapshots?.() ?? 3, fileName);
    }
    return info;
  }

  /** Delete the oldest backups of one auto-created kind beyond `keep`. Manual backups are never auto-deleted. */
  async #prune(target: WtfTarget, kind: BackupKind, keep: number, exceptFileName: string): Promise<void> {
    const { backups } = await this.listBackups(target);
    const same = backups.filter((b) => b.valid && b.kind === kind && b.fileName !== exceptFileName);
    // `except` (just created) counts toward the quota
    for (const old of same.slice(Math.max(0, keep - 1))) {
      await this.#deleteUnlocked(target, old.fileName).catch(() => {});
    }
  }

  async listBackups(target: WtfTarget): Promise<ListResult> {
    return this.#listFlavor(target.flavor);
  }

  /** One flavor's backups, newest first (they are keyed by flavor, not by WTF folder). */
  async #listFlavor(flavor: string): Promise<ListResult> {
    const root = this.#opts.backupRoot();
    const backupDir = flavorBackupDir(root.path, flavor);
    if (root.custom && !(await isDirectory(root.path))) {
      return { backupDir, dirAvailable: false, backups: [], totalBackupBytes: 0 };
    }
    const names = (await listDirectory(backupDir))
      .filter((e) => !e.isDirectory && !e.isSymlink && isBareZipName(e.name))
      .map((e) => e.name);
    const infos: WtfBackupInfo[] = [];
    for (let i = 0; i < names.length; i += META_READ_CONCURRENCY) {
      const batch = names.slice(i, i + META_READ_CONCURRENCY);
      infos.push(...(await Promise.all(batch.map((n) => this.#readInfo(join(backupDir, n), n)))));
    }
    infos.sort((a, b) => b.createdAt - a.createdAt);
    return {
      backupDir,
      dirAvailable: true,
      backups: infos,
      totalBackupBytes: infos.reduce((sum, b) => sum + b.sizeBytes, 0),
    };
  }

  /**
   * Other versions a Settings copy can bring settings from: every flavor other than the target's that
   * has a valid backup, installed (from `installed`) or backups only. Related first, then newest first;
   * the first one is the default.
   */
  async listCopySources(target: WtfTarget, installed: InstalledFlavor[]): Promise<CopySourcesResult> {
    const root = this.#opts.backupRoot();
    if (root.custom && !(await isDirectory(root.path))) {
      return { dirAvailable: false, sources: [] };
    }
    const folders = (await listDirectory(root.path))
      .filter((e) => e.isDirectory && !e.isSymlink && /^[a-z0-9_]+$/.test(e.name))
      .map((e) => e.name);
    const flavors = [...new Set([...folders, ...installed.map((i) => i.flavor)])].filter((f) => f !== target.flavor);
    const gameRunning = await this.gameStatus();
    const sources: WtfCopySource[] = [];
    for (const flavor of flavors) {
      const { backups } = await this.#listFlavor(flavor);
      const installation = installed.find((i) => i.flavor === flavor);
      const current = installation ? await currentSettings(installation.wtfPath) : null;
      if (!current && !backups.some((b) => b.valid)) {
        continue;
      }
      sources.push({
        flavor,
        displayName: flavorDisplayName(flavor),
        installed: installation !== undefined,
        installationId: installation?.installationId ?? null,
        related: areRelated(flavor, target.flavor),
        gameRunning,
        current,
        backups,
        isDefault: false,
      });
    }
    const newest = (s: WtfCopySource) => Math.max(s.current?.modifiedAt ?? 0, s.backups.find((b) => b.valid)?.createdAt ?? 0);
    sources.sort((a, b) => Number(b.related) - Number(a.related) || newest(b) - newest(a));
    if (sources[0]) {
      sources[0].isDefault = true;
    }
    return { dirAvailable: true, sources };
  }

  /** Delete one backup; refused while a backup or restore runs (the same lock as jobs). */
  async deleteBackup(target: WtfTarget, fileName: string): Promise<void> {
    assertBareZipName(fileName);
    return this.#exclusive(() => this.#deleteUnlocked(target, fileName));
  }

  /** The delete itself; callers hold the lock (a job's own retention pruning does). */
  async #deleteUnlocked(target: WtfTarget, fileName: string): Promise<void> {
    const path = join(flavorBackupDir(this.#opts.backupRoot().path, target.flavor), fileName);
    if (!(await pathExists(path))) {
      throw new WtfBackupError("not_found", "That backup no longer exists.");
    }
    await unlink(path);
    this.#metaCache.delete(path);
  }

  /**
   * Restore a backup: stage, verify, swap — and always keep a way back.
   *
   *  1. preconditions (flavor, WoW not running, free space)
   *  2. safety snapshot of the current WTF (abort if it fails)
   *  3. stream-extract into a staging dir next to WTF (same filesystem)
   *  4. verify (done while streaming) + optionally keep this device's Config.wtf
   *  5. swap: WTF -> WTF-pre-restore-<ts>, staging -> WTF (rolled back on failure)
   *  6. remove the old copy — the snapshot zip is the user's safety net
   */
  async restoreBackup(target: WtfTarget, fileName: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    return this.#exclusive(() => this.#restoreUnlocked(target, fileName, options));
  }

  async #restoreUnlocked(target: WtfTarget, fileName: string, options: RestoreOptions): Promise<RestoreResult> {
    const { onProgress, signal } = options;
    assertBareZipName(fileName);
    const root = this.#opts.backupRoot();
    if (root.custom && !(await isDirectory(root.path))) {
      throw new WtfBackupError("backup_dir_unavailable", "The backup folder isn't available. Is the SD card inserted?");
    }
    const sourceFlavor = options.sourceFlavor ?? target.flavor;
    const copying = sourceFlavor !== target.flavor;
    const zipPath = join(flavorBackupDir(root.path, sourceFlavor), fileName);
    if (!(await pathExists(zipPath))) {
      throw new WtfBackupError("not_found", "That backup no longer exists.");
    }
    const flavorDir = dirname(target.wtfPath);
    if (!(await isDirectory(flavorDir))) {
      throw new WtfBackupError("wtf_missing", "The WoW folder for this installation wasn't found.");
    }

    // Heal anything an earlier interrupted operation left behind before we add our own staging dirs.
    await this.#recoverUnlocked(target);

    const meta = await this.readMeta(zipPath);
    const recorded = meta.wowupDecky?.flavor;
    // A copy names its source on purpose, so a desktop WowUp backup in that version's folder needs no confirm.
    if (recorded === undefined) {
      if (!options.acceptUnknownFlavor && !copying) {
        throw new WtfBackupError(
          "flavor_unknown_needs_confirm",
          "This backup doesn't say which WoW version it is for. Confirm it is for this one to continue.",
        );
      }
    } else if (recorded !== sourceFlavor) {
      throw new WtfBackupError("flavor_mismatch", "This backup was made for a different WoW version.");
    }

    if ((await this.gameStatus(target)) === "running") {
      throw new WtfBackupError("game_running", "Close World of Warcraft first. It rewrites these files when you log out.");
    }

    const expected = new Map<string, BackupMetaEntry>(meta.contents.map((c) => [c.path, c]));
    const totalBytes = meta.contents.reduce((sum, c) => sum + (c.isDirectory ? 0 : c.size), 0);
    const free = await this.#freeBytes(flavorDir);
    if (free !== null && free < totalBytes + SPACE_SLACK_BYTES) {
      throw new WtfBackupError("insufficient_space", "Not enough free space to restore this backup.");
    }

    // Never restore without a net: snapshot the current settings first (nothing to snapshot on a fresh install).
    let snapshotFileName: string | null = null;
    const hadWtf = await isDirectory(target.wtfPath);
    if (hadWtf) {
      throwIfAborted(signal);
      const snapshot = await this.#createUnlocked(target, {
        kind: "pre-restore",
        signal,
        onProgress: (_phase, done, total) => onProgress?.("snapshot", done, total),
      });
      snapshotFileName = snapshot.fileName;
    }

    const stamp = this.#now();
    const stageDir = join(flavorDir, `${STAGE_PREFIX}${stamp}`);
    const oldDir = join(flavorDir, `${OLD_PREFIX}${stamp}`);
    const doRename = this.#opts.rename ?? fsRename;

    try {
      throwIfAborted(signal);
      onProgress?.("extract", 0, totalBytes);
      await extractBackupZip({
        zipPath,
        stageDir,
        expected,
        totalBytes,
        signal,
        onProgress: (done, total) => onProgress?.("extract", done, total),
      });

      onProgress?.("verify", 0, null);
      const staged = await walkWtf(stageDir, { excludeBak: false });
      const wantFiles = meta.contents.filter((c) => !c.isDirectory).length;
      const wantDirs = meta.contents.filter((c) => c.isDirectory && c.path !== "").length;
      if (staged.fileCount !== wantFiles || staged.dirCount !== wantDirs) {
        throw new WtfBackupError("verify_failed", "The restored files didn't match the backup. Nothing was changed.");
      }

      // "Keep this device's graphics/display settings": the current Config.wtf replaces the backup's.
      // With no current Config.wtf there is nothing to keep, so the backup's own is restored rather
      // than leaving the device without one; a backup without a Config.wtf just keeps the current one.
      // Another version's Config.wtf never describes this installation's client, so a copy keeps this one unless told not to.
      if (options.keepCurrentConfig ?? copying) {
        const current = join(target.wtfPath, CONFIG_FILE);
        if (hadWtf && (await pathExists(current))) {
          await copyFile(current, join(stageDir, CONFIG_FILE));
        }
      }

      // Last chance to cancel; after this the swap is two renames.
      throwIfAborted(signal);
      this.#committed = true;
      onProgress?.("swap", 0, null);
      if (hadWtf) {
        await doRename(target.wtfPath, oldDir);
      }
      try {
        await doRename(stageDir, target.wtfPath);
      } catch (err) {
        if (hadWtf) {
          await doRename(oldDir, target.wtfPath);
        }
        throw err;
      }
    } catch (err) {
      await removeDirectory(stageDir).catch(() => {});
      throw err;
    }

    onProgress?.("cleanup", 0, null);
    await removeDirectory(oldDir).catch(() => {});
    return { restoredFileName: fileName, snapshotFileName };
  }

  /**
   * Settings copy of another installation's current settings, as one operation: back up `source`'s WTF
   * as a manual backup in its own list (kept afterwards, the record of what was copied), then restore that
   * backup into `target` exactly as a backup copy does. The source's WTF is only read; WoW running there
   * isn't checked (the backup just won't include that session's changes). WoW running for the target
   * blocks before anything is written. If the copy doesn't happen (cancel, failure), the source backup
   * is removed again, so both sides are as they were.
   */
  async copyCurrentSettings(target: WtfTarget, source: WtfTarget, options: CopyCurrentOptions = {}): Promise<RestoreResult> {
    return this.#exclusive(async () => {
      const { signal, onProgress } = options;
      if (source.flavor === target.flavor) {
        throw new WtfBackupError("flavor_mismatch", "Choose another WoW version to copy from.");
      }
      if (!(await isDirectory(source.wtfPath))) {
        throw new WtfBackupError("wtf_missing", "That version has no settings to copy yet.");
      }
      if (!(await isDirectory(dirname(target.wtfPath)))) {
        throw new WtfBackupError("wtf_missing", "The WoW folder for this installation wasn't found.");
      }
      if ((await this.gameStatus(target)) === "running") {
        throw new WtfBackupError("game_running", "Close World of Warcraft first. It rewrites these files when you log out.");
      }
      // Reported as scan/compress; the target's own safety backup that follows is "snapshot".
      const backup = await this.#createUnlocked(source, { kind: "manual", signal, onProgress });
      try {
        return await this.#restoreUnlocked(target, backup.fileName, {
          sourceFlavor: source.flavor,
          keepCurrentConfig: options.keepCurrentConfig,
          signal,
          onProgress,
        });
      } catch (err) {
        await this.#deleteUnlocked(source, backup.fileName).catch(() => {});
        throw err;
      }
    });
  }

  /**
   * Heal what an interrupted restore left behind (engine killed, power loss, sleep):
   *  - no WTF + a WTF-pre-restore-<ts>  -> the swap died halfway: put the old one back
   *  - WTF + WTF-pre-restore-<ts>       -> the swap finished: drop the leftover copy
   *  - .WTF-restore-<ts> staging dirs   -> drop (never complete)
   * Idempotent. A no-op while a job is running.
   */
  async recover(target: WtfTarget): Promise<{ restoredPreviousWtf: boolean }> {
    if (this.#busy) {
      return { restoredPreviousWtf: false };
    }
    return this.#recoverUnlocked(target);
  }

  async #recoverUnlocked(target: WtfTarget): Promise<{ restoredPreviousWtf: boolean }> {
    const flavorDir = dirname(target.wtfPath);
    const names = (await listDirectory(flavorDir)).filter((e) => e.isDirectory).map((e) => e.name);
    const olds = names.filter((n) => OLD_RE.test(n)).sort((a, b) => Number(b.slice(OLD_PREFIX.length)) - Number(a.slice(OLD_PREFIX.length)));
    const stages = names.filter((n) => STAGE_RE.test(n));
    let restoredPreviousWtf = false;
    const doRename = this.#opts.rename ?? fsRename;
    if (!(await isDirectory(target.wtfPath)) && olds.length > 0) {
      await doRename(join(flavorDir, olds[0]!), target.wtfPath);
      olds.shift();
      restoredPreviousWtf = true;
    }
    if (await isDirectory(target.wtfPath)) {
      for (const n of olds) {
        await removeDirectory(join(flavorDir, n)).catch(() => {});
      }
    }
    for (const n of stages) {
      await removeDirectory(join(flavorDir, n)).catch(() => {});
    }
    return { restoredPreviousWtf };
  }

  /** Remove `*.zip.partial` files left by an interrupted backup, in every flavor folder. A no-op while a job runs. */
  async sweepPartials(): Promise<number> {
    if (this.#busy) {
      return 0;
    }
    const root = this.#opts.backupRoot();
    if (root.custom && !(await isDirectory(root.path))) {
      return 0;
    }
    let removed = 0;
    for (const flavor of await listDirectory(root.path)) {
      if (!flavor.isDirectory) {
        continue;
      }
      for (const f of await listDirectory(flavor.path)) {
        if (!f.isDirectory && f.name.endsWith(PARTIAL_SUFFIX)) {
          await unlink(f.path).then(() => (removed += 1)).catch(() => {});
        }
      }
    }
    return removed;
  }

  /**
   * Add a backup zip from anywhere (e.g. one made on another computer and copied over, or by desktop
   * WowUp) to this flavor's list. Validated before anything is copied: a readable zip with WowUp-style
   * metadata, and — when it records a flavor — the right one. Copied via `.partial` + atomic rename.
   * Importing a file that is already in the list is a no-op that returns the existing name.
   */
  async importBackup(target: WtfTarget, sourcePath: string): Promise<{ fileName: string; alreadyPresent: boolean }> {
    return this.#exclusive(async () => {
      if (sourcePath.includes("\0") || !isAbsolute(sourcePath) || !sourcePath.toLowerCase().endsWith(".zip")) {
        throw new WtfBackupError("backup_invalid", "Choose a .zip backup file.");
      }
      const st = await stat(sourcePath).catch(() => null);
      if (!st?.isFile()) {
        throw new WtfBackupError("not_found", "That file doesn't exist.");
      }
      const meta = await this.readMeta(sourcePath);
      const recorded = meta.wowupDecky?.flavor;
      if (recorded !== undefined && recorded !== target.flavor) {
        throw new WtfBackupError("flavor_mismatch", "This backup was made for a different WoW version.");
      }
      const dir = await this.#prepareBackupDir(target);
      const resolvedSource = resolve(sourcePath);
      if (dirname(resolvedSource) === resolve(dir)) {
        return { fileName: resolvedSource.slice(resolve(dir).length + 1), alreadyPresent: true };
      }
      const free = await this.#freeBytes(dir);
      if (free !== null && free < st.size + SPACE_SLACK_BYTES) {
        throw new WtfBackupError("insufficient_space", "Not enough free space for this backup.");
      }
      let stamp = Math.floor(meta.createdAt);
      for (;;) {
        const name = backupFileName(stamp);
        const existing = join(dir, name);
        if (!(await pathExists(existing))) {
          break;
        }
        if ((await stat(existing)).size === st.size) {
          return { fileName: name, alreadyPresent: true };
        }
        stamp += 1;
      }
      const fileName = backupFileName(stamp);
      const finalPath = join(dir, fileName);
      const partial = `${finalPath}${PARTIAL_SUFFIX}`;
      try {
        await copyFile(sourcePath, partial);
        await fsRename(partial, finalPath);
      } catch (err) {
        await unlink(partial).catch(() => {});
        throw err;
      }
      return { fileName, alreadyPresent: false };
    });
  }

  /** Read a backup's metadata cheaply (ranged reads), cached by path + mtime + size. */
  async readMeta(zipPath: string): Promise<BackupMeta> {
    const entries = await listZipEntries(zipPath);
    const metaEntry = entries.find((e) => e.name === BACKUP_META_NAME);
    if (!metaEntry) {
      throw new WtfBackupError("backup_invalid", "Made by another app, not WowUp");
    }
    return parseBackupMeta(await readZipEntryText(zipPath, metaEntry));
  }

  async #readInfo(path: string, fileName: string): Promise<WtfBackupInfo> {
    const st = await stat(path);
    const key = `${st.mtimeMs}:${st.size}`;
    const cached = this.#metaCache.get(path);
    if (cached && cached.key === key) {
      return cached.info;
    }
    let info: WtfBackupInfo;
    try {
      const meta = await this.readMeta(path);
      const fromThisDevice = meta.wowupDecky?.deviceId !== undefined && meta.wowupDecky.deviceId === this.#deviceId();
      info = {
        fileName,
        sizeBytes: st.size,
        createdAt: meta.createdAt,
        kind: kindOf(meta.createdBy),
        fileCount: meta.contents.filter((c) => !c.isDirectory).length,
        flavor: meta.wowupDecky?.flavor ?? null,
        hasConfig: meta.contents.some((c) => !c.isDirectory && c.path === `/${CONFIG_FILE}`),
        fromThisDevice,
        // Desktop WowUp backups and backups from another plugin install: their Config.wtf describes another machine's display.
        keepConfigSuggested: !fromThisDevice,
        valid: true,
        invalidReason: null,
      };
    } catch (err) {
      info = {
        fileName,
        sizeBytes: st.size,
        createdAt: st.mtimeMs,
        kind: "unknown",
        fileCount: null,
        flavor: null,
        hasConfig: false,
        fromThisDevice: false,
        keepConfigSuggested: false,
        valid: false,
        invalidReason: err instanceof WtfBackupError ? err.message : "unreadable",
      };
    }
    this.#metaCache.set(path, { key, info });
    return info;
  }
}
