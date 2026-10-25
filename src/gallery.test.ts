/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { nextGalleryIndex } from "./gallery";

describe("nextGalleryIndex", () => {
  test("steps forward and backward within bounds", () => {
    expect(nextGalleryIndex(0, 1, 5)).toBe(1);
    expect(nextGalleryIndex(2, -1, 5)).toBe(1);
  });

  // Unlike shoulderNav's nextSectionIndex (clamps at the edges), the
  // gallery wraps — Next on the last image goes to the first, matching
  // a normal slideshow, not a bounded tab strip.
  test("wraps forward past the last image to the first", () => {
    expect(nextGalleryIndex(4, 1, 5)).toBe(0);
  });

  test("wraps backward past the first image to the last", () => {
    expect(nextGalleryIndex(0, -1, 5)).toBe(4);
  });

  test("a single image wraps to itself", () => {
    expect(nextGalleryIndex(0, 1, 1)).toBe(0);
    expect(nextGalleryIndex(0, -1, 1)).toBe(0);
  });

  test("an empty gallery never throws and returns 0", () => {
    expect(nextGalleryIndex(0, 1, 0)).toBe(0);
    expect(nextGalleryIndex(0, -1, 0)).toBe(0);
  });
});
