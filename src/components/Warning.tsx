/**
 * A warning inside a row's description (guide S38, recipe R9): an amber
 * icon and a heading in primary text that says what is happening, then
 * indented secondary lines that explain it or say what to do. The words
 * carry the meaning; amber on the icon only backs them up.
 */
import type { ReactNode } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { STEAM, descriptionStyle } from "../steamTheme";

/** The icon's width plus its gap: the lines under the heading start where its words do. */
const ICON = "12px";
const GAP = "6px";
const INDENT = `calc(${ICON} + ${GAP})`;

export function Warning({ heading, children }: { heading: string; children?: ReactNode }) {
  return (
    <div role="note" style={{ marginTop: "4px" }}>
      <div
        style={{
          ...descriptionStyle,
          color: STEAM.text,
          display: "flex",
          alignItems: "center",
          gap: GAP,
        }}
      >
        <FaExclamationTriangle
          aria-hidden
          style={{ color: STEAM.warning, flex: "none", width: ICON, height: ICON }}
        />
        <span>{heading}</span>
      </div>
      {children && <div style={{ paddingLeft: INDENT }}>{children}</div>}
    </div>
  );
}

/**
 * One secondary line under a Warning heading. `level` indents it one step
 * further per level: a row's own detail under that row (the conflict
 * card's folders under each addon), instead of tree connector characters.
 */
export function WarningLine({ text, level = 0 }: { text: string; level?: number }) {
  return (
    <div
      style={{ ...descriptionStyle, paddingLeft: level ? `calc(${level} * ${INDENT})` : undefined }}
    >
      {text}
    </div>
  );
}
