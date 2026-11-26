/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createKeyedResource } from "./keyedResource";
import { createManualClock } from "./testSupport/manualClock";

/**
 * The one place stale answers are tested: every component reads engine data
 * through a keyed resource, so these rules hold for all of them.
 */

function harness(pollMs?: number) {
  const clock = createManualClock();
  const reads: {
    key: string;
    resolve(v: string): Promise<void>;
    reject(e: Error): Promise<void>;
  }[] = [];
  const resource = createKeyedResource<string>({
    read: (key) =>
      new Promise((resolve, reject) => {
        reads.push({
          key,
          resolve: async (v) => {
            resolve(v);
            await Promise.resolve();
            await Promise.resolve();
          },
          reject: async (e) => {
            reject(e);
            await Promise.resolve();
            await Promise.resolve();
          },
        });
      }),
    errorText: (e) => (e instanceof Error ? e.message : String(e)),
    clock,
    pollMs,
  });
  return { resource, reads, clock };
}

describe("keyed resource: stale answers", () => {
  test("an older answer never replaces a newer one", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    const older = reads[0]!;
    void resource.refresh("a");
    await reads[1]!.resolve("new");
    await older.resolve("old");
    expect(resource.get("a").data).toBe("new");
  });

  test("an older failure never replaces a newer answer", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    const older = reads[0]!;
    void resource.refresh("a");
    await reads[1]!.resolve("new");
    await older.reject(new Error("late"));
    expect(resource.get("a")).toEqual({ data: "new", error: null, loading: false });
  });

  test("an answer for one key never shows under another", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    resource.subscribe("b", () => {});
    await reads[1]!.resolve("for b");
    await reads[0]!.resolve("for a");
    expect(resource.get("a").data).toBe("for a");
    expect(resource.get("b").data).toBe("for b");
    expect(resource.get(null).data).toBeNull();
  });

  test("invalidate ignores the reads on their way and reads viewed keys again", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    resource.invalidate();
    expect(reads).toHaveLength(2);
    await reads[0]!.resolve("before");
    expect(resource.get("a").data).toBeNull();
    await reads[1]!.resolve("after");
    expect(resource.get("a").data).toBe("after");
  });

  test("invalidate leaves an unviewed key stale until someone views it", async () => {
    const { resource, reads } = harness();
    const off = resource.subscribe("a", () => {});
    await reads[0]!.resolve("first");
    off();
    resource.invalidate();
    expect(reads).toHaveLength(1);
    resource.subscribe("a", () => {});
    expect(reads).toHaveLength(2);
    expect(resource.get("a").data).toBe("first");
  });

  test("put is the newest answer: a read already on its way is ignored", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    resource.put("a", "written");
    await reads[0]!.resolve("old");
    expect(resource.get("a")).toEqual({ data: "written", error: null, loading: false });
  });

  test("forget drops the key and ignores the answers on their way", async () => {
    const { resource, reads } = harness();
    const off = resource.subscribe("a", () => {});
    resource.forget("a");
    await reads[0]!.resolve("late");
    expect(resource.get("a").data).toBeNull();
    off();
  });

  test("a viewer still there when its key is forgotten starts again empty", async () => {
    const { resource, reads } = harness(1000);
    let heard = 0;
    resource.subscribe("a", () => heard++);
    await reads[0]!.resolve("one");
    resource.forget("a");
    expect(resource.get("a").data).toBeNull();
    expect(heard).toBeGreaterThan(1);
  });

  test("retainOnly forgets every other key", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    resource.subscribe("b", () => {});
    await reads[0]!.resolve("a");
    await reads[1]!.resolve("b");
    resource.retainOnly(["b"]);
    expect(resource.get("a").data).toBeNull();
    expect(resource.get("b").data).toBe("b");
  });
});

describe("keyed resource: failures and polling", () => {
  test("a failed read keeps the last data beside the error; a success clears it", async () => {
    const { resource, reads } = harness();
    resource.subscribe("a", () => {});
    await reads[0]!.resolve("kept");
    void resource.refresh("a");
    await reads[1]!.reject(new Error("lost"));
    expect(resource.get("a")).toEqual({ data: "kept", error: "lost", loading: false });
    void resource.refresh("a");
    await reads[2]!.resolve("fresh");
    expect(resource.get("a")).toEqual({ data: "fresh", error: null, loading: false });
  });

  test("the first view loads with loading shown; a return revalidates quietly", async () => {
    const { resource, reads } = harness();
    const off = resource.subscribe("a", () => {});
    expect(resource.get("a").loading).toBe(true);
    await reads[0]!.resolve("one");
    off();
    resource.subscribe("a", () => {});
    expect(resource.get("a").loading).toBe(false);
    expect(reads).toHaveLength(2);
  });

  test("without revalidateOnReturn a return reads only a key invalidated meanwhile", async () => {
    const clock = createManualClock();
    const reads: string[] = [];
    const resource = createKeyedResource<string>({
      read: async (key) => {
        reads.push(key);
        return `answer ${reads.length}`;
      },
      errorText: String,
      clock,
      revalidateOnReturn: false,
    });
    const off = resource.subscribe("a", () => {});
    await Promise.resolve();
    off();
    const back = resource.subscribe("a", () => {});
    expect(reads).toHaveLength(1);
    expect(resource.get("a").data).toBe("answer 1");
    back();
    resource.invalidate();
    resource.subscribe("a", () => {});
    expect(reads).toHaveLength(2);
  });

  test("a viewed key polls once however many viewers, and stops with the last", async () => {
    const { resource, reads, clock } = harness(1000);
    const one = resource.subscribe("a", () => {});
    const two = resource.subscribe("a", () => {});
    await reads[0]!.resolve("x");
    clock.advance(1000);
    expect(reads).toHaveLength(2);
    one();
    expect(clock.activeTimers()).toBe(1);
    two();
    expect(clock.activeTimers()).toBe(0);
  });

  test("without pollMs a key reads on first view and on request only", async () => {
    const { resource, reads, clock } = harness();
    resource.subscribe("a", () => {});
    await reads[0]!.resolve("x");
    clock.advance(60_000);
    expect(clock.activeTimers()).toBe(0);
    expect(reads).toHaveLength(1);
  });
});
