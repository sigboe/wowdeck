import type { UpdateAllProgress } from "../backend/src/api/contracts";
import { dayAndTime, plural, updateAllRow } from "./text";

/**
 * What the WoW addons box on Steam's game page shows (#252), as data: the
 * component draws it and nothing else, so every state is tested here.
 *
 * The box keeps one height in every state (owner, 2026-11-26: design the
 * content around the box, never the box around the content): line 1 says
 * the state, line 2 the detail, and the bar lives in space the box always
 * reserves. One action button changes its job with the state; Update all
 * checks every installation before it updates (`addons.updateAll`
 * `allInstallations`), so Check for updates only shows when nothing waits.
 */

/** A run of line-1 text; `count` is Steam's bold green (its "Verified"). */
export type BoxText = { text: string; tone?: "strong" | "count" };

export interface GamePageBoxAction {
  label: "Update all" | "Check for updates";
  /** Steam's blue: something waits for the player. Grey otherwise. */
  primary: boolean;
  /** A check or a run is going on: the button stays a focus stop and A does nothing. */
  inert: boolean;
}

export interface GamePageBoxView {
  spinner: boolean;
  line1: BoxText[];
  line2: string;
  /** 0–100 for a determinate bar, null for none. */
  percent: number | null;
  action: GamePageBoxAction;
}

export interface GamePageBoxInput {
  /** Updates per installation (`addons.updateSummary`); null until the first read. */
  summary: { displayName: string; updates: number }[] | null;
  /** A check for updates is running (steamUpdates). */
  checking: boolean;
  /** When the last check finished, if this session saw one. */
  checkedAt: number | null;
  now: number;
  /** The addon session's Update all run, from either view. */
  run: { scope: "installation" | "all"; progress: UpdateAllProgress | null } | null;
}

const strong = (text: string): BoxText => ({ text, tone: "strong" });
const plain = (text: string): BoxText => ({ text });

/** Line 2 when no run is going on: what was checked, and when. */
function detail(
  summary: { displayName: string; updates: number }[],
  checkedAt: number | null,
  now: number,
): string {
  const checked = checkedAt === null ? null : `Checked ${dayAndTime(checkedAt, now)}`;
  const withUpdates = summary.filter((i) => i.updates > 0);
  if (withUpdates.length > 0 && summary.length > 1) {
    return withUpdates.map((i) => `${i.displayName} ${i.updates}`).join(" · ");
  }
  const where =
    summary.length === 1
      ? summary[0]!.displayName
      : summary.length > 1
        ? plural(summary.length, "installation")
        : null;
  if (withUpdates.length > 0) {
    return checked ?? where ?? "";
  }
  return [checked, where].filter(Boolean).join(" · ");
}

export function gamePageBoxView(input: GamePageBoxInput): GamePageBoxView {
  const { summary, checking, checkedAt, now, run } = input;
  const total = summary?.reduce((n, i) => n + i.updates, 0) ?? 0;
  const action: GamePageBoxAction =
    run || total > 0
      ? { label: "Update all", primary: true, inert: run !== null || checking }
      : { label: "Check for updates", primary: false, inert: checking };

  if (run) {
    // My Addons' own wording (updateAllRow), word for word.
    const row = updateAllRow(run.progress, run.scope);
    const waiting = !run.progress && run.scope === "all";
    return {
      spinner: row.percent === null && !row.status.startsWith("Done"),
      line1: [plain(row.status)],
      line2: row.addon || (waiting ? "All installations" : ""),
      percent: row.percent,
      action,
    };
  }
  const line2 = summary ? detail(summary, checkedAt, now) : "Loading…";
  if (checking) {
    return { spinner: true, line1: [plain("Checking for updates…")], line2, percent: null, action };
  }
  const line1 =
    total > 0
      ? [
          strong("WoW addons"),
          plain(" · "),
          { text: plural(total, "update"), tone: "count" as const },
          plain(" ready"),
        ]
      : summary
        ? [strong("WoW addons"), plain(" are up to date")]
        : [strong("WoW addons")];
  return { spinner: false, line1, line2, percent: null, action };
}
