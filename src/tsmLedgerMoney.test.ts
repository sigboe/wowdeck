import { expect, test } from "bun:test";
import { dashboardMoney, dashboardSummaryMoney } from "./tsmLedgerMoney";

test("other games keep every copper", () => {
  expect(dashboardMoney(12_345_678, false)).toBe(12_345_678);
  expect(dashboardMoney(-12_345.6, false)).toBe(-12_346);
  expect(dashboardSummaryMoney(70_550, false)).toBe(70_550);
});

test("Retail writes 1g and more to the silver, on either side of zero", () => {
  expect(dashboardMoney(12_345_678, true)).toBe(12_345_700);
  expect(dashboardMoney(12_345_649, true)).toBe(12_345_600);
  expect(dashboardMoney(-12_345_678, true)).toBe(-12_345_700);
  // Below 1g the copper stays.
  expect(dashboardMoney(9_999, true)).toBe(9_999);
  expect(dashboardMoney(-705, true)).toBe(-705);
});

test("Retail's summary rounds to whole gold, halves up", () => {
  expect(dashboardSummaryMoney(70_550, true)).toBe(70_000);
  expect(dashboardSummaryMoney(75_000, true)).toBe(80_000);
  expect(dashboardSummaryMoney(4_999, true)).toBe(0);
  expect(dashboardSummaryMoney(-15_000, true)).toBe(-10_000);
});
