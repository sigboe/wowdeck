/**
 * .github/FUNDING.yml → the Funding links (GLOSSARY) Support WoWDeck shows.
 * The same file drives GitHub's Sponsor button, so it uses GitHub's keys:
 * https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository
 *
 * The file is untrusted input fetched from `next` (ADR-0005): only
 * `https://` links and checksummed `bitcoin:` addresses (Bitcoin.ts)
 * survive, names come from the table below (never from the file), and the
 * count is capped here so the frontend can trust the answer.
 */

import type { FundingLink } from "../api/contracts";
import { bitcoinAddress } from "./Bitcoin";

export const FUNDING_FILE = ".github/FUNDING.yml";

/** The most links shown; the rest (last in the file) are dropped. */
export const MAX_FUNDING_LINKS = 6;
/** A longer link is not one the owner wrote, and would make a dense QR code. */
const MAX_URL_LENGTH = 200;

/** Display names by host (without "www."); any other host shows as itself. */
const KNOWN_HOSTS: { name: string; matches: (host: string, path: string) => boolean }[] = [
  { name: "Ko-fi", matches: (host) => host === "ko-fi.com" },
  { name: "Patreon", matches: (host) => host === "patreon.com" },
  { name: "PayPal", matches: (host) => host === "paypal.me" || host === "paypal.com" },
  { name: "Buy Me a Coffee", matches: (host) => host === "buymeacoffee.com" },
  { name: "Liberapay", matches: (host) => host === "liberapay.com" },
  {
    name: "GitHub Sponsors",
    matches: (host, path) => host === "github.com" && path.startsWith("/sponsors/"),
  },
];

/** A platform key's value is a username: GitHub's own keys take nothing else. */
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/**
 * The platform keys we support, each turning a username into its page. A
 * Map, so a key like `constructor` or `__proto__` in the file finds nothing.
 */
const PLATFORM_URLS = new Map<string, (user: string) => string>([
  ["github", (user) => `https://github.com/sponsors/${user}`],
  ["ko_fi", (user) => `https://ko-fi.com/${user}`],
  ["patreon", (user) => `https://www.patreon.com/${user}`],
  ["liberapay", (user) => `https://liberapay.com/${user}`],
  ["buy_me_a_coffee", (user) => `https://buymeacoffee.com/${user}`],
]);

/** Every value of a key: GitHub allows a string or a list for most of them. */
function values(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
}

/** The links in the file's key order. A file that isn't YAML has none. */
export function parseFunding(yaml: string): FundingLink[] {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yaml);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const links = new Map<string, FundingLink>();
  for (const [key, value] of Object.entries(parsed)) {
    const toUrl = PLATFORM_URLS.get(key);
    const candidates =
      key === "custom"
        ? values(value)
        : toUrl
          ? values(value)
              .filter((user) => USERNAME.test(user))
              .map(toUrl)
          : [];
    for (const candidate of candidates) {
      const link = fundingLink(candidate);
      if (link && !links.has(link.url)) links.set(link.url, link);
    }
  }
  return [...links.values()].slice(0, MAX_FUNDING_LINKS);
}

/** An `https://` link with its display name, a Bitcoin address, or null. */
function fundingLink(text: string): FundingLink | null {
  if (text.length > MAX_URL_LENGTH) return null;
  if (/^bitcoin:/i.test(text)) {
    const address = bitcoinAddress(text);
    return address ? { kind: "bitcoin", name: "Bitcoin", url: `bitcoin:${address}` } : null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, "");
  const named = KNOWN_HOSTS.find((known) => known.matches(host, url.pathname));
  // The parsed form: encoded, with no stray whitespace or control characters.
  return { kind: "web", name: named?.name ?? host, url: url.href };
}
