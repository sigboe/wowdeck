import { STEAM } from "../steamTheme";
import { DOT_FILL, DOT_SIZE_PX, type DotColor } from "../updateDot";

/**
 * The update dot (updateDot.ts): pinned to the top-right corner of its
 * anchor, which must be positioned (`.wowdeck-tab` is). Off draws nothing.
 * On a tab pill the corner falls on the pill's rounded edge, so the dot
 * straddles the pill and the dark QAM; a thin dark ring, drawn outside the
 * 10 px fill, keeps the half on a focused (white) pill readable (orange on
 * white alone is ~2:1).
 */
export function UpdateDot({ color }: { color?: DotColor | null }) {
  if (!color) {
    return null;
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: `${DOT_SIZE_PX}px`,
        height: `${DOT_SIZE_PX}px`,
        borderRadius: "50%",
        background: DOT_FILL[color],
        boxShadow: `0 0 0 1.5px ${STEAM.row}`,
        pointerEvents: "none",
      }}
    />
  );
}
