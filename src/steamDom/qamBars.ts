/**
 * Keeps the widened Get Addons pane clear of Steam's bars inside the QAM
 * window.
 *
 * Depends on: Steam drawing its status bar (clock, battery) and its button
 * bar inside the QAM window while a game runs, as hit-testable elements
 * stacked over the panel (DEVICE 2026-11-14, Tower Wizard running: status
 * bar 40 CSS px at the top, z-index 6000, background see-through; button bar
 * about 42 px at the bottom, z-index 7000; the main window's
 * `--basicui-header-height` drops to 0 and the QAM takes the full screen
 * height). Without a game both bars sit outside the QAM window, so nothing
 * of Steam's is over the pane and the insets are 0.
 * Fails as: a bar Steam draws differently (not hit-testable, not full
 * width) is not found: the pane keeps its 0 inset and runs under the bar,
 * as it did before this module. Nothing throws.
 * Kill switch: none needed; drop the `usePaneBarInsets` call.
 *
 * No class names: the bars are found by geometry. `elementsFromPoint` at the
 * pane's right edge, one pixel inside the window's top and bottom, returns
 * everything painted there; whatever is neither the pane, inside it, nor
 * one of its ancestors and spans the window like a bar is Steam's.
 */

import { useEffect, type RefObject } from "react";

export interface BarRect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface BarInsets {
  top: number;
  bottom: number;
}

/** A bar is short and spans most of the window's width. */
const MAX_BAR_HEIGHT = 100;
const MIN_BAR_WIDTH_SHARE = 0.5;

/**
 * The insets the pane needs from Steam's elements found at its top and
 * bottom edges: the lowest bottom of a bar touching the window's top, and
 * the distance from the highest top of a bar touching the window's bottom.
 * Rects that aren't bar-shaped (a full-height panel, a narrow badge) don't
 * count.
 */
export function barInsets(
  atTop: readonly BarRect[],
  atBottom: readonly BarRect[],
  viewport: { width: number; height: number },
): BarInsets {
  const isBar = (r: BarRect) =>
    r.height > 0 && r.height <= MAX_BAR_HEIGHT && r.width >= viewport.width * MIN_BAR_WIDTH_SHARE;
  const top = atTop
    .filter((r) => isBar(r) && r.top <= 1)
    .reduce((inset, r) => Math.max(inset, r.bottom), 0);
  const bottom = atBottom
    .filter((r) => isBar(r) && r.bottom >= viewport.height - 1)
    .reduce((inset, r) => Math.max(inset, viewport.height - r.top), 0);
  return { top: Math.round(top), bottom: Math.round(bottom) };
}

/** Steam's elements painted at (x, y) that aren't the pane or its own tree. */
function foreignRects(pane: HTMLElement, doc: Document, x: number, y: number): BarRect[] {
  return doc
    .elementsFromPoint(x, y)
    .filter((el) => !el.contains(pane) && !pane.contains(el))
    .map((el) => el.getBoundingClientRect());
}

/** The pane's current insets, or 0/0 when the window can't be read. */
export function measureBarInsets(pane: HTMLElement): BarInsets {
  try {
    const doc = pane.ownerDocument;
    const win = doc.defaultView;
    if (!win || typeof doc.elementsFromPoint !== "function") {
      return { top: 0, bottom: 0 };
    }
    const width = win.innerWidth;
    const height = win.innerHeight;
    const x = width - 4;
    return barInsets(foreignRects(pane, doc, x, 1), foreignRects(pane, doc, x, height - 1), {
      width,
      height,
    });
  } catch (err) {
    console.warn("wowdeck: can't measure Steam's bars over the pane", err);
    return { top: 0, bottom: 0 };
  }
}

/**
 * While `open`, measures Steam's bars over the pane and sets
 * `--wowdeck-bar-top` / `--wowdeck-bar-bottom` on it, again whenever the
 * QAM window resizes (a game starting or quitting changes its height).
 */
export function usePaneBarInsets(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    const pane = ref.current;
    const win = pane?.ownerDocument.defaultView;
    if (!pane || !open) {
      return;
    }
    const apply = () => {
      const insets = measureBarInsets(pane);
      pane.style.setProperty("--wowdeck-bar-top", `${insets.top}px`);
      pane.style.setProperty("--wowdeck-bar-bottom", `${insets.bottom}px`);
    };
    apply();
    win?.addEventListener("resize", apply);
    return () => win?.removeEventListener("resize", apply);
  }, [ref, open]);
}
