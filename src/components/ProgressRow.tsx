import { ProgressBarWithInfo, type ProgressBarWithInfoProps } from "@decky/ui";

/**
 * Field props Steam's ProgressBarWithInfo passes through but @decky/ui's
 * ItemProps leaves untyped.
 */
interface UntypedFieldProps {
  focusable?: boolean;
  preferredFocus?: boolean;
  onCancelButton?: () => void;
  onCancelActionDescription?: string;
}

/**
 * Steam's progress row, used as the row itself (guide S32). ProgressBarWithInfo
 * is already a focusable Field: a label column, then the bar in a column with
 * a 270 px minimum width. Inline, in the QAM's 268 px row, the bar ran ~136 px
 * past the panel's edge (DEVICE, 2026-10-16). Wrapped in another Field, the
 * bar sat in a narrow right column and its text wrapped (DEVICE, 2026-11-12).
 * So: never wrap it; the label goes above (`childrenLayout="below"`) and the
 * bar takes the full width (244 of 244 px in the QAM, 584 of 584 in a modal).
 * Row actions (B cancels) go straight on it.
 */
export function ProgressRow({
  label,
  ...props
}: Omit<ProgressBarWithInfoProps, "childrenContainerWidth" | "layout"> & UntypedFieldProps) {
  const row = {
    ...props,
    label,
    childrenContainerWidth: "max",
    ...(label === undefined ? {} : { childrenLayout: "below" }),
  } as ProgressBarWithInfoProps;
  return <ProgressBarWithInfo {...row} />;
}
