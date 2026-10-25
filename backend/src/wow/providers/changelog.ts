import { AddonChannelType } from "../types";

/**
 * How many recent releases the Details modal Changelog shows. A hidden
 * option on purpose — not exposed in the UI, same idea as the frontend's
 * DISCOVER_PAGE_SIZE / DISCOVER_MAX_PAGES.
 */
export const CHANGELOG_ENTRY_COUNT = 3;

export interface ChangelogEntry {
  title: string;
  channelType: AddonChannelType;
  releaseDate?: string;
  body: string | null | undefined;
}

const NO_NOTES = "_No release notes provided._";

function channelLabel(channelType: AddonChannelType): string {
  switch (channelType) {
    case AddonChannelType.Beta:
      return "Beta";
    case AddonChannelType.Alpha:
      return "Alpha";
    default:
      return "Release";
  }
}

export function dateLabel(releaseDate: string | undefined): string | undefined {
  if (!releaseDate) {
    return undefined;
  }
  const time = new Date(releaseDate).getTime();
  if (!Number.isFinite(time) || time <= 0) {
    return undefined;
  }
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Joins the most recent releases' notes into one Markdown document, newest
 * first, each under a `## <version>` heading with a channel/date line.
 * Returns "" when no entry has any notes, so the Details modal shows its
 * "No changelog available." state instead of a list of empty headings.
 * Entry titles come from third parties, so they are flattened to one line
 * and stripped of leading heading markers.
 */
export function composeChangelog(entries: ChangelogEntry[], limit: number = CHANGELOG_ENTRY_COUNT): string {
  const recent = entries.slice(0, Math.max(0, limit));
  if (!recent.some((entry) => entry.body?.trim())) {
    return "";
  }
  return recent
    .map((entry) => {
      const title = entry.title.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim() || "Untitled release";
      const meta = [channelLabel(entry.channelType), dateLabel(entry.releaseDate)].filter(Boolean).join(" · ");
      const body = entry.body?.trim() || NO_NOTES;
      return `## ${title}\n\n_${meta}_\n\n${body}`;
    })
    .join("\n\n---\n\n");
}
