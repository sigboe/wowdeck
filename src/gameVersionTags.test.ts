/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { gameVersionTag, gameVersionTagList } from "./gameVersionTags";

describe("gameVersionTag", () => {
  test("names the flavors our clients table knows", () => {
    expect(gameVersionTag("12.1.5")).toBe("Forever");
    expect(gameVersionTag("11.0.2")).toBe("Forever");
    expect(gameVersionTag("1.15.9")).toBe("Classic Era");
    expect(gameVersionTag("1.14.4")).toBe("Classic Era");
    expect(gameVersionTag("2.5.6")).toBe("Burning Crusade Anniversary");
    expect(gameVersionTag("5.5.4")).toBe("Mists of Pandaria Classic");
  });

  test("names the classic flavors that have no client of ours", () => {
    expect(gameVersionTag("3.4.5")).toBe("Wrath of the Lich King Classic");
    expect(gameVersionTag("4.4.2")).toBe("Cataclysm Classic");
  });

  test("keeps an unknown version raw instead of guessing a name", () => {
    expect(gameVersionTag("1.60.1")).toBe("1.60.1");
    expect(gameVersionTag("3.80.2")).toBe("3.80.2");
    expect(gameVersionTag("13.0.1")).toBe("13.0.1");
    expect(gameVersionTag("")).toBe("");
  });
});

describe("gameVersionTagList", () => {
  test("names every version of a multi-flavor release, without repeats", () => {
    expect(
      gameVersionTagList({
        gameVersion: "12.1.5",
        gameVersions: ["12.1.5", "1.60.1", "5.5.4", "1.15.9", "2.5.6"],
      }),
    ).toEqual([
      "Forever",
      "1.60.1",
      "Mists of Pandaria Classic",
      "Classic Era",
      "Burning Crusade Anniversary",
    ]);
  });

  test("collapses versions of one flavor into one tag", () => {
    expect(
      gameVersionTagList({ gameVersion: "1.15.9", gameVersions: ["1.15.9", "1.15.8"] }),
    ).toEqual(["Classic Era"]);
  });

  test("falls back to the single version, as a one-tag line", () => {
    expect(gameVersionTagList({ gameVersion: "11.0.2", gameVersions: null })).toEqual(["Forever"]);
    expect(gameVersionTagList({ gameVersion: "1.60.1", gameVersions: null })).toEqual(["1.60.1"]);
  });

  test("nothing when no version is known", () => {
    expect(gameVersionTagList({ gameVersion: null, gameVersions: null })).toEqual([]);
    expect(gameVersionTagList({ gameVersion: null, gameVersions: [] })).toEqual([]);
  });
});
