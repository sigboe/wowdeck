/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { PluginSettings } from "./types";
import { createSettingsStore, type SettingsDeps } from "./settingsStore";
import { defaultSettings } from "../backend/src/wow/storage/settings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A store over a fake engine. Each `set` and `get` waits for its own
 * answer; `answer` and `fail` settle the oldest save still waiting, or the
 * one at `index` (in the order they were sent).
 */
function harness(engine: Partial<PluginSettings> = {}) {
  const toasts: string[] = [];
  const saves: Array<ReturnType<typeof deferred<PluginSettings>> & { settled: boolean }> = [];
  const reads: Array<ReturnType<typeof deferred<PluginSettings>>> = [];
  let readsWait = false;
  const deps: SettingsDeps = {
    get: () => {
      if (!readsWait) return Promise.resolve({ ...defaultSettings(), ...engine });
      const read = deferred<PluginSettings>();
      reads.push(read);
      return read.promise;
    },
    set: () => {
      const save = { ...deferred<PluginSettings>(), settled: false };
      saves.push(save);
      return save.promise;
    },
    toast: (title, body) => toasts.push(body ? `${title}: ${body}` : title),
  };
  const store = createSettingsStore(deps);
  const pick = (index?: number) => {
    const save = index === undefined ? saves.find((s) => !s.settled) : saves[index];
    save!.settled = true;
    return save!;
  };
  return {
    store,
    toasts,
    answer: (settings: Partial<PluginSettings>, index?: number) =>
      pick(index).resolve({ ...store.get().settings, ...settings }),
    fail: (message: string, index?: number) => pick(index).reject(new Error(message)),
    /** From now on each `get` waits until `answerRead` settles it. */
    holdReads: () => {
      readsWait = true;
    },
    answerRead: (settings: Partial<PluginSettings>) =>
      reads.shift()!.resolve({ ...defaultSettings(), ...settings }),
  };
}

describe("settings store", () => {
  test("shows the engine's defaults until loaded, then the engine's settings", async () => {
    const { store } = harness({ autoUpdate: true });
    expect(store.get().loaded).toBe(false);
    expect(store.get().settings.autoUpdate).toBe(false);
    await store.load();
    expect(store.get()).toEqual({
      settings: { ...defaultSettings(), autoUpdate: true },
      loaded: true,
    });
  });

  test("a save shows the value at once", async () => {
    const h = harness();
    const saving = h.store.save({ autoUpdate: true });
    expect(h.store.get().settings.autoUpdate).toBe(true);
    h.answer({ autoUpdate: true });
    expect(await saving).toBe(true);
    expect(h.toasts).toEqual([]);
  });

  test("a failed save puts the value back and says so", async () => {
    const h = harness();
    const saving = h.store.save({ hideLibraries: true });
    h.fail("disk full");
    expect(await saving).toBe(false);
    expect(h.store.get().settings.hideLibraries).toBe(false);
    expect(h.toasts).toEqual(["Couldn't save: disk full"]);
  });

  test("the engine's normalized value replaces the optimistic one", async () => {
    const h = harness();
    const saving = h.store.save({ wtfKeepSnapshots: 99 });
    expect(h.store.get().settings.wtfKeepSnapshots).toBe(99);
    h.answer({ wtfKeepSnapshots: 10 });
    await saving;
    expect(h.store.get().settings.wtfKeepSnapshots).toBe(10);
  });

  test("a failed save rolls back only its own keys", async () => {
    const h = harness();
    const first = h.store.save({ hideLibraries: true });
    h.fail("nope");
    // A second save started before the first failed keeps its value.
    const second = h.store.save({ hideUnmanaged: true });
    await first;
    expect(h.store.get().settings.hideUnmanaged).toBe(true);
    h.answer({ hideUnmanaged: true });
    await second;
    expect(h.store.get().settings.hideLibraries).toBe(false);
  });

  test("the newest save wins when an older save's answer lands after it", async () => {
    const h = harness();
    const slow = h.store.save({ steamBadge: false });
    const fast = h.store.save({ steamBadge: true });
    // The engine applied both in order; the newer answer comes back first.
    h.answer({ steamBadge: true }, 1);
    await fast;
    h.answer({ steamBadge: false }, 0);
    expect(await slow).toBe(true);
    expect(h.store.get().settings.steamBadge).toBe(true);
  });

  test("a read started before a save and answered after it doesn't undo the save", async () => {
    const h = harness();
    h.holdReads();
    const loading = h.store.load();
    const saving = h.store.save({ autoUpdate: true });
    h.answer({ autoUpdate: true });
    await saving;
    h.answerRead({ autoUpdate: false });
    await loading;
    expect(h.store.get().settings.autoUpdate).toBe(true);
  });

  test("a read started after a save shows the engine's settings", async () => {
    const h = harness();
    h.holdReads();
    const saving = h.store.save({ autoUpdate: true });
    const loading = h.store.load();
    h.answerRead({ autoUpdate: true, hideLibraries: true });
    await loading;
    expect(h.store.get()).toMatchObject({
      settings: { autoUpdate: true, hideLibraries: true },
      loaded: true,
    });
    h.answer({ autoUpdate: true });
    await saving;
  });

  test("an older save that fails doesn't undo a newer save of the same key", async () => {
    const h = harness();
    const older = h.store.save({ wtfKeepSnapshots: 20 });
    const newer = h.store.save({ wtfKeepSnapshots: 30 });
    h.answer({ wtfKeepSnapshots: 30 }, 1);
    await newer;
    h.fail("The settings file couldn't be written", 0);
    expect(await older).toBe(false);
    expect(h.store.get().settings.wtfKeepSnapshots).toBe(30);
    expect(h.toasts).toEqual(["Couldn't save: The settings file couldn't be written"]);
  });

  test("toasts the saved text only after the engine agreed", async () => {
    const h = harness();
    const saving = h.store.save({ steamBadge: false }, ["Saved", "badge off"]);
    expect(h.toasts).toEqual([]);
    h.answer({ steamBadge: false });
    await saving;
    expect(h.toasts).toEqual(["Saved: badge off"]);
  });

  test("write throws and leaves the store unchanged on failure", async () => {
    const h = harness();
    const before = h.store.get();
    const writing = h.store.write({ wtfBackupDir: "/nope" });
    h.fail("not writable");
    await expect(writing).rejects.toThrow("not writable");
    expect(h.store.get()).toBe(before);
  });

  test("keeps the same state object until something changes", async () => {
    const h = harness();
    const a = h.store.get();
    expect(h.store.get()).toBe(a);
    await h.store.load();
    expect(h.store.get()).not.toBe(a);
  });
});
