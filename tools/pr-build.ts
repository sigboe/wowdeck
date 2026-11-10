/**
 * The PR build workflow's decisions, as pure functions over PR event facts,
 * tags and the published list; the workflow only feeds this script and `gh`.
 * See GLOSSARY.md ("PR build") and docs/adr/0010-pr-builds-on-pages.md.
 *
 *   echo "$facts" | bun tools/pr-build.ts action
 *   git tag -l 'v*' | bun tools/pr-build.ts next-version <pr> <index.json>
 *   bun tools/pr-build.ts is-maintainer <role>
 *   echo "$facts" | bun tools/pr-build.ts publish <index.json>
 *
 * `action` reads a PrEventFacts JSON object and prints build, strip-label,
 * unlist or skip. `is-maintainer` prints true or false for a repository
 * role_name. `publish` reads a PublishFacts JSON object and prints the
 * PublishPlan: the next list, whether to upload the run's zip, and the PR
 * comment. A missing <index.json> is an empty list. Bad input exits 1.
 *
 * The list, `index.json` on the `pr-builds` Pages branch beside
 * `pr/<number>/WoWDeck.zip`, is what the engine reads to offer PR builds:
 *
 *   {
 *     "builds": [                // newest PR first, at most PR_BUILDS_CAP
 *       {
 *         "number": 117,           // the pull request number
 *         "title": "Fix …",        // the PR title as written; show as plain text
 *         "author": "octocat",     // the PR author's GitHub login
 *         "version": "1.1.2-pr.117.2", // X.Y.Z-pr.N, -pr.N.K from the 2nd build
 *         "headSha": "0123…",      // the 40-hex commit the zip was built from
 *         "builtAt": "2026-11-09T12:00:00Z", // ISO 8601 UTC, when it was built
 *         "zipSize": 73000000,     // the zip's size in bytes
 *         "sha256": "ab…",         // the zip's sha256, 64 lowercase hex
 *         "zipUrl": "https://sigboe.github.io/wowdeck/pr/117/WoWDeck.zip"
 *       }
 *     ],
 *     "published": {             // newest version ever published, per PR,
 *       "117": "1.1.2-pr.117.2", // kept after the PR leaves the list; the
 *       "98": "1.1.1-pr.98.3"    // next build of a PR counts on from it
 *     }
 *   }
 *
 * The engine reads only `builds`. `published` is the workflow's memory, so
 * a PR that is unlabeled or stripped and later labeled again never gets a
 * version it already had: one version string always means one build.
 */

import { existsSync } from "node:fs";
import { nextPatchBase } from "./beta-release";

/** The label a maintainer puts on a pull request to publish a PR build of it. */
export const PR_BUILD_LABEL = "pr-build";

/** What the workflow knows about one `pull_request_target` event. */
export interface PrEventFacts {
  /** The event's `action`: labeled, unlabeled, synchronize, reopened, closed, … */
  event: string;
  /** The label added or removed, for labeled and unlabeled events. */
  label?: string;
  /** Whether the PR carries the `pr-build` label after the event. */
  labeled: boolean;
  /** Whether the event's sender (the pusher, for synchronize) is a maintainer. */
  senderIsMaintainer: boolean;
}

/**
 * - `build`: build the PR's head and list it (replacing its old build).
 * - `strip-label`: remove the `pr-build` label and unlist the PR; someone
 *   other than a maintainer moved its head, so the reviewed commit is gone.
 * - `unlist`: remove the PR's build from the list.
 * - `skip`: nothing to do.
 */
export type PrBuildAction = "build" | "strip-label" | "unlist" | "skip";

/**
 * Whether a repository role (the `role_name` GitHub reports for a user's
 * permission on the repo) makes its holder a maintainer: triage access or
 * higher, the access needed to put the `pr-build` label on a PR.
 */
export function isMaintainerRole(role: string): boolean {
  return ["triage", "write", "maintain", "admin"].includes(role);
}

/**
 * - A push (`synchronize`) to a labeled PR rebuilds it when a maintainer
 *   pushed and strips the label otherwise: only a push moves the head away
 *   from the commit a maintainer reviewed.
 * - Reopening a labeled PR lists it again when a maintainer reopened it;
 *   anyone else's reopen leaves it unlisted until a maintainer acts.
 * - Opening a PR never builds: a label set at creation also fires
 *   `labeled`, which does.
 */
export function decideAction(facts: PrEventFacts): PrBuildAction {
  const { event, label, labeled, senderIsMaintainer } = facts;
  if (event === "closed") return "unlist";
  if (event === "unlabeled") return label === PR_BUILD_LABEL && !labeled ? "unlist" : "skip";
  if (event === "labeled") return label === PR_BUILD_LABEL && labeled ? "build" : "skip";
  if (event === "synchronize" && labeled) return senderIsMaintainer ? "build" : "strip-label";
  if (event === "reopened" && labeled && senderIsMaintainer) return "build";
  return "skip";
}

/** One PR build in `index.json`; see the file's header for the shape. */
export interface PrBuildEntry {
  number: number;
  title: string;
  author: string;
  version: string;
  headSha: string;
  builtAt: string;
  zipSize: number;
  sha256: string;
  zipUrl: string;
}

/** `index.json`: every listed PR build. */
export interface PrBuildIndex {
  builds: PrBuildEntry[];
  /**
   * The newest version ever published for each PR, by PR number, kept after
   * the PR leaves the list so a relabel counts on instead of reusing a
   * version. Absent in a list written before it existed.
   */
  published?: Record<string, string>;
}

// Semver numbers: no leading zeros, as tools/version.py's.
const N = String.raw`(0|[1-9]\d*)`;
const PR_VERSION = new RegExp(`^${N}\\.${N}\\.${N}-pr\\.${N}(?:\\.${N})?$`);

/** X.Y.Z and K (1 when absent) of a build of `pr`; null for anything else. */
function prBuildOf(version: string, pr: number): { base: number[]; k: number } | null {
  const m = PR_VERSION.exec(version);
  if (!m || Number(m[4]) !== pr) return null;
  return { base: [m[1], m[2], m[3]].map(Number), k: m[5] === undefined ? 1 : Number(m[5]) };
}

function compareBase(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Version order between two builds of one PR: X.Y.Z, then K. */
function comparePrBuilds(a: { base: number[]; k: number }, b: { base: number[]; k: number }) {
  return compareBase(a.base, b.base) || a.k - b.k;
}

/**
 * `X.Y.Z-pr.N` for a PR's first build, `X.Y.Z-pr.N.K` for its K-th:
 * `X.Y.Z` is the newest stable tag with patch+1, as for betas. K counts on
 * from the PR's newest build, listed or remembered in `published`, even
 * when a new stable release moved `X.Y.Z`; and `X.Y.Z` never drops below
 * that build's. So a rebuild always gets a strictly higher version.
 */
export function nextPrBuildVersion(tags: string[], pr: number, index: PrBuildIndex): string {
  const base = nextPatchBase(tags).split(".").map(Number);
  const priors = [index.builds.find((b) => b.number === pr)?.version, index.published?.[pr]]
    .map((v) => (v === undefined ? null : prBuildOf(v, pr)))
    .filter((p) => p !== null);
  if (priors.length === 0) return `${base.join(".")}-pr.${pr}`;
  const last = priors.reduce((a, b) => (comparePrBuilds(a, b) >= 0 ? a : b));
  const next = compareBase(base, last.base) >= 0 ? base : last.base;
  return `${next.join(".")}-pr.${pr}.${last.k + 1}`;
}

/** `published` with each build remembered, keeping the newest version per PR. */
function remember(
  published: Record<string, string> | undefined,
  builds: PrBuildEntry[],
): Record<string, string> {
  const next = { ...published };
  for (const { number, version } of builds) {
    const build = prBuildOf(version, number);
    const known = next[number] === undefined ? null : prBuildOf(next[number], number);
    if (build && (known === null || comparePrBuilds(build, known) > 0)) next[number] = version;
  }
  return next;
}

/** How many PR builds Pages holds at once; each zip is about 73 MB. */
export const PR_BUILDS_CAP = 10;

export type NextIndex = { ok: true; index: PrBuildIndex } | { ok: false; refused: string };

/**
 * The list with `build` added, or replacing its PR's old build; newest PR
 * first. Refuses a build that would list an 11th PR, with the reason to post
 * on the PR.
 */
export function withBuild(index: PrBuildIndex, build: PrBuildEntry): NextIndex {
  const others = index.builds.filter((b) => b.number !== build.number);
  if (others.length >= PR_BUILDS_CAP) {
    return {
      ok: false,
      refused:
        `${PR_BUILDS_CAP} PR builds are already listed, the most Pages holds. ` +
        "Remove the pr-build label from another PR, then label this one again.",
    };
  }
  const builds = [...others, build].sort((a, b) => b.number - a.number);
  return { ok: true, index: { builds } };
}

/** A pull request as GitHub reports it now, read by the publish job. */
export interface PrState {
  number: number;
  /** open or closed (a merged PR is closed). */
  state: string;
  /** The names of its labels. */
  labels: string[];
  /** The 40-hex commit its head points at. */
  headSha: string;
}

/** What the publish job knows when it writes the list. */
export interface PublishFacts {
  /** The pull request the run is for. */
  pr: number;
  /** What `decideAction` chose for the run's event. */
  action: PrBuildAction;
  /** The build to list, when the action is `build`. */
  build?: PrBuildEntry;
  /** The current state of the run's PR and of every listed PR. */
  prs: PrState[];
}

/** The PR's one comment, found again by COMMENT_MARKER. */
export interface PrComment {
  body: string;
  /** Post it when the PR has none yet; otherwise only edit the existing one. */
  create: boolean;
}

export interface PublishPlan {
  /** The next `index.json`; every `pr/<n>/` it does not list goes. */
  index: PrBuildIndex;
  /** Whether to write the run's zip to `pr/<pr>/WoWDeck.zip`. */
  upload: boolean;
  comment: PrComment | null;
}

/** Marks the one comment the workflow keeps on a PR. */
export const COMMENT_MARKER = "<!-- wowdeck-pr-build -->";

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function builtComment(build: PrBuildEntry): string {
  return [
    COMMENT_MARKER,
    `**PR build** \`${build.version}\` of ${build.headSha}`,
    "",
    `Download [WoWDeck.zip](${build.zipUrl}) (${megabytes(build.zipSize)}, sha256 \`${build.sha256}\`).`,
    "",
    "On a device: Options › Updates › WoWDeck › channel picker › PR builds….",
  ].join("\n");
}

/** A listed build is current while its PR is open, labeled and at the built commit. */
function isCurrent(build: PrBuildEntry, prs: PrState[]): boolean {
  const state = prs.find((p) => p.number === build.number);
  return (
    state !== undefined &&
    state.state === "open" &&
    state.labels.includes(PR_BUILD_LABEL) &&
    state.headSha === build.headSha
  );
}

/**
 * The list the publish job writes, whether it uploads the run's zip, and the
 * PR comment. Every publish also drops listed builds whose PR is closed,
 * unlabeled or past the built commit, so the next publish makes up for a run
 * GitHub cancelled while it waited in the concurrency group. The next list
 * remembers the version of every build it ever listed (`published`).
 */
export function planPublish(index: PrBuildIndex, facts: PublishFacts): PublishPlan {
  const plan = planBuilds(index, facts);
  const published = remember(index.published, [...index.builds, ...plan.index.builds]);
  return { ...plan, index: { builds: plan.index.builds, published } };
}

function planBuilds(index: PrBuildIndex, facts: PublishFacts): PublishPlan {
  const current = { builds: index.builds.filter((b) => isCurrent(b, facts.prs)) };
  const { build } = facts;
  if (facts.action === "build" && build && isCurrent(build, facts.prs)) {
    const next = withBuild(current, build);
    if (next.ok) {
      return {
        index: next.index,
        upload: true,
        comment: { body: builtComment(build), create: true },
      };
    }
    const body = `${COMMENT_MARKER}\n**No PR build**: ${next.refused}`;
    return { index: current, upload: false, comment: { body, create: true } };
  }
  if (facts.action === "strip-label") {
    const body =
      `${COMMENT_MARKER}\n**PR build removed**: someone other than a maintainer pushed to ` +
      `this PR, so the ${PR_BUILD_LABEL} label came off and its build left the list. ` +
      "A maintainer can label it again after reviewing the new commits.";
    return { index: current, upload: false, comment: { body, create: true } };
  }
  const wasListed = index.builds.some((b) => b.number === facts.pr);
  const isListed = current.builds.some((b) => b.number === facts.pr);
  if (wasListed && !isListed) {
    const body = `${COMMENT_MARKER}\n**PR build removed**: this PR left the PR builds list.`;
    return { index: current, upload: false, comment: { body, create: false } };
  }
  return { index: current, upload: false, comment: null };
}

const ENTRY_FIELDS: Record<keyof PrBuildEntry, "number" | "string"> = {
  number: "number",
  title: "string",
  author: "string",
  version: "string",
  headSha: "string",
  builtAt: "string",
  zipSize: "number",
  sha256: "string",
  zipUrl: "string",
};

function isEntry(value: unknown): value is PrBuildEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(ENTRY_FIELDS).every(([field, type]) => typeof record[field] === type);
}

function isPublished(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

async function readIndex(path: string): Promise<PrBuildIndex> {
  if (!existsSync(path)) return { builds: [] };
  const parsed: unknown = await Bun.file(path).json();
  const { builds, published } = (parsed ?? {}) as { builds?: unknown; published?: unknown };
  if (!Array.isArray(builds) || !builds.every(isEntry)) {
    throw new Error(`${path} is not a PR build list`);
  }
  if (published !== undefined && !isPublished(published)) {
    throw new Error(`${path} has a malformed published map`);
  }
  return published === undefined ? { builds } : { builds, published };
}

function isPrState(value: unknown): value is PrState {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.number === "number" &&
    typeof p.state === "string" &&
    Array.isArray(p.labels) &&
    p.labels.every((l) => typeof l === "string") &&
    typeof p.headSha === "string"
  );
}

const ACTIONS: readonly string[] = ["build", "strip-label", "unlist", "skip"];

function isPublishFacts(value: unknown): value is PublishFacts {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.pr === "number" &&
    typeof f.action === "string" &&
    ACTIONS.includes(f.action) &&
    (f.build === undefined || isEntry(f.build)) &&
    Array.isArray(f.prs) &&
    f.prs.every(isPrState)
  );
}

const PR_NUMBER = /^[1-9]\d*$/;
const USAGE =
  "usage: pr-build.ts action | is-maintainer <role> | next-version <pr> <index.json> | " +
  "publish <index.json>";

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === "action" && args.length === 0) {
    const facts: unknown = JSON.parse(await Bun.stdin.text());
    const f = facts as Partial<PrEventFacts> | null;
    if (
      typeof f?.event !== "string" ||
      typeof f.labeled !== "boolean" ||
      typeof f.senderIsMaintainer !== "boolean" ||
      (f.label !== undefined && typeof f.label !== "string")
    ) {
      console.error("action: stdin is not a PrEventFacts object");
      return 1;
    }
    process.stdout.write(decideAction(f as PrEventFacts) + "\n");
  } else if (command === "next-version" && args.length === 2 && PR_NUMBER.test(args[0])) {
    const tags = (await Bun.stdin.text())
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    process.stdout.write(
      nextPrBuildVersion(tags, Number(args[0]), await readIndex(args[1])) + "\n",
    );
  } else if (command === "is-maintainer" && args.length === 1) {
    process.stdout.write(`${isMaintainerRole(args[0])}\n`);
  } else if (command === "publish" && args.length === 1) {
    const facts: unknown = JSON.parse(await Bun.stdin.text());
    if (!isPublishFacts(facts)) {
      console.error("publish: stdin is not a PublishFacts object");
      return 1;
    }
    const plan = planPublish(await readIndex(args[0]), facts);
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else {
    console.error(USAGE);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
