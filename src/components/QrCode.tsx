import { useMemo } from "react";
import { qrCode } from "../qr";

/**
 * The shared QR code: any URL, drawn as crisp SVG, black on white whatever
 * the theme, since phone cameras read dark-on-light codes most reliably.
 * Decorative for screen readers: the URL is always printed next to it.
 */
export function QrCode({ value, size = 128 }: { value: string; size?: number }) {
  const shape = useMemo(() => qrCode(value), [value]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{
        // Inline, so Steam's Field rule for a child svg (height: 1em) can't
        // shrink the code to icon size.
        width: size,
        height: size,
        display: "block",
        flexShrink: 0,
        background: "#fff",
        paddingTop: 4,
        paddingRight: 4,
        paddingBottom: 4,
        paddingLeft: 4,
        borderRadius: 4,
      }}
    >
      <path d={shape.path} fill="#000" />
    </svg>
  );
}
