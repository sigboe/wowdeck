/**
 * Runs WTF backup/restore as background jobs (project-owned).
 *
 * The JSONL server handles requests strictly one at a time and the Python
 * bridge times a request out after 120 s, so a backup or restore can never
 * be a single long RPC. `start*` validates, kicks the work off WITHOUT
 * awaiting it and returns a job id; progress and the final outcome are
 * pushed as events (`wtf.progress`, `wtf.completed`). `current()` lets a
 * reopened UI re-attach to a job that is still running.
 */

import type { EventMap, WtfJobKind, WtfJobSnapshot, WtfPhase } from "../../api/contracts";
import { WtfBackupError } from "./errors";
import type { RestoreResult, WtfBackupService, WtfTarget } from "./WtfBackupService";
import { flavorDisplayName } from "./VersionFamilies";

export interface WtfJobEvents {
  progress: (payload: EventMap["wtf.progress"]) => void;
  completed: (payload: EventMap["wtf.completed"]) => void;
  /** For diagnostics: a failed job's stable code + short message (never file names from inside WTF). */
  failed?: (code: string, message: string) => void;
}

export interface WtfJobTarget extends WtfTarget {
  installationId: string;
}

const PROGRESS_MIN_INTERVAL_MS = 250;

export class WtfJobRunner {
  readonly #service: WtfBackupService;
  readonly #events: WtfJobEvents;
  readonly #now: () => number;
  #job: WtfJobSnapshot | null = null;
  #abort: AbortController | null = null;
  #lastEmit = 0;
  #seq = 0;

  constructor(service: WtfBackupService, events: WtfJobEvents, now: () => number = Date.now) {
    this.#service = service;
    this.#events = events;
    this.#now = now;
  }

  current(): WtfJobSnapshot | null {
    return this.#job ? { ...this.#job } : null;
  }

  startCreate(target: WtfJobTarget): { jobId: string } {
    return this.#start("create", target, (signal, onProgress) =>
      this.#service.createBackup(target, { kind: "manual", signal, onProgress }).then((info) => ({ fileName: info.fileName, snapshotFileName: null })),
    );
  }

  startRestore(
    target: WtfJobTarget,
    fileName: string,
    options: { acceptUnknownFlavor?: boolean; keepCurrentConfig?: boolean },
  ): { jobId: string } {
    return this.#start("restore", target, (signal, onProgress) =>
      this.#service
        .restoreBackup(target, fileName, { ...options, signal, onProgress })
        .then((r) => ({ fileName: r.restoredFileName, snapshotFileName: r.snapshotFileName })),
    );
  }

  /** Settings copy: restore another version's backup (see RestoreOptions.sourceFlavor). */
  startCopy(
    target: WtfJobTarget,
    sourceFlavor: string,
    fileName: string,
    options: { keepCurrentConfig?: boolean; acceptUnknownFlavor?: boolean },
  ): { jobId: string } {
    return this.#startCopy(target, sourceFlavor, (signal, onProgress) =>
      this.#service.restoreBackup(target, fileName, { ...options, sourceFlavor, signal, onProgress }),
    );
  }

  /** Settings copy of another installation's current settings (see WtfBackupService.copyCurrentSettings). */
  startCopyCurrent(target: WtfJobTarget, source: WtfTarget, options: { keepCurrentConfig?: boolean }): { jobId: string } {
    return this.#startCopy(target, source.flavor, (signal, onProgress) =>
      this.#service.copyCurrentSettings(target, source, { ...options, signal, onProgress }),
    );
  }

  /** A "copy" job, completing with the display name of the version the settings came from. */
  #startCopy(
    target: WtfJobTarget,
    sourceFlavor: string,
    run: (signal: AbortSignal, onProgress: (phase: WtfPhase, done: number, total: number | null) => void) => Promise<RestoreResult>,
  ): { jobId: string } {
    return this.#start(
      "copy",
      target,
      (signal, onProgress) =>
        run(signal, onProgress).then((r) => ({ fileName: r.restoredFileName, snapshotFileName: r.snapshotFileName })),
      flavorDisplayName(sourceFlavor),
    );
  }

  cancel(jobId: string): { cancelled: boolean } {
    if (!this.#job || this.#job.jobId !== jobId || !this.#abort) {
      return { cancelled: false };
    }
    if (this.#service.committed) {
      throw new WtfBackupError("too_late_to_cancel", "The restore is already switching your settings over and can't be cancelled now.");
    }
    this.#abort.abort();
    return { cancelled: true };
  }

  #start(
    kind: WtfJobKind,
    target: WtfJobTarget,
    run: (
      signal: AbortSignal,
      onProgress: (phase: WtfPhase, done: number, total: number | null) => void,
    ) => Promise<{ fileName: string; snapshotFileName: string | null }>,
    sourceName: string | null = null,
  ): { jobId: string } {
    // Checked synchronously (single-threaded), so two starts can never both pass.
    if (this.#job || this.#service.busy) {
      throw new WtfBackupError("job_in_progress", "Another backup or restore is already running.");
    }
    const jobId = `wtf-${this.#now()}-${(this.#seq += 1)}`;
    const abort = new AbortController();
    this.#abort = abort;
    this.#job = { jobId, kind, installationId: target.installationId, phase: "scan", done: 0, total: null };
    this.#lastEmit = 0;

    const onProgress = (phase: WtfPhase, done: number, total: number | null): void => {
      const job = this.#job;
      if (!job || job.jobId !== jobId) {
        return;
      }
      const phaseChanged = job.phase !== phase;
      job.phase = phase;
      job.done = done;
      job.total = total;
      const now = this.#now();
      if (phaseChanged || now - this.#lastEmit >= PROGRESS_MIN_INTERVAL_MS) {
        this.#lastEmit = now;
        this.#events.progress({ job: { ...job } });
      }
    };

    let promise: Promise<{ fileName: string; snapshotFileName: string | null }>;
    try {
      promise = run(abort.signal, onProgress);
    } catch (err) {
      this.#job = null;
      this.#abort = null;
      throw err;
    }
    void promise.then(
      (r) => this.#finish(jobId, kind, target, { ...r, sourceName, error: null }),
      (err: unknown) => {
        const error =
          err instanceof WtfBackupError
            ? { code: err.code, message: err.message }
            : { code: "internal_error", message: "Something went wrong. Your WoW settings were not changed." };
        if (!(err instanceof WtfBackupError)) {
          console.error(`[wtf] ${kind} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (error.code !== "cancelled") {
          this.#events.failed?.(error.code, error.message);
        }
        this.#finish(jobId, kind, target, { fileName: null, snapshotFileName: null, sourceName, error });
      },
    );
    return { jobId };
  }

  #finish(
    jobId: string,
    kind: WtfJobKind,
    target: WtfJobTarget,
    outcome: {
      fileName: string | null;
      snapshotFileName: string | null;
      sourceName: string | null;
      error: { code: string; message: string } | null;
    },
  ): void {
    this.#job = null;
    this.#abort = null;
    this.#events.completed({ jobId, kind, installationId: target.installationId, ...outcome });
  }
}
