import { rawErrorText } from "./errors";
import type { Installation, ProviderInfo } from "./types";
import { providerLabel } from "./addonRow";

/**
 * What the UI calls an installation's game (the search helper, the export
 * file name): the engine's short client name, e.g. "Forever", the same name
 * My Addons and Installation details show.
 */
export function installationLabel(installation: Installation | null | undefined): string | null {
  return installation ? installation.clientName : null;
}

/** "A", "A and B", "A, B and C" — no Oxford comma, matches the rest of the UI's prose style. */
export function formatList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0]!;
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Dynamic search helper text. Generated purely from actual
 * provider/installation state — never hardcoded provider names — so it
 * updates correctly as providers are enabled/disabled or configured, and
 * degrades to an explicit empty-state message when nothing can search.
 *
 * Filtered by `catalogSearch`: GitHub and WowInterface are reached through
 * From URL, not this box, so they are not named here.
 */
export function searchHelperText(providers: ProviderInfo[], clientLabel: string | null): string {
  const available = providers
    .filter((p) => p.available && p.catalogSearch)
    // People's names for providers ("CurseForge"), not engine ids ("Curse").
    .map((p) => providerLabel(p.id));
  if (available.length === 0) {
    return "No source that searches by name is turned on. Turn one on in Options › Addon sources";
  }
  if (!clientLabel) {
    return "Select a WoW installation in Options to search";
  }
  return `Search ${formatList(available)} for ${clientLabel} addons`;
}

/**
 * Turns a raw provider/engine error string into something a user can act
 * on. Raw text such as "TypeError: fetch failed" says nothing about what to
 * do (Xbox Accessibility Guideline 115: describe the error and how to
 * correct it).
 */
export function friendlySearchError(rawInput: string): string {
  const raw = rawErrorText(rawInput);
  if (/timed? ?out|timeout|AbortError|too long/i.test(raw)) {
    return "took too long to respond. Check your internet connection";
  }
  if (
    /TypeError|fetch failed|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ConnectionRefused|Unable to connect|network|offline|EAI_AGAIN/i.test(
      raw,
    )
  ) {
    return "couldn't be reached. Check your internet connection";
  }
  const http = /HTTP (\d{3})/.exec(raw);
  if (http) {
    const code = Number(http[1]);
    if (code === 401 || code === 403) {
      return "didn't accept the request. Check the API key in Options";
    }
    if (code === 429) {
      return "is getting too many requests. Try again in a minute";
    }
    if (code >= 500) {
      return "is having problems. Try again later";
    }
  }
  return "couldn't finish the search. Try again later";
}

/**
 * Inline status for a finished search. An empty result set is a normal
 * outcome (muted text), whereas providers that failed are errors — the
 * two must not look alike (Xbox Accessibility Guideline 115: say what
 * failed, not just that nothing came back).
 */
export function searchOutcome(
  query: string,
  resultCount: number,
  providerErrors: Array<{ providerId: string; error: string }>,
): { kind: "none" | "empty" | "error"; text: string } {
  if (resultCount > 0) {
    return { kind: "none", text: "" };
  }
  if (providerErrors.length > 0) {
    const detail = providerErrors
      .map((f) => `${providerLabel(f.providerId)} ${friendlySearchError(f.error)}`)
      .join("; ");
    return { kind: "error", text: `${detail}.`.slice(0, 220) };
  }
  return { kind: "empty", text: `No results for “${query}”.` };
}
