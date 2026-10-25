/**
 * Steam's scroll room around a focused row, everywhere (guide S21).
 *
 * Steam's focus scroller keeps the row clear by the container's
 * `scroll-padding` plus the row's own `scroll-margin` (read from the client,
 * 2026-10-15). Steam's settings pages use the big buffer: 250 px above, 60 px
 * below (`PagedSettingsDialog_PageContent`). Owner decision 2026-10-15: every
 * view gets that buffer, measured from the bottom of whatever floats over the
 * top of the scroller (Decky's sticky title in the QAM), so the row lands
 * 250 px below the last floating thing.
 */
export const VALVE_SCROLL_BUFFER = { top: 250, bottom: 60 } as const;

/**
 * The `scroll-margin` our rows need, with Neovim `scrolloff` semantics (owner,
 * 2026-10-15): on every move Steam scrolls just enough to keep the focused row
 * at least the buffer away from the top (below the floating panes) and the
 * bottom of the visible list. Like `scrolloff`, the buffer is capped so that
 * buffer + row + buffer fits in the visible list; if it did not, Steam's
 * scroll-into-view (block "nearest") either did nothing or jumped (DEVICE frame
 * recording 2026-10-15: QAM list 440 px tall, 270 + 12 px margins, rows
 * sliding off the top, then a 504 px jump). Valve's 250/60 px applies when
 * there is room; on a short list the row stays near the middle instead.
 */
export function scrollMargins(input: {
  /** Distance from the scroller's top edge to the bottom of the lowest floating pane. */
  floatingTop: number;
  /** The scroller's own scroll-padding (Steam's, already honoured). */
  paddingTop: number;
  paddingBottom: number;
  /** The scroller's visible height (clientHeight). */
  viewportHeight: number;
  /** Height of the tallest ordinary row (capped by the caller). */
  rowHeight: number;
}): { top: number; bottom: number } {
  const { floatingTop, paddingTop, paddingBottom, viewportHeight, rowHeight } = input;
  // Room around one row inside the part of the list that is not covered.
  const room = Math.max(0, viewportHeight - floatingTop - rowHeight);
  const bottomBuffer = Math.max(
    Math.min(paddingBottom, room),
    Math.min(VALVE_SCROLL_BUFFER.bottom, Math.floor(room / 2)),
  );
  const topBuffer = Math.max(0, Math.min(VALVE_SCROLL_BUFFER.top, room - bottomBuffer));
  return {
    top: Math.max(0, Math.round(floatingTop + topBuffer - paddingTop)),
    bottom: Math.max(0, Math.round(bottomBuffer - paddingBottom)),
  };
}

/** Bottom of the lowest overlay, relative to the scroller's top (0 when none overlap it). */
export function floatingTop(scrollerTop: number, overlayBottoms: number[]): number {
  return Math.max(0, ...overlayBottoms.map((b) => b - scrollerTop));
}

/**
 * Extra top padding so content starts below floating panes that cover more of
 * the scroller than its own padding already leaves free (e.g. our page bar
 * wrapping to a second line under Steam's fixed 58 + 60 px header padding).
 */
export function contentOverlap(floatingTop: number, scrollerPaddingTop: number): number {
  return Math.max(0, Math.round(floatingTop - scrollerPaddingTop));
}

/**
 * How far a computed `box-shadow` reaches below its box: offset-y + blur +
 * spread of the largest non-inset shadow. Decky's QAM title has
 * `rgb(14, 20, 27) 0px 0px 7px 12px`, a fade of 19 px over whatever is below.
 */
export function shadowReach(boxShadow: string | null | undefined): number {
  if (!boxShadow || boxShadow === "none") {
    return 0;
  }
  let reach = 0;
  // Shadows are comma-separated; colours like rgb(…) contain commas too.
  for (const part of boxShadow.split(/,(?![^(]*\))/)) {
    if (/inset/.test(part)) {
      continue;
    }
    const nums = (part.replace(/(rgba?|hsla?)\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []).map(
      parseFloat,
    );
    const [, offsetY = 0, blur = 0, spread = 0] = nums;
    reach = Math.max(reach, offsetY + blur + spread);
  }
  return reach;
}
