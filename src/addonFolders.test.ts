/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { showRow } from "./addonFolders";

describe("showRow", () => {
  test("names the running file manager", () => {
    expect(showRow({ running: true, name: "Dolphin", steamAppId: null })).toMatchObject({
      label: "Show in Dolphin",
      muted: false,
    });
  });

  test("running but unnamed: a generic name, not muted", () => {
    expect(showRow({ running: true, name: null, steamAppId: null })).toMatchObject({
      label: "Show in file manager",
      muted: false,
    });
  });

  test("none running: stays, muted and generic, with the hint as its description", () => {
    expect(showRow({ running: false, name: null, steamAppId: null })).toEqual({
      label: "Show in file manager",
      muted: true,
      description: expect.stringContaining("non-Steam game or in a nested desktop session"),
    });
  });
});
