import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideAction,
  isMaintainerRole,
  nextPrBuildVersion,
  planPublish,
  type PrBuildEntry,
  type PrState,
  withBuild,
} from "./pr-build";

function entry(number: number, version: string): PrBuildEntry {
  return {
    number,
    title: `PR ${number}`,
    author: "someone",
    version,
    headSha: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-11-09T12:00:00Z",
    zipSize: 73_000_000,
    sha256: "ab".repeat(32),
    zipUrl: `https://sigboe.github.io/wowdeck/pr/${number}/WoWDeck.zip`,
  };
}

describe("nextPrBuildVersion", () => {
  test("a first build bumps the newest stable tag's patch and appends the PR number", () => {
    expect(nextPrBuildVersion(["v1.0.0", "v1.1.1", "v1.1.0"], 117, { builds: [] })).toBe(
      "1.1.2-pr.117",
    );
  });

  test("orders stable tags numerically and ignores pre-releases, as for betas", () => {
    const tags = ["v0.9.0", "v0.10.0", "v0.10.1-beta.4", "v9.9.9-rc1", "v0.11.0-beta.1"];
    expect(nextPrBuildVersion(tags, 5, { builds: [] })).toBe("0.10.1-pr.5");
  });

  test("a rebuild of a listed PR counts its builds from 2", () => {
    const tags = ["v1.1.1"];
    expect(nextPrBuildVersion(tags, 117, { builds: [entry(117, "1.1.2-pr.117")] })).toBe(
      "1.1.2-pr.117.2",
    );
    expect(nextPrBuildVersion(tags, 117, { builds: [entry(117, "1.1.2-pr.117.9")] })).toBe(
      "1.1.2-pr.117.10",
    );
  });

  test("the counter keeps counting when a new stable release moves the base", () => {
    expect(
      nextPrBuildVersion(["v1.1.1", "v1.2.0"], 117, { builds: [entry(117, "1.1.2-pr.117.3")] }),
    ).toBe("1.2.1-pr.117.4");
  });

  test("a relabel after the PR left the list counts on from its last published build", () => {
    const index = { builds: [], published: { "117": "1.1.2-pr.117.3" } };
    expect(nextPrBuildVersion(["v1.1.1"], 117, index)).toBe("1.1.2-pr.117.4");
  });

  test("counts on from the higher of the listed and the last published build", () => {
    const index = {
      builds: [entry(117, "1.1.2-pr.117.2")],
      published: { "117": "1.1.2-pr.117.5" },
    };
    expect(nextPrBuildVersion(["v1.1.1"], 117, index)).toBe("1.1.2-pr.117.6");
  });

  test("never goes below a published build, even when the newest stable tag is gone", () => {
    const index = { builds: [], published: { "117": "1.2.1-pr.117" } };
    expect(nextPrBuildVersion(["v1.1.1"], 117, index)).toBe("1.2.1-pr.117.2");
  });

  test("other PRs' builds do not count", () => {
    expect(nextPrBuildVersion(["v1.1.1"], 117, { builds: [entry(118, "1.1.2-pr.118.4")] })).toBe(
      "1.1.2-pr.117",
    );
  });
});

describe("decideAction", () => {
  test("a push by a maintainer to a labeled PR builds it", () => {
    expect(decideAction({ event: "synchronize", labeled: true, senderIsMaintainer: true })).toBe(
      "build",
    );
  });

  test("a push by anyone else to a labeled PR strips the label", () => {
    expect(decideAction({ event: "synchronize", labeled: true, senderIsMaintainer: false })).toBe(
      "strip-label",
    );
  });

  test("a merged or closed PR is unlisted, whoever closed it", () => {
    for (const senderIsMaintainer of [true, false]) {
      expect(decideAction({ event: "closed", labeled: true, senderIsMaintainer })).toBe("unlist");
      expect(decideAction({ event: "closed", labeled: false, senderIsMaintainer })).toBe("unlist");
    }
  });

  test("removing the pr-build label unlists the PR", () => {
    expect(
      decideAction({
        event: "unlabeled",
        label: "pr-build",
        labeled: false,
        senderIsMaintainer: true,
      }),
    ).toBe("unlist");
  });

  test("adding the pr-build label builds the PR", () => {
    expect(
      decideAction({
        event: "labeled",
        label: "pr-build",
        labeled: true,
        senderIsMaintainer: true,
      }),
    ).toBe("build");
  });

  test("adding or removing another label changes nothing", () => {
    expect(
      decideAction({ event: "labeled", label: "bug", labeled: true, senderIsMaintainer: true }),
    ).toBe("skip");
    expect(
      decideAction({ event: "unlabeled", label: "bug", labeled: true, senderIsMaintainer: true }),
    ).toBe("skip");
  });

  test("a push to an unlabeled PR changes nothing, whoever pushed", () => {
    for (const senderIsMaintainer of [true, false]) {
      expect(decideAction({ event: "synchronize", labeled: false, senderIsMaintainer })).toBe(
        "skip",
      );
    }
  });

  test("reopening a labeled PR rebuilds it for a maintainer and keeps the label for anyone", () => {
    expect(decideAction({ event: "reopened", labeled: true, senderIsMaintainer: true })).toBe(
      "build",
    );
    expect(decideAction({ event: "reopened", labeled: true, senderIsMaintainer: false })).toBe(
      "skip",
    );
    expect(decideAction({ event: "reopened", labeled: false, senderIsMaintainer: true })).toBe(
      "skip",
    );
  });

  test("opening a PR changes nothing; the labeled event that follows builds it", () => {
    for (const senderIsMaintainer of [true, false]) {
      expect(decideAction({ event: "opened", labeled: true, senderIsMaintainer })).toBe("skip");
    }
  });

  test("any other event changes nothing", () => {
    expect(decideAction({ event: "edited", labeled: true, senderIsMaintainer: false })).toBe(
      "skip",
    );
  });
});

describe("isMaintainerRole", () => {
  test("triage access or higher is a maintainer", () => {
    for (const role of ["triage", "write", "maintain", "admin"]) {
      expect(isMaintainerRole(role)).toBe(true);
    }
  });

  test("read access, no access or an unknown role is not", () => {
    for (const role of ["read", "none", "", "custom-role"]) {
      expect(isMaintainerRole(role)).toBe(false);
    }
  });
});

describe("withBuild", () => {
  const ten = Array.from({ length: 10 }, (_, i) => entry(100 + i, `1.1.2-pr.${100 + i}`));

  test("lists a new build, newest PR first", () => {
    const result = withBuild({ builds: [entry(5, "1.1.2-pr.5")] }, entry(7, "1.1.2-pr.7"));
    expect(result).toEqual({
      ok: true,
      index: { builds: [entry(7, "1.1.2-pr.7"), entry(5, "1.1.2-pr.5")] },
    });
  });

  test("a rebuild replaces the PR's old build", () => {
    const result = withBuild(
      { builds: [entry(7, "1.1.2-pr.7"), entry(5, "1.1.2-pr.5")] },
      entry(5, "1.1.2-pr.5.2"),
    );
    expect(result).toEqual({
      ok: true,
      index: { builds: [entry(7, "1.1.2-pr.7"), entry(5, "1.1.2-pr.5.2")] },
    });
  });

  test("refuses an 11th build", () => {
    const result = withBuild({ builds: ten }, entry(200, "1.1.2-pr.200"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refused).toContain("10");
  });

  test("a rebuild of one of 10 listed PRs is not refused", () => {
    const result = withBuild({ builds: ten }, entry(104, "1.1.2-pr.104.2"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index.builds).toHaveLength(10);
      expect(result.index.builds.find((b) => b.number === 104)?.version).toBe("1.1.2-pr.104.2");
    }
  });
});

const SHA = "0123456789abcdef0123456789abcdef01234567";
const NEWER = "fedcba9876543210fedcba9876543210fedcba98";

function pr(number: number, changes: Partial<PrState> = {}): PrState {
  return { number, state: "open", labels: ["pr-build"], headSha: SHA, ...changes };
}

describe("planPublish", () => {
  test("lists a build of an open, labeled PR still at the built commit", () => {
    const build = entry(7, "1.1.2-pr.7");
    const plan = planPublish(
      { builds: [entry(5, "1.1.2-pr.5")] },
      { pr: 7, action: "build", build, prs: [pr(5), pr(7)] },
    );
    expect(plan.index.builds).toEqual([build, entry(5, "1.1.2-pr.5")]);
    expect(plan.upload).toBe(true);
    expect(plan.comment?.create).toBe(true);
    expect(plan.comment?.body).toContain("1.1.2-pr.7");
    expect(plan.comment?.body).toContain(SHA);
    expect(plan.comment?.body).toContain(build.zipUrl);
  });

  test("remembers every published build's version after its PR leaves the list", () => {
    const listed = [entry(5, "1.1.2-pr.5.3"), entry(6, "1.1.2-pr.6")];
    const built = planPublish(
      { builds: listed, published: { "4": "1.1.2-pr.4.2" } },
      { pr: 7, action: "build", build: entry(7, "1.1.2-pr.7"), prs: [pr(6), pr(7)] },
    );
    expect(built.index.builds.map((b) => b.number)).toEqual([7, 6]);
    expect(built.index.published).toEqual({
      "4": "1.1.2-pr.4.2",
      "5": "1.1.2-pr.5.3",
      "6": "1.1.2-pr.6",
      "7": "1.1.2-pr.7",
    });

    const unlisted = planPublish(built.index, {
      pr: 7,
      action: "unlist",
      prs: [pr(6), pr(7, { state: "closed" })],
    });
    expect(unlisted.index.builds.map((b) => b.number)).toEqual([6]);
    expect(unlisted.index.published).toEqual(built.index.published);
  });

  test("a refused build is not remembered: nothing was published under its version", () => {
    const ten = Array.from({ length: 10 }, (_, i) => entry(100 + i, `1.1.2-pr.${100 + i}`));
    const plan = planPublish(
      { builds: ten },
      {
        pr: 7,
        action: "build",
        build: entry(7, "1.1.2-pr.7"),
        prs: [...ten.map((b) => pr(b.number)), pr(7)],
      },
    );
    expect(plan.index.published?.["7"]).toBeUndefined();
  });

  test("drops builds whose PR is closed, unlabeled, past the built commit or unknown", () => {
    const listed = [1, 2, 3, 4, 5].map((n) => entry(n, `1.1.2-pr.${n}`));
    const plan = planPublish(
      { builds: listed },
      {
        pr: 9,
        action: "unlist",
        prs: [
          pr(1, { state: "closed" }),
          pr(2, { labels: ["bug"] }),
          pr(3, { headSha: NEWER }),
          pr(5),
          pr(9, { state: "closed" }),
        ],
      },
    );
    expect(plan.index.builds).toEqual([entry(5, "1.1.2-pr.5")]);
    expect(plan.upload).toBe(false);
  });

  test("does not list a build whose PR moved on while it was built", () => {
    const plan = planPublish(
      { builds: [] },
      { pr: 7, action: "build", build: entry(7, "1.1.2-pr.7"), prs: [pr(7, { headSha: NEWER })] },
    );
    expect(plan).toEqual({ index: { builds: [], published: {} }, upload: false, comment: null });
  });

  test("refuses an 11th build and says why on the PR", () => {
    const ten = Array.from({ length: 10 }, (_, i) => entry(100 + i, `1.1.2-pr.${100 + i}`));
    const plan = planPublish(
      { builds: ten },
      {
        pr: 7,
        action: "build",
        build: entry(7, "1.1.2-pr.7"),
        prs: [...ten.map((b) => pr(b.number)), pr(7)],
      },
    );
    expect(plan.index.builds).toEqual(ten);
    expect(plan.upload).toBe(false);
    expect(plan.comment?.create).toBe(true);
    expect(plan.comment?.body).toContain("10 PR builds are already listed");
  });

  test("a stripped label is said on the PR", () => {
    const plan = planPublish(
      { builds: [entry(7, "1.1.2-pr.7")] },
      { pr: 7, action: "strip-label", prs: [pr(7, { labels: [], headSha: NEWER })] },
    );
    expect(plan.index.builds).toEqual([]);
    expect(plan.comment?.create).toBe(true);
    expect(plan.comment?.body).toContain("someone other than a maintainer");
  });

  test("an unlisted build edits the PR's comment but never starts one", () => {
    const plan = planPublish(
      { builds: [entry(7, "1.1.2-pr.7")] },
      { pr: 7, action: "unlist", prs: [pr(7, { state: "closed" })] },
    );
    expect(plan.index.builds).toEqual([]);
    expect(plan.comment?.create).toBe(false);
    expect(plan.comment?.body).toContain("removed");
  });

  test("closing a PR that had no build says nothing", () => {
    const plan = planPublish(
      { builds: [] },
      { pr: 7, action: "unlist", prs: [pr(7, { state: "closed", labels: [] })] },
    );
    expect(plan.comment).toBeNull();
  });

  test("a PR labeled again before its unlist ran keeps its build", () => {
    const plan = planPublish(
      { builds: [entry(7, "1.1.2-pr.7")] },
      { pr: 7, action: "unlist", prs: [pr(7)] },
    );
    expect(plan).toEqual({
      index: { builds: [entry(7, "1.1.2-pr.7")], published: { "7": "1.1.2-pr.7" } },
      upload: false,
      comment: null,
    });
  });
});

describe("command line", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pr-build-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function run(args: string[], stdin: string): Promise<{ out: string; code: number }> {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/pr-build.ts`, ...args], {
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    return { out, code: await proc.exited };
  }

  async function indexFile(builds: PrBuildEntry[]): Promise<string> {
    const path = join(dir, "index.json");
    await Bun.write(path, JSON.stringify({ builds }));
    return path;
  }

  test("action reads the event facts as JSON from stdin", async () => {
    const facts = { event: "synchronize", labeled: true, senderIsMaintainer: false };
    expect(await run(["action"], JSON.stringify(facts))).toEqual({
      out: "strip-label\n",
      code: 0,
    });
  });

  test("next-version reads tags from stdin and the PR's build from the list", async () => {
    const path = await indexFile([entry(117, "1.1.2-pr.117")]);
    expect(await run(["next-version", "117", path], "v1.1.0\nv1.1.1\n")).toEqual({
      out: "1.1.2-pr.117.2\n",
      code: 0,
    });
  });

  test("next-version counts on from a PR the list no longer shows", async () => {
    const path = join(dir, "index.json");
    await Bun.write(path, JSON.stringify({ builds: [], published: { "117": "1.1.2-pr.117.2" } }));
    expect(await run(["next-version", "117", path], "v1.1.1\n")).toEqual({
      out: "1.1.2-pr.117.3\n",
      code: 0,
    });
  });

  test("a missing list file is an empty list", async () => {
    const path = join(dir, "absent.json");
    expect(await run(["next-version", "117", path], "v1.1.1\n")).toEqual({
      out: "1.1.2-pr.117\n",
      code: 0,
    });
  });

  test("is-maintainer prints whether a role is a maintainer's", async () => {
    expect(await run(["is-maintainer", "triage"], "")).toEqual({ out: "true\n", code: 0 });
    expect(await run(["is-maintainer", "read"], "")).toEqual({ out: "false\n", code: 0 });
  });

  test("publish reads the facts from stdin and prints the plan", async () => {
    const path = await indexFile([entry(5, "1.1.2-pr.5")]);
    const facts = { pr: 5, action: "unlist", prs: [pr(5, { state: "closed" })] };
    const result = await run(["publish", path], JSON.stringify(facts));
    expect(result.code).toBe(0);
    const plan = JSON.parse(result.out);
    expect(plan.index.builds).toEqual([]);
    expect(plan.upload).toBe(false);
    expect(plan.comment.create).toBe(false);
  });

  test("publish rejects facts with a malformed PR state", async () => {
    const path = await indexFile([]);
    const facts = { pr: 5, action: "unlist", prs: [{ number: 5, state: "open" }] };
    expect((await run(["publish", path], JSON.stringify(facts))).code).toBe(1);
  });

  test("rejects a PR number that is not a positive integer", async () => {
    expect((await run(["next-version", "abc", join(dir, "index.json")], "v1.1.1\n")).code).toBe(1);
  });
});
