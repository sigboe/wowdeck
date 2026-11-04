import type { Clock } from "./clock";
import { createKeyedResource, type KeyedResource } from "./keyedResource";
import type { Rpc } from "./services/envelope";
import { createStore } from "./store";
import {
  type Affected,
  changedIn,
  copied,
  EVERYTHING,
  imported,
  unrecordedJob,
} from "./wtfAffected";
import type {
  BackendEvent,
  PluginSettings,
  WtfCompleted,
  WtfCopySourcesResult,
  WtfJobSnapshot,
  WtfListResult,
} from "./types";
import type { MethodMap } from "../backend/src/api/contracts";
import {
  errorCodeOf,
  friendlyWtfCallError,
  friendlyWtfError,
  importNotice,
  outcomeOf,
  UNKNOWN_SETTINGS_WRITE,
  unknownCancelOutcome,
  unknownOutcome,
  type WtfOutcome,
} from "./wtfText";

/** How often a viewed resource is read again (WoW may start or close meanwhile). */
export const WTF_POLL_MS = 10_000;

/** The settings a running job reads (folder, safety backups to keep). */
export type WtfSettingsPatch = Partial<Pick<PluginSettings, "wtfBackupDir" | "wtfKeepSnapshots">>;

export interface WtfLifecycleDeps {
  rpc: Rpc;
  clock: Clock;
  /** Persist settings (the settings store's `write`; throws on failure). */
  writeSettings: (patch: WtfSettingsPatch) => Promise<unknown>;
  /** Read the engine's settings into the settings store (its `load`; never throws). */
  readSettings: () => Promise<void>;
}

/** The actions that start a Settings job and take the one operation slot. */
export type WtfOperationKind = WtfJobSnapshot["kind"];
/** The actions that take the slot for one request only: the engine runs no job for them. */
export type WtfRequestKind = "import" | "delete";

/**
 * What holds the global operation slot. The engine runs one Settings job at a
 * time behind one lock, so one slot covers every installation.
 */
export type WtfActivity =
  /** Confirmed and sent; the engine hasn't answered with a job ID yet. */
  | { phase: "starting"; kind: WtfOperationKind; installationId: string }
  /**
   * The engine runs this job. `cancel`: "pending" while a cancel request is
   * out, "requested" once the engine signalled the abort; neither ends it.
   */
  | {
      phase: "running";
      kind: WtfOperationKind;
      installationId: string;
      jobId: string;
      cancel: "none" | "pending" | "requested";
    }
  /**
   * Import or delete: sent, no answer yet. It holds the engine's lock while the
   * request runs, so no job may start. `fileName`: the backup being deleted.
   */
  | {
      phase: "requesting";
      kind: WtfRequestKind;
      installationId: string;
      fileName: string | null;
    }
  /**
   * A backup folder or retention write is out. The engine takes no lock for
   * it, but a job reads both settings while it runs, so it holds the slot.
   */
  | { phase: "settings" }
  /**
   * Its result can't be established: the start's or request's answer was
   * lost (`jobId` null), or a running job ended without a completion. Holds
   * the slot until a fresh list shows what the engine runs now.
   */
  | {
      phase: "unknown";
      kind: WtfOperationKind | WtfRequestKind;
      installationId: string;
      jobId: string | null;
    };

/**
 * Failures that don't show the engine refused: the call may have run. No code
 * means the Decky bridge itself failed; main.py names the others (its request
 * timeout, a dead or stopped engine) after the request may have been sent.
 */
const AMBIGUOUS_CODES = new Set(["timeout", "engine_unavailable", "engine_stopped"]);
const isAmbiguous = (e: unknown) => {
  const code = errorCodeOf(e);
  return code === undefined || AMBIGUOUS_CODES.has(code);
};

export interface WtfOperationSnapshot {
  /** The slot holder, or null when an action may start. */
  readonly activity: WtfActivity | null;
  /** The running job's latest progress, for display. */
  readonly job: WtfJobSnapshot | null;
  /** The latest finished job's result (one, global); views show it for its installation only. */
  readonly outcome: WtfOutcome | null;
  /** Action errors per initiating installation, kept until that installation's next action. */
  readonly errors: Readonly<Record<string, string>>;
  /** Import notices per initiating installation, kept until that installation's next action. */
  readonly notices: Readonly<Record<string, string>>;
  /** Why the latest backup folder or retention write failed; null once one succeeds or starts. */
  readonly settingsError: string | null;
  /** The latest write's answer was lost: whether it saved is unknown. Null once another starts. */
  readonly settingsUnknown: string | null;
}

export type WtfRestoreChoice = Omit<MethodMap["wtf.restore"]["params"], "installationId">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WtfCopyChoice = DistributiveOmit<MethodMap["wtf.copy"]["params"], "installationId">;

/**
 * The Settings backup lifecycle (ADR 0007): one module owns the reads Options,
 * Manage backups and Settings copy show, the job-starting actions and the job
 * they started, so their state outlives every modal change and they share
 * freshness rules, polling and one operation guard. Views bind to it thinly
 * (wtfSession.ts) and keep only selection, confirmation, pickers and navigation.
 */
export interface WtfLifecycle {
  /** `wtf.list`, per installation id. */
  backupList: KeyedResource<WtfListResult>;
  /** `wtf.copySources`, per installation id: what Settings copy can bring settings from. */
  copySources: KeyedResource<WtfCopySourcesResult>;
  /** Installations that still exist; state for any other is dropped. */
  retainInstallations(ids: readonly string[]): void;

  /** The operation slot, the running job, the latest outcome and per-installation feedback. */
  operation: {
    get(): WtfOperationSnapshot;
    subscribe(listener: () => void): () => void;
  };
  /**
   * Start a job for `installationId` (the installation the action began in;
   * later navigation can't redirect it). Call at invocation, also from inside
   * confirmation callbacks: the guard is checked then. Resolves true once the
   * engine acknowledged the job; false when the slot was taken (nothing sent)
   * or the engine refused (the error is in `errors[installationId]`).
   */
  create(installationId: string): Promise<boolean>;
  restore(installationId: string, choice: WtfRestoreChoice): Promise<boolean>;
  copy(installationId: string, choice: WtfCopyChoice): Promise<boolean>;
  /**
   * Import the picked zip into `installationId`'s backups (or the version it
   * was made for); the notice lands in `notices[installationId]`. Call from
   * the picker's callback: the guard is checked then. Resolves true once the
   * engine filed it.
   */
  importBackup(installationId: string, path: string): Promise<boolean>;
  /** Delete one backup; call from the confirmation's OK. Resolves true once it is gone. */
  deleteBackup(installationId: string, fileName: string): Promise<boolean>;
  /**
   * Save the backup folder or retention through the settings store, holding
   * the slot until the write settles. Resolves true once saved; false when
   * the slot was taken (nothing written), the engine refused (the reason is
   * in `settingsError`) or the answer was lost (`settingsUnknown`; the slot
   * is held until the settings store read the engine's settings again).
   */
  saveSettings(patch: WtfSettingsPatch): Promise<boolean>;
  /**
   * Ask the engine to abort the running job; repeated presses send one request.
   * A lost answer is an unknown outcome, not an error: the job stays busy.
   */
  cancel(): Promise<void>;
  /** `wtf.progress` / `wtf.completed`, forwarded once per plugin load (index.tsx). */
  handleEvent(event: BackendEvent): void;
}

const EMPTY_OPERATION: WtfOperationSnapshot = {
  activity: null,
  job: null,
  outcome: null,
  errors: {},
  notices: {},
  settingsError: null,
  settingsUnknown: null,
};

export function createWtfLifecycle(deps: WtfLifecycleDeps): WtfLifecycle {
  const operation = createStore<WtfOperationSnapshot>(EMPTY_OPERATION);
  /** Jobs that ended: a late acknowledgement, event or list answer can't revive them. */
  const finished = new Set<string>();
  /** What each job the UI started will change, for when it ends. */
  const jobAffects = new Map<string, Affected>();
  /** What an `unknown` activity may have changed, invalidated once it resolves. */
  let unknownAffects: Affected = EVERYTHING;
  /**
   * Bumped by every job event and job-starting step. A list read stamps it when
   * sent; if it moved before the answer, the answer's job field is stale (and
   * the engine reads that field after the list contents, so it isn't one
   * snapshot with them either).
   */
  let changes = 0;
  const bumpChanges = () => void changes++;

  /** The installations that exist; null until the first `retainInstallations`. */
  let retained: ReadonlySet<string> | null = null;

  const setFeedback = (
    field: "errors" | "notices",
    installationId: string,
    text: string | null,
  ) => {
    if (text !== null && retained !== null && !retained.has(installationId)) {
      return; // a late answer for an installation that is gone
    }
    const map = { ...operation.get()[field] };
    if (text === null) {
      if (!(installationId in map)) {
        return;
      }
      delete map[installationId];
    } else {
      map[installationId] = text;
    }
    operation.patch({ [field]: map });
  };
  const setError = (installationId: string, text: string | null) =>
    setFeedback("errors", installationId, text);
  /** An installation's next action starts: its earlier error and import notice go. */
  const clearFeedback = (installationId: string) => {
    setFeedback("errors", installationId, null);
    setFeedback("notices", installationId, null);
  };

  const adopt = (job: WtfJobSnapshot) => {
    const { activity } = operation.get();
    if (activity?.phase === "starting") {
      operation.patch({ job }); // most likely ours; the acknowledgement names it
      return;
    }
    if (activity?.phase === "unknown") {
      if (activity.kind === job.kind && activity.installationId === job.installationId) {
        // Most likely the unknown start: the job's end refreshes what it changes.
        if (!jobAffects.has(job.jobId)) {
          jobAffects.set(job.jobId, unknownAffects);
        }
        unknownAffects = EVERYTHING;
      } else {
        unknownResolved();
      }
    }
    operation.patch({
      job,
      // An unknown start now has a running job: its real result is on its way.
      ...(activity?.phase === "unknown" && activity.kind === job.kind ? { outcome: null } : {}),
      activity:
        activity?.phase === "running" && activity.jobId === job.jobId
          ? activity
          : {
              phase: "running",
              kind: job.kind,
              installationId: job.installationId,
              jobId: job.jobId,
              cancel: "none",
            },
    });
  };

  /**
   * A list answer carries the engine's view of the running job. Only an answer
   * sent after the last job change counts: older ones can't revive a finished
   * job or clear a newer one.
   */
  const reconcile = (engineJob: WtfJobSnapshot | null, stamp: number) => {
    if (stamp !== changes) {
      return;
    }
    const { activity, job } = operation.get();
    if (engineJob === null) {
      if (activity?.phase === "running") {
        // It ended and its completion never arrived: the engine keeps no outcome.
        operation.patch({
          activity: null,
          job: null,
          outcome: unknownOutcome(activity.kind, activity.installationId),
        });
        jobEnded(activity.jobId, activity.kind, activity.installationId);
      } else if (activity?.phase === "unknown") {
        // Nothing runs: whatever it did is done. No outcome is claimed.
        operation.patch({ activity: null, job: null });
        unknownResolved();
      } else if (activity === null && job !== null) {
        operation.patch({ activity: null, job: null });
      }
      return;
    }
    if (finished.has(engineJob.jobId) || job?.jobId === engineJob.jobId) {
      return; // events are fresher than a poll
    }
    adopt(engineJob);
  };

  /** A job ended, however it went (a failed restore may leave its safety backup). */
  const jobEnded = (jobId: string, kind: WtfOperationKind, installationId: string) => {
    touch(jobAffects.get(jobId) ?? unrecordedJob(kind, installationId));
    jobAffects.delete(jobId);
  };

  /** An unknown result was settled: what it may have changed is read again. */
  const unknownResolved = () => {
    touch(unknownAffects);
    unknownAffects = EVERYTHING;
  };

  /** Whether `done` ends what holds the slot (an unknown start may have been this job). */
  const ends = (activity: WtfActivity | null, done: WtfCompleted) =>
    (activity?.phase === "running" && activity.jobId === done.jobId) ||
    (activity?.phase === "unknown" &&
      (activity.jobId === null
        ? activity.kind === done.kind && activity.installationId === done.installationId
        : activity.jobId === done.jobId));

  const onCompleted = (done: WtfCompleted) => {
    finished.add(done.jobId);
    const { activity, job } = operation.get();
    const settlesUnknown = activity?.phase === "unknown" && ends(activity, done);
    operation.patch({
      outcome: outcomeOf(done),
      job: job?.jobId === done.jobId ? null : job,
      activity: ends(activity, done) ? null : activity,
    });
    // After the slot frees: only lists someone views read again.
    jobEnded(done.jobId, done.kind, done.installationId);
    if (settlesUnknown) {
      unknownResolved();
    }
  };

  const backupList = createKeyedResource<WtfListResult>({
    read: (installationId) => deps.rpc("wtf.list", { installationId }),
    errorText: friendlyWtfCallError,
    clock: deps.clock,
    pollMs: WTF_POLL_MS,
    stamp: () => changes,
    onData: (_, list, stamp) => reconcile(list.job, stamp),
  });
  const copySources = createKeyedResource<WtfCopySourcesResult>({
    read: (installationId) => deps.rpc("wtf.copySources", { installationId }),
    errorText: friendlyWtfCallError,
    clock: deps.clock,
    pollMs: WTF_POLL_MS,
  });

  /**
   * The installation `flavor` belongs to, from `fromId`'s copy sources: null
   * when that version isn't installed, undefined when they don't list it.
   */
  const installationOf = (fromId: string, flavor: string): string | null | undefined => {
    const source = copySources.get(fromId).data?.sources.find((s) => s.flavor === flavor);
    return source ? source.installationId : undefined;
  };

  // Unresolved work keeps its list polled, viewers or not, so a missed
  // completion or an unknown result is reconciled; `list.job` is global.
  let held: { key: string; release: () => void } | null = null;
  operation.subscribe(() => {
    const { activity } = operation.get();
    const want =
      activity?.phase === "running" || activity?.phase === "unknown"
        ? activity.installationId
        : null;
    if (held?.key === want) {
      return;
    }
    held?.release();
    held = want === null ? null : { key: want, release: backupList.subscribe(want, () => {}) };
  });

  const start = async (
    kind: WtfOperationKind,
    installationId: string,
    send: () => Promise<{ jobId: string }>,
    affects: Affected = changedIn(installationId),
  ): Promise<boolean> => {
    if (operation.get().activity !== null) {
      setError(installationId, friendlyWtfError("job_in_progress", ""));
      return false;
    }
    clearFeedback(installationId);
    bumpChanges();
    operation.patch({ activity: { phase: "starting", kind, installationId }, outcome: null });
    const ours = () => {
      const { activity } = operation.get();
      return activity?.phase === "starting" && activity.installationId === installationId;
    };
    try {
      const { jobId } = await send();
      if (!finished.has(jobId)) {
        jobAffects.set(jobId, affects);
      }
      bumpChanges();
      // Sent first: its answer then reconciles the job if its events were missed.
      void backupList.refresh(installationId);
      if (ours()) {
        operation.patch({
          activity: finished.has(jobId)
            ? null
            : { phase: "running", kind, installationId, jobId, cancel: "none" },
        });
      }
      return true;
    } catch (e) {
      bumpChanges();
      if (!isAmbiguous(e)) {
        if (ours()) {
          operation.patch({ activity: null });
        }
        setError(installationId, friendlyWtfCallError(e));
        return false;
      }
      // The job may have started. Never sent again: check what the engine runs.
      void backupList.refresh(installationId);
      if (ours()) {
        const { job, outcome } = operation.get();
        if (outcome?.kind === kind && outcome.installationId === installationId) {
          operation.patch({ activity: null }); // its completion already arrived
        } else if (job?.kind === kind && job.installationId === installationId) {
          jobAffects.set(job.jobId, affects);
          operation.patch({
            activity: { phase: "running", kind, installationId, jobId: job.jobId, cancel: "none" },
          });
        } else {
          unknownAffects = affects;
          operation.patch({
            activity: { phase: "unknown", kind, installationId, jobId: null },
            outcome: unknownOutcome(kind, installationId),
          });
        }
      }
      return false;
    }
  };

  /**
   * Import or delete: the slot is held for the request's lifetime only. A lost
   * answer is an unknown result, never sent again: a fresh list frees the slot.
   */
  const request = async <T>(
    kind: WtfRequestKind,
    installationId: string,
    fileName: string | null,
    send: () => Promise<T>,
    /** What the request changed; `undefined` when its answer was lost. */
    affects: (result: T | undefined) => Affected,
  ): Promise<T | null> => {
    if (operation.get().activity !== null) {
      setError(installationId, friendlyWtfError("job_in_progress", ""));
      return null;
    }
    clearFeedback(installationId);
    operation.patch({ activity: { phase: "requesting", kind, installationId, fileName } });
    const ours = () => {
      const { activity } = operation.get();
      return activity?.phase === "requesting" && activity.installationId === installationId;
    };
    try {
      const result = await send();
      if (ours()) {
        operation.patch({ activity: null });
      }
      touch(affects(result));
      return result;
    } catch (e) {
      if (!isAmbiguous(e)) {
        if (ours()) {
          operation.patch({ activity: null });
        }
        setError(installationId, friendlyWtfCallError(e));
        return null;
      }
      // It may have run: only reads sent from now on can free the slot.
      bumpChanges();
      touch(affects(undefined));
      if (ours()) {
        unknownAffects = affects(undefined);
        operation.patch({
          activity: { phase: "unknown", kind, installationId, jobId: null },
          outcome: unknownOutcome(kind, installationId),
        });
      }
      return null;
    }
  };

  const touch = ({ listChanged, sourcesChanged }: Affected) => {
    backupList.invalidate(listChanged);
    copySources.invalidate(sourcesChanged);
  };

  return {
    backupList,
    copySources,
    retainInstallations: (ids) => {
      retained = new Set(ids);
      backupList.retainOnly(ids);
      copySources.retainOnly(ids);
      const keep = (map: Readonly<Record<string, string>>) =>
        Object.keys(map).every((id) => retained!.has(id))
          ? map
          : Object.fromEntries(Object.entries(map).filter(([id]) => retained!.has(id)));
      const { errors, notices } = operation.get();
      if (keep(errors) !== errors || keep(notices) !== notices) {
        operation.patch({ errors: keep(errors), notices: keep(notices) });
      }
    },
    operation: { get: operation.get, subscribe: operation.subscribe },
    create: (installationId) =>
      start("create", installationId, () => deps.rpc("wtf.create", { installationId })),
    restore: (installationId, choice) =>
      start("restore", installationId, () =>
        deps.rpc("wtf.restore", { installationId, ...choice }),
      ),
    copy(installationId, choice) {
      const source =
        "sourceInstallationId" in choice
          ? choice.sourceInstallationId
          : installationOf(installationId, choice.sourceFlavor);
      return start(
        "copy",
        installationId,
        () => deps.rpc("wtf.copy", { installationId, ...choice }),
        copied(installationId, source),
      );
    },
    async importBackup(installationId, path) {
      if (operation.get().activity === null && operation.get().outcome) {
        operation.patch({ outcome: null }); // the outcome line made way for the import's notice
      }
      const result = await request(
        "import",
        installationId,
        null,
        () => deps.rpc("wtf.import", { installationId, path }),
        (result) =>
          imported(installationId, result, (flavor) => installationOf(installationId, flavor)),
      );
      if (result) {
        setFeedback("notices", installationId, importNotice(result));
      }
      return result !== null;
    },
    async deleteBackup(installationId, fileName) {
      const result = await request(
        "delete",
        installationId,
        fileName,
        () => deps.rpc("wtf.delete", { installationId, fileName }),
        () => changedIn(installationId),
      );
      return result !== null;
    },
    async saveSettings(patch) {
      if (operation.get().activity !== null) {
        operation.patch({ settingsError: friendlyWtfError("job_in_progress", "") });
        return false;
      }
      operation.patch({
        activity: { phase: "settings" },
        settingsError: null,
        settingsUnknown: null,
      });
      const release = () => {
        // A job another caller started meanwhile keeps the slot.
        if (operation.get().activity?.phase === "settings") {
          operation.patch({ activity: null });
        }
      };
      try {
        await deps.writeSettings(patch);
      } catch (e) {
        if (!isAmbiguous(e)) {
          release();
          operation.patch({ settingsError: friendlyWtfCallError(e) });
          return false;
        }
        // It may have saved. Never sent again: the folder may hold other backups
        // now, and Options shows what the engine has before anything else starts.
        operation.patch({ settingsUnknown: UNKNOWN_SETTINGS_WRITE });
        touch(EVERYTHING);
        await deps.readSettings();
        release();
        return false;
      }
      release();
      operation.patch({ settingsError: null });
      // A new folder holds other backups; every installation's lists read again.
      touch(EVERYTHING);
      return true;
    },
    async cancel() {
      const activity = operation.get().activity;
      if (activity?.phase !== "running" || activity.cancel !== "none") {
        return;
      }
      const { jobId, installationId } = activity;
      const mark = (cancel: "none" | "pending" | "requested") => {
        const now = operation.get().activity;
        if (now?.phase === "running" && now.jobId === jobId) {
          operation.patch({ activity: { ...now, cancel } });
        }
      };
      clearFeedback(installationId);
      mark("pending");
      try {
        const { cancelled } = await deps.rpc("wtf.cancel", { jobId });
        // Only a signalled abort; completion or a fresh list ends the job.
        mark(cancelled ? "requested" : "none");
      } catch (e) {
        mark("none");
        if (!isAmbiguous(e)) {
          setError(installationId, friendlyWtfCallError(e));
          return;
        }
        // The abort may have been signalled: the job's end shows what happened.
        if (operation.get().activity?.phase === "running") {
          operation.patch({ outcome: unknownCancelOutcome(activity.kind, installationId) });
        }
      }
    },
    handleEvent(event) {
      if (event.event === "wtf.progress" || event.event === "wtf.completed") {
        bumpChanges();
      }
      if (event.event === "wtf.progress") {
        if (!finished.has(event.params.job.jobId)) {
          adopt(event.params.job);
          operation.patch({ outcome: null });
        }
      } else if (event.event === "wtf.completed") {
        onCompleted(event.params);
      }
    },
  };
}
