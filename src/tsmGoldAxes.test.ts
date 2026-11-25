import { describe, expect, test } from "bun:test";
import {
  goldAxisLabel,
  goldXAxis,
  goldYAxis,
  X_LABEL_SPACING,
  Y_LINE_SPACING,
} from "./tsmGoldAxes";

const G = 10_000;

describe("goldAxisLabel", () => {
  test("writes gold as the addon's graph does, Retail from thousands", () => {
    expect(goldAxisLabel(0, false)).toBe("0g");
    expect(goldAxisLabel(999 * G + 9_999, false)).toBe("999g");
    expect(goldAxisLabel(1_280 * G, false)).toBe("1.28kg");
    expect(goldAxisLabel(12_800 * G, false)).toBe("12kg");
    expect(goldAxisLabel(2_500_000 * G, false)).toBe("2.50Mg");
    expect(goldAxisLabel(25_000_000 * G, false)).toBe("25Mg");
    expect(goldAxisLabel(0, true)).toBe("0kg");
    expect(goldAxisLabel(1_280 * G, true)).toBe("1kg");
  });
});

describe("goldYAxis", () => {
  test("pads 0g to 3g up to 4g and keeps the gridlines that fit their spacing", () => {
    // The in-game graph of the owner's character (2026-11-25): 0g to 3g.
    const tall = goldYAxis([0, 2 * G, 3 * G], 200, false);
    expect([tall.min, tall.max]).toEqual([0, 4 * G]);
    expect(tall.lines.map((l) => l.label)).toEqual(["0g", "1g", "2g", "3g", "4g"]);
    // A shorter plot keeps every other one.
    const short = goldYAxis([0, 2 * G, 3 * G], 96, false);
    expect(short.lines.map((l) => l.label)).toEqual(["0g", "2g", "4g"]);
    for (const [a, b] of short.lines.slice(1).map((l, i) => [short.lines[i]!, l] as const)) {
      expect(b.offset - a.offset).toBeGreaterThanOrEqual(Y_LINE_SPACING);
    }
  });

  test("starts the range at the lowest value rounded down to its step", () => {
    const axis = goldYAxis([1_234 * G, 1_734 * G], 96, false);
    expect(axis.min).toBe(1_200 * G);
    expect(axis.max).toBe(1_800 * G);
    expect(axis.lines[0]!.label).toBe("1.20kg");
    expect(axis.lines[axis.lines.length - 1]!.copper).toBeLessThanOrEqual(axis.max);
  });

  test("gives a flat line a step of room and Retail steps of 1,000g", () => {
    expect(goldYAxis([5 * G], 96, false)).toMatchObject({ min: 5 * G, max: 6 * G });
    const retail = goldYAxis([0, 3_000 * G], 96, true);
    expect([retail.min, retail.max]).toEqual([0, 4_000 * G]);
    expect(retail.lines.map((l) => l.label)).toEqual(["0kg", "2kg", "4kg"]);
  });

  test("keeps the edge labels inside the plot", () => {
    const axis = goldYAxis([0, 3 * G], 96, false);
    expect(axis.lines.map((l) => l.align)).toEqual(["start", "center", "end"]);
  });
});

describe("goldXAxis", () => {
  const at = (month: number, day: number, hour = 0, minute = 0) =>
    new Date(2026, month, day, hour, minute).getTime();

  test("labels days every few days when a label's spacing covers more than two days", () => {
    // The in-game graph's span: 9 Nov 14:00 to 25 Nov 12:02.
    const ticks = goldXAxis(at(10, 9, 14), at(10, 25, 12, 2), 260);
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) {
      expect(new Date(tick.at).getHours()).toBe(0);
      expect(tick.label).toMatch(/^\d{1,2} Nov$/);
    }
    for (const [a, b] of ticks.slice(1).map((t, i) => [ticks[i]!, t] as const)) {
      expect(b.offset - a.offset).toBeGreaterThan(X_LABEL_SPACING);
    }
  });

  test("labels weekdays, hours or months by the span", () => {
    expect(goldXAxis(at(10, 20, 12), at(10, 25, 12), 300).map((t) => t.label)).toEqual([
      "Sat",
      "Mon",
      "Wed",
    ]);
    expect(goldXAxis(at(10, 25, 9, 30), at(10, 25, 18), 300).map((t) => t.label)).toEqual([
      "11:00",
      "15:00",
    ]);
    const year = goldXAxis(at(0, 10), at(10, 25), 300).map((t) => t.label);
    expect(year.every((label) => /^[A-Z][a-z]{2} 2026$/.test(label))).toBe(true);
  });

  test("labels a day in hours even on a plot too narrow for the addon's rule", () => {
    // The QAM's plot on the Deck (DEVICE 2026-11-25): the addon would show one weekday.
    const day = goldXAxis(at(10, 24, 12, 2), at(10, 25, 12, 2), 430).map((t) => t.label);
    expect(day).toEqual(["14:00", "20:00", "02:00", "08:00"]);
    // Past a day the addon's rule holds.
    expect(goldXAxis(at(10, 24, 12), at(10, 25, 13), 430).map((t) => t.label)).toEqual(["Wed"]);
  });

  test("keeps the edge labels inside the plot and draws none without a span or a width", () => {
    const ticks = goldXAxis(at(10, 9, 23), at(10, 25, 1), 260);
    expect(ticks[0]!.align).toBe("start");
    expect(goldXAxis(at(10, 25), at(10, 25), 260)).toEqual([]);
    expect(goldXAxis(at(10, 9), at(10, 25), 0)).toEqual([]);
  });
});
