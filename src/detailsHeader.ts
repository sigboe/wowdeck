import type { DetailsResult } from "./types";
import { dayMonth } from "./text";

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatDownloadCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) {
    return "0";
  }
  if (count >= 1_000_000_000) {
    return `${oneDecimal(count / 1_000_000_000)}B`;
  }
  if (count >= 1_000_000) {
    return `${oneDecimal(count / 1_000_000)}M`;
  }
  if (count >= 1_000) {
    return `${oneDecimal(count / 1_000)}K`;
  }
  return String(Math.floor(count));
}

/**
 * The muted facts shown after the provider chip in the Details header,
 * in display order. Only facts that are actually known are returned —
 * a missing field never renders as a placeholder.
 */
export function headerFacts(result: DetailsResult): string[] {
  const facts: string[] = [];
  if (result.author) {
    facts.push(result.author);
  }
  if (result.downloadCount !== null && result.downloadCount > 0) {
    facts.push(`${formatDownloadCount(result.downloadCount)} downloads`);
  }
  if (result.latestVersion) {
    facts.push(result.latestVersion);
  }
  if (result.channel === "beta" || result.channel === "alpha") {
    facts.push(result.channel === "beta" ? "Beta" : "Alpha");
  }
  if (result.gameVersion) {
    facts.push(`WoW ${result.gameVersion}`);
  }
  const released = shortReleaseDate(result.releasedAt, new Date());
  if (released) {
    facts.push(`Updated ${released}`);
  }
  return facts;
}

/**
 * A release day (YYYY-MM-DD) as short as it reads at a glance (C10): "14 Oct"
 * this year, "14 Oct 2024" before. Null for anything else.
 */
export function shortReleaseDate(day: string | null | undefined, now: Date): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!m) {
    return null;
  }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getMonth() !== Number(m[2]) - 1) {
    return null;
  }
  return dayMonth(date, now);
}

export interface DependencyNote {
  /** "Requires Ace3, LibStub" / "Needs 2 other addons, installed automatically". */
  text: string;
  /** Required folders not in AddOns; the addon will not load without them. */
  missing: string | null;
}

/**
 * The Details line about required dependencies (WF-11). For an installed
 * addon: the TOC's names, and which are missing. For a provider result: only
 * a count (the provider gives ids, not names), and that they come along on
 * install. Null when there are none.
 */
export function dependencyNote(
  deps: { required: string[]; missing: string[] } | { count: number },
): DependencyNote | null {
  if ("count" in deps) {
    if (deps.count <= 0) {
      return null;
    }
    const n = deps.count === 1 ? "1 other addon" : `${deps.count} other addons`;
    return { text: `Needs ${n}, installed automatically`, missing: null };
  }
  if (deps.required.length === 0) {
    return null;
  }
  return {
    text: `Requires ${deps.required.join(", ")}`,
    missing: deps.missing.length ? `Missing: ${deps.missing.join(", ")}` : null,
  };
}
