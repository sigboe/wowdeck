/**
 * The addon transaction (ADR 0006): one boundary that changes an
 * installation's live addon folders and commits the addon record with them.
 * Callers hand in an addon-specific plan and get the committed result or a
 * `TransactionFailure`; they never move, undo or clean up folders
 * themselves.
 *
 * One run, in order:
 *
 *   1. prepare  - check the game folder (never created), create a work
 *                 folder `AddOns/.wowdeck/tx-<id>/` and let the plan stage
 *                 its folders in `stage/` (extraction, validation);
 *   2. marker   - plan every move, collect content evidence of every place
 *                 a move touches, and store a versioned marker holding it
 *                 with the original record. Nothing live has changed yet: a
 *                 failure up to here changes nothing;
 *   3. moves    - rename-only, same filesystem: live folders to `backup/`,
 *                 staged ones into AddOns, and (best-effort) the replaced
 *                 folders into the Roll back cache. Roll back exchanges
 *                 instead: the kept previous version out of the cache, the
 *                 live folders to `backup/`, the previous version into
 *                 AddOns, and the outgoing version into the cache — every
 *                 one of them mandatory. A removal only moves the live
 *                 folders to `backup/`, deleted with the work folder at
 *                 cleanup. Each move checks
 *                 containment, refuses links, other filesystems and an
 *                 occupied destination, and never creates a parent;
 *   4. commit   - the plan's record change and commit evidence, in one
 *                 acknowledged write (AddonRecords.commit). The operation
 *                 commits here and only here;
 *   5. cleanup  - the work folder is disposable now; the marker is resolved.
 *
 * A failure in 3 or 4 undoes the executed moves in reverse (renames back,
 * nothing deleted). Restored: the work folder goes and the marker with it.
 * Not restored: the work folder (every remaining copy) and the marker stay.
 *
 * A failing cleanup never fails a committed operation (#105): it succeeds
 * with a `cleanupWarning`. A work folder that can't be deleted keeps its
 * marker, so the leftover stays identified; the commit evidence makes that
 * marker committed (`classifyTransaction`), never restorable, and the next
 * transaction in the installation finishes the cleanup (`cleanUpCommitted`).
 */

import { lstatSync, readdirSync, readFileSync, rmdirSync, statSync } from "node:fs";
import { deviceOf, identity, isDir, isPlainDir, pathPresent, pathProblem } from "./folderChecks";
import {
  isTransactionId,
  readMarker,
  TRANSACTION_MARKER_VERSION,
  workDirOf,
  type AddonTransactionMarker,
  type PlannedMove,
} from "./TransactionMarker";
import { dirname, join, relative } from "node:path";
import type { WowInstallation } from "../models";
import type { FsStage, StageFs } from "../fs/StageFs";
import { joinWithin } from "../fs/safe-fs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { InstallError, plainSystemError } from "../errors";
import { markerId, markerOwner, type AddonOperation, type AddonRecord, type AddonRecordChange, type AddonRecords } from "./AddonRecords";
import { folderEvidence, type FolderEvidence } from "./FolderEvidence";

export type { AddonTransactionMarker, PlannedMove } from "./TransactionMarker";
import { STAGING_DIR_NAME, type KeptRelease, type PreviousVersion } from "./RollbackCache";

/** What happened to the addon's kept previous version (Roll back). */
export type PreviousOutcome =
  /** The replaced folders are now the previous version. */
  | "kept"
  /** Nothing was kept; whatever was kept before is still there. */
  | "unchanged"
  /** Nothing was kept, and the version kept before is no longer offered. */
  | "gone";

interface PlanBase<T> {
  installation: WowInstallation;
  /** Names the addon in the marker and in failures (`unmanaged:<folder>` for an unmanaged folder). */
  addonId: string;
  /** The record before the transaction, or null for a new one. */
  originalRecord: AddonRecord | null;
  /** The record change to commit, with the folders live. A throw undoes the moves. */
  change(live: { installed: string[]; previous: PreviousOutcome }): Promise<{ change: AddonRecordChange; result: T }>;
}

/** Install or update: the folders come from an archive the plan stages. */
export interface StagedPlan<T> extends PlanBase<T> {
  operation: Extract<AddonOperation, "install" | "update">;
  /**
   * Fill `stageDir` (a fresh, empty folder beneath AddOns) and name the
   * folders to install, main first. A throw fails the transaction with
   * nothing changed; an InstallError's message is reported as it is.
   */
  stage(stageDir: string): Promise<string[]>;
  /** Keep the folders this replaces as the addon's previous version; best-effort. */
  keepPrevious?: KeptRelease;
}

/**
 * Roll back: exchange the live folders with the addon's kept previous
 * version. Keeping the outgoing version (so the rollback can be undone) is
 * part of the transaction: if it fails, nothing commits.
 */
export interface RollbackPlan<T> extends PlanBase<T> {
  operation: "rollback";
  /** The kept previous version, as read from the cache (readPrevious). */
  previous: PreviousVersion;
  /** The live folders the record names: they leave with the outgoing version. */
  current: string[];
  /** What the outgoing version is, for its meta.json. */
  outgoing: KeptRelease;
}

/**
 * Removal: the named live folders go aside into the work folder and are
 * deleted with it once the change commits. A folder already missing counts
 * as removed. With no `originalRecord` (an unmanaged folder) the commit
 * evidence names no addon, only the folders.
 */
export interface RemovalPlan<T> extends PlanBase<T> {
  operation: "remove";
  folders: string[];
}

export type AddonTransactionPlan<T> = StagedPlan<T> | RollbackPlan<T> | RemovalPlan<T>;

/**
 * A transaction that did not commit. `restored`: the live folders and the
 * record are as they were before (another attempt is allowed). Otherwise
 * the undo stopped: the work folder and the marker are kept as they are.
 */
export class TransactionFailure extends InstallError {
  constructor(
    message: string,
    addonId: string,
    readonly restored: boolean,
    readonly transactionId: string,
  ) {
    super(message, addonId);
    this.name = "TransactionFailure";
  }
}

/** Wraps a plan's staging error so it passes through unchanged. */
class StagingError extends Error {
  constructor(override readonly cause: unknown) {
    super("staging failed");
  }
}

/** A rename the transaction executed, or a folder it created for one (absolute paths). */
type Move = { from: string; to: string } | { created: string };

/** The Roll back cache folder inside the plugin's folder. */
export const ROLLBACK_DIR_NAME = "rollback";

/** What a run that committed returns; `cleanupWarning` when its cleanup didn't finish. */
export interface CommittedTransaction<T> {
  transactionId: string;
  result: T;
  cleanupWarning?: string;
}

/**
 * A stored marker's standing. `committed`: its commit evidence is stored, so
 * the operation's result stands and its leftovers are disposable (cleanup
 * only, never restoration or undo). `restored`: its undo finished (see
 * below); the leftovers are disposable. `unfinished`: anything else,
 * including a marker this build can't read.
 */
export type TransactionStanding = "committed" | "restored" | "unfinished";

/**
 * `restored`: no commit evidence, but the transaction's own work folder,
 * on the installation it began on (same physical AddOns folder), holds the
 * note its finished undo left (`#noteRestored`). The original arrangement
 * was put back by the engine, so nothing needs recovery; the leftover is
 * disposable. A drive that is missing or replaced can't show the note, so
 * the marker stays unfinished (recovery pending).
 */
export function classifyTransaction(records: AddonRecords, marker: unknown): TransactionStanding {
  const leftover = committedLeftover(marker);
  if (!leftover) {
    return "unfinished";
  }
  if (records.commitEvidence(leftover.transactionId)) {
    return "committed";
  }
  return hasRestoreNote(marker) ? "restored" : "unfinished";
}

const RESTORED_NOTE = "restored.json";

/** Whether a marker this build can read has its finished undo's note, on the AddOns folder it began on. */
function hasRestoreNote(stored: unknown): boolean {
  const marker = readMarker(stored);
  if (!marker) {
    return false;
  }
  const { addonsPath, addonsId } = marker.root;
  try {
    if (identity(addonsPath) !== addonsId) {
      return false;
    }
    const work = joinWithin(addonsPath, ...marker.workDir.split("/"));
    if (!isPlainDir(join(addonsPath, STAGING_DIR_NAME)) || !isPlainDir(work)) {
      return false;
    }
    const note = JSON.parse(readFileSync(join(work, RESTORED_NOTE), "utf-8")) as { transactionId?: unknown };
    return note.transactionId === marker.transactionId;
  } catch {
    return false;
  }
}

/**
 * The installation and work folder a committed marker names, when they are
 * the ones this build writes. Asks less than readMarker on purpose: commit
 * evidence settles a marker whatever else it holds, and only these three
 * are needed to clean up after it.
 */
function committedLeftover(marker: unknown): { transactionId: string; installationId: string; workDir: string } | null {
  const transactionId = markerId(marker);
  const installationId = markerOwner(marker);
  const { workDir } = (marker ?? {}) as { workDir?: unknown };
  if (!isTransactionId(transactionId) || installationId === undefined || workDir !== workDirOf(transactionId)) {
    return null;
  }
  return { transactionId, installationId, workDir };
}

export class AddonTransactions {
  /** Transactions running now: their markers are not left behind (yet). */
  readonly #running = new Set<string>();
  /** Transactions this engine run restored but whose marker could not be cleared. */
  readonly #restored = new Set<string>();

  constructor(private fs: StageFs) {}

  async run<T>(records: AddonRecords, plan: AddonTransactionPlan<T>): Promise<CommittedTransaction<T>> {
    // Leftovers of earlier committed operations here are disposable.
    await this.cleanUpCommitted(records, plan.installation);
    const transactionId = crypto.randomUUID();
    this.#running.add(transactionId);
    try {
      return await this.#run(records, plan, transactionId);
    } catch (err) {
      if (err instanceof TransactionFailure && err.restored && hasMarker(records, transactionId)) {
        this.#restored.add(transactionId);
      }
      throw err;
    } finally {
      this.#running.delete(transactionId);
    }
  }

  /**
   * The transactions that leave an installation needing recovery: a stored
   * marker naming it that no running transaction owns and that is neither
   * committed nor restored (`classifyTransaction`; this engine run's own
   * restorations count as restored). A marker that names no installation
   * can't be ruled out for any, so it counts for every installation; one
   * without a readable id is listed as "unreadable".
   */
  unresolved(records: AddonRecords, installationId: string): string[] {
    return this.unresolvedMarkers(records, installationId).map((marker) => markerId(marker) ?? "unreadable");
  }

  /** The stored markers `unresolved` counts, as stored, oldest first. */
  unresolvedMarkers(records: AddonRecords, installationId: string): unknown[] {
    const found: unknown[] = [];
    for (const marker of records.markers()) {
      const owner = markerOwner(marker);
      if (owner !== undefined && owner !== installationId) {
        continue;
      }
      const id = markerId(marker);
      if (id !== undefined && (this.#running.has(id) || this.#restored.has(id))) {
        continue;
      }
      if (classifyTransaction(records, marker) === "unfinished") {
        found.push(marker);
      }
    }
    return found;
  }

  async #run<T>(
    records: AddonRecords,
    plan: AddonTransactionPlan<T>,
    transactionId: string,
  ): Promise<CommittedTransaction<T>> {
    const addonsPath = getAddonsPath(plan.installation);
    const pluginDir = join(addonsPath, STAGING_DIR_NAME);
    const work = joinWithin(pluginDir, `tx-${transactionId}`);
    const stageDir = join(work, "stage");
    const failure = (message: string, restored: boolean) =>
      new TransactionFailure(message, plan.addonId, restored, transactionId);

    // 1-2. Prepare and mark: nothing live changes, so a failure only
    // removes the work folder. The plan's own staging errors (a download,
    // an invalid archive) are reported as they are.
    let folders: string[];
    let marker: AddonTransactionMarker;
    /** Interface or AddOns levels this run created; they go again if nothing is marked. */
    const created: string[] = [];
    try {
      const root = this.#prepare(plan.installation, addonsPath, pluginDir, work, created);
      if (plan.operation === "rollback") {
        folders = [...plan.previous.folders];
        marker = await this.#markExchange(plan, transactionId, root, addonsPath, work);
      } else if (plan.operation === "remove") {
        folders = [...plan.folders];
        marker = await this.#markRemoval(plan, transactionId, root, addonsPath, work);
      } else {
        try {
          folders = await plan.stage(stageDir);
        } catch (err) {
          throw new StagingError(err);
        }
        marker = await this.#mark(plan, transactionId, root, addonsPath, work, folders);
      }
      records.writeMarker(marker);
    } catch (err) {
      await discardWork(this.fs, work, pluginDir);
      // Nothing outside the plugin's folder changes before the marker
      // (scenario 10): the levels made for the work folder go too.
      for (const dir of created.reverse()) {
        try {
          rmdirSync(dir); // never recursive: only what this run made, now empty
        } catch (rmErr) {
          console.error(`[transaction] ${transactionId}: couldn't remove ${dir}: ${String(rmErr)}`);
        }
      }
      if (err instanceof StagingError) {
        throw err.cause;
      }
      throw failure(
        err instanceof InstallError
          ? err.message
          : plainSystemError(err, "Couldn't prepare the addon's files. Nothing was changed", "transaction"),
        true,
      );
    }

    // 3-4. Move and commit; a failure undoes the moves.
    const done: Move[] = [];
    let result: T;
    let step =
      plan.operation === "rollback"
        ? "Couldn't roll back. Nothing was changed"
        : plan.operation === "remove"
          ? "Couldn't remove the addon's folders. Nothing was changed"
          : "Couldn't put the addon's files in place. Nothing was changed";
    try {
      const previous =
        plan.operation === "rollback"
          ? this.#exchange(plan, addonsPath, marker, done)
          : plan.operation === "remove"
            ? this.#takeOut(addonsPath, marker.moves, done)
            : this.#replace(plan, addonsPath, marker.moves, done);
      const planned = await plan.change({ installed: plan.operation === "remove" ? [] : folders, previous });
      step = "Couldn't save the addon list. Nothing was changed";
      records.commit(planned.change, {
        transactionId,
        installationId: plan.installation.id,
        operation: plan.operation,
        // An unmanaged folder's removal involves no record: its evidence names none.
        ...(!(plan.operation === "remove" && plan.originalRecord === null) && { addonId: plan.addonId }),
        folders,
      });
      result = planned.result;
    } catch (err) {
      const message = plainSystemError(err, step, "transaction");
      if (this.#undo(done, 0)) {
        // Marker first: the work folder holds the note that stands in for
        // a marker that couldn't be cleared.
        if (resolveMarker(records, transactionId)) {
          await discardWork(this.fs, work, pluginDir);
        } else {
          this.#noteRestored(transactionId, work);
        }
        throw failure(message, true);
      }
      console.error(`[transaction] ${transactionId}: undo stopped; work folder and marker kept`);
      throw failure(
        `Couldn't put the addon's files back. Its original files are kept in AddOns/${marker.workDir}`,
        false,
      );
    }

    // 5. Committed: what is left is disposable, and its failure only a warning.
    const cleanupWarning = await this.#finish(records, transactionId, work, pluginDir, marker.workDir);
    return { transactionId, result, ...(cleanupWarning && { cleanupWarning }) };
  }

  /**
   * Remove the leftovers of an installation's committed and restored transactions and
   * resolve their markers. Touches nothing an unfinished transaction keeps
   * (its work folder holds recovery copies) and never restores anything.
   * Failures are logged; what stays is cleaned up by a later call.
   */
  async cleanUpCommitted(
    records: AddonRecords,
    installation: WowInstallation,
  ): Promise<{ cleaned: string[]; left: string[] }> {
    const cleaned: string[] = [];
    const left: string[] = [];
    const addonsPath = getAddonsPath(installation);
    const pluginDir = join(addonsPath, STAGING_DIR_NAME);
    for (const marker of records.markers()) {
      const leftover = committedLeftover(marker);
      if (markerOwner(marker) !== installation.id) {
        continue;
      }
      const standing = classifyTransaction(records, marker);
      if (!leftover || standing === "unfinished") {
        left.push(markerId(marker) ?? "");
        continue;
      }
      // A game folder that is gone (an SD card out) or a linked plugin
      // folder: nothing is deleted, the marker waits.
      if (!isDir(installation.location) || (pathPresent(pluginDir) && !isPlainDir(pluginDir))) {
        left.push(leftover.transactionId);
        continue;
      }
      const work = joinWithin(addonsPath, ...leftover.workDir.split("/"));
      if (standing === "restored") {
        // Marker first, then the folder holding its note: a folder that
        // stays is harmless, a marker without its note would block.
        if (!resolveMarker(records, leftover.transactionId)) {
          left.push(leftover.transactionId);
          continue;
        }
        await discardWork(this.fs, work, pluginDir);
        cleaned.push(leftover.transactionId);
        continue;
      }
      const warning = await this.#finish(records, leftover.transactionId, work, pluginDir, leftover.workDir);
      (warning ? left : cleaned).push(leftover.transactionId);
    }
    try {
      cleaned.push(...(await this.#discardUnmarked(records, installation, pluginDir)));
    } catch {
      // This optional sweep must never prevent the requested addon change.
      console.error("[transaction] orphan work folder sweep failed");
    }
    return { cleaned, left };
  }

  /**
   * Work folders no marker names and no running transaction owns (#134): an
   * engine that stopped before writing the marker. Nothing outside the
   * plugin's folder moves before the marker, so they hold only staging and
   * are deleted. Markers of every installation count, and one without a
   * readable id could name any folder, so it stops the sweep.
   */
  async #discardUnmarked(records: AddonRecords, installation: WowInstallation, pluginDir: string): Promise<string[]> {
    if (!isDir(installation.location) || !isPlainDir(pluginDir)) {
      return [];
    }
    const marked = new Set<string>();
    for (const marker of records.markers()) {
      const id = markerId(marker);
      if (id === undefined) {
        return [];
      }
      marked.add(id);
    }
    const discarded: string[] = [];
    for (const name of this.fs.readdirSync("cleanup.list", pluginDir)) {
      const id = name.slice("tx-".length);
      if (!name.startsWith("tx-") || !isTransactionId(id) || marked.has(id) || this.#running.has(id)) {
        continue;
      }
      const work = join(pluginDir, name);
      if (isPlainDir(work) && (await discardWork(this.fs, work, pluginDir))) {
        console.error(`[transaction] ${id}: removed a work folder left without a marker`);
        discarded.push(id);
      }
    }
    return discarded;
  }

  /**
   * Cleanup of a committed transaction: remove the work folder, then resolve
   * the marker. A work folder that stays keeps its marker (and evidence) so
   * it is still known as committed. Returns the warning for what failed.
   */
  async #finish(
    records: AddonRecords,
    transactionId: string,
    work: string,
    pluginDir: string,
    workDir: string,
  ): Promise<string | undefined> {
    if (!(await discardWork(this.fs, work, pluginDir))) {
      console.error(`[transaction] ${transactionId}: committed; work folder left, marker kept for a later cleanup`);
      return `Its temporary files are left in AddOns/${workDir}. They're removed at the next addon change.`;
    }
    if (!resolveMarker(records, transactionId)) {
      return "WoWDeck couldn't finish cleaning up after it. It tries again at the next addon change.";
    }
    return undefined;
  }

  /**
   * The game folder must exist (an SD card that isn't inserted must not be
   * recreated on internal storage); Interface/AddOns below it may be
   * created, one level at a time (each one created is pushed to `created`).
   * Returns the root's physical identity.
   */
  #prepare(installation: WowInstallation, addonsPath: string, pluginDir: string, work: string, created: string[]) {
    const location = installation.location;
    if (!isDir(location)) {
      throw new InstallError(`${installation.displayName} isn't available. Is the SD card inserted?`);
    }
    for (const dir of [dirname(addonsPath), addonsPath]) {
      if (!pathPresent(dir)) {
        this.fs.mkdirSync("tx.prepare", dir);
        created.push(dir);
      }
    }
    if (!pathPresent(pluginDir)) {
      this.fs.mkdirSync("tx.prepare", pluginDir);
    }
    if (!isPlainDir(pluginDir)) {
      throw new InstallError(`AddOns/${STAGING_DIR_NAME} isn't a plain folder. Nothing was changed`);
    }
    this.fs.mkdirSync("tx.prepare", work);
    this.fs.mkdirSync("tx.prepare", join(work, "stage"));
    this.fs.mkdirSync("tx.prepare", join(work, "backup"));
    const addonsDev = statSync(addonsPath, { bigint: true }).dev;
    if (statSync(work, { bigint: true }).dev !== addonsDev) {
      throw new InstallError(`AddOns/${STAGING_DIR_NAME} is on another drive than AddOns. Nothing was changed`);
    }
    return { location, locationId: identity(location), addonsId: identity(addonsPath), addonsDev };
  }

  /** Install or update: live folders aside, staged ones in, then (best-effort) keep the replaced ones. */
  #replace<T>(plan: StagedPlan<T>, addonsPath: string, moves: PlannedMove[], done: Move[]): PreviousOutcome {
    const replaced: string[] = [];
    for (const move of moves.filter((m) => m.kind !== "retain")) {
      this.#move(addonsPath, move, done);
      if (move.kind === "backup") {
        replaced.push(move.from);
      }
    }
    return this.#retain(plan, addonsPath, replaced, moves, done);
  }

  /** Removal: the live folders aside into the work folder; nothing is kept. */
  #takeOut(addonsPath: string, moves: PlannedMove[], done: Move[]): PreviousOutcome {
    for (const move of moves) {
      this.#move(addonsPath, move, done);
    }
    return "unchanged";
  }

  /**
   * Roll back: every planned move in order, none optional. The outgoing
   * version's meta.json is written into the backup before the backup goes
   * into the cache, so keeping it is one rename. A throw undoes the moves.
   */
  #exchange<T>(plan: RollbackPlan<T>, addonsPath: string, marker: AddonTransactionMarker, done: Move[]): PreviousOutcome {
    const backup = `${marker.workDir}/backup`;
    const outgoing = marker.moves.filter((m) => m.kind === "backup").map((m) => m.from);
    let kept = false;
    for (const move of marker.moves) {
      if (move.kind === "retain" && move.from === backup) {
        const meta: PreviousVersion = { ...plan.outgoing, folders: outgoing, savedAt: Date.now() };
        this.fs.writeFileSync("previous.meta", join(addonsPath, ...backup.split("/"), "meta.json"), JSON.stringify(meta, null, 2));
        kept = true;
      }
      this.#move(addonsPath, move, done);
    }
    return kept ? "kept" : "gone";
  }

  /**
   * Plan a rollback's exchange: the kept version out of the cache into the
   * work folder, the live folders (the record's, and any in the way of the
   * previous version) to the backup, the previous folders into AddOns, and
   * the backup, when it holds anything, into the cache as the new previous
   * version.
   */
  async #markExchange<T>(
    plan: RollbackPlan<T>,
    transactionId: string,
    root: { location: string; locationId: string; addonsId: string; addonsDev: bigint },
    addonsPath: string,
    work: string,
  ): Promise<AddonTransactionMarker> {
    const workRel = relative(addonsPath, work);
    const kept = `${STAGING_DIR_NAME}/${ROLLBACK_DIR_NAME}/${plan.addonId}`;
    const keptPath = joinWithin(addonsPath, STAGING_DIR_NAME, ROLLBACK_DIR_NAME, plan.addonId);
    if (pathProblem(addonsPath, kept, root.addonsDev)) {
      throw new InstallError(
        `AddOns/${STAGING_DIR_NAME}/${ROLLBACK_DIR_NAME} isn't a plain folder, so nothing was rolled back. Nothing was changed`,
        plan.addonId,
      );
    }
    if (!isPlainDir(keptPath)) {
      throw new InstallError("No previous version is kept for this addon", plan.addonId);
    }
    const moves: PlannedMove[] = [{ from: kept, to: `${workRel}/previous`, kind: "retain" }];
    for (const folder of plan.previous.folders) {
      checkFolderName(folder);
      if (!isPlainDir(join(keptPath, folder))) {
        throw new InstallError(`The kept previous version's ${folder} is missing. Nothing was changed`, plan.addonId);
      }
    }
    const leaving = [...new Set([...plan.current, ...plan.previous.folders])];
    for (const folder of leaving) {
      checkFolderName(folder);
      const target = joinWithin(addonsPath, folder);
      if (pathPresent(target)) {
        this.#checkLive(target, folder, root.addonsDev);
        moves.push({ from: folder, to: `${workRel}/backup/${folder}`, kind: "backup" });
      }
    }
    for (const folder of plan.previous.folders) {
      moves.push({ from: `${workRel}/previous/${folder}`, to: folder, kind: "install" });
    }
    if (moves.some((m) => m.kind === "backup")) {
      moves.push({ from: `${workRel}/backup`, to: kept, kind: "retain" });
    }
    const evidence: Record<string, FolderEvidence> = {};
    for (const path of new Set(moves.flatMap((m) => [m.from, m.to]))) {
      if (!path.startsWith(`${workRel}/`)) {
        evidence[path] = await folderEvidence(this.fs, join(addonsPath, path));
      }
    }
    return {
      version: TRANSACTION_MARKER_VERSION,
      transactionId,
      installationId: plan.installation.id,
      operation: plan.operation,
      addonId: plan.addonId,
      startedAt: Date.now(),
      root: { location: root.location, addonsPath, locationId: root.locationId, addonsId: root.addonsId },
      workDir: workRel,
      originalRecord: plan.originalRecord,
      moves,
      evidence,
    };
  }

  /** Plan a removal: each live folder present to the backup, with its evidence. */
  async #markRemoval<T>(
    plan: RemovalPlan<T>,
    transactionId: string,
    root: { location: string; locationId: string; addonsId: string; addonsDev: bigint },
    addonsPath: string,
    work: string,
  ): Promise<AddonTransactionMarker> {
    const workRel = relative(addonsPath, work);
    const moves: PlannedMove[] = [];
    const evidence: Record<string, FolderEvidence> = {};
    for (const folder of new Set(plan.folders)) {
      checkFolderName(folder);
      const target = joinWithin(addonsPath, folder);
      if (pathPresent(target)) {
        this.#checkLive(target, folder, root.addonsDev, "removed");
        moves.push({ from: folder, to: `${workRel}/backup/${folder}`, kind: "backup" });
      }
      evidence[folder] = await folderEvidence(this.fs, target);
    }
    return {
      version: TRANSACTION_MARKER_VERSION,
      transactionId,
      installationId: plan.installation.id,
      operation: plan.operation,
      addonId: plan.addonId,
      startedAt: Date.now(),
      root: { location: root.location, addonsPath, locationId: root.locationId, addonsId: root.addonsId },
      workDir: workRel,
      originalRecord: plan.originalRecord,
      moves,
      evidence,
    };
  }

  /** Plan the moves, check every place they touch, and collect its evidence. */
  async #mark<T>(
    plan: StagedPlan<T>,
    transactionId: string,
    root: { location: string; locationId: string; addonsId: string; addonsDev: bigint },
    addonsPath: string,
    work: string,
    folders: string[],
  ): Promise<AddonTransactionMarker> {
    const rel = (path: string) => relative(addonsPath, path);
    const workRel = rel(work);
    const moves: PlannedMove[] = [];
    for (const folder of folders) {
      const staged = joinWithin(work, "stage", folder);
      if (!isPlainDir(staged)) {
        throw new InstallError(`The archive's ${folder} isn't a plain folder`);
      }
      const target = joinWithin(addonsPath, folder);
      if (pathPresent(target)) {
        this.#checkLive(target, folder, root.addonsDev);
        moves.push({ from: folder, to: `${workRel}/backup/${folder}`, kind: "backup" });
      }
    }
    for (const folder of folders) {
      moves.push({ from: `${workRel}/stage/${folder}`, to: folder, kind: "install" });
    }
    const kept = `${STAGING_DIR_NAME}/${ROLLBACK_DIR_NAME}/${plan.addonId}`;
    joinWithin(addonsPath, STAGING_DIR_NAME, ROLLBACK_DIR_NAME, plan.addonId); // containment check of the id
    // A Roll back cache that is a link (or on another drive) keeps nothing:
    // keeping is best-effort, and nothing goes through a link.
    const cacheUsable = !pathProblem(addonsPath, kept, root.addonsDev);
    if (plan.keepPrevious && cacheUsable && moves.some((m) => m.kind === "backup")) {
      if (pathPresent(join(addonsPath, kept))) {
        moves.push({ from: kept, to: `${workRel}/previous`, kind: "retain" });
      }
      moves.push({ from: `${workRel}/backup`, to: kept, kind: "retain" });
    }
    const evidence: Record<string, FolderEvidence> = {};
    for (const path of new Set(moves.flatMap((m) => [m.from, m.to]))) {
      if (!path.startsWith(`${workRel}/backup`) && path !== `${workRel}/previous`) {
        evidence[path] = await folderEvidence(this.fs, join(addonsPath, path));
      }
    }
    return {
      version: TRANSACTION_MARKER_VERSION,
      transactionId,
      installationId: plan.installation.id,
      operation: plan.operation,
      addonId: plan.addonId,
      startedAt: Date.now(),
      root: { location: root.location, addonsPath, locationId: root.locationId, addonsId: root.addonsId },
      workDir: workRel,
      originalRecord: plan.originalRecord,
      moves,
      evidence,
    };
  }

  /** A live folder the transaction may move: a plain folder on AddOns' own drive. */
  #checkLive(path: string, folder: string, addonsDev: bigint, verb: "replaced" | "removed" = "replaced"): void {
    const info = lstatSync(path, { bigint: true });
    if (info.isSymbolicLink()) {
      throw new InstallError(`${folder} in AddOns is a link to another folder, so it wasn't ${verb}. Nothing was changed`);
    }
    if (!info.isDirectory()) {
      throw new InstallError(`${folder} in AddOns isn't a folder, so it wasn't ${verb}. Nothing was changed`);
    }
    if (info.dev !== addonsDev) {
      throw new InstallError(`${folder} in AddOns is on another drive, so it wasn't ${verb}. Nothing was changed`);
    }
  }

  /** One planned rename; refuses an occupied destination or a missing parent. */
  #move(addonsPath: string, move: PlannedMove, done: Move[]): void {
    const from = joinWithin(addonsPath, ...move.from.split("/"));
    const to = joinWithin(addonsPath, ...move.to.split("/"));
    // Every folder on the way, the moved one included, is a plain folder on AddOns' drive.
    const addonsDev = deviceOf(addonsPath);
    const parent = dirname(move.to);
    const problem = pathProblem(addonsPath, move.from, addonsDev) ?? (parent === "." ? null : pathProblem(addonsPath, parent, addonsDev));
    if (problem) {
      throw new Error(`AddOns/${problem.at}: ${problem.problem}`);
    }
    renameFolder(this.fs, move.kind === "backup" ? "folder.backup" : move.kind === "install" ? "folder.install" : "folder.retain", from, to);
    done.push({ from, to });
  }

  /**
   * Keep the replaced folders as the previous version, replacing the one
   * kept before (moved aside, not deleted, until commit). Best-effort: a
   * failure undoes its own moves and the update goes on.
   */
  #retain<T>(
    plan: StagedPlan<T>,
    addonsPath: string,
    replaced: string[],
    moves: PlannedMove[],
    done: Move[],
  ): PreviousOutcome {
    const retain = moves.filter((m) => m.kind === "retain");
    if (!plan.keepPrevious) {
      return "unchanged";
    }
    if (retain.length === 0) {
      // A cache that is a link or not a folder (#mark planned nothing) offers nothing.
      const kept = `${STAGING_DIR_NAME}/${ROLLBACK_DIR_NAME}/${plan.addonId}`;
      return replaced.length > 0 && pathProblem(addonsPath, kept, deviceOf(addonsPath)) ? "gone" : "unchanged";
    }
    const cache = join(addonsPath, STAGING_DIR_NAME, ROLLBACK_DIR_NAME);
    const kept = joinWithin(cache, plan.addonId);
    const mark = done.length;
    try {
      if (!pathPresent(cache)) {
        this.fs.mkdirSync("folder.retain", cache);
        done.push({ created: cache });
      }
      for (const move of retain) {
        this.#move(addonsPath, move, done);
      }
      const meta: PreviousVersion = { ...plan.keepPrevious, folders: replaced, savedAt: Date.now() };
      this.fs.writeFileSync("previous.meta", join(kept, "meta.json"), JSON.stringify(meta, null, 2));
      return "kept";
    } catch (err) {
      console.error(`[transaction] could not keep the previous version: ${String(err)}`);
      this.#undo(done, mark);
      return pathPresent(join(kept, "meta.json")) ? "unchanged" : "gone";
    }
  }

  /** Undo executed moves down to `downTo`, newest first; stops at the first that fails. */
  #undo(done: Move[], downTo: number): boolean {
    while (done.length > downTo) {
      const move = done[done.length - 1]!;
      try {
        if ("created" in move) {
          rmdirSync(move.created); // never recursive: it held only what was moved out again
        } else {
          renameFolder(this.fs, "folder.restore", move.to, move.from);
        }
      } catch (err) {
        console.error(`[transaction] undo failed: ${String(err)}`);
        return false;
      }
      done.pop();
    }
    return true;
  }

  /**
   * Leave restore-completed evidence in the work folder of a transaction
   * whose undo finished but whose marker could not be cleared, so after a
   * restart the marker classifies as restored rather than unfinished. A
   * note that can't be written leaves the marker unfinished: the safe
   * direction (recovery required until Verify recovery).
   */
  #noteRestored(transactionId: string, work: string): void {
    try {
      this.fs.writeFileSync("restore.note", join(work, RESTORED_NOTE), JSON.stringify({ transactionId }));
    } catch (err) {
      console.error(`[transaction] ${transactionId}: restored, but neither marker cleared nor note written: ${String(err)}`);
    }
  }

}

/** One checked rename: refuses an occupied destination or a missing (or linked) parent, and never creates one. */
export function renameFolder(fs: StageFs, stage: FsStage, from: string, to: string): void {
  if (pathPresent(to)) {
    throw new Error(`Destination exists: ${to}`);
  }
  if (!isPlainDir(dirname(to))) {
    throw new Error(`Destination folder missing or not a plain folder: ${dirname(to)}`);
  }
  fs.renameSync(stage, from, to);
}

/**
 * Remove a transaction's work folder, and the plugin folder once nothing
 * else uses it. False when the work folder couldn't be removed; failures
 * are logged.
 */
export async function discardWork(fs: StageFs, work: string, pluginDir: string): Promise<boolean> {
  try {
    await fs.remove("cleanup.remove", work);
  } catch (err) {
    console.error(`[transaction] cleanup failed: ${String(err)}`);
    return false;
  }
  try {
    if (isDir(pluginDir) && readdirSync(pluginDir).length === 0) {
      await fs.remove("cleanup.remove", pluginDir);
    }
  } catch (err) {
    // An empty folder of our own; harmless, and the next run tries again.
    console.error(`[transaction] cleanup failed: ${String(err)}`);
  }
  return true;
}

/** Clear a transaction's marker; false (logged) when the write failed. */
export function resolveMarker(records: AddonRecords, transactionId: string): boolean {
  try {
    records.resolveTransaction(transactionId);
    return true;
  } catch (err) {
    console.error(`[transaction] ${transactionId}: marker not cleared: ${String(err)}`);
    return false;
  }
}

/** A folder name from meta.json or a record: one plain name directly in AddOns. */
function checkFolderName(folder: string): void {
  if (!folder || folder === "." || folder === ".." || /[/\\]/.test(folder) || folder.startsWith(".")) {
    throw new InstallError(`${folder || "An empty name"} isn't an addon folder name. Nothing was changed`);
  }
}

function hasMarker(records: Pick<AddonRecords, "markers">, transactionId: string): boolean {
  return records.markers().some((m) => markerId(m) === transactionId);
}
