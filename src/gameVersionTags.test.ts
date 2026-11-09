/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { gameVersionTag, gameVersionTagList } from "./gameVersionTags";

describe("gameVersionTag", () => {
  test("names each classic flavor with our short client names", () => {
    expect(gameVersionTag("1.15.9")).toEqual({ label: "Classic Era", color: "#C39B52" });
    expect(gameVersionTag("1.14.4")).toEqual({ label: "Classic Era", color: "#C39B52" });
    expect(gameVersionTag("1.60.1")).toEqual({ label: "Forever", color: "#178CA8" });
    expect(gameVersionTag("2.5.6")).toEqual({ label: "Anniversary", color: "#4FAF58" });
    expect(gameVersionTag("5.5.4")).toEqual({ label: "MoP", color: "#5CA48A" });
    expect(gameVersionTag("3.4.5")).toEqual({ label: "Wrath", color: "#68B7DA" });
    expect(gameVersionTag("4.4.2")).toEqual({ label: "Cataclysm", color: "#D65A3A" });
  });

  test("names Retail versions by expansion, since both are the Retail client", () => {
    expect(gameVersionTag("11.0.2")).toEqual({ label: "War Within", color: "#B15B5E" });
    expect(gameVersionTag("12.1.5")).toEqual({ label: "Midnight", color: "#6F5BC7" });
    expect(gameVersionTag("13.0.1")).toEqual({ label: "Last Titan", color: "#D6AB4B" });
  });

  test("keeps an unknown version raw, with the neutral color", () => {
    expect(gameVersionTag("3.80.2")).toEqual({ label: "3.80.2", color: null });
    expect(gameVersionTag("14.0.1")).toEqual({ label: "14.0.1", color: null });
    expect(gameVersionTag("")).toEqual({ label: "", color: null });
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
      { label: "Midnight", color: "#6F5BC7" },
      { label: "Forever", color: "#178CA8" },
      { label: "MoP", color: "#5CA48A" },
      { label: "Classic Era", color: "#C39B52" },
      { label: "Anniversary", color: "#4FAF58" },
    ]);
  });

  test("collapses versions of one flavor into one tag", () => {
    expect(
      gameVersionTagList({ gameVersion: "1.15.9", gameVersions: ["1.15.9", "1.15.8"] }),
    ).toEqual([{ label: "Classic Era", color: "#C39B52" }]);
  });

  test("falls back to the single version, as a one-tag line", () => {
    expect(gameVersionTagList({ gameVersion: "11.0.2", gameVersions: null })).toEqual([
      { label: "War Within", color: "#B15B5E" },
    ]);
    expect(gameVersionTagList({ gameVersion: "1.60.1", gameVersions: null })).toEqual([
      { label: "Forever", color: "#178CA8" },
    ]);
  });

  test("nothing when no version is known", () => {
    expect(gameVersionTagList({ gameVersion: null, gameVersions: null })).toEqual([]);
    expect(gameVersionTagList({ gameVersion: null, gameVersions: [] })).toEqual([]);
  });
});
