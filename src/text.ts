/**
 * Small helpers for user-facing copy (guide §7.3 copy rules C01–C12).
 * English only, fixed formats, so tests are deterministic.
 */

import type { OperationResult } from "./types";

/** "1 addon", "3 addons" (C02: never "addon(s)"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Oct" this year, "14 Oct 2024" another year (C10). */
export function dayMonth(date: Date, now: Date): string {
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** "today at 14:32", "yesterday at 09:05", "14 Oct at 14:32" (C10). */
export function dayAndTime(epochMs: number, now: number): string {
  const date = new Date(epochMs);
  const today = new Date(now);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (epochMs >= startOfToday) {
    return `today at ${time}`;
  }
  if (epochMs >= startOfToday - 24 * 60 * 60 * 1000) {
    return `yesterday at ${time}`;
  }
  return `${dayMonth(date, today)} at ${time}`;
}

/** "A, B" or "A, B +3": at most two names (C11). */
function shortList(list: string[]): string {
  return list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

/** Said when a result says an installation's addons are paused for recovery (ADR 0006). */
export const RECOVERY_NOTE = "This installation needs recovery before its addons can change.";

/**
 * Toast after Update all (C11): how many were updated, which weren't (by
 * name when the engine gives names, #110), and whether an installation now
 * needs recovery or temporary files are left.
 */
export function updateAllToast(operations: OperationResult[]): [string, string] {
  const updated = operations.filter((o) => o.status === "updated").length;
  const failed = operations.filter((o) => o.status === "failed");
  if (updated === 0 && failed.length === 0) {
    return ["All addons are up to date", ""];
  }
  const names = failed.map((o) => o.addonName).filter((n): n is string => !!n);
  const notUpdated = !failed.length
    ? ""
    : names.length === failed.length
      ? `Not updated: ${shortList(names)}.`
      : updated
        ? `${plural(failed.length, "addon")} couldn't be updated.`
        : "";
  const leftovers = operations.some((o) => o.status !== "failed" && o.cleanupWarning);
  const body = [
    notUpdated,
    failed.some((o) => o.recoveryRequired)
      ? "An installation needs recovery before its addons can change."
      : "",
    leftovers ? LEFTOVERS_NOTE : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    updated
      ? `Updated ${plural(updated, "addon")}`
      : `Couldn't update ${plural(failed.length, "addon")}`,
    body,
  ];
}

/**
 * After a removal: the libraries it left unneeded that went with it and the
 * ones that couldn't (#110), and whether the installation now needs recovery.
 */
export function followUpNote(operation: OperationResult): string {
  const followUps = operation.followUps ?? [];
  const named = (status: OperationResult["status"]) =>
    followUps.filter((o) => o.status === status).map((o) => o.addonName ?? "a library");
  const removed = named("removed");
  const failed = named("failed");
  return [
    removed.length ? `Also removed ${shortList(removed)}.` : "",
    failed.length ? `Couldn't remove ${shortList(failed)}.` : "",
    followUps.some((o) => o.recoveryRequired) ? RECOVERY_NOTE : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One addon-list import entry's line in the results list: its outcome and its dependencies' (#110). */
export function importResultLine(operation: OperationResult): string {
  if (operation.status === "failed") {
    return `failed, ${operation.error ?? "unknown error"}`;
  }
  const missing = (operation.followUps ?? [])
    .filter((o) => o.status === "failed")
    .map((o) => o.addonName ?? "another addon");
  if (missing.length) {
    return `installed, but ${shortList(missing)}, which it needs, couldn't be installed`;
  }
  return cleanupNote("installed", operation);
}

const LEFTOVERS_NOTE = "Some temporary files are left; they're removed at the next addon change.";

/**
 * A success toast's body with the operation's cleanup warning after it: the
 * operation succeeded, only its temporary files or marker are left (#105).
 */
export function cleanupNote(body: string, operation: { cleanupWarning?: string }): string {
  if (!operation.cleanupWarning) {
    return body;
  }
  return body
    ? `${/[.!?]$/.test(body) ? body : `${body}.`} ${operation.cleanupWarning}`
    : operation.cleanupWarning;
}

/**
 * Under "Update automatically": the last run, said plainly (C10, C11):
 * "Last run today at 14:32: updated DBM, Plater +1".
 */
export function lastAutoUpdateLine(
  r: { at: number; updated: string[]; failed: string[]; skipped: string | null },
  now: number,
): string {
  const names = shortList;
  const what = r.skipped
    ? `postponed (${r.skipped})`
    : [
        r.updated.length ? `updated ${names(r.updated)}` : "",
        r.failed.length ? `couldn't update ${names(r.failed)}` : "",
      ]
        .filter(Boolean)
        .join("; ") || "nothing to update";
  return `Last run ${dayAndTime(r.at, now)}: ${what}`;
}
