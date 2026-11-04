/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  dayAndTime,
  dayMonth,
  importResultLine,
  lastAutoUpdateLine,
  plural,
  updateAllToast,
} from "./text";
import type { OperationResult } from "./types";

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
  const ops = (...statuses: string[]) =>
    statuses.map((status) => ({ status, error: null }) as unknown as OperationResult);
  test("what happened to how many", () => {
    expect(updateAllToast(ops("updated", "updated", "updated"))).toEqual(["Updated 3 addons", ""]);
    expect(updateAllToast(ops("updated", "failed", "failed", "current"))).toEqual([
      "Updated 1 addon",
      "2 addons couldn't be updated.",
    ]);
    expect(updateAllToast(ops("failed"))).toEqual(["Couldn't update 1 addon", ""]);
    expect(updateAllToast(ops("current"))).toEqual(["All addons are up to date", ""]);
    expect(updateAllToast([{ ...ops("updated")[0]!, cleanupWarning: "left" }])).toEqual([
      "Updated 1 addon",
      "Some temporary files are left; they're removed at the next addon change.",
    ]);
  });
  test("names what wasn't updated when the engine names it (#110)", () => {
    const failed = (addonName: string) => ({ ...ops("failed")[0]!, addonName });
    expect(updateAllToast([...ops("updated"), failed("Bravo")])).toEqual([
      "Updated 1 addon",
      "Not updated: Bravo.",
    ]);
    expect(updateAllToast([failed("Bravo"), failed("Charlie")])).toEqual([
      "Couldn't update 2 addons",
      "Not updated: Bravo, Charlie.",
    ]);
  });
});

describe("importResultLine (#110)", () => {
  const base = { operationId: "op", addonId: "a", error: null } as const;
  test("each entry's own outcome, with what its dependencies did", () => {
    expect(importResultLine({ ...base, status: "installed" })).toBe("installed");
    expect(importResultLine({ ...base, status: "failed", error: "HTTP 404" })).toBe(
      "failed, HTTP 404",
    );
    expect(
      importResultLine({
        ...base,
        status: "installed",
        followUps: [
          { ...base, status: "installed", addonName: "LibOk" },
          { ...base, status: "failed", error: "x", addonName: "LibA" },
        ],
      }),
    ).toBe("installed, but LibA, which it needs, couldn't be installed");
    expect(
      importResultLine({
        ...base,
        status: "installed",
        cleanupWarning: "Its temporary files are left.",
      }),
    ).toBe("installed. Its temporary files are left.");
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
