/**
 * Money on the Ledger rounded the way the TradeSkillMaster addon's in-game
 * Dashboard rounds it (addon 4.15.9: `LibTSMUtil/Source/UI/Money.lua`,
 * `Format/MoneyFormatter.lua` and the Dashboard's summary and details rows,
 * a behaviour reference only; ADR 0018). Project-owned.
 *
 * Other games keep every copper. On Retail the addon writes any amount of
 * 1g or more to the silver, and its summary rounds Daily change, Top sale
 * and Top purchase to whole gold.
 */

const COPPER_PER_SILVER = 100;
const COPPER_PER_GOLD = 10_000;

/** The addon's Math.Round: to the nearest multiple of `step`, halves up. */
const roundTo = (value: number, step: number) => Math.floor(value / step + 0.5) * step;

/**
 * An amount as the Dashboard writes it: to the copper, and on Retail to the
 * silver from 1g on either side of zero.
 */
export function dashboardMoney(copper: number, retail: boolean): number {
  const whole = roundTo(copper, 1);
  if (!retail || Math.abs(whole) < COPPER_PER_GOLD) return whole;
  return Math.sign(whole) * roundTo(Math.abs(whole), COPPER_PER_SILVER);
}

/** Daily change, Top sale and Top purchase as the Dashboard's summary writes them: whole gold on Retail. */
export function dashboardSummaryMoney(copper: number, retail: boolean): number {
  return retail ? roundTo(copper, COPPER_PER_GOLD) : roundTo(copper, 1);
}
