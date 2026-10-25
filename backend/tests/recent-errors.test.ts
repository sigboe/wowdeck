import { describe, expect, test } from "bun:test";
import { RecentErrorsBuffer } from "../src/diagnostics/RecentErrors";

describe("RecentErrorsBuffer", () => {
  test("records newest first", () => {
    const buf = new RecentErrorsBuffer();
    buf.record("addons.install", "first");
    buf.record("addons.update", "second");
    const items = buf.list();
    expect(items).toHaveLength(2);
    expect(items[0]!.message).toBe("second");
    expect(items[0]!.method).toBe("addons.update");
    expect(items[1]!.message).toBe("first");
    expect(items[0]!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("caps at the configured maximum, dropping the oldest", () => {
    const buf = new RecentErrorsBuffer(3);
    buf.record("m", "1");
    buf.record("m", "2");
    buf.record("m", "3");
    buf.record("m", "4");
    expect(buf.list().map((e) => e.message)).toEqual(["4", "3", "2"]);
  });

  test("clamps overly long messages", () => {
    const buf = new RecentErrorsBuffer();
    buf.record("m", "x".repeat(500));
    expect(buf.list()[0]!.message.length).toBe(200);
  });
});
