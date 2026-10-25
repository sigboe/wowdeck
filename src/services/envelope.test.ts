/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { rpcVia, unwrapBackendResult } from "./envelope";

describe("unwrapBackendResult", () => {
  test("passes normal results through, including null and arrays", () => {
    expect(unwrapBackendResult({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapBackendResult(null)).toBeNull();
    expect(unwrapBackendResult([1, 2])).toEqual([1, 2]);
  });
  test("throws the engine's message for an error envelope", () => {
    expect(() =>
      unwrapBackendResult({ __error: { code: "internal_error", message: "boom" } }),
    ).toThrow("boom");
  });
  test("an object that merely has other keys is not an envelope", () => {
    expect(unwrapBackendResult({ error: "x" })).toEqual({ error: "x" });
  });
});

describe("rpcVia", () => {
  test("sends the method and params, and returns the result", async () => {
    const sent: unknown[] = [];
    const rpc = rpcVia(async (method, params) => {
      sent.push([method, params]);
      return { addon: { id: "x" } };
    });
    const out = await rpc("addons.update", { addonId: "x" });
    expect(out).toEqual({ addon: { id: "x" } } as never);
    expect(sent).toEqual([["addons.update", { addonId: "x" }]]);
  });
  test("params are optional for a method that takes none", async () => {
    const sent: unknown[] = [];
    const rpc = rpcVia(async (method, params) => {
      sent.push([method, params]);
      return { addons: [] };
    });
    await rpc("addons.list");
    expect(sent).toEqual([["addons.list", undefined]]);
  });
  test("throws the engine's message and code for an error envelope", async () => {
    const rpc = rpcVia(async () => ({
      __error: { code: "not_found", message: "Addon not found" },
    }));
    const err = await rpc("addons.update", { addonId: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Addon not found");
    expect((err as { code?: string }).code).toBe("not_found");
  });
});
