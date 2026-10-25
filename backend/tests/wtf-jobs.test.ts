import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EventMap } from "../src/api/contracts";
import { JsonlServer } from "../src/bridge/jsonl";
import { WtfBackupError } from "../src/wow/wtf/errors";
import { WtfBackupService } from "../src/wow/wtf/WtfBackupService";
import { WtfJobRunner, type WtfJobTarget } from "../src/wow/wtf/WtfJobRunner";
import { flavorKeyFor, validateBackupDir } from "../src/wow/wtf/WtfPaths";

let tmp: string;
let wtf: string;
let backupRoot: string;
let target: WtfJobTarget;

function write(rel: string, data: string | Uint8Array) {
  const p = join(wtf, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

function setup(serviceOver: Partial<ConstructorParameters<typeof WtfBackupService>[0]> = {}) {
  const progress: EventMap["wtf.progress"][] = [];
  const completed: EventMap["wtf.completed"][] = [];
  const failed: string[] = [];
  let t = 1_700_000_000_000;
  const service = new WtfBackupService({
    backupRoot: () => ({ path: backupRoot, custom: false }),
    now: () => (t += 1000),
    freeBytes: async () => 10 * 1024 ** 3,
    gameStatus: async () => "not_running",
    ...serviceOver,
  });
  const runner = new WtfJobRunner(service, {
    progress: (p) => progress.push(p),
    completed: (c) => completed.push(c),
    failed: (code) => failed.push(code),
  });
  const done = () =>
    new Promise<EventMap["wtf.completed"]>((resolve) => {
      const iv = setInterval(() => {
        if (completed.length) {
          clearInterval(iv);
          resolve(completed[completed.length - 1]!);
        }
      }, 2);
    });
  return { service, runner, progress, completed, failed, done };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wtf-jobs-"));
  wtf = join(tmp, "game", "_retail_", "WTF");
  backupRoot = join(tmp, "backups");
  mkdirSync(wtf, { recursive: true });
  target = { installationId: "inst1", wtfPath: wtf, flavor: "_retail_" };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("WtfJobRunner", () => {
  test("create returns a job id at once, reports progress and completes with the new file", async () => {
    write("Config.wtf", "x");
    write("a/big.bin", randomBytes(2 * 1024 * 1024));
    const { runner, progress, completed, done } = setup();
    const { jobId } = runner.startCreate(target);
    expect(jobId).toMatch(/^wtf-/);
    expect(runner.current()).toMatchObject({ jobId, kind: "create", installationId: "inst1" });
    const result = await done();
    expect(result).toMatchObject({ jobId, kind: "create", installationId: "inst1", error: null, snapshotFileName: null });
    expect(result.fileName).toMatch(/^wtf_\d+\.zip$/);
    expect(runner.current()).toBeNull();
    expect(completed).toHaveLength(1);
    const phases = progress.map((p) => p.job.phase);
    expect(phases).toContain("scan");
    expect(phases).toContain("compress");
  });

  test("restore reports snapshot + restored file names", async () => {
    write("Config.wtf", "one");
    const { service, runner, done, completed } = setup();
    const b = await service.createBackup(target, { kind: "manual" });
    write("Config.wtf", "two");
    runner.startRestore(target, b.fileName, {});
    const result = await done();
    expect(result).toMatchObject({ kind: "restore", fileName: b.fileName, error: null });
    expect(result.snapshotFileName).toMatch(/^wtf_\d+\.zip$/);
    expect(completed).toHaveLength(1);
  });

  test("only one job at a time", async () => {
    write("a/big.bin", randomBytes(4 * 1024 * 1024));
    const { runner, done } = setup();
    runner.startCreate(target);
    expect(() => runner.startCreate(target)).toThrow(WtfBackupError);
    expect(() => runner.startRestore(target, "wtf_1.zip", {})).toThrow(expect.objectContaining({ code: "job_in_progress" }));
    await done();
    expect(() => runner.startCreate(target)).not.toThrow();
  });

  test("a failing job completes with a stable error code and is reported to diagnostics", async () => {
    rmSync(wtf, { recursive: true });
    const { runner, done, failed } = setup();
    runner.startCreate(target);
    const result = await done();
    expect(result.fileName).toBeNull();
    expect(result.error).toMatchObject({ code: "wtf_missing" });
    expect(failed).toEqual(["wtf_missing"]);
    expect(runner.current()).toBeNull();
  });

  test("an unexpected error is reported generically, never as raw text", async () => {
    write("Config.wtf", "x");
    const { runner, done } = setup({
      freeBytes: async () => {
        throw new Error("EACCES: /home/deck/secret/path");
      },
    });
    runner.startCreate(target);
    const result = await done();
    expect(result.error?.code).toBe("internal_error");
    expect(result.error?.message).not.toContain("secret");
  });

  test("cancelling a create ends with code 'cancelled', leaves no files and isn't a diagnostics failure", async () => {
    write("a/one.bin", randomBytes(3 * 1024 * 1024));
    write("a/two.bin", randomBytes(3 * 1024 * 1024));
    const { runner, done, failed } = setup();
    const { jobId } = runner.startCreate(target);
    expect(runner.cancel("nope")).toEqual({ cancelled: false });
    expect(runner.cancel(jobId)).toEqual({ cancelled: true });
    const result = await done();
    expect(result.error?.code).toBe("cancelled");
    expect(failed).toEqual([]);
    expect(readdirSync(join(backupRoot, "_retail_"))).toEqual([]);
  });

  test("a restore can't be cancelled once it is swapping folders", async () => {
    write("Config.wtf", "one");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let swapping!: () => void;
    const swapStarted = new Promise<void>((r) => (swapping = r));
    const { service, runner, done } = setup({
      rename: async (from, to) => {
        if (from === wtf) {
          swapping();
          await gate;
        }
        await fsRename(from, to);
      },
    });
    const b = await service.createBackup(target, { kind: "manual" });
    const { jobId } = runner.startRestore(target, b.fileName, {});
    await swapStarted;
    expect(() => runner.cancel(jobId)).toThrow(expect.objectContaining({ code: "too_late_to_cancel" }));
    release();
    const result = await done();
    expect(result.error).toBeNull();
  });
});

describe("jobs over the JSONL server", () => {
  test("wtf.create is answered immediately; other RPCs are served while it runs; the outcome arrives as an event", async () => {
    write("a/big.bin", randomBytes(6 * 1024 * 1024));
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    const events: string[] = [];
    const service = new WtfBackupService({
      backupRoot: () => ({ path: backupRoot, custom: false }),
      freeBytes: async () => 10 * 1024 ** 3,
      gameStatus: async () => "not_running",
    });
    const jobs = new WtfJobRunner(service, {
      progress: (p) => server.emit("wtf.progress", p),
      completed: (c) => {
        events.push("completed");
        server.emit("wtf.completed", c);
      },
    });
    server.on("wtf.create", async () => jobs.startCreate(target));
    server.on("system.getStatus", async () => ({ backendVersion: "t", protocolVersion: 1, pid: 1 }));

    await server.handleLine(JSON.stringify({ id: 1, method: "wtf.create", params: {} }));
    await server.handleLine(JSON.stringify({ id: 2, method: "system.getStatus", params: {} }));

    const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed()[0]).toMatchObject({ id: 1 });
    expect(parsed()[1]).toMatchObject({ id: 2 });
    expect(events).toEqual([]); // the job is still running while both requests were already answered

    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (events.length) {
          clearInterval(iv);
          resolve();
        }
      }, 5);
    });
    const completedEvent = parsed().find((m) => m.event === "wtf.completed");
    expect(completedEvent).toBeDefined();
    expect((completedEvent as { params: { error: unknown } }).params.error).toBeNull();
  });

  test("WtfBackupError codes pass through errorCodeFor to the wire", async () => {
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    const { runner } = setup();
    server.on("wtf.cancel", async (p) => runner.cancel(p.jobId));
    server.on("wtf.create", async () => {
      throw new WtfBackupError("game_running", "Close World of Warcraft first");
    });
    await server.handleLine(JSON.stringify({ id: 1, method: "wtf.create", params: {} }));
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 1, error: { code: "game_running", message: "Close World of Warcraft first" } });
  });
});

describe("flavorKeyFor / validateBackupDir", () => {
  test("uses the flavor folder name so Classic and its PTR never share a list", () => {
    expect(flavorKeyFor("/g/World of Warcraft/_retail_", "retail")).toBe("_retail_");
    expect(flavorKeyFor("/g/World of Warcraft/_classic_ptr_", "classic")).toBe("_classic_ptr_");
    expect(flavorKeyFor("/g/World of Warcraft/_anniversary_", "classic_era")).toBe("_anniversary_");
    expect(flavorKeyFor("/home/deck/Games/MyWoWFolder", "classic_era")).toBe("classic_era");
  });

  test("accepts a writable absolute folder", async () => {
    mkdirSync(join(tmp, "sd"));
    expect(await validateBackupDir(join(tmp, "sd"), [join(tmp, "game", "_retail_")])).toBe(join(tmp, "sd"));
    expect(readdirSync(join(tmp, "sd"))).toEqual([]); // probe file cleaned up
  });

  test("rejects relative, missing, and game-internal folders", async () => {
    const loc = join(tmp, "game", "_retail_");
    await expect(validateBackupDir("relative/dir", [loc])).rejects.toMatchObject({ code: "backup_dir_invalid" });
    await expect(validateBackupDir(join(tmp, "nope"), [loc])).rejects.toMatchObject({ code: "backup_dir_unavailable" });
    expect(existsSync(join(tmp, "nope"))).toBe(false);
    mkdirSync(join(loc, "Interface", "x"), { recursive: true });
    await expect(validateBackupDir(join(loc, "WTF"), [loc])).rejects.toMatchObject({ code: "backup_dir_invalid" });
    await expect(validateBackupDir(join(loc, "Interface", "x"), [loc])).rejects.toMatchObject({ code: "backup_dir_invalid" });
  });
});

describe("StateStore.deviceId", () => {
  test("is random, created once, persisted and reloaded", async () => {
    const { StateStore } = await import("../src/wow/storage/StateStore");
    const path = join(tmp, "state.json");
    const a = new StateStore(path);
    const id = a.deviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.deviceId()).toBe(id);
    const b = new StateStore(path);
    expect(b.deviceId()).toBe(id);
    const c = new StateStore(join(tmp, "other.json"));
    expect(c.deviceId()).not.toBe(id);
  });
});
