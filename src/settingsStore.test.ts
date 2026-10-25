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

function harness(engine: Partial<PluginSettings> = {}) {
  const toasts: string[] = [];
  let pending = deferred<PluginSettings>();
  const deps: SettingsDeps = {
    get: async () => ({ ...defaultSettings(), ...engine }),
    set: () => pending.promise,
    toast: (title, body) => toasts.push(body ? `${title}: ${body}` : title),
  };
  const store = createSettingsStore(deps);
  return {
    store,
    toasts,
    answer: (settings: Partial<PluginSettings>) => {
      pending.resolve({ ...store.get().settings, ...settings });
      pending = deferred();
    },
    fail: (message: string) => {
      pending.reject(new Error(message));
      pending = deferred();
    },
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
