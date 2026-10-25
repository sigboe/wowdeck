/**
 * Small helpers for user-facing copy (guide §7.3 copy rules C01–C12).
 * English only, fixed formats, so tests are deterministic.
 */

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

/** Toast after Update all (C11): what happened to how many. */
export function updateAllToast(updated: number, failed: number): [string, string] {
  if (updated === 0 && failed === 0) {
    return ["All addons are up to date", ""];
  }
  if (updated === 0) {
    return [`Couldn't update ${plural(failed, "addon")}`, ""];
  }
  return [
    `Updated ${plural(updated, "addon")}`,
    failed ? `${plural(failed, "addon")} couldn't be updated` : "",
  ];
}

/**
 * Under "Update automatically": the last run, said plainly (C10, C11):
 * "Last run today at 14:32: updated DBM, Plater +1".
 */
export function lastAutoUpdateLine(
  r: { at: number; updated: string[]; failed: string[]; skipped: string | null },
  now: number,
): string {
  const names = (list: string[]) =>
    list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
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
