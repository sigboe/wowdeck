/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { chooseStartPath } from "./pickerStart";

describe("where a file picker starts (#133)", () => {
  test("a saved or typed folder wins", () => {
    expect(chooseStartPath("/run/media/sd/Backups", "/home/sigurdb")).toBe("/run/media/sd/Backups");
  });

  test("a typed path is trimmed before it is used", () => {
    expect(chooseStartPath("  /home/sigurdb/Games  ", "/home/sigurdb")).toBe("/home/sigurdb/Games");
  });

  test("with no folder chosen it opens in the engine's home folder", () => {
    expect(chooseStartPath(undefined, "/home/sigurdb")).toBe("/home/sigurdb");
    expect(chooseStartPath("", "/home/sigurdb")).toBe("/home/sigurdb");
    expect(chooseStartPath("   ", "/home/sigurdb")).toBe("/home/sigurdb");
    expect(chooseStartPath(null, "/home/sigurdb")).toBe("/home/sigurdb");
  });

  test("before the engine has said where home is it opens at the root, never /home/deck", () => {
    expect(chooseStartPath(undefined, null)).toBe("/");
    expect(chooseStartPath("", "")).toBe("/");
  });
});
