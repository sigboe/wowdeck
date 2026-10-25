/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { dayAndTime, dayMonth, lastAutoUpdateLine, plural, updateAllToast } from "./text";

describe("copy helpers (C02, C10)", () => {
  test("plural", () => {
    expect(plural(1, "addon")).toBe("1 addon");
    expect(plural(3, "addon")).toBe("3 addons");
    expect(plural(2, "installation")).toBe("2 installations");
    expect(plural(0, "update")).toBe("0 updates");
  });
  test("dayMonth", () => {
    const now = new Date(2026, 9, 16);
    expect(dayMonth(new Date(2026, 9, 4), now)).toBe("4 Oct");
    expect(dayMonth(new Date(2024, 2, 31), now)).toBe("31 Mar 2024");
  });
  test("dayAndTime", () => {
    const now = new Date(2026, 9, 16, 15, 0).getTime();
    expect(dayAndTime(new Date(2026, 9, 16, 14, 32).getTime(), now)).toBe("today at 14:32");
    expect(dayAndTime(new Date(2026, 9, 15, 9, 5).getTime(), now)).toBe("yesterday at 09:05");
    expect(dayAndTime(new Date(2026, 9, 1, 8, 0).getTime(), now)).toBe("1 Oct at 08:00");
  });
});

describe("updateAllToast (C11)", () => {
  test("what happened to how many", () => {
    expect(updateAllToast(3, 0)).toEqual(["Updated 3 addons", ""]);
    expect(updateAllToast(1, 2)).toEqual(["Updated 1 addon", "2 addons couldn't be updated"]);
    expect(updateAllToast(0, 1)).toEqual(["Couldn't update 1 addon", ""]);
    expect(updateAllToast(0, 0)).toEqual(["All addons are up to date", ""]);
  });
});

describe("lastAutoUpdateLine (C10, C11)", () => {
  test("when and what, in plain words", () => {
    const now = new Date(2026, 9, 16, 15, 0).getTime();
    const at = new Date(2026, 9, 16, 14, 32).getTime();
    expect(lastAutoUpdateLine({ at, updated: ["DBM"], failed: [], skipped: null }, now)).toBe(
      "Last run today at 14:32: updated DBM",
    );
    expect(
      lastAutoUpdateLine({ at, updated: [], failed: [], skipped: "WoW was running" }, now),
    ).toBe("Last run today at 14:32: postponed (WoW was running)");
  });
});
