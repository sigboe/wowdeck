/**
 * The PR builds list fixture: what CI publishes on Pages, built by running
 * the PR build tool itself, the way the workflow runs it —
 * nextPrBuildVersion picks each version, planPublish plans each publish —
 * and carried through JSON, as between the publish job and the engine's
 * fetch. The engine's tests read the writer's output, never a hand-written
 * copy of its documented shape (AGENTS.md: deterministic tests; the writer
 * and the reader meet here).
 *
 * The story the list tells: with v1.1.1 the newest stable tag, #117 was
 * labeled and built, a maintainer's push rebuilt it (1.1.2-pr.117.2), then
 * #171 was labeled and built. WITHOUT_117 is the same list after #117 was
 * closed and unlisted.
 */

import {
  PR_BUILD_LABEL,
  nextPrBuildVersion,
  planPublish,
  type PrBuildIndex,
  type PrState,
  type PublishedPrBuild,
} from "../../../../tools/pr-build";

/** The tags CI saw: v1.1.1 was the newest stable release at the time. */
const TAGS = ["v1.1.0", "v1.1.1"];

/** The heads the story moves through; #117's first build sat on another. */
const HEAD_117 = "0123456789abcdef0123456789abcdef01234567";
const HEAD_117_BEFORE_PUSH = "beefcafebeefcafebeefcafebeefcafebeefcafe";
const HEAD_171 = "8f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6";

/** What the publish job knows about a PR, as the workflow reads it from GitHub. */
function openPr(number: number, headSha: string): PrState {
  return { number, state: "open", labels: [PR_BUILD_LABEL], headSha };
}

/** #117's zip as CI built it: the same bytes across both of its builds. */
function build117(version: string, headSha: string, builtAt: string): PublishedPrBuild {
  return {
    number: 117,
    title: "Add PR builds to the channel picker",
    author: "sigboe",
    version,
    headSha,
    builtAt,
    zipSize: 72998400,
    sha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    zipUrl: "https://sigboe.github.io/wowdeck/pr/117/WoWDeck.zip",
  };
}

/** #171's zip: the same PR title markup that must never render as markup. */
function build171(version: string): PublishedPrBuild {
  return {
    number: 171,
    title: "<b>Urgent</b> fix: [click here](https://evil.example) & more",
    author: "octocat",
    version,
    headSha: HEAD_171,
    builtAt: "2026-11-09T18:42:07Z",
    zipSize: 73104512,
    sha256: "3b7e5a0c9d1f2e4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a",
    zipUrl: "https://sigboe.github.io/wowdeck/pr/171/WoWDeck.zip",
  };
}

/** #117 labeled and built at its first head. */
const first = planPublish(
  { builds: [] },
  {
    pr: 117,
    action: "build",
    build: build117(
      nextPrBuildVersion(TAGS, 117, { builds: [] }),
      HEAD_117_BEFORE_PUSH,
      "2026-11-08T08:00:00Z",
    ),
    prs: [openPr(117, HEAD_117_BEFORE_PUSH)],
  },
);

/** A maintainer pushed a new head, so CI rebuilt #117: 1.1.2-pr.117.2. */
const rebuilt = planPublish(first.index, {
  pr: 117,
  action: "build",
  build: build117(nextPrBuildVersion(TAGS, 117, first.index), HEAD_117, "2026-11-08T09:15:00Z"),
  prs: [openPr(117, HEAD_117)],
});

/** Then #171 was labeled and built: 1.1.2-pr.171, listed newest PR first. */
const listed = planPublish(rebuilt.index, {
  pr: 171,
  action: "build",
  build: build171(nextPrBuildVersion(TAGS, 171, rebuilt.index)),
  prs: [openPr(117, HEAD_117), openPr(171, HEAD_171)],
});

/** JSON, as the wire between the publish job and the engine's fetch. */
function throughTheWire(index: PrBuildIndex): PrBuildIndex {
  return JSON.parse(JSON.stringify(index));
}

/** The published list: #171 and #117 at 1.1.2-pr.117.2, newest PR first. */
export const LISTED: PrBuildIndex = throughTheWire(listed.index);

/** The same list after #117 was closed and unlisted; #171 stays. */
export const WITHOUT_117: PrBuildIndex = throughTheWire(
  planPublish(listed.index, {
    pr: 117,
    action: "unlist",
    prs: [openPr(171, HEAD_171), { ...openPr(117, HEAD_117), state: "closed" }],
  }).index,
);
