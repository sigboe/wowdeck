/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  VALVE_SCROLL_BUFFER,
  contentOverlap,
  floatingTop,
  scrollMargins,
  shadowReach,
} from "./scrollBuffer";

describe("scrollBuffer", () => {
  const big = { viewportHeight: 2000, rowHeight: 60 };
  test("room to spare: Valve's 250/60 px below the floating panes", () => {
    // Decky's 68 px title over a 48 px-padded scroller
    expect(scrollMargins({ floatingTop: 68, paddingTop: 48, paddingBottom: 48, ...big })).toEqual({
      top: 250 + 68 - 48,
      bottom: 12,
    });
  });
  test("nothing floating and no padding: Valve's buffer as is", () => {
    expect(scrollMargins({ floatingTop: 0, paddingTop: 0, paddingBottom: 0, ...big })).toEqual({
      top: VALVE_SCROLL_BUFFER.top,
      bottom: VALVE_SCROLL_BUFFER.bottom,
    });
  });
  test("never negative when the container already pads more", () => {
    expect(scrollMargins({ floatingTop: 0, paddingTop: 400, paddingBottom: 80, ...big })).toEqual({
      top: 0,
      bottom: 0,
    });
  });
  test("scrolloff cap: buffer + tallest row + buffer always fits (the measured QAM case)", () => {
    // DEVICE 2026-10-15: list 440 px, Decky title 68 px, padding 48/48, rows up to 92 px
    const m = scrollMargins({
      floatingTop: 68,
      paddingTop: 48,
      paddingBottom: 48,
      viewportHeight: 440,
      rowHeight: 92,
    });
    const topEdge = 48 + m.top; // where a row's top may come to rest
    const bottomEdge = 440 - 48 - m.bottom;
    expect(bottomEdge - topEdge).toBeGreaterThanOrEqual(92);
    expect(topEdge).toBeGreaterThan(68); // never under the title
  });
  test("a tiny list keeps the row in view rather than asking for room that is not there", () => {
    const m = scrollMargins({
      floatingTop: 100,
      paddingTop: 0,
      paddingBottom: 0,
      viewportHeight: 180,
      rowHeight: 80,
    });
    expect(m).toEqual({ top: 100, bottom: 0 });
  });
  test("floatingTop is the lowest overlay bottom below the scroller top", () => {
    expect(floatingTop(14, [82, 40])).toBe(68);
    expect(floatingTop(100, [50])).toBe(0);
    expect(floatingTop(0, [])).toBe(0);
  });
});

describe("contentOverlap", () => {
  test("no extra padding while Steam's header padding covers the floating pane", () => {
    expect(contentOverlap(118, 118)).toBe(0);
    expect(contentOverlap(100, 118)).toBe(0);
  });
  test("pads by the part a taller pane covers", () => {
    expect(contentOverlap(158, 118)).toBe(40);
  });
});

describe("shadowReach", () => {
  test("Decky's title shadow reaches 19 px below it (measured)", () => {
    expect(shadowReach("rgb(14, 20, 27) 0px 0px 7px 12px")).toBe(19);
  });
  test("Steam's scrolled tab header shadow, offset included", () => {
    expect(shadowReach("rgba(0, 0, 0, 0.5) 0px 4px 8px 0px")).toBe(12);
  });
  test("largest of several, inset ignored, none is 0", () => {
    expect(
      shadowReach("rgba(0, 0, 0, 0.2) 0px 2px 4px 0px, rgb(0, 0, 0) 0px 0px 0px 30px inset"),
    ).toBe(6);
    expect(shadowReach("none")).toBe(0);
    expect(shadowReach("")).toBe(0);
  });
});
