import { beforeEach, describe, expect, test } from "bun:test";
import type { WtfCompleted, WtfJobSnapshot } from "./types";
import {
  bumpWtfList,
  clearWtfOutcome,
  getWtfState,
  handleWtfEvent,
  onWtfCompleted,
  onWtfProgress,
  reconcileWtfJob,
  resetWtfState,
  subscribeWtfState,
} from "./wtfBackupState";

const job = (over: Partial<WtfJobSnapshot> = {}): WtfJobSnapshot => ({
  jobId: "j1",
  kind: "create",
  installationId: "i1",
  phase: "compress",
  done: 10,
  total: 100,
  ...over,
});
const completed = (over: Partial<WtfCompleted> = {}): WtfCompleted => ({
  jobId: "j1",
  kind: "create",
  installationId: "i1",
  fileName: "wtf_1.zip",
  snapshotFileName: null,
  sourceName: null,
  error: null,
  ...over,
});

beforeEach(() => resetWtfState());

describe("wtfBackupState", () => {
  test("progress sets the job and clears a previous outcome", () => {
    onWtfCompleted(completed());
    expect(getWtfState().outcome?.ok).toBe(true);
    onWtfProgress(job());
    expect(getWtfState().job?.jobId).toBe("j1");
    expect(getWtfState().outcome).toBeNull();
  });

  test("completion ends the job, records an inline outcome and bumps listVersion", () => {
    onWtfProgress(job());
    const before = getWtfState().listVersion;
    onWtfCompleted(completed());
    const s = getWtfState();
    expect(s.job).toBeNull();
    expect(s.listVersion).toBe(before + 1);
    expect(s.outcome).toMatchObject({ ok: true, kind: "create", text: "Backup created." });
  });

  test("a failed job becomes a friendly error, never raw text", () => {
    onWtfCompleted(completed({ fileName: null, error: { code: "game_running", message: "x" } }));
    expect(getWtfState().outcome).toMatchObject({ ok: false });
    expect(getWtfState().outcome?.text).toContain("Close World of Warcraft");
  });

  test("restore outcome mentions the safety backup", () => {
    onWtfCompleted(completed({ kind: "restore", snapshotFileName: "wtf_2.zip" }));
    expect(getWtfState().outcome?.text).toContain("safety backup");
  });

  test("handleWtfEvent routes only wtf events", () => {
    handleWtfEvent({ event: "addons.changed", params: { addonIds: [] } });
    expect(getWtfState()).toEqual({ job: null, outcome: null, listVersion: 0 });
    handleWtfEvent({ event: "wtf.progress", params: { job: job() } });
    expect(getWtfState().job?.phase).toBe("compress");
    handleWtfEvent({ event: "wtf.completed", params: completed() });
    expect(getWtfState().job).toBeNull();
  });

  test("reconcile attaches to a job the UI missed and drops one the engine no longer has", () => {
    reconcileWtfJob(job({ jobId: "late" }));
    expect(getWtfState().job?.jobId).toBe("late");
    reconcileWtfJob(job({ jobId: "late", done: 99 })); // same job: keep (events are fresher)
    expect(getWtfState().job?.done).toBe(10);
    reconcileWtfJob(null);
    expect(getWtfState().job).toBeNull();
  });

  test("bumpWtfList asks list views to reload without touching the job or outcome", () => {
    onWtfProgress(job());
    const v = getWtfState().listVersion;
    bumpWtfList();
    expect(getWtfState().listVersion).toBe(v + 1);
    expect(getWtfState().job?.jobId).toBe("j1");
  });

  test("subscribers are notified and can unsubscribe; clearWtfOutcome only notifies when there is one", () => {
    let calls = 0;
    const off = subscribeWtfState(() => (calls += 1));
    clearWtfOutcome();
    expect(calls).toBe(0);
    onWtfProgress(job());
    expect(calls).toBe(1);
    onWtfCompleted(completed());
    clearWtfOutcome();
    expect(calls).toBe(3);
    off();
    onWtfProgress(job());
    expect(calls).toBe(3);
  });
});
