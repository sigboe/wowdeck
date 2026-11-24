/**
 * The Ledger's gold graph (ADR 0018): the sum of selected gold logs over
 * time, sampled and summarised as the TradeSkillMaster addon's in-game
 * Dashboard does (4.15.9: its gold tracker, gold log and Dashboard graph,
 * a behaviour reference only). Project-owned; the `minute,copper` log
 * format is documented in spec #308.
 */
import type { TradeSkillMasterLedgerGold } from "../../api/contracts";

const MINUTE = 60;
const DAY = 86_400;
/** The summary's High and Low look back 52 weeks, one sample every 6 hours. */
const STATS_PERIOD = 52 * 7 * DAY;
const STATS_SAMPLE = 6 * 3600;
/** The addon's graph plots at most this many steps across its range. */
const MAX_PLOT_POINTS = 300;
const COPPER_PER_GOLD = 10_000;
/** A zero between two balances above 5,000 gold is a misread, and the addon drops it. */
const ERRONEOUS_ZERO = 5_000 * COPPER_PER_GOLD;
/** Balances above these are misreads too. */
export const MAX_CHARACTER_COPPER = 10_000_000 * COPPER_PER_GOLD;
export const MAX_WARBANK_COPPER = 100_000_000 * COPPER_PER_GOLD;

/** One gold log: the minutes of its points and the balance from each on. */
export interface GoldLog {
  minutes: number[];
  values: number[];
}

/** Rows of `minute,copper` as numbers; a row that is not two numbers is skipped. */
export function goldLog(rows: Iterable<string[]>, maxCopper?: number): GoldLog {
  const log: GoldLog = { minutes: [], values: [] };
  for (const [minute, copper] of rows) {
    const m = Number(minute), c = Number(copper);
    if (minute!.trim() === "" || copper!.trim() === "" || !Number.isFinite(m) || !Number.isFinite(c)) continue;
    log.minutes.push(m);
    log.values.push(c);
  }
  if (maxCopper !== undefined) clean(log, maxCopper);
  return log;
}

/**
 * Drops what the addon drops when it loads a character's or the Warband
 * bank's log: a zero between two balances above 5,000 gold, a balance equal
 * to the one before, and a balance above `maxCopper`. The first point stays.
 */
function clean({ minutes, values }: GoldLog, maxCopper: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = values.length - 2; i >= 1; i--) {
      if (values[i - 1]! > ERRONEOUS_ZERO && values[i] === 0 && values[i + 1]! > ERRONEOUS_ZERO) {
        minutes.splice(i, 1);
        values.splice(i, 1);
        changed = true;
      }
    }
    for (let i = values.length - 1; i >= 1; i--) {
      if (values[i - 1] === values[i] || values[i]! > maxCopper) {
        minutes.splice(i, 1);
        values.splice(i, 1);
        changed = true;
      }
    }
  }
}

/** The balance at `minute`: zero before the first point, else the last point's at or before it. */
function valueAt({ minutes, values }: GoldLog, minute: number): number {
  if (minutes.length === 0 || minute < minutes[0]!) return 0;
  let low = 0, high = minutes.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (minutes[mid]! <= minute) low = mid;
    else high = mid - 1;
  }
  return values[low]!;
}

/** A selected log; `until` (seconds) ends a guild the addon stops counting at its last point. */
export interface SelectedLog {
  log: GoldLog;
  until?: number;
}

/** The selection's gold at `time` (seconds): every log's balance at that minute, summed. */
function goldAt(logs: SelectedLog[], time: number): number {
  const minute = Math.floor(time / MINUTE);
  let sum = 0;
  for (const { log, until } of logs) if (until === undefined || until > time) sum += valueAt(log, minute);
  return sum;
}

/**
 * The selection's time range, in seconds: from its first point (or now) to
 * now, both on a whole minute.
 */
export function goldRange(logs: SelectedLog[], nowMs: number): { start: number; end: number } {
  const end = Math.floor(nowMs / 1000 / MINUTE) * MINUTE;
  let start = end;
  for (const { log } of logs) if (log.minutes.length > 0) start = Math.min(start, log.minutes[0]! * MINUTE);
  return { start, end };
}

/**
 * The graph and summary for `logs` over the period of `rangeSeconds` (null
 * is All) at `nowMs`; null when no log holds a point.
 */
export function goldGraph(logs: SelectedLog[], rangeSeconds: number | null, nowMs: number): TradeSkillMasterLedgerGold | null {
  if (!logs.some(({ log }) => log.minutes.length > 0)) return null;
  const { start, end } = goldRange(logs, nowMs);
  // All spans the whole range; a period ends now and starts no earlier than the range.
  const now = Math.floor(nowMs / 1000);
  const zoomStart = rangeSeconds === null ? start : Math.max(now - rangeSeconds, start);
  const zoomEnd = rangeSeconds === null ? end : now;

  // The addon's sampling: the first and last time, and between them a time
  // more than one step past the last kept one and more than a step from the end.
  const step = Math.ceil((zoomEnd - zoomStart) / MAX_PLOT_POINTS / MINUTE) * MINUTE;
  const points: [number, number][] = [];
  let kept: number | undefined;
  for (let x = zoomStart; ; x = Math.min(x + step, zoomEnd)) {
    if (kept === undefined || x === zoomEnd || (x - kept > step && zoomEnd - x > step)) {
      points.push([x * 1000, goldAt(logs, x)]);
      kept = x;
    }
    if (x >= zoomEnd) break;
  }

  const current = goldAt(logs, end);
  let high = current, low = current;
  for (let t = Math.max(end - STATS_PERIOD, start); t <= end; t += STATS_SAMPLE) {
    const value = goldAt(logs, t);
    high = Math.max(high, value);
    low = Math.min(low, value);
  }
  return { points, high, low, dailyChange: current - goldAt(logs, Math.max(end - DAY, start)) };
}
