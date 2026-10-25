import type { ReactNode } from "react";
import { Field } from "@decky/ui";
import { descriptionStyle } from "../steamTheme";

/**
 * A text field the way Steam's own settings show one (guide S28): a Field row
 * with the label and description, the unlabelled input as the row's control,
 * so the whole row lights up while it has focus. Steam's Keyboard settings do
 * this: input inline on the right of a 12 x 20 px padded row (DEVICE,
 * 2026-10-16). TextField's own `label` (DialogInputLabelGroup, label above, no
 * row) is the login-dialog pattern and lit only the input, so it looked
 * different from every other row. `layout="below"` in the QAM, which is too
 * narrow for an inline input; inline in dialogs and pages, like Valve.
 */
export function TextRow({
  label,
  description,
  layout = "below",
  children,
}: {
  label: string;
  description?: ReactNode;
  layout?: "below" | "inline";
  children: ReactNode;
}) {
  return (
    <Field
      label={label}
      description={description ? <span style={descriptionStyle}>{description}</span> : undefined}
      childrenLayout={layout === "below" ? "below" : "inline"}
      childrenContainerWidth={layout === "below" ? "max" : "fixed"}
    >
      {children}
    </Field>
  );
}
