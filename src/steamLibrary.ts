/**
 * The Steam library entry that launches WoW (BEYOND-05), and what the
 * game-page section and the Options picker need from Steam.
 *
 * Steam keeps every library entry in the ambient `appStore.allApps`; a
 * non-Steam shortcut is app_type 0x40000000 (1073741824). Read on the Deck
 * (spike S8, 2026-10-16): 1321 apps, 22 shortcuts, "World of Warcraft" among
 * them. `SteamClient.Apps.GetAllShortcuts` (exe paths) does not exist on that
 * client, so nothing here matches a shortcut to an installation: the section
 * covers every installation.
 */

export interface SteamGame {
  appId: number;
  name: string;
}

const SHORTCUT_APP_TYPE = 1073741824;

interface SteamApp {
  appid?: unknown;
  display_name?: unknown;
  app_type?: unknown;
}

/** Non-Steam shortcuts in the library, A–Z; empty when Steam's store is not where we expect it. */
export function listSteamShortcuts(): SteamGame[] {
  try {
    const apps = (globalThis as { appStore?: { allApps?: SteamApp[] } }).appStore?.allApps;
    if (!Array.isArray(apps)) {
      return [];
    }
    return shortcutsFrom(apps);
  } catch {
    return [];
  }
}

/** Pure part of listSteamShortcuts, for tests. */
export function shortcutsFrom(apps: SteamApp[]): SteamGame[] {
  return apps
    .filter(
      (a) =>
        a.app_type === SHORTCUT_APP_TYPE &&
        typeof a.appid === "number" &&
        typeof a.display_name === "string",
    )
    .map((a) => ({ appId: a.appid as number, name: (a.display_name as string).trim() }))
    .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

/**
 * Picker filter: case-insensitive on the name; "wow" also finds "World of
 * Warcraft" by its initials, the name people call it by. Blank keeps all.
 */
export function filterSteamGames(games: SteamGame[], query: string): SteamGame[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) {
    return games;
  }
  return games.filter((g) => {
    const name = g.name.toLocaleLowerCase();
    const initials = name
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map((w) => w[0])
      .join("");
    return name.includes(q) || initials.startsWith(q.replace(/\s+/g, ""));
  });
}

// Entries people add WoW as: the game itself, or the Battle.net launcher
// that starts it (owner, 2026-10-16).
const LIKELY_WOW = /warcraft|\bwow\b|battle\.?net|blizzard/i;

export function isLikelyWow(name: string): boolean {
  return LIKELY_WOW.test(name);
}

/** The picker's order: likely WoW entries (WoW, Battle.net) first, each part A–Z as given. */
export function likelyWowFirst(games: SteamGame[]): SteamGame[] {
  return [
    ...games.filter((g) => isLikelyWow(g.name)),
    ...games.filter((g) => !isLikelyWow(g.name)),
  ];
}

/** Background checks run at most this often (the page and tile appear often). */
export const AUTO_CHECK_EVERY_MS = 15 * 60 * 1000;

/** Whether the page or tile appearing should start a background check now. */
export function shouldAutoCheck(enabled: boolean, lastAt: number, now: number): boolean {
  return enabled && now - lastAt >= AUTO_CHECK_EVERY_MS;
}

export type BadgeState = "updates" | "current" | "checking";

/** What the home-tile badge shows; null (no badge) until anything is known. */
export function badgeState(
  summary: { updates: number }[] | null,
  checking: boolean,
): BadgeState | null {
  if (checking) {
    return "checking";
  }
  if (!summary) {
    return null;
  }
  return summary.some((i) => i.updates > 0) ? "updates" : "current";
}

/**
 * The game-page line: "3 addon updates: Forever 2 · Classic Era 1" when
 * several installations have updates, "1 addon update in Forever" when one
 * does (of several), "2 addon updates" with a single installation, "All
 * addons are up to date" otherwise.
 */
export function updateSummaryText(
  installations: { displayName: string; updates: number }[],
): string {
  const withUpdates = installations.filter((i) => i.updates > 0);
  const total = withUpdates.reduce((n, i) => n + i.updates, 0);
  if (total === 0) {
    return "All addons are up to date";
  }
  const head = total === 1 ? "1 addon update" : `${total} addon updates`;
  if (installations.length === 1) {
    return head;
  }
  if (withUpdates.length === 1) {
    return `${head} in ${withUpdates[0]!.displayName}`;
  }
  return `${head}: ${withUpdates.map((i) => `${i.displayName} ${i.updates}`).join(" · ")}`;
}

/**
 * Toast and Options text for an automatic update run (WF-02): null when
 * there is nothing to say (no updates done or failed, and not skipped).
 */
export function autoUpdateText(r: {
  updated: string[];
  failed: string[];
  skipped: string | null;
}): { title: string; body: string } | null {
  if (r.skipped) {
    return {
      title: "Automatic updates postponed",
      body: `${r.skipped}. They'll run at the next check`,
    };
  }
  if (r.updated.length === 0 && r.failed.length === 0) {
    return null;
  }
  const names = (list: string[]) =>
    list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
  const parts = [
    r.updated.length ? `Updated ${names(r.updated)}` : "",
    r.failed.length ? `failed: ${names(r.failed)}` : "",
  ].filter(Boolean);
  const n = r.updated.length;
  return {
    title: n
      ? `${n} addon${n === 1 ? "" : "s"} updated automatically`
      : "Couldn't update automatically",
    body: parts.join("; "),
  };
}
