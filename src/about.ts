/**
 * Options › About: which rows appear, in what order, from the engine's
 * about.get answer. Support WoWDeck (hidden without Funding links) and
 * Supporters (hidden without names) come before Third-party notices, which
 * always shows; each row opens its own modal.
 */

import type { AboutInfo, FundingLink } from "./types";

/** An About row, also its focus-memory id in Options (SettingsRow). */
export type AboutRowId = "supportWoWDeck" | "showSupporters" | "thirdPartyNotices";

export interface AboutRow {
  id: AboutRowId;
  label: string;
  description: string;
}

const SUPPORT_ROW: AboutRow = {
  id: "supportWoWDeck",
  label: "Support WoWDeck",
  description: "Scan a code with your phone to fund WoWDeck",
};

const SUPPORTERS_ROW: AboutRow = {
  id: "showSupporters",
  label: "Supporters",
  description: "The people who fund WoWDeck and asked to be thanked by name",
};

const NOTICES_ROW: AboutRow = {
  id: "thirdPartyNotices",
  label: "Third-party notices",
  description: "What WoWDeck is built from, and under which licenses",
};

/**
 * The rows in display order. `info` is null until about.get first answers;
 * rows that need its data stay hidden until then.
 */
export function aboutRows(info: AboutInfo | null): AboutRow[] {
  return [
    ...(info?.funding.length ? [SUPPORT_ROW] : []),
    ...(info?.supporters.length ? [SUPPORTERS_ROW] : []),
    NOTICES_ROW,
  ];
}

/**
 * The last about.get answer, kept at module scope: opening an About modal
 * unmounts the panel (guide G4), and the remounted section must start with
 * the rows it had, so focus memory finds the row that opened the modal
 * (S36) instead of a list that lacks it until about.get answers again.
 */
let lastInfo: AboutInfo | null = null;

/** The answer the About section starts from: the last one seen, else null. */
export function lastAboutInfo(): AboutInfo | null {
  return lastInfo;
}

/** Keep about.get's answer for the next mount (lastAboutInfo). */
export function rememberAboutInfo(info: AboutInfo): void {
  lastInfo = info;
}

/**
 * The owner's note above the Funding links. It ships in the plugin, not in
 * the fetched data, so FUNDING.yml on `next` can only ever add links.
 */
export const SUPPORT_NOTE =
  "I build WoWDeck in my spare time. Your support pays for the WoW subscription I test it with and the coding agent I write it with, and maybe later for access to the wago.io API. Thank you for helping.";

/** How to use the links, under the note. A on a Bitcoin address opens nothing. */
export const SUPPORT_HINT =
  "Scan a code with your phone, or press A on a page to open it in Steam's browser.";

/**
 * The text under a Funding link's QR code: a web link's short URL, or a
 * Bitcoin link's full address, which the player checks against their
 * wallet before sending, so it is never shortened.
 */
export function fundingText(link: FundingLink): string {
  return link.kind === "bitcoin" ? link.url.replace(/^bitcoin:/, "") : shortUrl(link.url);
}

/** A Funding link as printed under its QR code, short enough to type on another device. */
export function shortUrl(url: string): string {
  return url
    .replace(/^https:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

const NOTICES_FALLBACK =
  "Couldn't read the notices from this install. They're in THIRD_PARTY_NOTICES.md on github.com/sigboe/wowdeck.";

/**
 * The notices modal's Markdown: the installed plugin's notices, or where to
 * find them. A leading H1 is dropped: the modal's title already says it.
 */
export function noticesText(info: AboutInfo | null): string {
  const notices = info?.notices?.replace(/^\s*# [^\n]*\n*/, "");
  return notices && notices.trim() ? notices : NOTICES_FALLBACK;
}
