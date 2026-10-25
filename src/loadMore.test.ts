/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { SearchResult } from "./types";
import { appendPage, hasMore } from "./loadMore";

const r = (id: string) => ({ providerId: "Curse", externalId: id }) as SearchResult;

describe("appendPage", () => {
  test("appends and drops duplicates already shown", () => {
    const out = appendPage([r("1"), r("2")], [r("2"), r("3")]);
    expect(out.map((x) => x.externalId)).toEqual(["1", "2", "3"]);
  });
});

describe("hasMore", () => {
  test("offers more while full pages keep coming", () => {
    expect(hasMore(10, 500, 10, 10, 200)).toBe(true);
  });
  test("stops on a short page, at the total, or at the cap", () => {
    expect(hasMore(14, 500, 4, 10, 200)).toBe(false);
    expect(hasMore(20, 20, 10, 10, 200)).toBe(false);
    expect(hasMore(200, 10000, 10, 10, 200)).toBe(false);
  });
});
