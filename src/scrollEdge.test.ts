/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { canScroll } from "./scrollEdge";

describe("canScroll (Steam's 2 px edge)", () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });
  test("in the middle both ways", () => {
    expect(canScroll("up", box(300))).toBe(true);
    expect(canScroll("down", box(300))).toBe(true);
  });
  test("at the top only down, at the bottom only up (within 2 px)", () => {
    expect(canScroll("up", box(2))).toBe(false);
    expect(canScroll("down", box(2))).toBe(true);
    expect(canScroll("down", box(598))).toBe(false);
    expect(canScroll("up", box(598))).toBe(true);
  });
  test("content that fits never scrolls", () => {
    const fits = { scrollTop: 0, scrollHeight: 300, clientHeight: 400 };
    expect(canScroll("up", fits)).toBe(false);
    expect(canScroll("down", fits)).toBe(false);
  });
});
