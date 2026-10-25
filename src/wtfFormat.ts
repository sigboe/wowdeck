import type { WtfBackupInfo } from "./types";
import { dayMonth, plural } from "./text";

/** "412 MB", "38 KB", "1.4 MB" — decimal units, one decimal only below 10. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1000) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative time, spelled out (C10): "3 minutes ago", "5 hours ago"; "14 Oct" after a week. */
export function formatWhen(epochMs: number, now: number): string {
  const diff = now - epochMs;
  if (diff < -MIN) {
    return dayMonth(new Date(epochMs), new Date(now));
  }
  if (diff < MIN) {
    return "just now";
  }
  if (diff < HOUR) {
    return `${plural(Math.floor(diff / MIN), "minute")} ago`;
  }
  if (diff < DAY) {
    return `${plural(Math.floor(diff / HOUR), "hour")} ago`;
  }
  if (diff < 2 * DAY) {
    return "yesterday";
  }
  if (diff < 7 * DAY) {
    return `${Math.floor(diff / DAY)} days ago`;
  }
  return dayMonth(new Date(epochMs), new Date(now));
}

/**
 * Where a backup came from, for a green/red line: green = made by this plugin install on this
 * device, red = another computer (another install, or desktop WowUp). Null for a damaged backup.
 */
export function backupOrigin(
  info: Pick<WtfBackupInfo, "fromThisDevice" | "flavor" | "valid">,
): { text: string; good: boolean } | null {
  if (!info.valid) {
    return null;
  }
  if (info.fromThisDevice) {
    return { text: "From this device", good: true };
  }
  return {
    text: info.flavor === null ? "From another computer (WowUp)" : "From another computer",
    good: false,
  };
}

/** Short badge text for a backup row. */
export function backupKindLabel(info: Pick<WtfBackupInfo, "kind" | "flavor" | "valid">): string {
  if (!info.valid) {
    return "Damaged";
  }
  switch (info.kind) {
    case "pre-restore":
      return "Safety backup";
    case "auto":
      return "Automatic";
    case "manual":
      return info.flavor === null ? "From WowUp" : "Manual";
    default:
      return "Other";
  }
}
