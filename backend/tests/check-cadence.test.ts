/**
 * The cadence rule both periodic checks share (UpdateToastGate and
 * PluginUpdateCheck): when a check is due again. Pure — no clock, no
 * store, no network.
 */

import { describe, expect, test } from "bun:test";
import {
  backoffIntervalMs,
  DAY_MS,
  HOUR_MS,
  isDue,
} from "../src/wow/notifications/CheckCadence";

const NOW = 1_800_000_000_000;

describe("isDue", () => {
  test("a check that never ran is due", () => {
    expect(isDue(null, NOW, DAY_MS)).toBe(true);
    expect(isDue(undefined, NOW, DAY_MS)).toBe(true);
  });

  test("a stamp that is not a number is due", () => {
    expect(isDue(Number.NaN, NOW, DAY_MS)).toBe(true);
    expect(isDue(Number.POSITIVE_INFINITY, NOW, DAY_MS)).toBe(true);
  });

  test("inside the interval it is not due", () => {
    expect(isDue(NOW - 1, NOW, DAY_MS)).toBe(false);
    expect(isDue(NOW - DAY_MS + 1, NOW, DAY_MS)).toBe(false);
  });

  test("exactly one interval old is due", () => {
    expect(isDue(NOW - DAY_MS, NOW, DAY_MS)).toBe(true);
    expect(isDue(NOW - DAY_MS - 1, NOW, DAY_MS)).toBe(true);
  });

  test("a stamp in the future is due, not trusted", () => {
    // A clock that jumped back, or settings from another time: running one
    // extra check is harmless; trusting it would silence the check all day.
    expect(isDue(NOW + 60 * 60 * 1000, NOW, DAY_MS)).toBe(true);
  });

  test("the interval is per caller: a short one is due sooner", () => {
    expect(isDue(NOW - 60_000, NOW, 30_000)).toBe(true);
    expect(isDue(NOW - 15_000, NOW, 30_000)).toBe(false);
  });
});

describe("backoffIntervalMs", () => {
  test("the failure ladder: one hour, two, then four — capped there", () => {
    expect(backoffIntervalMs(1)).toBe(HOUR_MS);
    expect(backoffIntervalMs(2)).toBe(2 * HOUR_MS);
    expect(backoffIntervalMs(3)).toBe(4 * HOUR_MS);
    expect(backoffIntervalMs(4)).toBe(4 * HOUR_MS);
    expect(backoffIntervalMs(9)).toBe(4 * HOUR_MS);
  });

  test("no consecutive failures means no spacing", () => {
    expect(backoffIntervalMs(0)).toBe(0);
    expect(backoffIntervalMs(-1)).toBe(0);
  });
});
