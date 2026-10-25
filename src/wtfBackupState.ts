/**
 * WTF backup job state, kept at module scope.
 *
 * Two reasons it can't live in a component: (1) any `showModal` unmounts
 * the whole plugin panel (guide G4), so progress/outcome would be lost
 * when the backup modal opens; (2) a backup or restore keeps running in
 * the engine after the UI that started it is gone, and the events must
 * still be seen. The engine's `wtf.progress` / `wtf.completed` events are
 * subscribed once per plugin load (index.tsx), and every view reads this
 * store.
 */
import type { BackendEvent, WtfCompleted, WtfJobSnapshot } from "./types";
import { outcomeOf, type WtfOutcome } from "./wtfText";
import { createStore } from "./store";

export interface WtfState {
  job: WtfJobSnapshot | null;
  /** Result of the most recently finished job, shown inline until the next action. */
  outcome: WtfOutcome | null;
  /** Bumped whenever a job finishes so list views reload. */
  listVersion: number;
}

const INITIAL: WtfState = { job: null, outcome: null, listVersion: 0 };
const store = createStore<WtfState>(INITIAL);
const set = store.set;

export const getWtfState = store.get;
export const subscribeWtfState = store.subscribe;

export function resetWtfState(): void {
  set(INITIAL);
}

export function onWtfProgress(job: WtfJobSnapshot): void {
  set({ ...store.get(), job, outcome: null });
}

export function onWtfCompleted(completed: WtfCompleted): void {
  set({
    job: null,
    outcome: outcomeOf(completed),
    listVersion: store.get().listVersion + 1,
  });
}

/** Called when the user starts a job: clears the previous result line. */
export function clearWtfOutcome(): void {
  if (store.get().outcome) {
    set({ ...store.get(), outcome: null });
  }
}

/**
 * A list response carries the engine's own view of the running job. After a
 * plugin reload the UI may have missed events, so the engine wins: attach to
 * a job we don't know about, and drop one the engine says is gone.
 */
export function reconcileWtfJob(engineJob: WtfJobSnapshot | null): void {
  const known = store.get().job;
  if (engineJob === null && known === null) {
    return;
  }
  if (engineJob !== null && known !== null && engineJob.jobId === known.jobId) {
    return;
  }
  set({ ...store.get(), job: engineJob });
}

/** Event router used by index.tsx; ignores every other event. */
export function handleWtfEvent(event: BackendEvent): void {
  if (event.event === "wtf.progress") {
    onWtfProgress(event.params.job);
  } else if (event.event === "wtf.completed") {
    onWtfCompleted(event.params);
  }
}

/** Make list views reload (e.g. the backup folder setting changed or a file was imported). */
export function bumpWtfList(): void {
  set({ ...store.get(), listVersion: store.get().listVersion + 1 });
}
