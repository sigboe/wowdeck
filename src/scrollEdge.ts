/**
 * Whether a vertical scroller can still move in a direction, with Steam's own
 * 2 px tolerance (its ScrollPanel's onGamepadDirection, read from sp.js).
 * Used to decide when a D-pad press is ours (scroll, no sound) and when it
 * should fall through to Steam, which then plays its "can't move" bell.
 */
export const SCROLL_EDGE_PX = 2;

export function canScroll(
  direction: "up" | "down",
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
): boolean {
  return direction === "up"
    ? el.scrollTop > SCROLL_EDGE_PX
    : el.scrollTop < el.scrollHeight - el.clientHeight - SCROLL_EDGE_PX;
}
