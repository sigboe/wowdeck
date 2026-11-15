import { Field, Spinner } from "@decky/ui";
import type { ReactNode } from "react";
import { STEAM } from "../steamTheme";
import type { UpdateAllRowView } from "../text";
import { ProgressRow } from "./ProgressRow";

/**
 * One line of text that ends in "…" at the row's edge instead of widening
 * it. Steam's progress row sizes its columns to their content, so a long
 * name pushed the bar past the panel (S32, DEVICE 2026-11-14). A grid
 * column of minmax(0, max-content) has no minimum width, so the row can
 * shrink it to the space it has.
 */
function FitText({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "grid", gridTemplateColumns: "minmax(0, max-content)" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children || " "}
      </span>
    </span>
  );
}

/**
 * Update all's row while it runs (#253, S17), laid out like Steam's
 * downloads: the status in Steam's blue capitals over the bar, and the
 * addon being updated under it. Without a bar, a spinner leads the status
 * and an empty track of the bar's height keeps the row the same size, so
 * nothing below it moves.
 */
export function UpdateAllRow({ view }: { view: UpdateAllRowView }) {
  const description = <FitText>{view.addon}</FitText>;
  if (view.percent !== null) {
    return (
      // Focusable, so focus has a stop here like the spinner row's.
      <ProgressRow
        focusable
        description={description}
        nProgress={view.percent}
        sOperationText={<FitText>{view.status}</FitText>}
        bottomSeparator="none"
      />
    );
  }
  return (
    // Focusable like Steam's progress row, so focus has somewhere to wait
    // while the pressed button is gone (InstalledView's FocusSlot).
    <Field
      focusable
      description={description}
      childrenLayout="below"
      childrenContainerWidth="max"
      bottomSeparator="none"
    >
      <div
        style={{
          // Right-aligned, where Steam's progress row puts its status.
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "6px",
          height: "22px",
          color: STEAM.primary,
          fontSize: "13px",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        <Spinner style={{ width: "1em", flex: "none" }} />
        <FitText>{view.status}</FitText>
      </div>
      <div style={{ height: "8px" }} />
    </Field>
  );
}
