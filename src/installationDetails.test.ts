/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { addonCountText, gameFolder, homePath, splitGameVersion } from "./installationDetails";

describe("splitGameVersion", () => {
  test("splits a four-part version into version and build", () => {
    expect(splitGameVersion("1.60.1.70338")).toEqual({ version: "1.60.1", build: "70338" });
  });

  test("keeps a three-part version whole with no build", () => {
    expect(splitGameVersion("11.0.2")).toEqual({ version: "11.0.2", build: null });
  });

  test("passes null through as null", () => {
    expect(splitGameVersion(null)).toEqual({ version: null, build: null });
  });
});

describe("homePath", () => {
  test("shortens a leading /home/<user>", () => {
    expect(homePath("/home/deck/Applications/X")).toBe("~/Applications/X");
  });

  test("leaves other paths unchanged", () => {
    expect(homePath("/mnt/games/wow")).toBe("/mnt/games/wow");
  });
});

describe("gameFolder", () => {
  test("returns the last path segment", () => {
    expect(gameFolder("/a/b/_classic_beta_")).toBe("_classic_beta_");
  });

  test("tolerates a trailing slash", () => {
    expect(gameFolder("/a/b/_classic_beta_/")).toBe("_classic_beta_");
  });
});

describe("addonCountText", () => {
  test("counts installed and managed", () => {
    expect(addonCountText(16, 15)).toBe("16 installed, 15 managed");
  });

  test("one addon reads the same way", () => {
    expect(addonCountText(1, 1)).toBe("1 installed, 1 managed");
  });

  test("says none when nothing is installed", () => {
    expect(addonCountText(0, 0)).toBe("None installed");
  });
});
