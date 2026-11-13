import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, formatReport, inspect, type OpenPr, type Report } from "./tidy";

// Throwaway repos: a bare `origin` and a clone, no network, no user config.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_COMMITTER_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

// tidy's own git calls read process.env (Bun's spawn ignores later edits otherwise).
beforeAll(() => Object.assign(process.env, ENV));

let root: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

/** Write files (path → lines) and commit them on the checked-out branch. */
function commit(cwd: string, message: string, files: Record<string, string[]>): string {
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), lines.join("\n") + "\n");
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

const line = (n: number, tag = "") =>
  `export const value${n} = "a line long enough to count ${tag}";`;
const lines = (from: number, to: number, tag = "") =>
  Array.from({ length: to - from + 1 }, (_, i) => line(from + i, tag));

const NOW = new Date("2026-11-12T12:00:00Z");

function report(openPrs: OpenPr[] = []): Report {
  return inspect(repo, { openPrs, now: NOW });
}

function branch(r: Report, name: string) {
  const found = r.branches.find((b) => b.name === name);
  if (!found) throw new Error(`no branch ${name} in report`);
  return found;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tidy-test-"));
  git(root, "init", "-q", "--bare", "-b", "next", "origin.git");
  repo = join(root, "repo");
  git(root, "clone", "-q", join(root, "origin.git"), "repo");
  git(repo, "checkout", "-q", "-b", "next");
  commit(repo, "base", {
    ".gitignore": [".scratch/"],
    "src/a.ts": lines(1, 10),
    "src/b.ts": lines(11, 20),
  });
  git(repo, "push", "-q", "origin", "next");
  git(repo, "branch", "-q", "main");
  git(repo, "push", "-q", "origin", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Land `name` on origin/next as one squashed commit, the way a PR merges here. */
function squashIntoNext(name: string, edit?: (files: Record<string, string[]>) => void) {
  git(repo, "checkout", "-q", "next");
  git(repo, "merge", "-q", "--squash", name);
  if (edit) {
    const files: Record<string, string[]> = {};
    edit(files);
    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(repo, path), content.join("\n") + "\n");
    }
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `squashed ${name}`);
  git(repo, "push", "-q", "origin", "next");
}

describe("inspect: branch verdicts", () => {
  test("a fast-forward merged branch is in next", () => {
    git(repo, "checkout", "-q", "-b", "ff");
    commit(repo, "ff work", { "src/c.ts": lines(30, 35) });
    git(repo, "checkout", "-q", "next");
    git(repo, "merge", "-q", "--ff-only", "ff");
    git(repo, "push", "-q", "origin", "next");

    const ff = branch(report(), "ff");
    expect(ff.verdict).toBe("in next");
    expect(ff.removable).toBe(true);
  });

  test("a squash-merged branch is in next, though git branch --merged says otherwise", () => {
    git(repo, "checkout", "-q", "-b", "squashed");
    commit(repo, "one", { "src/c.ts": lines(30, 35) });
    commit(repo, "two", { "src/d.ts": lines(40, 45) });
    squashIntoNext("squashed");

    expect(git(repo, "branch", "--merged", "origin/next")).not.toContain("squashed");
    expect(branch(report(), "squashed").verdict).toBe("in next");
  });

  test("a branch squashed and then edited in review has landed", () => {
    git(repo, "checkout", "-q", "-b", "reviewed");
    commit(repo, "work", { "src/c.ts": lines(30, 39) });
    squashIntoNext("reviewed", (files) => {
      files["src/c.ts"] = [...lines(30, 38), line(39, "after review")];
    });

    const reviewed = branch(report(), "reviewed");
    expect(reviewed.verdict).toBe("landed (squashed)");
    expect(reviewed.removable).toBe(true);
  });

  test("a conflicted branch with under 80% of its added lines in next is unmerged", () => {
    git(repo, "checkout", "-q", "-b", "landed");
    commit(repo, "edit a", {
      "src/a.ts": [...lines(1, 3), ...lines(4, 6, "branch"), ...lines(7, 10)],
    });
    squashIntoNext("landed");
    commit(repo, "later edit on next", {
      "src/a.ts": [
        ...lines(1, 3),
        ...lines(4, 6, "branch"),
        ...lines(7, 7, "next later"),
        ...lines(8, 10),
      ],
    });
    git(repo, "push", "-q", "origin", "next");
    // Work added after the squash: a line next never got.
    git(repo, "checkout", "-q", "landed");
    commit(repo, "touch line 7 too", {
      "src/a.ts": [
        ...lines(1, 3),
        ...lines(4, 6, "branch"),
        ...lines(7, 7, "branch only"),
        ...lines(8, 10),
      ],
    });
    git(repo, "checkout", "-q", "next");

    // 3 of 4 added lines landed: 75%, under the threshold.
    expect(branch(report(), "landed").verdict).toBe("unmerged");
  });

  test("a conflicted branch whose added lines are all in next has landed", () => {
    git(repo, "checkout", "-q", "-b", "conflicted");
    commit(repo, "edit a", {
      "src/a.ts": [...lines(1, 3), ...lines(4, 6, "branch"), ...lines(7, 10)],
    });
    squashIntoNext("conflicted");
    commit(repo, "next edits the next line", {
      "src/a.ts": [
        ...lines(1, 3),
        ...lines(4, 6, "branch"),
        line(7, "next later"),
        ...lines(8, 10),
      ],
    });
    git(repo, "push", "-q", "origin", "next");

    const merge = Bun.spawnSync(
      ["git", "merge-tree", "--write-tree", "origin/next", "conflicted"],
      { cwd: repo, env: ENV },
    );
    expect(merge.exitCode).toBe(1); // conflicts

    expect(branch(report(), "conflicted").verdict).toBe("landed (squashed)");
  });

  test("lines a branch only moved do not count as landed", () => {
    git(repo, "checkout", "-q", "-b", "moved");
    // Move lines 1-5 below line 10 and add one new line: only that line is new work.
    commit(repo, "move", {
      "src/a.ts": [...lines(6, 9), line(10), ...lines(1, 5), line(99, "new")],
    });
    git(repo, "checkout", "-q", "next");
    commit(repo, "next edits line 10", { "src/a.ts": [...lines(1, 9), line(10, "next")] });
    git(repo, "push", "-q", "origin", "next");

    expect(branch(report(), "moved").verdict).toBe("unmerged");
  });

  test("a branch with new work is unmerged and kept", () => {
    git(repo, "checkout", "-q", "-b", "fresh");
    commit(repo, "new", { "src/c.ts": lines(30, 35) });
    git(repo, "checkout", "-q", "next");
    git(repo, "checkout", "-q", "-b", "clash");
    commit(repo, "clash", {
      "src/a.ts": [...lines(1, 4), ...lines(5, 6, "clash"), ...lines(7, 10)],
    });
    git(repo, "checkout", "-q", "next");
    commit(repo, "next edits the same lines", {
      "src/a.ts": [...lines(1, 4), ...lines(5, 6, "next"), ...lines(7, 10)],
    });
    git(repo, "push", "-q", "origin", "next");

    const r = report();
    for (const name of ["fresh", "clash"]) {
      expect(branch(r, name).verdict).toBe("unmerged");
      expect(branch(r, name).removable).toBe(false);
    }
  });
});

describe("inspect: protection", () => {
  test("an open PR's branch is kept; its pre-squash backup is in that PR and removable", () => {
    git(repo, "checkout", "-q", "-b", "feat/x");
    commit(repo, "one", { "src/c.ts": lines(30, 35) });
    commit(repo, "two", { "src/d.ts": lines(40, 45) });
    git(repo, "branch", "-q", "backup/feat-x-pre-squash");
    git(repo, "reset", "-q", "--soft", "next");
    git(repo, "commit", "-q", "-m", "feat x");
    git(repo, "push", "-q", "origin", "feat/x");
    git(repo, "checkout", "-q", "next");

    const r = report([{ number: 7, headRefName: "feat/x" }]);
    expect(branch(r, "feat/x")).toMatchObject({
      verdict: "in PR #7",
      keep: "open PR #7",
      removable: false,
    });
    expect(branch(r, "backup/feat-x-pre-squash")).toMatchObject({
      verdict: "in PR #7",
      removable: true,
    });
  });

  test("a fork PR's head is not matched to a same-named branch on origin", () => {
    git(repo, "checkout", "-q", "-b", "fix");
    commit(repo, "fix", { "src/c.ts": lines(30, 35) });
    git(repo, "push", "-q", "origin", "fix");
    git(repo, "branch", "-q", "fix-copy");
    git(repo, "checkout", "-q", "next");

    const r = report([{ number: 5, headRefName: "fix", isCrossRepository: true }]);
    expect(branch(r, "fix-copy").verdict).toBe("unmerged");
    expect(branch(r, "fix")).toMatchObject({ keep: "open PR #5", removable: false });
  });

  test("main, next and the current branch are kept even when merged", () => {
    git(repo, "checkout", "-q", "-b", "here");
    const r = report();
    expect(branch(r, "here")).toMatchObject({
      verdict: "in next",
      keep: "current",
      removable: false,
    });
    expect(branch(r, "main").removable).toBe(false);
    expect(branch(r, "next").removable).toBe(false);
  });
});

describe("inspect: worktrees and stashes", () => {
  function worktree(name: string): string {
    const path = join(root, `wt-${name}`);
    git(repo, "worktree", "add", "-q", "-b", name, path, "next");
    return path;
  }

  test("a clean worktree of a merged branch is removable; dirty and scratch ones are kept", () => {
    worktree("clean");
    writeFileSync(join(worktree("dirty"), "notes.txt"), "work in progress\n");
    const scratch = worktree("scratch");
    mkdirSync(join(scratch, ".scratch", "190"), { recursive: true });
    writeFileSync(join(scratch, ".scratch", "190", "log.txt"), "a run log\n"); // ignored, so not dirty

    git(repo, "worktree", "lock", worktree("locked"));

    const r = report();
    const wt = (b: string) => r.worktrees.find((w) => w.branch === b);
    expect(wt("locked")).toMatchObject({ state: "locked", removable: false });
    expect(branch(r, "locked")).toMatchObject({ keep: "locked worktree", removable: false });
    expect(wt("clean")).toMatchObject({ state: "clean", removable: true });
    expect(wt("dirty")).toMatchObject({ state: "dirty", removable: false });
    expect(wt("scratch")).toMatchObject({ state: "scratch", removable: false });
    expect(wt("clean")?.sizeKiB).toBeGreaterThan(0);
    expect(branch(r, "dirty")).toMatchObject({ keep: "dirty worktree", removable: false });
    expect(branch(r, "scratch")).toMatchObject({ keep: "scratch worktree", removable: false });
    expect(r.worktrees.find((w) => w.branch === "next")?.removable).toBe(false); // the main worktree
  });

  test("a worktree whose directory is gone is listed as missing and prunable", async () => {
    await rm(worktree("gone"), { recursive: true, force: true });
    const gone = report().worktrees.find((w) => w.branch === "gone");
    expect(gone).toMatchObject({ state: "missing", removable: true });
  });

  test("stashes are listed with their age and source branch", () => {
    git(repo, "checkout", "-q", "-b", "release-prep");
    writeFileSync(join(repo, "src/a.ts"), "bumped\n");
    const threeDaysAgo = Math.floor(NOW.getTime() / 1000) - 3 * 86_400;
    const stash = Bun.spawnSync(["git", "stash", "push", "-q", "-m", "version bump"], {
      cwd: repo,
      env: { ...ENV, GIT_COMMITTER_DATE: `${threeDaysAgo} +0000` },
    });
    expect(stash.exitCode).toBe(0);

    expect(report().stashes).toEqual([
      { ref: "stash@{0}", ageDays: 3, branch: "release-prep", message: "version bump" },
    ]);
  });
});

describe("apply", () => {
  test("removes removable branches and worktrees and keeps the rest", () => {
    // merged + clean worktree, merged + dirty worktree, unmerged, open PR
    git(repo, "worktree", "add", "-q", "-b", "done", join(root, "wt-done"), "next");
    git(repo, "worktree", "add", "-q", "-b", "wip", join(root, "wt-wip"), "next");
    writeFileSync(join(root, "wt-wip", "wip.txt"), "wip\n");
    git(repo, "branch", "-q", "pr-branch", "next");
    git(repo, "checkout", "-q", "-b", "reviewed");
    commit(repo, "work", { "src/d.ts": lines(50, 59) });
    squashIntoNext("reviewed", (files) => {
      files["src/d.ts"] = [...lines(50, 58), line(59, "after review")];
    });
    git(repo, "checkout", "-q", "-b", "unmerged");
    commit(repo, "new", { "src/c.ts": lines(30, 35) });
    git(repo, "checkout", "-q", "next");
    const doneSha = git(repo, "rev-parse", "done");

    const r = report([{ number: 9, headRefName: "pr-branch" }]);
    const log = apply(repo, r);

    const left = git(repo, "branch", "--format=%(refname:short)").split("\n").sort();
    expect(left).toEqual(["main", "next", "pr-branch", "unmerged", "wip"]);
    expect(existsSync(join(root, "wt-done"))).toBe(false);
    expect(existsSync(join(root, "wt-wip", "wip.txt"))).toBe(true);
    expect(log).toContain(
      `deleted branch done (was ${doneSha}; restore: git branch done ${doneSha})`,
    );
  });

  test("prunes worktrees whose directory is gone", async () => {
    git(repo, "worktree", "add", "-q", "-b", "gone", join(root, "wt-gone"), "next");
    await rm(join(root, "wt-gone"), { recursive: true, force: true });
    apply(repo, report());
    expect(git(repo, "worktree", "list")).not.toContain("wt-gone");
    expect(git(repo, "branch", "--list", "gone")).toBe("");
  });
});

describe("formatReport", () => {
  test("prints one line per branch, worktree and stash, and the dry-run hint", () => {
    git(repo, "branch", "-q", "done", "next");
    git(repo, "worktree", "add", "-q", "-b", "wt", join(root, "wt"), "next");
    const r = report();
    const text = formatReport(r, false);
    const rows = r.branches.length + r.worktrees.length + r.stashes.length;
    expect(text.split("\n")).toHaveLength(rows + 4); // 3 headers + hint
    expect(text).toMatch(/^ {2}rm +done +in next$/m);
    expect(text).toContain("dry run: make tidy APPLY=1 removes 2 branches and 1 worktrees");
    expect(formatReport(r, true)).not.toContain("dry run");
  });
});
