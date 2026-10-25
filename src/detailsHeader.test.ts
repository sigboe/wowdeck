/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  dependencyNote,
  formatDownloadCount,
  headerFacts,
  shortReleaseDate,
} from "./detailsHeader";
import type { DetailsResult } from "./types";

function result(overrides: Partial<DetailsResult> = {}): DetailsResult {
  return {
    providerId: "curseforge",
    externalId: "1",
    name: "Addon",
    author: null,
    downloadCount: null,
    summary: null,
    thumbnailUrl: null,
    websiteUrl: null,
    latestVersion: null,
    gameVersion: null,
    releasedAt: null,
    channel: null,
    screenshots: [],
    ...overrides,
  };
}

describe("formatDownloadCount", () => {
  test("keeps small counts exact", () => {
    expect(formatDownloadCount(0)).toBe("0");
    expect(formatDownloadCount(999)).toBe("999");
  });

  test("abbreviates thousands, millions and billions with one decimal", () => {
    expect(formatDownloadCount(1_000)).toBe("1K");
    expect(formatDownloadCount(34_560)).toBe("34.6K");
    expect(formatDownloadCount(60_894_636)).toBe("60.9M");
    expect(formatDownloadCount(2_000_000_000)).toBe("2B");
  });

  test("treats invalid input as zero", () => {
    expect(formatDownloadCount(-5)).toBe("0");
    expect(formatDownloadCount(Number.NaN)).toBe("0");
  });
});

describe("headerFacts", () => {
  test("returns nothing when no facts are known", () => {
    expect(headerFacts(result())).toEqual([]);
  });

  test("lists known facts in display order", () => {
    expect(
      headerFacts(
        result({
          author: "Crieve",
          downloadCount: 1_200_000,
          latestVersion: "v1.2.3",
          gameVersion: "11.0.2",
        }),
      ),
    ).toEqual(["Crieve", "1.2M downloads", "v1.2.3", "WoW 11.0.2"]);
  });

  test("adds a non-stable channel and the release day", () => {
    expect(
      headerFacts(
        result({
          latestVersion: "2.0",
          channel: "beta",
          gameVersion: "11.0.2",
          releasedAt: "2026-09-01",
        }),
      ),
    ).toEqual([
      "2.0",
      "Beta",
      "WoW 11.0.2",
      `Updated ${shortReleaseDate("2026-09-01", new Date())}`,
    ]);
  });

  test("does not call out the stable channel", () => {
    expect(headerFacts(result({ channel: "stable" }))).toEqual([]);
  });

  test("skips a zero or null download count", () => {
    expect(headerFacts(result({ downloadCount: 0, author: "A" }))).toEqual(["A"]);
  });
});

describe("shortReleaseDate", () => {
  const now = new Date(2026, 9, 16);
  test("day and month this year, month and year before", () => {
    expect(shortReleaseDate("2026-10-04", now)).toBe("4 Oct");
    expect(shortReleaseDate("2024-03-31", now)).toBe("31 Mar 2024");
  });
  test("nothing for a missing or odd value", () => {
    expect(shortReleaseDate(null, now)).toBeNull();
    expect(shortReleaseDate("2026-13-01", now)).toBeNull();
    expect(shortReleaseDate("yesterday", now)).toBeNull();
  });
});

describe("dependencyNote (WF-11)", () => {
  test("installed: names, and which are missing", () => {
    expect(dependencyNote({ required: ["Ace3", "LibStub"], missing: ["LibStub"] })).toEqual({
      text: "Requires Ace3, LibStub",
      missing: "Missing: LibStub",
    });
    expect(dependencyNote({ required: ["Ace3"], missing: [] })?.missing).toBeNull();
  });
  test("provider result: a count that comes along on install", () => {
    expect(dependencyNote({ count: 1 })?.text).toBe("Needs 1 other addon, installed automatically");
    expect(dependencyNote({ count: 3 })?.text).toBe(
      "Needs 3 other addons, installed automatically",
    );
  });
  test("none: no line", () => {
    expect(dependencyNote({ count: 0 })).toBeNull();
    expect(dependencyNote({ required: [], missing: [] })).toBeNull();
  });
});
