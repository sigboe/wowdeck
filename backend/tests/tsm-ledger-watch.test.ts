import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { GameRunning, RpcEvent } from "../src/api/contracts";
import { assembleEngine, configFromEnv } from "../src/engine";
import type { WowInstallation } from "../src/wow/models";
import type { LedgerWatchOptions } from "../src/wow/tsm/LedgerWatch";
import { WowClientType } from "../src/wow/types";

type Task = () => void | Promise<void>;

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function manualTimers() {
  let now = 0;
  const tasks = new Map<Task, { delay: number; at: number }>();
  const waiting = new Map<number, () => void>();
  return {
    tasks,
    clock: {
      setTimeout(task: Task, ms: number) {
        tasks.set(task, { delay: ms, at: now + ms });
        waiting.get(ms)?.();
        waiting.delete(ms);
        return task;
      },
      clearTimeout(task: unknown) { tasks.delete(task as Task); },
    },
    next(ms: number) {
      const next = defer();
      waiting.set(ms, next.resolve);
      return next.promise;
    },
    pending(ms: number) {
      return [...tasks.values()].filter(({ delay }) => delay === ms).length;
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...tasks].sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next || next[1].at > until) break;
        const [task, { at }] = next;
        tasks.delete(task);
        now = at;
        await task();
      }
      now = until;
    },
    async fire(ms: number) {
      const due = [...tasks.values()].filter(({ delay }) => delay === ms);
      expect(due).toHaveLength(1);
      await this.advance(due[0]!.at - now);
    },
  };
}

function fixture(
  watchDirectory?: LedgerWatchOptions["watchDirectory"],
  { missingStorage = false, firstProcessCheck }: {
    missingStorage?: boolean;
    firstProcessCheck?: Promise<GameRunning>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "ledger-watch-"));
  const timers = manualTimers();
  const events: RpcEvent[] = [];
  let game: GameRunning = firstProcessCheck ? "running" : "not_running";
  let firstCheck = true;
  const engine = assembleEngine({
    ...configFromEnv({ HOME: root, WOWDECK_DATA_DIR: join(root, "plugin") }, "0.0.0"),
    now: () => 1_800_000_020_000,
    out: (line) => events.push(JSON.parse(line) as RpcEvent),
    ledgerWatch: {
      clock: timers.clock, watchDirectory,
      gameRunning: async () => {
        if (firstCheck) {
          firstCheck = false;
          if (firstProcessCheck) return firstProcessCheck;
        }
        return game;
      },
    },
  });
  const installation = (id: string): WowInstallation => ({
    id, location: join(root, "games", id), clientType: WowClientType.ClassicEra,
    displayName: id, label: id, selected: false, defaultAddonChannelType: 0, source: "manual",
  });
  const first = installation("first");
  const second = installation("second");
  const savedFile = ({ location }: WowInstallation, account = "MAIN") =>
    join(location, "WTF", "Account", account, "SavedVariables", "TradeSkillMaster.lua");
  const write = (path: string, seconds: number, gold = 100) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `TradeSkillMasterDB = { ["g@ @internalData@warbankGoldLog"] = "minute,copper\\n29000000,${gold}" }\n`);
    utimesSync(path, seconds, seconds);
  };
  if (!missingStorage) {
    write(savedFile(first), 1_800_000_000);
    write(savedFile(second), 1_800_000_000);
  }
  engine.deps.store.setInstallations([first, second]);

  const read = (installationId: string) => engine.call("tradeskillmaster.ledger", { installationId });
  const select = (installationId: string) => engine.call("installations.select", { installationId });
  const expectEvent = (installationId: string) =>
    expect(events.splice(0)).toEqual([{ event: "tradeskillmaster.ledgerChanged", params: { installationId } }]);
  const expectSave = async (installationId: string, recordedAt: number) => {
    await timers.fire(300);
    expectEvent(installationId);
    expect((await read(installationId)).recordedAt).toBe(recordedAt * 1_000);
  };
  const end = defer();
  const ready = timers.next(5_000);
  const serving = engine.serve((async function* () { await end.promise; })());
  return {
    first, second, timers, events, savedFile, write, read, select, expectEvent, expectSave, ready,
    gameRunning: (state: GameRunning) => { game = state; },
    async close() {
      end.resolve();
      await serving;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("a native watch delivers a fixture write through the engine event", async () => {
  const f = fixture();
  try {
    await f.ready;
    f.expectEvent(f.first.id);
    const before = await f.read(f.first.id);
    const scheduled = f.timers.next(300);
    f.write(f.savedFile(f.first), 1_800_000_001, 900);
    await scheduled;
    expect(f.events).toEqual([]);
    await f.expectSave(f.first.id, 1_800_000_001);
    expect((await f.read(f.first.id)).gold).not.toEqual(before.gold);
  } finally {
    await f.close();
  }
});

test("Ledger watches coalesce saves, follow selection and close with the engine", async () => {
  const subscriptions = new Map<string, (name: string) => void>();
  const f = fixture((path, onChange) => {
    expect(subscriptions.has(path)).toBe(false);
    subscriptions.set(path, onChange);
    return { close: () => subscriptions.delete(path) };
  });
  const notify = (path: string) => subscriptions.get(dirname(path))?.(basename(path));
  try {
    await f.ready;
    f.expectEvent(f.first.id);
    const firstFile = f.savedFile(f.first);
    for (const time of [1_800_000_002, 1_800_000_003, 1_800_000_004]) {
      f.write(firstFile, time);
      notify(firstFile);
      await f.timers.advance(100);
    }
    // The first deadline has passed. Only the last write's deadline may emit.
    expect(f.events).toEqual([]);
    await f.timers.advance(199);
    expect(f.events).toEqual([]);
    await f.timers.advance(1);
    f.expectEvent(f.first.id);
    expect((await f.read(f.first.id)).recordedAt).toBe(1_800_000_004_000);

    // The account and its first saved file can appear together. Later saves
    // can replace the file's inode, and the next write must still refresh.
    const added = f.savedFile(f.first, "ALT");
    f.write(added, 1_800_000_005);
    notify(dirname(dirname(added)));
    await f.expectSave(f.first.id, 1_800_000_005);
    expect((await f.read(f.first.id)).accounts).toEqual(["ALT", "MAIN"]);
    f.write(added + ".tmp", 1_800_000_006);
    notify(added + ".tmp");
    expect(f.timers.pending(300)).toBe(0);
    renameSync(added + ".tmp", added);
    notify(added);
    await f.expectSave(f.first.id, 1_800_000_006);
    f.write(added, 1_800_000_007);
    notify(added);
    await f.expectSave(f.first.id, 1_800_000_007);

    // Discard a save already queued for the previous installation.
    notify(firstFile);
    await f.select(f.second.id);
    f.expectEvent(f.second.id);
    expect(f.timers.pending(300)).toBe(0);
    f.write(firstFile, 1_800_000_008);
    notify(firstFile);
    expect(f.timers.pending(300)).toBe(0);
    const secondFile = f.savedFile(f.second);
    f.write(secondFile, 1_800_000_010);
    notify(secondFile);
    await f.expectSave(f.second.id, 1_800_000_010);

    for (const state of ["running", "not_running"] as const) {
      f.gameRunning(state);
      await f.timers.fire(5_000);
      f.expectEvent(f.second.id);
      expect((await f.read(f.second.id)).gameRunning).toBe(state === "running");
    }
    await f.timers.fire(5_000);
    expect(f.events).toEqual([]);

    // End the session with a debounce and a process check still queued.
    notify(secondFile);
  } finally {
    await f.close();
  }
  expect(subscriptions.size).toBe(0);
  expect(f.timers.tasks.size).toBe(0);
  expect(f.events).toEqual([]);
});

test("Ledger watches rebind when selected storage appears or replaces its parent", async () => {
  const subscriptions = new Map<string, (name: string) => void>();
  const f = fixture((path, onChange) => {
    subscriptions.set(path, onChange);
    return { close: () => subscriptions.delete(path) };
  }, { missingStorage: true });
  try {
    await f.ready;
    f.events.length = 0;
    const file = f.savedFile(f.first);
    const parent = dirname(f.first.location);
    for (const time of [1_800_000_001, 1_800_000_003]) {
      f.write(file, time);
      await f.timers.fire(5_000);
      f.expectEvent(f.first.id);
      const notify = subscriptions.get(dirname(file));
      expect(notify).toBeDefined();
      f.write(file, time + 1);
      notify!(basename(file));
      await f.expectSave(f.first.id, time + 1);
      renameSync(parent, parent + "-" + time);
    }
  } finally {
    await f.close();
  }
});

test("the first game observation refreshes a Ledger read while that check was pending", async () => {
  let finish!: (state: GameRunning) => void;
  const f = fixture(undefined, {
    firstProcessCheck: new Promise((resolve) => { finish = resolve; }),
  });
  try {
    expect((await f.read(f.first.id)).gameRunning).toBe(true);
    f.gameRunning("not_running");
    finish("not_running");
    await f.ready;
    f.expectEvent(f.first.id);
    expect((await f.read(f.first.id)).gameRunning).toBe(false);
  } finally {
    finish("not_running");
    await f.close();
  }
});

test("Ledger watches retry a failed subscription and recover after an error", async () => {
  let attempts = 0;
  let savedVariablesWatch: { change: (name: string) => void; fail: () => void } | undefined;
  const f = fixture((path, change, fail) => {
    if (basename(path) !== "SavedVariables") return { close() {} };
    if (++attempts < 3) throw new Error("watch temporarily unavailable");
    savedVariablesWatch = { change, fail };
    return { close() { savedVariablesWatch = undefined; } };
  });
  try {
    await f.ready;
    f.expectEvent(f.first.id);
    expect(savedVariablesWatch).toBeUndefined();

    await f.timers.fire(5_000);
    f.expectEvent(f.first.id);
    expect(savedVariablesWatch).toBeDefined();
    savedVariablesWatch!.fail();
    expect(savedVariablesWatch).toBeUndefined();

    await f.timers.fire(5_000);
    f.expectEvent(f.first.id);
    const file = f.savedFile(f.first);
    f.write(file, 1_800_000_007);
    savedVariablesWatch!.change(basename(file));
    await f.expectSave(f.first.id, 1_800_000_007);
  } finally {
    await f.close();
  }
});
