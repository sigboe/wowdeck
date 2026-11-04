/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type {
  PluginSettings,
  WtfCompleted,
  WtfCopySourcesResult,
  WtfImportResult,
  WtfJobSnapshot,
  WtfListResult,
} from "./types";
import { createWtfLifecycle, WTF_POLL_MS } from "./wtfLifecycle";
import { createDeferredRpc } from "./testSupport/deferredRpc";
import { createManualClock } from "./testSupport/manualClock";
import { createSettingsStore } from "./settingsStore";
import { defaultSettings } from "../backend/src/wow/storage/settings";

const listOf = (fileNames: string[], job: WtfJobSnapshot | null = null): WtfListResult => ({
  wtfExists: true,
  backupDir: "/backups",
  dirAvailable: true,
  backups: fileNames.map((fileName) => ({ fileName }) as WtfListResult["backups"][number]),
  totalBackupBytes: 0,
  gameRunning: "not_running",
  job,
});
const names = (list: WtfListResult | null) => list?.backups.map((b) => b.fileName) ?? null;

/** The module over the deferred typed RPC and a manual clock: the harness later tickets reuse. */
function harness() {
  const engine = createDeferredRpc();
  const clock = createManualClock();
  // The real settings store over the same engine: persistence stays there.
  const settings = createSettingsStore({
    get: async () => (await engine.rpc("settings.get")).settings,
    set: async (patch) => (await engine.rpc("settings.set", { settings: patch })).settings,
    toast: () => {},
  });
  const lifecycle = createWtfLifecycle({
    rpc: engine.rpc,
    clock,
    writeSettings: settings.write,
    readSettings: settings.load,
  });
  const lists = lifecycle.backupList;
  /** A view of one installation's list: counts notifications, unsubscribes on `close`. */
  const view = (installationId: string | null) => {
    let notified = 0;
    const close = lists.subscribe(installationId, () => notified++);
    return { close, notified: () => notified, snapshot: () => lists.get(installationId) };
  };
  const listCalls = (installationId: string) =>
    engine.log.filter((line) => line === `wtf.list {"installationId":"${installationId}"}`).length;
  return { engine, clock, lifecycle, lists, view, listCalls, settings };
}

describe("Settings backup lifecycle: backup lists", () => {
  test("the first viewer loads the list; loading shows until it answers", async () => {
    const { engine, view } = harness();
    const options = view("i1");
    expect(options.snapshot()).toEqual({ data: null, error: null, loading: true });
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    expect(names(options.snapshot().data)).toEqual(["a.zip"]);
    expect(options.snapshot().loading).toBe(false);
    expect(options.notified()).toBeGreaterThan(0);
  });
});

describe("Settings backup lifecycle: retention and shared polling (scenario 5)", () => {
  test("viewers of one installation share one ten-second loop that stops with the last viewer", async () => {
    const { engine, clock, view, listCalls } = harness();
    const options = view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    const manage = view("i1");
    expect(listCalls("i1")).toBe(1); // the second viewer reuses the loop, no second read
    expect(clock.activeTimers()).toBe(1);

    clock.advance(WTF_POLL_MS - 1);
    expect(listCalls("i1")).toBe(1);
    clock.advance(1);
    expect(listCalls("i1")).toBe(2);
    await engine.next("wtf.list").resolve(listOf(["a.zip", "b.zip"]));
    expect(names(manage.snapshot().data)).toEqual(["a.zip", "b.zip"]);

    options.close();
    clock.advance(WTF_POLL_MS);
    expect(listCalls("i1")).toBe(3);
    await engine.next("wtf.list").resolve(listOf(["b.zip"]));
    manage.close();
    expect(clock.activeTimers()).toBe(0);
    clock.advance(WTF_POLL_MS * 3);
    expect(listCalls("i1")).toBe(3);
  });

  test("a poll is skipped while a read of that installation is still running", async () => {
    const { engine, clock, view, listCalls } = harness();
    view("i1");
    clock.advance(WTF_POLL_MS * 2);
    expect(listCalls("i1")).toBe(1);
    await engine.next("wtf.list").resolve(listOf([]));
  });

  test("remounting shows the retained list at once, then revalidates it", async () => {
    const { engine, view, listCalls } = harness();
    const options = view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    options.close(); // the panel unmounts when Manage backups opens (guide G4)

    const manage = view("i1");
    expect(names(manage.snapshot().data)).toEqual(["a.zip"]);
    expect(manage.snapshot().loading).toBe(false); // cached data, no spinner
    expect(listCalls("i1")).toBe(2);
    await engine.next("wtf.list").resolve(listOf(["a.zip", "b.zip"]));
    expect(names(manage.snapshot().data)).toEqual(["a.zip", "b.zip"]);
  });

  test("an applied answer hands the engine's job to the operation", async () => {
    const { engine, lifecycle, view } = harness();
    view("i1");
    const job = { jobId: "j1", kind: "create", installationId: "i1" } as WtfJobSnapshot;
    await engine.next("wtf.list").resolve(listOf([], job));
    expect(lifecycle.operation.get().job).toEqual(job);
  });
});

describe("Settings backup lifecycle: changing installations (scenario 4)", () => {
  test("another installation never shows the previous one's list, even when its answer is late", async () => {
    const { engine, view } = harness();
    const one = view("i1");
    const firstRead = engine.next("wtf.list");
    one.close();
    const two = view("i2");
    expect(two.snapshot()).toEqual({ data: null, error: null, loading: true });
    await firstRead.resolve(listOf(["i1.zip"]));
    expect(two.snapshot().data).toBeNull();
    await engine.next("wtf.list").resolve(listOf(["i2.zip"]));
    expect(names(two.snapshot().data)).toEqual(["i2.zip"]);
  });

  test("no selection shows nothing and reads nothing, whatever answers arrive", async () => {
    const { engine, lists, view } = harness();
    const one = view("i1");
    const pending = engine.next("wtf.list");
    one.close();
    const none = view(null);
    expect(none.snapshot()).toEqual({ data: null, error: null, loading: false });
    await pending.resolve(listOf(["i1.zip"]));
    expect(lists.get(null).data).toBeNull();
    expect(engine.pending()).toHaveLength(0);
  });

  test("a removed installation's late answer can't refill it, and returning revalidates", async () => {
    const { engine, lifecycle, lists, view, listCalls } = harness();
    const one = view("i1");
    await engine.next("wtf.list").resolve(listOf(["old.zip"]));
    one.close();
    view("i1").close();
    const late = engine.next("wtf.list");

    lifecycle.retainInstallations(["i2"]);
    expect(lists.get("i1").data).toBeNull();
    await late.resolve(listOf(["late.zip"], { jobId: "late" } as WtfJobSnapshot));
    expect(lists.get("i1").data).toBeNull();
    expect(lifecycle.operation.get().job).toBeNull(); // the late answer's job never reached it

    const back = view("i1");
    expect(listCalls("i1")).toBe(3);
    expect(back.snapshot().loading).toBe(true);
    await engine.next("wtf.list").resolve(listOf(["new.zip"]));
    expect(names(back.snapshot().data)).toEqual(["new.zip"]);
  });

  test("a removed installation's errors and notices go, and late answers can't bring them back", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").reject("wtf_missing", "no WTF");
    void lifecycle.importBackup("i2", "/a.zip");
    await engine.next("wtf.import").resolve(imported());
    expect(Object.keys(lifecycle.operation.get().errors)).toEqual(["i1"]);
    expect(Object.keys(lifecycle.operation.get().notices)).toEqual(["i2"]);

    lifecycle.retainInstallations(["i3"]);
    expect(lifecycle.operation.get().errors).toEqual({});
    expect(lifecycle.operation.get().notices).toEqual({});

    void lifecycle.importBackup("i3", "/b.zip");
    lifecycle.retainInstallations([]);
    await engine.next("wtf.import").resolve(imported());
    expect(lifecycle.operation.get().notices).toEqual({});
    expect(lifecycle.operation.get().activity).toBeNull(); // the slot still frees

    void lifecycle.restore("i4", {
      fileName: "a.zip",
      acceptUnknownFlavor: false,
      keepCurrentConfig: false,
    });
    lifecycle.retainInstallations([]);
    await engine.next("wtf.restore").reject("game_running", "running");
    expect(lifecycle.operation.get().errors).toEqual({});
    expect(lifecycle.operation.get().activity).toBeNull();
  });

  test("a removed installation still on screen empties for its viewer", async () => {
    const { engine, lifecycle, view } = harness();
    const one = view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    const before = one.notified();
    lifecycle.retainInstallations([]);
    expect(one.snapshot().data).toBeNull();
    expect(one.notified()).toBeGreaterThan(before);
  });

  test("an older answer never replaces a newer one", async () => {
    const { engine, lists, view } = harness();
    view("i1");
    const older = engine.next("wtf.list");
    const refreshed = lists.refresh("i1");
    const newer = engine.pending("wtf.list")[1];
    await newer.resolve(listOf(["new.zip"]));
    await older.resolve(listOf(["old.zip"]));
    await refreshed;
    expect(names(lists.get("i1").data)).toEqual(["new.zip"]);
  });
});

describe("Settings backup lifecycle: refresh failures (scenario 6)", () => {
  test("a failed first load is an error, never an empty list; Retry reads again", async () => {
    const { engine, lists, view, listCalls } = harness();
    const options = view("i1");
    await engine.next("wtf.list").reject("internal", "disk on fire");
    expect(options.snapshot().data).toBeNull();
    expect(options.snapshot().error).not.toBeNull();
    expect(options.snapshot().loading).toBe(false);

    const retry = lists.refresh("i1");
    expect(listCalls("i1")).toBe(2);
    await engine.next("wtf.list").resolve(listOf([]));
    await retry;
    expect(options.snapshot()).toEqual({ data: listOf([]), error: null, loading: false });
  });

  test("a failed background refresh keeps the cached list beside the error; success clears it", async () => {
    const { engine, clock, view } = harness();
    const manage = view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    clock.advance(WTF_POLL_MS);
    await engine.next("wtf.list").fail(new Error("lost"));
    expect(names(manage.snapshot().data)).toEqual(["a.zip"]);
    expect(manage.snapshot().error).not.toBeNull();

    clock.advance(WTF_POLL_MS);
    await engine.next("wtf.list").resolve(listOf(["a.zip", "b.zip"]));
    expect(manage.snapshot().error).toBeNull();
    expect(names(manage.snapshot().data)).toEqual(["a.zip", "b.zip"]);
  });

  test("a poll overtaking an explicit refresh doesn't leave loading stuck", async () => {
    const { engine, clock, lists, view } = harness();
    view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    clock.advance(WTF_POLL_MS); // poll in flight
    const poll = engine.next("wtf.list");
    const refreshed = lists.refresh("i1");
    expect(lists.get("i1").loading).toBe(true);
    const explicit = engine.pending("wtf.list")[1];
    await poll.resolve(listOf(["stale.zip"]));
    expect(names(lists.get("i1").data)).toEqual(["a.zip"]); // the poll was overtaken
    await explicit.resolve(listOf(["b.zip"]));
    await refreshed;
    expect(lists.get("i1")).toEqual({ data: listOf(["b.zip"]), error: null, loading: false });
  });

  test("an explicit refresh overtaken by a newer read still ends loading", async () => {
    const { engine, lists, view } = harness();
    view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    const first = lists.refresh("i1");
    const second = lists.refresh("i1");
    const [a, b] = engine.pending("wtf.list");
    await b.resolve(listOf(["b.zip"]));
    expect(lists.get("i1").loading).toBe(true);
    await a.fail(new Error("late"));
    await Promise.all([first, second]);
    expect(lists.get("i1")).toEqual({ data: listOf(["b.zip"]), error: null, loading: false });
  });
});

describe("Settings backup lifecycle: invalidation", () => {
  test("a change reads viewed lists again and ignores answers already on their way", async () => {
    const { engine, lifecycle, lists, view, listCalls } = harness();
    view("i1");
    const before = engine.next("wtf.list");
    // A copy the UI didn't start: every list may have changed.
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(listCalls("i1")).toBe(2);
    expect(lists.get("i1").loading).toBe(true);
    const after = engine.pending("wtf.list")[1];
    await after.resolve(listOf(["after.zip"]));
    await before.resolve(listOf(["before.zip"]));
    expect(names(lists.get("i1").data)).toEqual(["after.zip"]);
    expect(lists.get("i1").loading).toBe(false);
  });

  test("an unviewed list is not read until someone views it", async () => {
    const { engine, lifecycle, view, listCalls } = harness();
    const one = view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip"]));
    one.close();
    // A copy the UI didn't start: every list may have changed.
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(listCalls("i1")).toBe(1);
    view("i1");
    expect(listCalls("i1")).toBe(2);
  });
});

const progress = (over: Partial<WtfJobSnapshot> = {}): WtfJobSnapshot => ({
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
const BUSY = "Another backup or restore is already running.";

describe("Settings backup lifecycle: the operation guard (scenario 2)", () => {
  test("a confirmed backup holds the one slot for every installation before the engine answers", async () => {
    const { engine, lifecycle } = harness();
    const backup = lifecycle.create("i1");
    expect(lifecycle.operation.get().activity).toEqual({
      phase: "starting",
      kind: "create",
      installationId: "i1",
    });
    // A restore confirmed for another installation meanwhile sends nothing and says why.
    const restore = lifecycle.restore("i2", {
      fileName: "a.zip",
      acceptUnknownFlavor: false,
      keepCurrentConfig: false,
    });
    expect(await restore).toBe(false);
    expect(engine.pending().map((c) => c.method)).toEqual(["wtf.create"]);
    expect(lifecycle.operation.get().errors).toEqual({ i2: BUSY });

    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(await backup).toBe(true);
    expect(lifecycle.operation.get().activity).toMatchObject({
      phase: "running",
      jobId: "j1",
      installationId: "i1",
    });
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome).toMatchObject({ installationId: "i1", ok: true });
  });

  test("nothing is reserved until an action is invoked", () => {
    const { engine, lifecycle } = harness();
    expect(lifecycle.operation.get()).toMatchObject({ activity: null, job: null, outcome: null });
    expect(engine.log).toEqual([]);
  });

  test("a definite rejection frees the slot and shows the error for its installation only", async () => {
    const { engine, lifecycle } = harness();
    const copy = lifecycle.copy("i1", { sourceFlavor: "classic", sourceInstallationId: "i2" });
    await engine.next("wtf.copy").reject("game_running", "WoW is running");
    expect(await copy).toBe(false);
    const after = lifecycle.operation.get();
    expect(after.activity).toBeNull();
    expect(after.errors.i1).toContain("Close World of Warcraft");
    expect(after.errors.i2).toBeUndefined();

    // The installation's next action clears it; the request carries the initiating id.
    void lifecycle.create("i1");
    expect(lifecycle.operation.get().errors.i1).toBeUndefined();
    expect(engine.log[engine.log.length - 1]).toBe('wtf.create {"installationId":"i1"}');
  });

  test("a restore sends the confirmed choices for the installation it began in", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.restore("i1", {
      fileName: "a.zip",
      acceptUnknownFlavor: true,
      keepCurrentConfig: true,
    });
    expect(engine.next("wtf.restore").params).toEqual({
      installationId: "i1",
      fileName: "a.zip",
      acceptUnknownFlavor: true,
      keepCurrentConfig: true,
    });
  });

  test("a completion that arrives before the start's answer stays complete", async () => {
    const { engine, lifecycle } = harness();
    const backup = lifecycle.create("i1");
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress() } });
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get().activity?.phase).toBe("starting");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(await backup).toBe(true);
    expect(lifecycle.operation.get()).toMatchObject({ activity: null, job: null });
    expect(lifecycle.operation.get().outcome?.text).toBe("Backup created.");
  });

  test("the start's answer refreshes the initiating installation's list", async () => {
    const { engine, lifecycle, listCalls } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(listCalls("i1")).toBe(1);
  });
});

describe("Settings backup lifecycle: reconnecting after a modal change (scenario 1)", () => {
  test("a view mounted later sees the same pending and running operation, with no new request", async () => {
    const { engine, lifecycle } = harness();
    let heard = 0;
    const options = lifecycle.operation.subscribe(() => heard++);
    void lifecycle.create("i1");
    options(); // Manage backups opens: the panel unmounts

    const manage = lifecycle.operation.subscribe(() => heard++);
    expect(lifecycle.operation.get().activity?.phase).toBe("starting");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ done: 50 }) } });
    expect(lifecycle.operation.get().job?.done).toBe(50);
    expect(heard).toBeGreaterThan(1);
    manage();
    expect(engine.log.filter((l) => l.startsWith("wtf.create"))).toHaveLength(1);
  });

  test("feedback stays with the installation where the action began", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").reject("wtf_missing", "no WTF");
    // The view moved on to i2 meanwhile: i2 has nothing, i1 keeps its error.
    expect(lifecycle.operation.get().errors.i2).toBeUndefined();
    expect(lifecycle.operation.get().errors.i1).toBeTruthy();
  });
});

describe("Settings backup lifecycle: cancelling (scenario 10)", () => {
  test("repeated presses send one cancel; the job stays busy until it really ends", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    void lifecycle.cancel();
    void lifecycle.cancel();
    expect(engine.pending("wtf.cancel")).toHaveLength(1);
    expect(lifecycle.operation.get().activity).toMatchObject({ cancel: "pending" });
    await engine.next("wtf.cancel").resolve({ cancelled: true });
    void lifecycle.cancel();
    expect(engine.pending("wtf.cancel")).toHaveLength(0);
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "j1" });

    lifecycle.handleEvent({
      event: "wtf.completed",
      params: completed({ fileName: null, error: { code: "cancelled", message: "x" } }),
    });
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome?.ok).toBe(false);
  });

  test("a success that races the cancel shows as success", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    void lifecycle.cancel();
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    await engine.next("wtf.cancel").resolve({ cancelled: false });
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome).toMatchObject({ ok: true, text: "Backup created." });
  });

  test("a refused cancel shows its error for the job's installation and allows another press", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.restore("i1", {
      fileName: "a.zip",
      acceptUnknownFlavor: false,
      keepCurrentConfig: false,
    });
    await engine.next("wtf.restore").resolve({ jobId: "j1" });
    void lifecycle.cancel();
    await engine.next("wtf.cancel").reject("too_late_to_cancel", "late");
    expect(lifecycle.operation.get().errors.i1).toBeTruthy();
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", cancel: "none" });
    void lifecycle.cancel();
    expect(engine.pending("wtf.cancel")).toHaveLength(1);
  });

  test("a lost cancel answer is no error: the result is unknown and the job stays busy", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    void lifecycle.cancel();
    await engine.next("wtf.cancel").fail(new Error("bridge lost"));
    expect(lifecycle.operation.get().errors.i1).toBeUndefined();
    expect(lifecycle.operation.get().outcome).toMatchObject({ installationId: "i1", ok: null });
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "j1" });
    expect(engine.pending("wtf.cancel")).toHaveLength(0); // never sent again by itself

    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome).toMatchObject({ ok: true, text: "Backup created." });
  });
});

describe("Settings backup lifecycle: job events and the engine's job", () => {
  test("a job the UI didn't start (plugin reload, another caller) holds the slot", () => {
    const { lifecycle } = harness();
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ jobId: "x" }) } });
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "x" });
  });

  test("progress clears the previous outcome; a failed job reads as friendly text", () => {
    const { lifecycle } = harness();
    lifecycle.handleEvent({
      event: "wtf.completed",
      params: completed({ fileName: null, error: { code: "game_running", message: "x" } }),
    });
    expect(lifecycle.operation.get().outcome?.text).toContain("Close World of Warcraft");
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ jobId: "j2" }) } });
    expect(lifecycle.operation.get().outcome).toBeNull();
  });

  test("other events change nothing", () => {
    const { lifecycle } = harness();
    const before = lifecycle.operation.get();
    lifecycle.handleEvent({ event: "addons.changed", params: { addonIds: [] } });
    expect(lifecycle.operation.get()).toBe(before);
  });

  test("a list answer attaches to a job the UI missed and releases one the engine no longer has", async () => {
    const { engine, lifecycle, lists } = harness();
    void lists.refresh("i1");
    await engine.next("wtf.list").resolve(listOf([], progress({ jobId: "late" })));
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "late" });
    lifecycle.handleEvent({
      event: "wtf.progress",
      params: { job: progress({ jobId: "late", done: 60 }) },
    });
    void lists.refresh("i1");
    await engine.next("wtf.list").resolve(listOf([], progress({ jobId: "late", done: 20 })));
    expect(lifecycle.operation.get().job?.done).toBe(60); // events are fresher
    void lists.refresh("i1");
    await engine.next("wtf.list").resolve(listOf([]));
    // Its completion never arrived: free, but the result is unknown, not invented.
    expect(lifecycle.operation.get()).toMatchObject({
      activity: null,
      job: null,
      outcome: { installationId: "i1", ok: null },
    });
  });
});

const sourcesOf = (flavors: string[]): WtfCopySourcesResult => ({
  dirAvailable: true,
  gameRunning: "not_running",
  sources: flavors.map((flavor) => ({ flavor }) as WtfCopySourcesResult["sources"][number]),
});
const flavors = (result: WtfCopySourcesResult | null) =>
  result?.sources.map((s) => s.flavor) ?? null;

/** A view of one installation's copy sources, as Settings copy and Manage backups bind them. */
function sourcesHarness() {
  const h = harness();
  const sources = h.lifecycle.copySources;
  const view = (installationId: string | null) => {
    let notified = 0;
    const close = sources.subscribe(installationId, () => notified++);
    return { close, notified: () => notified, snapshot: () => sources.get(installationId) };
  };
  const sourceCalls = (installationId: string) =>
    h.engine.log.filter((line) => line === `wtf.copySources {"installationId":"${installationId}"}`)
      .length;
  return { ...h, sources, view, sourceCalls };
}

describe("Settings backup lifecycle: copy sources", () => {
  test("the first viewer loads the sources; loading shows until they answer", async () => {
    const { engine, view } = sourcesHarness();
    const copy = view("i1");
    expect(copy.snapshot()).toEqual({ data: null, error: null, loading: true });
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    expect(flavors(copy.snapshot().data)).toEqual(["_classic_"]);
    expect(copy.snapshot().loading).toBe(false);
    expect(copy.notified()).toBeGreaterThan(0);
  });

  test("copy sources and the backup list are separate resources", async () => {
    const { engine, view, sourceCalls, listCalls } = sourcesHarness();
    view("i1");
    expect(sourceCalls("i1")).toBe(1);
    expect(listCalls("i1")).toBe(0);
    await engine.next("wtf.copySources").resolve(sourcesOf([]));
  });

  test("viewers share one ten-second loop that stops with the last viewer (scenario 5)", async () => {
    const { engine, clock, view, sourceCalls } = sourcesHarness();
    const manage = view("i1");
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    const copy = view("i1"); // Settings copy opens over Manage backups
    expect(sourceCalls("i1")).toBe(1);
    expect(clock.activeTimers()).toBe(1);

    clock.advance(WTF_POLL_MS);
    expect(sourceCalls("i1")).toBe(2);
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_", "_beta_"]));
    expect(flavors(copy.snapshot().data)).toEqual(["_classic_", "_beta_"]);

    copy.close();
    manage.close();
    expect(clock.activeTimers()).toBe(0);
    clock.advance(WTF_POLL_MS * 3);
    expect(sourceCalls("i1")).toBe(2);
  });

  test("reopening Settings copy shows the retained sources at once, then revalidates", async () => {
    const { engine, view, sourceCalls } = sourcesHarness();
    const first = view("i1");
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    first.close();

    const again = view("i1");
    expect(flavors(again.snapshot().data)).toEqual(["_classic_"]);
    expect(again.snapshot().loading).toBe(false);
    expect(sourceCalls("i1")).toBe(2);
    await engine.next("wtf.copySources").resolve(sourcesOf(["_beta_"]));
    expect(flavors(again.snapshot().data)).toEqual(["_beta_"]);
  });

  test("another installation never shows the previous one's sources, even when its answer is late (scenario 4)", async () => {
    const { engine, view } = sourcesHarness();
    const one = view("i1");
    const late = engine.next("wtf.copySources");
    one.close();
    const two = view("i2");
    await late.resolve(sourcesOf(["from_i1"]));
    expect(two.snapshot().data).toBeNull();
    await engine.next("wtf.copySources").resolve(sourcesOf(["from_i2"]));
    expect(flavors(two.snapshot().data)).toEqual(["from_i2"]);
  });

  test("a removed installation's late answer can't refill its sources", async () => {
    const { engine, lifecycle, sources, view } = sourcesHarness();
    const one = view("i1");
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    one.close();
    view("i1").close();
    const late = engine.next("wtf.copySources");
    lifecycle.retainInstallations([]);
    expect(sources.get("i1").data).toBeNull();
    await late.resolve(sourcesOf(["late"]));
    expect(sources.get("i1").data).toBeNull();
  });

  test("a failed first load is an error, never an empty list; Retry reads again (scenario 6)", async () => {
    const { engine, sources, view, sourceCalls } = sourcesHarness();
    const copy = view("i1");
    await engine.next("wtf.copySources").reject("internal", "disk on fire");
    expect(copy.snapshot().data).toBeNull();
    expect(copy.snapshot().error).not.toBeNull();

    const retry = sources.refresh("i1");
    expect(sourceCalls("i1")).toBe(2);
    await engine.next("wtf.copySources").resolve(sourcesOf([]));
    await retry;
    expect(copy.snapshot()).toEqual({ data: sourcesOf([]), error: null, loading: false });
  });

  test("a failed poll keeps the cached sources beside the error; success clears it", async () => {
    const { engine, clock, view } = sourcesHarness();
    const copy = view("i1");
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    clock.advance(WTF_POLL_MS);
    await engine.next("wtf.copySources").fail(new Error("lost"));
    expect(flavors(copy.snapshot().data)).toEqual(["_classic_"]);
    expect(copy.snapshot().error).not.toBeNull();

    clock.advance(WTF_POLL_MS);
    await engine.next("wtf.copySources").resolve(sourcesOf(["_classic_"]));
    expect(copy.snapshot().error).toBeNull();
  });

  test("a change reads viewed sources again, and answers on their way are ignored", async () => {
    const { engine, lifecycle, sources, view, sourceCalls } = sourcesHarness();
    view("i1");
    const before = engine.next("wtf.copySources");
    // A copy the UI didn't start: every list may have changed.
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(sourceCalls("i1")).toBe(2);
    const after = engine.pending("wtf.copySources")[1];
    await after.resolve(sourcesOf(["after"]));
    await before.resolve(sourcesOf(["before"]));
    expect(flavors(sources.get("i1").data)).toEqual(["after"]);
  });
});

const UNKNOWN_BACKUP =
  "Couldn't tell whether the backup finished. Check the backup list before trying again.";

describe("Settings backup lifecycle: unknown results (scenario 8)", () => {
  test("a lost start answer is an unknown result: never retried, actions stay blocked until a fresh list", async () => {
    const { engine, lifecycle } = harness();
    const backup = lifecycle.create("i1");
    await engine.next("wtf.create").fail(new Error("Python Exception"));
    expect(await backup).toBe(false);
    const after = lifecycle.operation.get();
    expect(after.activity).toMatchObject({
      phase: "unknown",
      kind: "create",
      installationId: "i1",
    });
    expect(after.outcome).toEqual({
      kind: "create",
      installationId: "i1",
      ok: null,
      text: UNKNOWN_BACKUP,
    });
    expect(after.errors).toEqual({});

    // Blocked while activity can't be checked; nothing is sent again.
    expect(await lifecycle.create("i1")).toBe(false);
    expect(engine.log.filter((l) => l.startsWith("wtf.create"))).toHaveLength(1);

    // The module checks the engine's activity itself; a fresh answer unblocks without an outcome.
    await engine.next("wtf.list").resolve(listOf([]));
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome?.text).toBe(UNKNOWN_BACKUP);
    expect(engine.log.filter((l) => l.startsWith("wtf.create"))).toHaveLength(1);
  });

  test("an engine timeout is as ambiguous as a lost answer", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.restore("i1", {
      fileName: "a.zip",
      acceptUnknownFlavor: false,
      keepCurrentConfig: false,
    });
    await engine.next("wtf.restore").reject("timeout", "Request wtf.restore timed out");
    expect(lifecycle.operation.get().activity?.phase).toBe("unknown");
    expect(lifecycle.operation.get().outcome?.ok).toBeNull();
    expect(lifecycle.operation.get().errors).toEqual({});
  });

  test("while the engine can't be reached, actions stay blocked and only the list is read again", async () => {
    const { engine, clock, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").fail(new Error("Python Exception"));
    await engine.next("wtf.list").fail(new Error("Python Exception"));
    expect(lifecycle.operation.get().activity?.phase).toBe("unknown");
    expect(clock.activeTimers()).toBe(1); // no viewer, still polled

    clock.advance(WTF_POLL_MS);
    expect(engine.pending().map((c) => c.method)).toEqual(["wtf.list"]);
    await engine.next("wtf.list").resolve(listOf([]));
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(clock.activeTimers()).toBe(0);
    expect(engine.log.filter((l) => l.startsWith("wtf.create"))).toHaveLength(1);
  });

  test("a lost start answer whose job then reports progress is that job, not an unknown result", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").fail(new Error("Python Exception"));
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress() } });
    expect(lifecycle.operation.get()).toMatchObject({
      activity: { phase: "running", jobId: "j1" },
      outcome: null,
    });
  });

  test("a fresh list showing the job adopts it; its completion is the real result", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").fail(new Error("Python Exception"));
    await engine.next("wtf.list").resolve(listOf([], progress()));
    expect(lifecycle.operation.get()).toMatchObject({
      activity: { phase: "running", jobId: "j1" },
      outcome: null,
    });
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get().outcome?.text).toBe("Backup created.");
    expect(lifecycle.operation.get().activity).toBeNull();
  });

  test("a completion that arrives while the result is unknown settles it", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").fail(new Error("Python Exception"));
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get()).toMatchObject({ activity: null });
    expect(lifecycle.operation.get().outcome?.text).toBe("Backup created.");
  });

  test("a running job gone from a fresh list without a completion is an unknown result, until the completion arrives", async () => {
    const { engine, lifecycle, lists } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    await engine.next("wtf.list").resolve(listOf([], progress()));
    void lists.refresh("i1");
    await engine.next("wtf.list").resolve(listOf(["wtf_1.zip"]));
    expect(lifecycle.operation.get()).toMatchObject({
      activity: null,
      job: null,
      outcome: { ok: null, text: UNKNOWN_BACKUP },
    });
    // The engine clears its job before it emits the completion: a late one still counts.
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(lifecycle.operation.get().outcome).toMatchObject({ ok: true, text: "Backup created." });
  });
});

describe("Settings backup lifecycle: stale answers (scenario 3)", () => {
  test("a late null-job poll can't clear a job that started after it was sent", async () => {
    const { engine, lifecycle, view } = harness();
    view("i1");
    const late = engine.next("wtf.list");
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    await late.resolve(listOf([]));
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "j1" });
    expect(lifecycle.operation.get().outcome).toBeNull();
  });

  test("a null-job poll overtaken by progress can't clear the job", async () => {
    const { engine, clock, lifecycle, view } = harness();
    view("i1");
    await engine.next("wtf.list").resolve(listOf([]));
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    await engine.next("wtf.list").resolve(listOf([], progress()));
    clock.advance(WTF_POLL_MS);
    const poll = engine.next("wtf.list");
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ done: 70 }) } });
    await poll.resolve(listOf([]));
    expect(lifecycle.operation.get()).toMatchObject({
      activity: { phase: "running", jobId: "j1" },
      job: { done: 70 },
      outcome: null,
    });
  });

  test("a late running poll can't revive a job that completed after it was sent", async () => {
    const { engine, lifecycle, lists } = harness();
    void lists.refresh("i1");
    const late = engine.next("wtf.list");
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ jobId: "j9" }) });
    await late.resolve(listOf([], progress({ jobId: "j9" })));
    expect(lifecycle.operation.get()).toMatchObject({ activity: null, job: null });
  });

  test("a running poll sent before another job's progress doesn't take the slot from it", async () => {
    const { engine, lifecycle, lists } = harness();
    void lists.refresh("i1");
    const late = engine.next("wtf.list");
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ jobId: "j2" }) } });
    await late.resolve(listOf([], progress({ jobId: "j1" })));
    expect(lifecycle.operation.get().activity).toMatchObject({ jobId: "j2" });
  });

  test("a stale progress event can't revive a completed job", () => {
    const { lifecycle } = harness();
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress() } });
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ done: 99 }) } });
    expect(lifecycle.operation.get()).toMatchObject({ activity: null, job: null });
    expect(lifecycle.operation.get().outcome?.text).toBe("Backup created.");
  });

  test("a poll sent before a job started can't replace the list read after it", async () => {
    const { engine, lifecycle, view } = harness();
    const options = view("i1");
    const late = engine.next("wtf.list");
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    const fresh = engine.pending("wtf.list")[1];
    await fresh.resolve(listOf(["new.zip"], progress()));
    await late.resolve(listOf(["old.zip"]));
    expect(names(options.snapshot().data)).toEqual(["new.zip"]);
  });
});

describe("Settings backup lifecycle: polling unresolved work (scenario 5)", () => {
  test("a running job is polled with no viewers, and polling stops once it resolves", async () => {
    const { engine, clock, lifecycle, listCalls } = harness();
    void lifecycle.create("i1");
    expect(clock.activeTimers()).toBe(0); // nothing to reconcile before the engine answers
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(clock.activeTimers()).toBe(1);
    expect(listCalls("i1")).toBe(1);
    await engine.next("wtf.list").resolve(listOf([], progress()));

    clock.advance(WTF_POLL_MS);
    expect(listCalls("i1")).toBe(2);
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    expect(clock.activeTimers()).toBe(0);
    await engine.next("wtf.list").resolve(listOf(["wtf_1.zip"]));
    clock.advance(WTF_POLL_MS * 3);
    expect(listCalls("i1")).toBe(2);
  });

  test("a viewer that stays keeps polling after the work resolves", async () => {
    const { engine, clock, lifecycle, view, listCalls } = harness();
    const options = view("i1");
    await engine.next("wtf.list").resolve(listOf([]));
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    await engine.next("wtf.list").resolve(listOf(["wtf_1.zip"]));
    expect(clock.activeTimers()).toBe(1);
    clock.advance(WTF_POLL_MS);
    expect(listCalls("i1")).toBe(3);
    options.close();
    expect(clock.activeTimers()).toBe(0);
  });
});

const imported = (over: Partial<WtfImportResult> = {}): WtfImportResult => ({
  fileName: "wtf_2.zip",
  alreadyPresent: false,
  otherVersion: null,
  ...over,
});

describe("Settings backup lifecycle: import and delete through the guard (scenarios 2 and 7)", () => {
  test("a picked import holds the slot for every installation until the engine answers", async () => {
    const { engine, lifecycle } = harness();
    const importing = lifecycle.importBackup("i1", "/home/deck/wtf.zip");
    expect(lifecycle.operation.get().activity).toEqual({
      phase: "requesting",
      kind: "import",
      installationId: "i1",
      fileName: null,
    });
    // A backup in another installation and a delete here send nothing and say why.
    expect(await lifecycle.create("i2")).toBe(false);
    expect(await lifecycle.deleteBackup("i1", "a.zip")).toBe(false);
    expect(engine.pending().map((c) => c.method)).toEqual(["wtf.import"]);
    expect(engine.next("wtf.import").params).toEqual({
      installationId: "i1",
      path: "/home/deck/wtf.zip",
    });
    expect(lifecycle.operation.get().errors.i2).toBe(BUSY);

    await engine.next("wtf.import").resolve(imported());
    expect(await importing).toBe(true);
    expect(lifecycle.operation.get().activity).toBeNull();
  });

  test("a running job blocks import and delete without a request", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(await lifecycle.importBackup("i2", "/x.zip")).toBe(false);
    expect(await lifecycle.deleteBackup("i1", "a.zip")).toBe(false);
    expect(engine.log.some((l) => l.startsWith("wtf.import") || l.startsWith("wtf.delete"))).toBe(
      false,
    );
    expect(lifecycle.operation.get().errors).toEqual({ i1: BUSY, i2: BUSY });
  });

  test("a confirmed delete holds the slot naming its file; a rejection frees it with the error", async () => {
    const { engine, lifecycle } = harness();
    const deleting = lifecycle.deleteBackup("i1", "a.zip");
    expect(lifecycle.operation.get().activity).toEqual({
      phase: "requesting",
      kind: "delete",
      installationId: "i1",
      fileName: "a.zip",
    });
    expect(await lifecycle.importBackup("i2", "/x.zip")).toBe(false);
    expect(engine.next("wtf.delete").params).toEqual({ installationId: "i1", fileName: "a.zip" });

    await engine.next("wtf.delete").reject("job_in_progress", "busy");
    expect(await deleting).toBe(false);
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().errors.i1).toBe(BUSY);
  });

  test("a definite import rejection frees the slot and shows the error for its installation only", async () => {
    const { engine, lifecycle } = harness();
    const importing = lifecycle.importBackup("i1", "/x.zip");
    await engine.next("wtf.import").reject("backup_invalid", "not a WTF backup");
    expect(await importing).toBe(false);
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().errors.i1).toBeTruthy();
    expect(lifecycle.operation.get().errors.i2).toBeUndefined();
    expect(lifecycle.operation.get().notices).toEqual({});
  });

  test("the import notice survives a modal change for its installation until that installation's next action", async () => {
    const { engine, lifecycle } = harness();
    const manage = lifecycle.operation.subscribe(() => {});
    void lifecycle.importBackup("i1", "/x.zip");
    manage(); // the file picker or another modal unmounts the view
    await engine
      .next("wtf.import")
      .resolve(imported({ otherVersion: { flavor: "_classic_", displayName: "Classic" } }));

    const again = lifecycle.operation.subscribe(() => {});
    expect(lifecycle.operation.get().notices).toEqual({
      i1: "Added to Classic's backups. To use it here, choose Copy settings from another version.",
    });
    // Another installation's action leaves it alone; this installation's next action clears it.
    void lifecycle.deleteBackup("i2", "b.zip");
    await engine.next("wtf.delete").resolve({ fileName: "b.zip" });
    expect(lifecycle.operation.get().notices.i1).toBeTruthy();
    void lifecycle.create("i1");
    expect(lifecycle.operation.get().notices.i1).toBeUndefined();
    again();
  });

  test("an import hides the previous job's outcome; a delete leaves it", async () => {
    const { engine, lifecycle } = harness();
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    void lifecycle.deleteBackup("i1", "old.zip");
    expect(lifecycle.operation.get().outcome).not.toBeNull();
    await engine.next("wtf.delete").resolve({ fileName: "old.zip" });
    void lifecycle.importBackup("i1", "/x.zip");
    expect(lifecycle.operation.get().outcome).toBeNull();
  });

  test("a delete or import reads the viewed list again once the engine answers", async () => {
    const { engine, lifecycle, view, listCalls } = harness();
    view("i1");
    await engine.next("wtf.list").resolve(listOf(["a.zip", "b.zip"]));
    void lifecycle.deleteBackup("i1", "a.zip");
    expect(listCalls("i1")).toBe(1);
    await engine.next("wtf.delete").resolve({ fileName: "a.zip" });
    expect(listCalls("i1")).toBe(2);
    await engine.next("wtf.list").resolve(listOf(["b.zip"]));

    void lifecycle.importBackup("i1", "/x.zip");
    await engine.next("wtf.import").resolve(imported());
    expect(listCalls("i1")).toBe(3);
  });
});

describe("Settings backup lifecycle: import and delete with unknown results (scenario 8)", () => {
  test("a lost import answer is an unknown result: never resent, the slot holds until a fresh list", async () => {
    const { engine, clock, lifecycle } = harness();
    const importing = lifecycle.importBackup("i1", "/x.zip");
    await engine.next("wtf.import").fail(new Error("Python Exception"));
    expect(await importing).toBe(false);
    expect(lifecycle.operation.get()).toMatchObject({
      activity: { phase: "unknown", kind: "import", installationId: "i1", jobId: null },
      outcome: {
        kind: "import",
        installationId: "i1",
        ok: null,
        text: "Couldn't tell whether the import finished. Check the backup list before trying again.",
      },
      errors: {},
      notices: {},
    });

    // Blocked, with no viewer the list is still read; nothing is sent again.
    expect(await lifecycle.importBackup("i1", "/x.zip")).toBe(false);
    expect(engine.pending().map((c) => c.method)).toEqual(["wtf.list"]);
    await engine.next("wtf.list").fail(new Error("Python Exception"));
    expect(lifecycle.operation.get().activity?.phase).toBe("unknown");
    clock.advance(WTF_POLL_MS);
    await engine.next("wtf.list").resolve(listOf(["wtf_2.zip"]));
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().outcome?.ok).toBeNull(); // no outcome is invented
    expect(clock.activeTimers()).toBe(0);
    expect(engine.log.filter((l) => l.startsWith("wtf.import"))).toHaveLength(1);
  });

  test("a delete that times out is an unknown result; a list read sent before it can't free the slot", async () => {
    const { engine, lifecycle, view } = harness();
    view("i1");
    const early = engine.next("wtf.list");
    void lifecycle.deleteBackup("i1", "a.zip");
    await engine.next("wtf.delete").reject("timeout", "Request wtf.delete timed out");
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "unknown", kind: "delete" });
    expect(lifecycle.operation.get().outcome?.text).toBe(
      "Couldn't tell whether the backup was deleted. Check the backup list before trying again.",
    );
    await early.resolve(listOf(["a.zip"]));
    expect(lifecycle.operation.get().activity?.phase).toBe("unknown");
    await engine.next("wtf.list").resolve(listOf([]));
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(engine.log.filter((l) => l.startsWith("wtf.delete"))).toHaveLength(1);
  });
});

describe("Settings backup lifecycle: backup folder and retention (scenario 9)", () => {
  const saved = (over: Partial<PluginSettings> = {}): PluginSettings => ({
    ...defaultSettings(),
    ...over,
  });

  test("a pending settings write blocks every action in every installation until it settles", async () => {
    const { engine, lifecycle, settings } = harness();
    const write = lifecycle.saveSettings({ wtfBackupDir: "/sd/backups" });
    expect(lifecycle.operation.get().activity).toEqual({ phase: "settings" });
    expect(engine.log).toEqual(['settings.set {"settings":{"wtfBackupDir":"/sd/backups"}}']);

    expect(await lifecycle.create("i1")).toBe(false);
    expect(
      await lifecycle.restore("i2", {
        fileName: "a.zip",
        acceptUnknownFlavor: false,
        keepCurrentConfig: false,
      }),
    ).toBe(false);
    expect(await lifecycle.copy("i3", { sourceFlavor: "retail", sourceInstallationId: "i9" })).toBe(
      false,
    );
    expect(await lifecycle.saveSettings({ wtfKeepSnapshots: 5 })).toBe(false);
    expect(engine.pending().map((c) => c.method)).toEqual(["settings.set"]);
    expect(lifecycle.operation.get().errors).toEqual({ i1: BUSY, i2: BUSY, i3: BUSY });

    await engine.next("settings.set").resolve({ settings: saved({ wtfBackupDir: "/sd/backups" }) });
    expect(await write).toBe(true);
    expect(settings.get().settings.wtfBackupDir).toBe("/sd/backups");
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(lifecycle.operation.get().settingsError).toBeNull();

    void lifecycle.create("i1");
    expect(engine.pending("wtf.create")).toHaveLength(1);
  });

  test("settings can't be written while a job is starting or running", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.create("i1");
    expect(await lifecycle.saveSettings({ wtfKeepSnapshots: 3 })).toBe(false);
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    expect(await lifecycle.saveSettings({ wtfBackupDir: null })).toBe(false);
    expect(engine.pending("settings.set")).toHaveLength(0);
    expect(lifecycle.operation.get().settingsError).toBe(BUSY);

    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    void lifecycle.saveSettings({ wtfKeepSnapshots: 3 });
    expect(lifecycle.operation.get().settingsError).toBeNull();
    expect(engine.pending("settings.set")).toHaveLength(1);
  });

  test("a rejected folder frees the slot and its error outlives a modal change", async () => {
    const { engine, lifecycle, settings } = harness();
    const write = lifecycle.saveSettings({ wtfBackupDir: "/home/deck/WTF" });
    await engine.next("settings.set").reject("backup_dir_invalid", "inside WTF");
    expect(await write).toBe(false);
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(settings.get().settings.wtfBackupDir).toBeNull();
    // The panel unmounted for the picker; whoever subscribes next sees the error.
    let heard = 0;
    const panel = lifecycle.operation.subscribe(() => heard++);
    expect(lifecycle.operation.get().settingsError).toBeTruthy();
    panel();
    expect(heard).toBe(0);
  });

  test("a saved folder reads every viewed installation's list again", async () => {
    const { engine, lifecycle, view, listCalls } = harness();
    view("i1");
    view("i2");
    await engine.next("wtf.list").resolve(listOf([]));
    await engine.next("wtf.list").resolve(listOf([]));
    void lifecycle.saveSettings({ wtfBackupDir: "/sd" });
    await engine.next("settings.set").resolve({ settings: saved({ wtfBackupDir: "/sd" }) });
    expect(listCalls("i1")).toBe(2);
    expect(listCalls("i2")).toBe(2);
  });

  test("a job another caller started during the write keeps the slot after the write ends", async () => {
    const { engine, lifecycle } = harness();
    void lifecycle.saveSettings({ wtfKeepSnapshots: 2 });
    lifecycle.handleEvent({ event: "wtf.progress", params: { job: progress({ jobId: "x" }) } });
    await engine.next("settings.set").resolve({ settings: saved({ wtfKeepSnapshots: 2 }) });
    expect(lifecycle.operation.get().activity).toMatchObject({ phase: "running", jobId: "x" });
  });

  test("a lost write answer is unknown: never sent again, lists and settings read again", async () => {
    const { engine, lifecycle, settings, view, listCalls } = harness();
    view("i1");
    view("i2");
    await engine.next("wtf.list").resolve(listOf([]));
    await engine.next("wtf.list").resolve(listOf([]));
    const write = lifecycle.saveSettings({ wtfBackupDir: "/sd" });
    await engine.next("settings.set").fail(new Error("bridge lost"));
    expect(lifecycle.operation.get().settingsError).toBeNull();
    expect(lifecycle.operation.get().settingsUnknown).toBeTruthy();
    expect([listCalls("i1"), listCalls("i2")]).toEqual([2, 2]);
    // The slot stays held until Options shows what the engine saved.
    expect(lifecycle.operation.get().activity).toEqual({ phase: "settings" });

    await engine.next("settings.get").resolve({ settings: saved({ wtfBackupDir: "/sd" }) });
    expect(await write).toBe(false);
    expect(settings.get().settings.wtfBackupDir).toBe("/sd");
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(engine.log.filter((l) => l.startsWith("settings.set"))).toHaveLength(1);

    void lifecycle.saveSettings({ wtfKeepSnapshots: 3 });
    expect(lifecycle.operation.get().settingsUnknown).toBeNull();
  });
});

describe("Settings backup lifecycle: changes refresh every affected list (scenario 7)", () => {
  /** i1, i2 and i3 each have a viewed list and viewed copy sources, all loaded. */
  async function viewedEverywhere() {
    const h = sourcesHarness();
    const ids = ["i1", "i2", "i3"];
    for (const id of ids) {
      h.view(id);
      h.lifecycle.backupList.subscribe(id, () => {});
    }
    for (let n = 0; n < ids.length; n++) {
      await h.engine.next("wtf.copySources").resolve(
        sourcesFor([
          ["_retail_", "i1"],
          ["_classic_", "i2"],
          ["_classic_era_", "i3"],
          ["_ptr_", null],
        ]),
      );
      await h.engine.next("wtf.list").resolve(listOf([]));
    }
    const reads = () =>
      Object.fromEntries(ids.map((id) => [id, [h.listCalls(id) - 1, h.sourceCalls(id) - 1]]));
    return { ...h, reads };
  }
  const sourcesFor = (entries: [string, string | null][]): WtfCopySourcesResult => ({
    dirAvailable: true,
    gameRunning: "not_running",
    sources: entries.map(
      ([flavor, installationId]) =>
        ({ flavor, installationId }) as WtfCopySourcesResult["sources"][number],
    ),
  });

  test("a finished backup re-reads its own list and the copy sources that list it", async () => {
    const { lifecycle, reads } = await viewedEverywhere();
    lifecycle.handleEvent({ event: "wtf.completed", params: completed() });
    // [list reads, copy-source reads] since everything loaded
    expect(reads()).toEqual({ i1: [1, 0], i2: [0, 1], i3: [0, 1] });
  });

  test("a finished restore re-reads the target's list and the others' copy sources", async () => {
    const { lifecycle, reads } = await viewedEverywhere();
    lifecycle.handleEvent({
      event: "wtf.completed",
      params: completed({ kind: "restore", installationId: "i2" }),
    });
    expect(reads()).toEqual({ i1: [0, 1], i2: [1, 0], i3: [0, 1] });
  });

  test("a cross-version copy of current settings refreshes source and destination", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.copy("i1", { sourceFlavor: "_classic_", sourceInstallationId: "i2" });
    await engine.next("wtf.copy").resolve({ jobId: "j1" });
    // The start's own read, which sees the job running.
    await engine.next("wtf.list").resolve(listOf([], progress({ kind: "copy" })));
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(reads()).toEqual({ i1: [2, 1], i2: [1, 1], i3: [0, 1] });
  });

  test("a cross-version copy from a backup finds the source installation by its version", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.copy("i1", {
      sourceFlavor: "_classic_era_",
      fileName: "wtf_9.zip",
      acceptUnknownFlavor: false,
    });
    await engine.next("wtf.copy").resolve({ jobId: "j1" });
    await engine.next("wtf.list").resolve(listOf([], progress({ kind: "copy" })));
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(reads()).toEqual({ i1: [2, 1], i2: [0, 1], i3: [1, 1] });
  });

  test("a copy the UI didn't start refreshes every list, since its source is unknown", async () => {
    const { lifecycle, reads } = await viewedEverywhere();
    lifecycle.handleEvent({ event: "wtf.completed", params: completed({ kind: "copy" }) });
    expect(reads()).toEqual({ i1: [1, 1], i2: [1, 1], i3: [1, 1] });
  });

  test("a cross-version import refreshes the version it was filed under, not the starting one", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.importBackup("i1", "/x.zip");
    await engine
      .next("wtf.import")
      .resolve(
        imported({ otherVersion: { flavor: "_classic_", displayName: "Cataclysm Classic" } }),
      );
    // i1's copy sources list the classic backups, so they read again too.
    expect(reads()).toEqual({ i1: [0, 1], i2: [1, 0], i3: [0, 1] });
  });

  test("an import filed under this version refreshes this list and the others' copy sources", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.importBackup("i2", "/x.zip");
    await engine.next("wtf.import").resolve(imported());
    expect(reads()).toEqual({ i1: [0, 1], i2: [1, 0], i3: [0, 1] });
  });

  test("an import filed under an uninstalled version refreshes only copy sources", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.importBackup("i1", "/x.zip");
    await engine
      .next("wtf.import")
      .resolve(imported({ otherVersion: { flavor: "_ptr_", displayName: "Retail PTR" } }));
    expect(reads()).toEqual({ i1: [0, 1], i2: [0, 1], i3: [0, 1] });
  });

  test("an import into a version the module can't place refreshes every list", async () => {
    const { engine, lifecycle, listCalls } = harness();
    lifecycle.backupList.subscribe("i1", () => {});
    lifecycle.backupList.subscribe("i2", () => {});
    await engine.next("wtf.list").resolve(listOf([]));
    await engine.next("wtf.list").resolve(listOf([]));
    void lifecycle.importBackup("i1", "/x.zip");
    await engine
      .next("wtf.import")
      .resolve(imported({ otherVersion: { flavor: "_classic_", displayName: "Classic" } }));
    expect([listCalls("i1"), listCalls("i2")]).toEqual([2, 2]);
  });

  test("a delete refreshes its own list and the others' copy sources", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.deleteBackup("i3", "a.zip");
    await engine.next("wtf.delete").resolve({ fileName: "a.zip" });
    expect(reads()).toEqual({ i1: [0, 1], i2: [0, 1], i3: [1, 0] });
  });

  test("a saved folder refreshes every list and every copy-source list", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.saveSettings({ wtfBackupDir: "/sd" });
    await engine
      .next("settings.set")
      .resolve({ settings: { ...defaultSettings(), wtfBackupDir: "/sd" } });
    expect(reads()).toEqual({ i1: [1, 1], i2: [1, 1], i3: [1, 1] });
  });

  test("a job whose completion was missed refreshes what it touched once the engine no longer has it", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.create("i2");
    await engine.next("wtf.create").resolve({ jobId: "j1" });
    await engine.next("wtf.list").resolve(listOf([])); // the job already ended; no event came
    expect(reads()).toEqual({ i1: [0, 1], i2: [2, 0], i3: [0, 1] });
  });

  test("a delete whose answer was lost refreshes what a delete touches, and again once settled", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.deleteBackup("i3", "a.zip");
    await engine.next("wtf.delete").reject("timeout", "Request wtf.delete timed out");
    expect(reads()).toEqual({ i1: [0, 1], i2: [0, 1], i3: [1, 0] });
    await engine.next("wtf.list").resolve(listOf([])); // nothing runs: the result is settled
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(reads()).toEqual({ i1: [0, 2], i2: [0, 2], i3: [2, 0] });
  });

  test("a start whose answer was lost refreshes what it touched once a fresh list settles it", async () => {
    const { engine, lifecycle, reads } = await viewedEverywhere();
    void lifecycle.restore("i2", {
      fileName: "a.zip",
      acceptUnknownFlavor: false,
      keepCurrentConfig: false,
    });
    await engine.next("wtf.restore").reject("timeout", "Request wtf.restore timed out");
    expect(reads()).toEqual({ i1: [0, 0], i2: [1, 0], i3: [0, 0] });
    await engine.next("wtf.list").resolve(listOf([]));
    expect(lifecycle.operation.get().activity).toBeNull();
    expect(reads()).toEqual({ i1: [0, 1], i2: [2, 0], i3: [0, 1] });
  });

  test("an affected installation nobody views is read only when someone views it", async () => {
    const { engine, lifecycle, view, listCalls } = harness();
    const one = view("i2");
    const late = engine.next("wtf.list"); // still on its way when the view closes
    one.close();
    lifecycle.handleEvent({
      event: "wtf.completed",
      params: completed({ kind: "restore", installationId: "i2" }),
    });
    expect(listCalls("i2")).toBe(1);
    const again = view("i2");
    expect(listCalls("i2")).toBe(2); // the stale read still in flight doesn't count
    await late.resolve(listOf(["old.zip"]));
    await engine.next("wtf.list").resolve(listOf(["new.zip"]));
    expect(names(again.snapshot().data)).toEqual(["new.zip"]);
  });
});
