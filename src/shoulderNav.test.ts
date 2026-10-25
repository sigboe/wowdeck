/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { nextSectionIndex, nextSelectableId, swipeDirection } from "./shoulderNav";

describe("nextSectionIndex", () => {
  test("RB moves forward through all three sections", () => {
    expect(nextSectionIndex(0, 1, 3)).toBe(1);
    expect(nextSectionIndex(1, 1, 3)).toBe(2);
  });

  test("LB moves backward through all three sections", () => {
    expect(nextSectionIndex(2, -1, 3)).toBe(1);
    expect(nextSectionIndex(1, -1, 3)).toBe(0);
  });

  test("LB on the first section is a no-op", () => {
    expect(nextSectionIndex(0, -1, 3)).toBe(0);
  });

  test("RB on the last section is a no-op", () => {
    expect(nextSectionIndex(2, 1, 3)).toBe(2);
  });
});

describe("nextSelectableId (addon Details modal LB/RB)", () => {
  const ALL = ["description", "changelog", "gallery"] as const;

  test("RB moves to the next selectable id", () => {
    expect(nextSelectableId("description", 1, ALL)).toBe("changelog");
    expect(nextSelectableId("changelog", 1, ALL)).toBe("gallery");
  });

  test("LB moves to the previous selectable id", () => {
    expect(nextSelectableId("gallery", -1, ALL)).toBe("changelog");
    expect(nextSelectableId("changelog", -1, ALL)).toBe("description");
  });

  test("LB on the first selectable id is a no-op", () => {
    expect(nextSelectableId("description", -1, ALL)).toBe("description");
  });

  test("RB on the last selectable id is a no-op", () => {
    expect(nextSelectableId("gallery", 1, ALL)).toBe("gallery");
  });

  // Gallery excluded (e.g. the result has no screenshots) — matches
  // SectionNav's own `disabled` already blocking a click from landing
  // there; RB from the last remaining selectable id must still clamp,
  // not skip past the end into the excluded one.
  test("a disabled section excluded from the list is never landed on", () => {
    const withoutGallery = ["description", "changelog"] as const;
    expect(nextSelectableId("changelog", 1, withoutGallery)).toBe("changelog");
  });

  test("returns the current id unchanged if it isn't present in the selectable list", () => {
    const withoutGallery = ["description", "changelog"] as const;
    expect(nextSelectableId("gallery", 1, withoutGallery)).toBe("gallery");
  });
});

describe("swipeDirection", () => {
  test("a swipe left pages forward, a swipe right pages back", () => {
    expect(swipeDirection(-120, 10)).toBe(1);
    expect(swipeDirection(120, -10)).toBe(-1);
  });

  test("a short or mostly vertical gesture does not page", () => {
    expect(swipeDirection(-30, 0)).toBe(0);
    expect(swipeDirection(-80, 60)).toBe(0);
    expect(swipeDirection(5, 300)).toBe(0);
  });
});
