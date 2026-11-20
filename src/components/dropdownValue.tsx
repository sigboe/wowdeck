import type { ReactNode } from "react";

/**
 * Keeps a dropdown's shown value inside its button (guide S27). Steam's
 * dropdown button grows with its value and does not truncate: a long value
 * ran 63 px past the button and 47 px past the row's focus highlight (DEVICE
 * audit, 2026-10-15). For values that are user data (installation names,
 * categories) pass this as `renderButtonValue`; Valve truncates long names
 * the same way ("Xbox Wireless Cont…" in Quick Settings).
 */
export function ellipsisValue(maxWidth: string) {
  return (value: ReactNode) => (
    <span
      style={{
        display: "block",
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

/** QAM row dropdowns: the label column keeps at least half of the 268 px row. */
export const QAM_DROPDOWN_VALUE = ellipsisValue("120px");
/**
 * A label-less QAM dropdown: the button spans the 268 px row, so the value
 * gets all of it but the arrow. For user data that runs long, like
 * installation names.
 */
export const QAM_DROPDOWN_BELOW_VALUE = ellipsisValue("200px");
/** The widened pane's content width: the QAM less the 348 px list column and the insets. */
const WIDE_PANE = "(100vw - 348px - 60px)";

/**
 * A browse bar segment's button (BrowseBar): half the widened pane — the
 * QAM's width less the 348 px list column, the pane's and row's insets and
 * the 12 px gap — less the button's padding and arrow.
 */
export const BAR_DROPDOWN_VALUE = ellipsisValue(`calc(${WIDE_PANE} / 2 - 56px)`);
/**
 * A segment button spanning the widened pane (the Controller layouts
 * destination's layout target): the pane's width less its insets, the
 * button's padding and the arrow.
 */
export const PANE_DROPDOWN_VALUE = ellipsisValue(`calc(${WIDE_PANE} - 56px)`);
