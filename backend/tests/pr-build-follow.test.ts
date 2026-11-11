/**
 * Following a PR build, engine side: system.prBuildState. The engine reads
 * the PR builds list, and only for a PR that left it asks GitHub's API for
 * the PR, the releases and whether the newest beta contains the merge. One
 * fake net stands in for NetworkClient.getJson and answers with recorded
 * fixtures (the list as tools/pr-build.ts publishes it, GitHub's PR,
 * releases and compare answers trimmed to the fields read), so no test
 * touches the network (deterministic tests, AGENTS.md).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register } from "../src/api/handlers/system";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError } from "../src/wow/net/network";
import { PrBuildFollow } from "../src/wow/plugin/PrBuildFollow";
import { PrBuildList } from "../src/wow/plugin/PrBuildList";

const INDEX_URL = "https://sigboe.github.io/wowdeck/index.json";
const REPO_API = "https://api.github.com/repos/sigboe/wowdeck";
const PULL_117 = `${REPO_API}/pulls/117`;
const RELEASES = `${REPO_API}/releases?per_page=100`;
const MERGE_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const compareTo = (tag: string) => `${REPO_API}/compare/${MERGE_SHA}...${tag}`;

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/pr-builds", name), "utf8"));

/** The recorded list: #171 at 1.1.2-pr.171, #117 at its second build, 1.1.2-pr.117.2. */
const LISTED = fixture("index.json");
/** The list after #117 left it. */
const WITHOUT_117 = { builds: (LISTED as { builds: { number: number }[] }).builds.filter((b) => b.number !== 117) };
/** #117 merged 2026-11-10T12:00:00Z as commit fedcba98…. */
const MERGED = fixture("pull-117-merged.json");
/** #117 closed without merging. */
const CLOSED = fixture("pull-117-closed.json");
/** #117 open (its label was removed). */
const OPEN = fixture("pull-117-open.json");
/** Newest beta 1.1.2-beta.43, published 2026-11-10T12:20:31Z; 1.1.2-beta.42 before the merge; stable 1.1.1. */
const RELEASES_AFTER_MERGE = fixture("releases-after-merge.json");
/** v1.1.2-beta.43 is ahead of the merge commit: it contains the PR. */
const BETA_43_HAS_MERGE = fixture("compare-merge-to-beta43.json");
/** v1.1.2-beta.42 is behind the merge commit: it lacks the PR. */
const BETA_42_LACKS_MERGE = fixture("compare-merge-to-beta42.json");

function engine(currentVersion: string, answers: Record<string, unknown>) {
  const asked: { url: string; headers?: Record<string, string> }[] = [];
  const net = {
    async getJson<T>(url: string, options?: { headers?: Record<string, string> }): Promise<T> {
      asked.push({ url, headers: options?.headers });
      if (!(url in answers)) throw new NetworkError(`no recorded answer for ${url}`);
      const answer = answers[url];
      if (answer instanceof Error) throw answer;
      return structuredClone(answer) as T;
    },
  };
  const deps = {
    prBuildFollow: new PrBuildFollow(currentVersion, new PrBuildList(net, INDEX_URL), net, REPO_API),
  } as unknown as HandlerDeps;
  return {
    async state() {
      let response: { result?: { state: unknown }; error?: unknown } = {};
      const rpc = new JsonlServer((line) => {
        response = JSON.parse(line);
      });
      register(rpc, deps);
      await rpc.handleLine(JSON.stringify({ id: 1, method: "system.prBuildState" }));
      expect(response.error).toBeUndefined();
      return response.result?.state;
    },
    asked,
  };
}

describe("following a PR build (system.prBuildState)", () => {
  test("a newer build of the same PR while it is still listed", async () => {
    const e = engine("1.1.2-pr.117", { [INDEX_URL]: LISTED });

    expect(await e.state()).toEqual({
      kind: "listed",
      number: 117,
      newer: {
        number: 117,
        title: "Add PR builds to the channel picker",
        author: "sigboe",
        version: "1.1.2-pr.117.2",
        headSha: "0123456789abcdef0123456789abcdef01234567",
        builtAt: "2026-11-08T09:15:00Z",
        zipSize: 72998400,
      },
    });
    // A listed PR needs no GitHub API call.
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL]);
  });

  test("merged, and the newest beta contains the merge commit: that beta", async () => {
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: RELEASES_AFTER_MERGE,
      [compareTo("v1.1.2-beta.43")]: BETA_43_HAS_MERGE,
    });

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: "1.1.2-beta.43" });
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL, PULL_117, RELEASES, compareTo("v1.1.2-beta.43")]);
  });

  test("a beta identical to the merge commit contains it", async () => {
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: RELEASES_AFTER_MERGE,
      [compareTo("v1.1.2-beta.43")]: { ...(BETA_43_HAS_MERGE as object), status: "identical", ahead_by: 0 },
    });

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: "1.1.2-beta.43" });
  });

  test("merged, but the newest beta lacks the merge commit: still building", async () => {
    const before = (RELEASES_AFTER_MERGE as { tag_name: string }[]).filter((r) => r.tag_name !== "v1.1.2-beta.43");
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: before,
      [compareTo("v1.1.2-beta.42")]: BETA_42_LACKS_MERGE,
    });

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: null });
  });

  test("a beta published after the merge but built without it is not offered", async () => {
    // A beta run that started before the merge can publish after it.
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: RELEASES_AFTER_MERGE,
      [compareTo("v1.1.2-beta.43")]: { ...(BETA_42_LACKS_MERGE as object), status: "diverged", ahead_by: 1 },
    });

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: null });
  });

  test("merged, and a stable release came after the merge: only a beta is offered", async () => {
    const releases = [
      { tag_name: "v1.1.2", draft: false, published_at: "2026-11-10T13:00:00Z" },
      ...(RELEASES_AFTER_MERGE as { tag_name: string }[]).filter((r) => r.tag_name !== "v1.1.2-beta.43"),
    ];
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: releases,
      [compareTo("v1.1.2-beta.42")]: BETA_42_LACKS_MERGE,
    });

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: null });
    expect(e.asked.map((a) => a.url)).not.toContain(compareTo("v1.1.2"));
  });

  test.each([
    ["the releases can't be read", { [RELEASES]: new NetworkError("HTTP 403 rate limited") }],
    [
      "the comparison can't be read",
      { [RELEASES]: RELEASES_AFTER_MERGE, [compareTo("v1.1.2-beta.43")]: new NetworkError("HTTP 404") },
    ],
    [
      "the comparison has no status",
      { [RELEASES]: RELEASES_AFTER_MERGE, [compareTo("v1.1.2-beta.43")]: { ahead_by: 2 } },
    ],
    [
      "GitHub names no merge commit",
      {
        [PULL_117]: { ...(MERGED as object), merge_commit_sha: null },
        [RELEASES]: RELEASES_AFTER_MERGE,
        [compareTo("v1.1.2-beta.43")]: BETA_43_HAS_MERGE,
      },
    ],
  ])("merged, and %s: still building, so Beta is never offered too early", async (_name, answers) => {
    const e = engine("1.1.2-pr.117.2", Object.assign({ [INDEX_URL]: WITHOUT_117, [PULL_117]: MERGED }, answers));

    expect(await e.state()).toEqual({ kind: "merged", number: 117, beta: null });
  });

  test("closed without merging", async () => {
    const e = engine("1.1.2-pr.117.2", { [INDEX_URL]: WITHOUT_117, [PULL_117]: CLOSED });

    expect(await e.state()).toEqual({ kind: "closed", number: 117 });
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL, PULL_117]);
  });

  test("still open but unlisted (the label was removed)", async () => {
    const e = engine("1.1.2-pr.117.2", { [INDEX_URL]: WITHOUT_117, [PULL_117]: OPEN });

    expect(await e.state()).toEqual({ kind: "unlisted", number: 117 });
  });

  test("the running build is the listed one: listed, nothing newer", async () => {
    const e = engine("1.1.2-pr.117.2", { [INDEX_URL]: LISTED });

    expect(await e.state()).toEqual({ kind: "listed", number: 117, newer: null });
  });

  test("asks GitHub without a token", async () => {
    const e = engine("1.1.2-pr.117.2", {
      [INDEX_URL]: WITHOUT_117,
      [PULL_117]: MERGED,
      [RELEASES]: RELEASES_AFTER_MERGE,
      [compareTo("v1.1.2-beta.43")]: BETA_43_HAS_MERGE,
    });

    await e.state();

    expect(e.asked.filter((a) => a.url.startsWith(REPO_API)).map((a) => a.headers?.Authorization)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test.each([
    ["a release", "1.1.1"],
    ["a beta", "1.1.2-beta.43"],
    ["a test build", "1.1.2-test.200"],
  ])("null on %s, without asking anything", async (_name, version) => {
    const e = engine(version, { [INDEX_URL]: LISTED });

    expect(await e.state()).toBeNull();
    expect(e.asked).toEqual([]);
  });

  test("null when the list can't load: a listed PR can't be told from a merged one", async () => {
    const e = engine("1.1.2-pr.117.2", { [INDEX_URL]: new NetworkError("offline") });

    expect(await e.state()).toBeNull();
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL]);
  });

  test("null when GitHub can't say where the PR stands", async () => {
    const e = engine("1.1.2-pr.117.2", { [INDEX_URL]: WITHOUT_117, [PULL_117]: new NetworkError("HTTP 403") });

    expect(await e.state()).toBeNull();
  });
});
