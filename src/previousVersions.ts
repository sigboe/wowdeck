import { formatBytes } from "./wtfFormat";

/** What rollback.status answers: the kept previous versions over every installation. */
export interface PreviousVersionsUsage {
  bytes: number;
  count: number;
}

/** "12 MB for 4 addons", or "None kept". */
export function previousVersionsUsageLine(usage: PreviousVersionsUsage): string {
  return usage.count
    ? `${formatBytes(usage.bytes)} for ${usage.count} addon${usage.count === 1 ? "" : "s"}`
    : "None kept";
}

/**
 * The Options › Updates "Previous versions" row's description (#207):
 * whether retention is on, then the space kept versions use. Off names the
 * space only while versions kept from before are still there to clear;
 * usage not answered yet shows the setting alone.
 */
export function previousVersionsSummary(
  keep: boolean,
  usage: PreviousVersionsUsage | null,
): string {
  if (!keep) {
    return usage?.count ? `Off · ${previousVersionsUsageLine(usage)}` : "Off";
  }
  return usage ? `On · ${previousVersionsUsageLine(usage)}` : "On";
}
