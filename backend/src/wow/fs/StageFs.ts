/**
 * The filesystem and state-write operations whose failure matters to addon
 * transactions (ADR 0006), each named by the stage it performs. Production
 * wires `realStageFs`, a thin pass-through to `node:fs`. Tests wire
 * `FaultInjectingFs` and make a named stage fail, so a failure path is
 * reached without timing, permission tricks or wall-clock ordering.
 *
 * Add a stage name (and, when needed, an operation) here when a transaction
 * step needs to be failable; keep the list narrow — only what a transaction
 * does.
 */

import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";

/** A named operation stage a test can make fail. */
export type FsStage =
  /** Writing the state file's temporary copy. */
  | "state.write"
  /** Renaming the temporary copy over the state file. */
  | "state.replace"
  /** Writing the temporary state copy that stores or clears an addon transaction marker. */
  | "marker.write"
  /** Renaming that copy over the state file. */
  | "marker.replace"
  /** Creating a transaction's work folder, or a missing Interface/AddOns level below the game folder. */
  | "tx.prepare"
  /** Reading a file for a folder's content evidence. */
  | "evidence.read"
  /** Moving a live folder aside into the transaction's backup. */
  | "folder.backup"
  /** Moving a staged folder into the live AddOns folder. */
  | "folder.install"
  /** Moving folders into or out of the Roll back cache (keeping the previous version). */
  | "folder.retain"
  /** Writing the kept previous version's description (meta.json). */
  | "previous.meta"
  /** Moving a folder back while undoing a transaction. */
  | "folder.restore"
  /** Deleting a transaction's disposable leftovers. */
  | "cleanup.remove"
  /** Listing disposable transaction work folders. */
  | "cleanup.list"
  /** Writing the note that a transaction's undo finished, when its marker could not be cleared. */
  | "restore.note";

export interface StageFs {
  readdirSync(stage: FsStage, path: string): string[];
  writeFileSync(stage: FsStage, path: string, data: string): void;
  renameSync(stage: FsStage, from: string, to: string): void;
  readFile(stage: FsStage, path: string): Promise<Buffer>;
  /** Create one directory; its parent must exist (never recursive). */
  mkdirSync(stage: FsStage, path: string): void;
  /** Delete a file or folder tree; a missing one is not an error. */
  remove(stage: FsStage, path: string): Promise<void>;
}

export const realStageFs: StageFs = {
  readdirSync: (_stage, path) => readdirSync(path),
  writeFileSync: (_stage, path, data) => writeFileSync(path, data),
  renameSync: (_stage, from, to) => renameSync(from, to),
  readFile: (_stage, path) => readFile(path),
  mkdirSync: (_stage, path) => void mkdirSync(path),
  remove: (_stage, path) => rm(path, { recursive: true, force: true }),
};

/** The error an injected fault throws; `code` mirrors a real I/O error. */
export class InjectedFault extends Error {
  readonly code = "EIO";
  constructor(readonly stage: FsStage) {
    super(`Injected failure at ${stage}`);
    this.name = "InjectedFault";
  }
}

interface Fault {
  /** Calls at this stage that still succeed before the fault fires. */
  skip: number;
  /** Calls that fail once it fires; Infinity until cleared. */
  remaining: number;
}

/**
 * Test adapter: delegates to a real StageFs, except at armed stages, which
 * throw `InjectedFault` before doing anything (the operation never happens).
 */
export class FaultInjectingFs implements StageFs {
  #faults = new Map<FsStage, Fault>();

  constructor(private base: StageFs = realStageFs) {}

  /**
   * Make `stage` fail. `after` lets that many calls succeed first; `times`
   * limits how many calls fail (default: every call until `clear`).
   */
  failAt(stage: FsStage, options: { after?: number; times?: number } = {}): this {
    this.#faults.set(stage, { skip: options.after ?? 0, remaining: options.times ?? Infinity });
    return this;
  }

  /** Disarm one stage, or every stage. */
  clear(stage?: FsStage): this {
    if (stage) {
      this.#faults.delete(stage);
    } else {
      this.#faults.clear();
    }
    return this;
  }

  #check(stage: FsStage): void {
    const fault = this.#faults.get(stage);
    if (!fault) {
      return;
    }
    if (fault.skip > 0) {
      fault.skip -= 1;
      return;
    }
    fault.remaining -= 1;
    if (fault.remaining <= 0) {
      this.#faults.delete(stage);
    }
    throw new InjectedFault(stage);
  }

  readdirSync(stage: FsStage, path: string): string[] {
    this.#check(stage);
    return this.base.readdirSync(stage, path);
  }

  writeFileSync(stage: FsStage, path: string, data: string): void {
    this.#check(stage);
    this.base.writeFileSync(stage, path, data);
  }

  renameSync(stage: FsStage, from: string, to: string): void {
    this.#check(stage);
    this.base.renameSync(stage, from, to);
  }

  async readFile(stage: FsStage, path: string): Promise<Buffer> {
    this.#check(stage);
    return this.base.readFile(stage, path);
  }

  mkdirSync(stage: FsStage, path: string): void {
    this.#check(stage);
    this.base.mkdirSync(stage, path);
  }

  async remove(stage: FsStage, path: string): Promise<void> {
    this.#check(stage);
    await this.base.remove(stage, path);
  }
}
