import { describe, expect, test } from "bun:test";
import { barInsets, type BarRect } from "./qamBars";

/** The QAM window and Steam's bars in it, as measured (DEVICE 2026-11-14). */
const viewport = { width: 855, height: 845 };
const rect = (top: number, height: number, width = 854): BarRect => ({
  top,
  bottom: top + height,
  width,
  height,
});
const statusBar = rect(0, 39.99);
const buttonBar = rect(803.56, 41.75);

describe("the pane's insets from Steam's bars", () => {
  test("a game running: the status bar on top, the button bar below", () => {
    expect(barInsets([statusBar, rect(0, 39.99)], [buttonBar], viewport)).toEqual({
      top: 40,
      bottom: 41,
    });
  });

  test("no game: nothing of Steam's over the pane", () => {
    expect(barInsets([], [], viewport)).toEqual({ top: 0, bottom: 0 });
  });

  test("shapes that aren't bars don't count", () => {
    const fullHeight = rect(0, 845);
    const narrowBadge = rect(0, 30, 120);
    const belowTheTop = rect(12, 30);
    const aboveTheBottom = rect(700, 40);
    expect(
      barInsets([fullHeight, narrowBadge, belowTheTop], [fullHeight, aboveTheBottom], viewport),
    ).toEqual({ top: 0, bottom: 0 });
  });
});
