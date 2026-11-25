/**
 * The Ledger gold graph's axes, laid out as the TradeSkillMaster addon's
 * in-game Dashboard lays out its own (addon 4.15.9: LibTSMUI
 * `Components/Display/Graph.lua` and the Dashboard's step and format
 * functions in `App/MainUI/Dashboard/Core.lua`, a behaviour reference only;
 * ADR 0018). Project-owned.
 *
 * Both axes follow the data and the plot's size. The gold axis pads the
 * range to a round step that fits the plot's height and draws a gridline
 * only where one fits a label's spacing from the last. The time axis picks
 * months, days or two-hour steps from how much time a label's spacing
 * covers, and labels in the project's date format (C10).
 */

const COPPER_PER_GOLD = 10_000;
const THOUSAND_GOLD = 1_000 * COPPER_PER_GOLD;
const MILLION_GOLD = 1_000 * THOUSAND_GOLD;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A label's box in CSS px: the description line's height, and room for "Nov 2026". */
export const AXIS_LABEL_HEIGHT = 16;
export const X_LABEL_WIDTH = 56;
/** The addon keeps a gridline or a date only a label and a half plus 8 px past the last one kept. */
export const Y_LINE_SPACING = AXIS_LABEL_HEIGHT * 1.5 + 8;
export const X_LABEL_SPACING = X_LABEL_WIDTH * 1.5 + 8;

/** Where a label sits on its mark: centred on it, or kept inside the plot at either edge. */
export type AxisAlign = "start" | "center" | "end";

export interface GoldYAxis {
  /** The plot's bottom and top, in copper. */
  min: number;
  max: number;
  /** Gridlines from the bottom up: their copper and height in px above the plot's bottom. */
  lines: { copper: number; offset: number; label: string; align: AxisAlign }[];
}

export interface GoldXTick {
  /** The tick's time (epoch ms) and its distance in px from the plot's left edge. */
  at: number;
  offset: number;
  label: string;
  align: AxisAlign;
}

/** The addon's smallest gold step: 1,000g on Retail, which records gold in such steps, else 1g. */
const minStep = (retail: boolean) => (retail ? THOUSAND_GOLD : COPPER_PER_GOLD);

/** The smallest power-of-ten multiple of the minimum step that reaches `atLeast`. */
function stepFor(atLeast: number, retail: boolean): number {
  let step = minStep(retail);
  while (step < atLeast) step *= 10;
  return step;
}

/** Keeps a mark inside the plot: centred on it unless half a label would cross an edge. */
function align(offset: number, size: number, length: number): AxisAlign {
  if (offset < size / 2) return "start";
  if (offset + size / 2 > length) return "end";
  return "center";
}

/**
 * A gridline's label as the addon writes it: whole gold below 1,000g, then
 * thousands and millions with two decimals below ten of them. Retail starts
 * at thousands.
 */
export function goldAxisLabel(copper: number, retail: boolean): string {
  if (!retail && copper < THOUSAND_GOLD) return `${Math.floor(copper / COPPER_PER_GOLD)}g`;
  if (!retail && copper < 10 * THOUSAND_GOLD) return `${(copper / THOUSAND_GOLD).toFixed(2)}kg`;
  if (copper < MILLION_GOLD) return `${Math.floor(copper / THOUSAND_GOLD)}kg`;
  if (copper < 10 * MILLION_GOLD) return `${(copper / MILLION_GOLD).toFixed(2)}Mg`;
  return `${Math.floor(copper / MILLION_GOLD)}Mg`;
}

/**
 * The gold axis for the plotted `values` on a plot `plotHeight` px tall.
 * The range runs from the lowest value rounded down to the next step, to a
 * third of a step past the highest rounded up, so the line never touches
 * the top; the step is the smallest that splits the range into no more
 * gridlines than fit, and at least 1/200 of the top. Gridlines then step
 * by a finer power of ten (1/1,000 of the top) and keep only those a
 * label's spacing above the last one kept.
 */
export function goldYAxis(values: number[], plotHeight: number, retail: boolean): GoldYAxis {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const fits = Math.max(1, Math.floor(plotHeight / Y_LINE_SPACING));
  const step = stepFor(Math.max((high - low) / fits / 10, high / 200), retail);
  const min = Math.floor(low / step) * step;
  let max = Math.ceil((high + step / 3) / step) * step;
  if (max === min) max += step;

  const lineStep = stepFor(max / 1000, retail);
  const lines: GoldYAxis["lines"] = [];
  let previous = -Infinity;
  for (
    let copper = min;
    copper <= max;
    copper = Math.floor(copper / lineStep) * lineStep + lineStep
  ) {
    const offset = ((copper - min) / (max - min)) * plotHeight;
    if (offset - previous >= Y_LINE_SPACING) {
      lines.push({
        copper,
        offset,
        label: goldAxisLabel(copper, retail),
        align: align(offset, AXIS_LABEL_HEIGHT, plotHeight),
      });
      previous = offset;
    }
  }
  return { min, max, lines };
}

/** The next mark after `time` for a label spacing that covers `spacing` ms of the plot. */
function nextMark(time: number, spacing: number): number {
  const d = new Date(time);
  if (spacing > 14 * DAY_MS) return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  if (spacing > DAY_MS / 6) {
    // The addon starts the day at 1:00 after an hour of 23, against a DST change.
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
      d.getHours() === 23 ? 1 : 0,
    ).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 2).getTime();
}

/** A mark's label: the month, the day, the weekday or the time, by the spacing. */
function markLabel(time: number, spacing: number): string {
  const d = new Date(time);
  if (spacing > 14 * DAY_MS) return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (spacing > 2 * DAY_MS) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (spacing > DAY_MS / 6) return WEEKDAYS[d.getDay()]!;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The time axis from `start` to `end` (epoch ms) on a plot `plotWidth` px
 * wide. The time one label's spacing covers picks the marks: the first of
 * each month above 14 days, each midnight above 4 hours, else every two
 * hours. A mark gets a label only more than a label's spacing right of the
 * last one labelled. Local time, as the game shows it.
 */
export function goldXAxis(start: number, end: number, plotWidth: number): GoldXTick[] {
  if (!(plotWidth > 0) || !(end > start)) return [];
  const spacing = (X_LABEL_SPACING / plotWidth) * (end - start);
  const ticks: GoldXTick[] = [];
  let previous = -Infinity;
  for (let at = nextMark(start, spacing); at <= end;) {
    const offset = ((at - start) / (end - start)) * plotWidth;
    if (offset - previous > X_LABEL_SPACING) {
      ticks.push({
        at,
        offset,
        label: markLabel(at, spacing),
        align: align(offset, X_LABEL_WIDTH, plotWidth),
      });
      previous = offset;
    }
    const next = nextMark(at, spacing);
    if (!(next > at)) break;
    at = next;
  }
  return ticks;
}
