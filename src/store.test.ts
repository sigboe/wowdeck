/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createStore } from "./store";

describe("createStore", () => {
  test("get() is the same object until a change (useSyncExternalStore)", () => {
    const store = createStore({ a: 1, b: "x" });
    const first = store.get();
    expect(store.get()).toBe(first);
    store.patch({ a: 2 });
    expect(store.get()).not.toBe(first);
    expect(store.get()).toEqual({ a: 2, b: "x" });
  });

  test("subscribers hear every change, not a set to the same object, and can leave", () => {
    const store = createStore({ n: 0 });
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.patch({ n: 1 });
    store.set(store.get());
    expect(calls).toBe(1);
    stop();
    store.patch({ n: 2 });
    expect(calls).toBe(1);
  });
});
