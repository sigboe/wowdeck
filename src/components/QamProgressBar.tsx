import { ProgressBarWithInfo, type ProgressBarWithInfoProps } from "@decky/ui";

/**
 * Steam's progress row sized for the QAM (guide S32). ProgressBarWithInfo is
 * a Field laid out inline: a label column, then the bar in a column with a
 * 270 px minimum width, so in the QAM's 268 px row the bar ran ~136 px past
 * the panel's edge (DEVICE, in-memory render, 2026-10-16). `layout="below"`
 * is ignored by this component; a full-width children column is what fits
 * (bar 244 px inside Steam's 12 px row padding). No label: the operation
 * text says what is running.
 */
export function QamProgressBar(
  props: Omit<ProgressBarWithInfoProps, "label" | "childrenContainerWidth">,
) {
  return <ProgressBarWithInfo {...props} childrenContainerWidth="max" />;
}
