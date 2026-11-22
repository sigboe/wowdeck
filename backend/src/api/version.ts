/**
 * WoWDeck's own version strings, for the engine, the frontend and the
 * release tools in tools/. Pure: no Node or Bun APIs.
 *
 * The forms: a release ("1.2.3", stable), a beta build of the next one
 * ("1.2.4-beta.57", the beta run number), a device-test build
 * ("1.2.4-test.114", written by `make version-set` on a device-test branch)
 * and a PR build ("1.2.4-pr.117", pull request 117; "1.2.4-pr.117.2", its
 * second build). Numbers carry no leading zeros; counters start at 1 and a
 * rebuild counter at 2.
 *
 * Writers use `parseVersion`, which takes only that canonical text. Readers
 * use `readVersion`, which also takes a leading "v" (tags carry one) and
 * surrounding whitespace. version-table.json is the conformance table every
 * reader and writer runs, the Python tools included.
 *
 * Ordering is semver precedence restricted to those forms: a pre-release
 * sorts below the same X.Y.Z, and betas order by N. A test build of the
 * same X.Y.Z sorts below the release but above every beta: it is built from
 * a branch past the newest beta, so it knows everything the beta does, and
 * it is superseded only by the shipped release or a newer X.Y.Z. A PR build
 * ranks with the test builds and orders among them by N; a rebuild's
 * counter K puts -pr.N.K after -pr.N (which counts as K = 1) and orders
 * rebuilds by K. Anything else is not a WoWDeck version, and comparing it is
 * "can't tell" rather than a guessed order.
 */

import type { UpdateChannel } from "./contracts";

/** beta is a published pre-release; test and pr are device-test builds. */
export type VersionForm = "stable" | "beta" | "test" | "pr";

export interface Version {
  /** The canonical text: no leading v, no whitespace. */
  text: string;
  release: [number, number, number];
  form: VersionForm;
  /** beta's run number, test's counter, pr's PR number; null for stable. */
  n: number | null;
  /** A PR build's rebuild counter: 1 for its first build; null for any other form. */
  k: number | null;
}

const N = String.raw`(0|[1-9]\d*)`;
const COUNTER = String.raw`([1-9]\d*)`;
const REBUILD = String.raw`([2-9]|[1-9]\d+)`;
const CANONICAL = new RegExp(
  `^${N}\\.${N}\\.${N}(?:-(beta|test)\\.${COUNTER}|-pr\\.${COUNTER}(?:\\.${REBUILD})?)?$`,
);

/** A version as a writer may write it: canonical text only; null otherwise. */
export function parseVersion(text: string): Version | null {
  const m = CANONICAL.exec(text);
  if (!m) return null;
  const release: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] !== undefined) return { text, release, form: m[4] as "beta" | "test", n: Number(m[5]), k: null };
  if (m[6] !== undefined) {
    return { text, release, form: "pr", n: Number(m[6]), k: m[7] === undefined ? 1 : Number(m[7]) };
  }
  return { text, release, form: "stable", n: null, k: null };
}

/** A version as read from a tag, a file or settings: also with a leading v and surrounding whitespace. */
export function readVersion(text: string): Version | null {
  const trimmed = text.trim();
  return parseVersion(trimmed.startsWith("v") ? trimmed.slice(1) : trimmed);
}

/** The canonical text of a version, or null when it is not a WoWDeck version. */
export function normalizeVersion(text: string): string | null {
  return readVersion(text)?.text ?? null;
}

/** Whether a WoWDeck version is a release (X.Y.Z). */
export function isStableVersion(text: string): boolean {
  return readVersion(text)?.form === "stable";
}

/** Whether a WoWDeck version is a beta build (X.Y.Z-beta.N). */
export function isBetaVersion(text: string): boolean {
  return readVersion(text)?.form === "beta";
}

/** Whether a WoWDeck version is a device-test build (X.Y.Z-test.N, X.Y.Z-pr.N or X.Y.Z-pr.N.K). */
export function isTestVersion(text: string): boolean {
  const form = readVersion(text)?.form;
  return form === "test" || form === "pr";
}

/** Whether a WoWDeck version is a PR build (X.Y.Z-pr.N or X.Y.Z-pr.N.K). */
export function isPrVersion(text: string): boolean {
  return readVersion(text)?.form === "pr";
}

/** N of a PR build (X.Y.Z-pr.N or X.Y.Z-pr.N.K): its pull request; null for any other version. */
export function prNumber(text: string): number | null {
  const v = readVersion(text);
  return v?.form === "pr" ? v.n : null;
}

/** X.Y.Z order only, ignoring the pre-release. */
export function compareReleases(a: Version, b: Version): number {
  return Math.sign(a.release[0] - b.release[0] || a.release[1] - b.release[1] || a.release[2] - b.release[2]);
}

/** Pre-release precedence within one X.Y.Z: a release beats test or pr, which beat beta. */
function formRank(form: VersionForm): number {
  if (form === "stable") return 2;
  return form === "beta" ? 0 : 1;
}

/** Two parsed versions in order: -1, 0 or 1. */
export function compareParsed(a: Version, b: Version): number {
  return (
    compareReleases(a, b) ||
    Math.sign(formRank(a.form) - formRank(b.form)) ||
    Math.sign((a.n ?? 0) - (b.n ?? 0)) ||
    Math.sign((a.k ?? 1) - (b.k ?? 1))
  );
}

/**
 * Compare two versions: -1, 0 or 1; null when either side is not a WoWDeck
 * version — the caller treats "can't tell" as unknown.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = readVersion(a);
  const pb = readVersion(b);
  return pa && pb ? compareParsed(pa, pb) : null;
}

/**
 * Whether a channel may offer this build: Stable offers releases only, Beta
 * releases and betas. Neither ever offers a test or PR build, however it was
 * published.
 */
export function isOfferedOn(channel: UpdateChannel, text: string): boolean {
  const form = readVersion(text)?.form;
  return form === "stable" || (channel === "beta" && form === "beta");
}

/**
 * The build a channel offers from these candidates: the newest it may offer,
 * as canonical text, so Beta offers the newer of stable and beta. Null when
 * none qualifies.
 */
export function newestOffered(channel: UpdateChannel, candidates: readonly string[]): string | null {
  let newest: Version | null = null;
  for (const candidate of candidates) {
    const v = readVersion(candidate);
    if (v === null || !isOfferedOn(channel, v.text)) continue;
    if (newest === null || compareParsed(v, newest) > 0) newest = v;
  }
  return newest?.text ?? null;
}
