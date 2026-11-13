/**
 * What local branches, worktrees and stashes are lying around, and which
 * are safe to remove. Run through `make tidy` (dry run) and
 * `make tidy APPLY=1` (removes the removable ones).
 *
 *   bun tools/tidy.ts [--apply]
 *
 * It fetches `origin` with prune, asks `gh` for the open PRs, then reads
 * only local git state. Branches are squashed before they merge here, so
 * "merged" is decided by content, not by ancestry:
 *
 * - `in next`: merging the branch into `origin/next` changes nothing
 *   (`git merge-tree --write-tree` yields `origin/next`'s own tree).
 * - `in PR #n`: the same against an open PR's head branch, or line
 *   containment (below) against it.
 * - `landed (squashed)`: the merge conflicts, but at least
 *   LANDED_THRESHOLD of the branch's added lines (over MIN_LINE chars,
 *   trimmed) are in `origin/next`'s version of their files. The branch's
 *   own diff is read, never the conflicted merge result, so conflict
 *   markers never count as new work.
 * - `unmerged`: anything else. Kept.
 *
 * Never removed: `main`, `next`, the current branch, branches backing an
 * open PR, unmerged branches, dirty worktrees (and their branches), and
 * worktrees holding `.scratch/` notes. Stashes are listed, never dropped.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const LANDED_THRESHOLD = 0.8;
export const MIN_LINE = 25;
const PROTECTED = new Set(["main", "next"]);

export interface OpenPr {
  number: number;
  headRefName: string;
  /** A fork's PR: its head branch is not on `origin`, whatever its name. */
  isCrossRepository?: boolean;
}

export type Verdict = "in next" | `in PR #${number}` | "landed (squashed)" | "unmerged";

export type Keep =
  | "protected"
  | "current"
  | `open PR #${number}`
  | "main worktree"
  | "dirty worktree"
  | "scratch worktree"
  | "locked worktree";

export interface BranchRow {
  name: string;
  sha: string;
  verdict: Verdict;
  /** Why it is kept regardless of verdict. */
  keep?: Keep;
  removable: boolean;
}

export interface WorktreeRow {
  /** Absolute; formatReport shortens it for display. */
  path: string;
  /** Branch name, or null for a detached HEAD. */
  branch: string | null;
  sha: string;
  /**
   * "dirty" has uncommitted changes, "scratch" holds .scratch/ notes,
   * "locked" was locked with `git worktree lock`, "missing" is gone from disk.
   */
  state: "clean" | "dirty" | "scratch" | "locked" | "missing";
  /** Disk use in KiB, or null when it could not be read. */
  sizeKiB: number | null;
  removable: boolean;
}

export interface StashRow {
  ref: string;
  ageDays: number;
  branch: string;
  message: string;
}

export interface Report {
  repo: string;
  branches: BranchRow[];
  worktrees: WorktreeRow[];
  stashes: StashRow[];
}

interface Run {
  code: number;
  out: string;
  err: string;
}

function run(cwd: string, cmd: string[]): Run {
  // process.env passed explicitly: Bun's default is the env at startup.
  const p = Bun.spawnSync(cmd, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
}

function git(cwd: string, ...args: string[]): string {
  const r = run(cwd, ["git", ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.err.trim()}`);
  return r.out.trim();
}

function revParse(repo: string, ref: string): string | null {
  const r = run(repo, ["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return r.code === 0 ? r.out.trim() : null;
}

/** Whether `sha` adds nothing to `target`: ancestor, or a merge that leaves its tree unchanged. */
function mergesClean(repo: string, target: string, sha: string): "same" | "differs" | "conflict" {
  if (run(repo, ["git", "merge-base", "--is-ancestor", sha, target]).code === 0) return "same";
  const r = run(repo, ["git", "merge-tree", "--write-tree", "--no-messages", target, sha]);
  if (r.code === 1) return "conflict";
  if (r.code !== 0) return "differs"; // unrelated histories and the like: treat as new work
  const tree = r.out.split("\n")[0]?.trim();
  return tree === git(repo, "rev-parse", `${target}^{tree}`) ? "same" : "differs";
}

/**
 * Share of the branch's added lines (since its merge base with `target`)
 * found in `target`'s version of their file. Lines the same diff also
 * removes were only moved, so they don't count.
 */
export function containment(repo: string, target: string, sha: string): number {
  const base = run(repo, ["git", "merge-base", target, sha]);
  if (base.code !== 0) return 0;
  const diff = git(
    repo,
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "-U0",
    base.out.trim(),
    sha,
  );
  const targetLines = new Map<string, Set<string>>();
  const linesOf = (path: string): Set<string> => {
    let set = targetLines.get(path);
    if (!set) {
      const shown = run(repo, ["git", "show", `${target}:${path}`]);
      set = new Set(shown.code === 0 ? shown.out.split("\n").map((l) => l.trim()) : []);
      targetLines.set(path, set);
    }
    return set;
  };
  const added: { path: string; text: string }[] = [];
  const removed = new Set<string>();
  let path: string | null = null;
  let inHeader = false; // between "diff --git" and its "+++" line
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      inHeader = true;
    } else if (inHeader) {
      if (l.startsWith("+++ ")) {
        path = l === "+++ /dev/null" ? null : l.slice(6); // strip "+++ b/"
        inHeader = false;
      }
    } else if (path && l.startsWith("+")) {
      const text = l.slice(1).trim();
      if (text.length > MIN_LINE) added.push({ path, text });
    } else if (l.startsWith("-")) {
      removed.add(l.slice(1).trim());
    }
  }
  const counted = added.filter((a) => !removed.has(a.text));
  if (counted.length === 0) return 0;
  return counted.filter((a) => linesOf(a.path).has(a.text)).length / counted.length;
}

function verdictFor(repo: string, sha: string, prTargets: { pr: OpenPr; ref: string }[]): Verdict {
  const next = mergesClean(repo, "origin/next", sha);
  if (next === "same") return "in next";
  for (const { pr, ref } of prTargets) {
    const r = mergesClean(repo, ref, sha);
    if (r === "same") return `in PR #${pr.number}`;
    if (r === "conflict" && containment(repo, ref, sha) >= LANDED_THRESHOLD) {
      return `in PR #${pr.number}`;
    }
  }
  if (next === "conflict" && containment(repo, "origin/next", sha) >= LANDED_THRESHOLD) {
    return "landed (squashed)";
  }
  return "unmerged";
}

interface RawWorktree {
  path: string;
  sha: string;
  branch: string | null;
  prunable: boolean;
  locked: boolean;
}

function listWorktrees(repo: string): RawWorktree[] {
  const out: RawWorktree[] = [];
  for (const block of git(repo, "worktree", "list", "--porcelain").split("\n\n")) {
    const fields = new Map<string, string>();
    for (const l of block.split("\n")) {
      const i = l.indexOf(" ");
      fields.set(i < 0 ? l : l.slice(0, i), i < 0 ? "" : l.slice(i + 1));
    }
    const path = fields.get("worktree");
    if (!path || fields.has("bare")) continue;
    const ref = fields.get("branch");
    out.push({
      path,
      sha: fields.get("HEAD") ?? "",
      branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
      prunable: fields.has("prunable"),
      locked: fields.has("locked"),
    });
  }
  return out;
}

function sizeKiB(path: string): number | null {
  const r = run("/", ["du", "-sk", path]);
  const n = parseInt(r.out, 10);
  return Number.isFinite(n) ? n : null;
}

function hasScratch(path: string): boolean {
  const dir = join(path, ".scratch");
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function listStashes(repo: string, now: Date): StashRow[] {
  const out = git(repo, "stash", "list", "--format=%gd%x09%ct%x09%gs");
  if (!out) return [];
  return out.split("\n").map((l) => {
    const [ref = "", ct = "0", subject = ""] = l.split("\t");
    // "WIP on <branch>: <sha> <msg>" or "On <branch>: <msg>"
    const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject);
    return {
      ref,
      ageDays: Math.floor((now.getTime() - parseInt(ct, 10) * 1000) / 86_400_000),
      branch: m?.[1] ?? "?",
      message: m?.[2] ?? subject,
    };
  });
}

/** Read the repository's branches, worktrees and stashes and decide what is removable. */
export function inspect(repo: string, opts: { openPrs: OpenPr[]; now: Date }): Report {
  const top = git(repo, "rev-parse", "--show-toplevel");
  const current = run(repo, ["git", "symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim();
  const prByBranch = new Map(opts.openPrs.map((pr) => [pr.headRefName, pr]));
  const prTargets = opts.openPrs.flatMap((pr) => {
    if (pr.isCrossRepository) return [];
    const ref = `origin/${pr.headRefName}`;
    return revParse(repo, ref) ? [{ pr, ref }] : [];
  });

  const raw = listWorktrees(repo);
  const mainPath = raw[0]?.path;
  const state = (w: RawWorktree): WorktreeRow["state"] => {
    if (w.prunable || !existsSync(w.path)) return "missing";
    if (w.locked) return "locked";
    if (git(w.path, "status", "--porcelain")) return "dirty";
    return hasScratch(w.path) && w.path !== mainPath ? "scratch" : "clean";
  };
  const worktreeRows = raw.map((w) => ({ w, state: state(w) }));
  const heldBy = new Map(
    worktreeRows.filter((x) => x.w.branch).map((x) => [x.w.branch as string, x]),
  );

  const branches: BranchRow[] = [];
  const refs = git(repo, "for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads");
  for (const l of refs ? refs.split("\n") : []) {
    const [name = "", sha = ""] = l.split("\t");
    const verdict = verdictFor(repo, sha, prTargets);
    const held = heldBy.get(name);
    let keep: Keep | undefined;
    if (PROTECTED.has(name)) keep = "protected";
    else if (name === current) keep = "current";
    else if (prByBranch.has(name)) keep = `open PR #${prByBranch.get(name)?.number ?? 0}`;
    else if (held?.w.path === mainPath) keep = "main worktree";
    else if (held && held.state !== "clean" && held.state !== "missing") {
      keep = `${held.state} worktree`;
    }
    branches.push({ name, sha, verdict, keep, removable: !keep && verdict !== "unmerged" });
  }
  const removableBranch = new Set(branches.filter((b) => b.removable).map((b) => b.name));

  const worktrees: WorktreeRow[] = worktreeRows.map(({ w, state }) => {
    const detachedMerged =
      w.branch === null && state === "clean" && verdictFor(repo, w.sha, prTargets) !== "unmerged";
    const removable =
      w.path !== mainPath &&
      w.path !== top &&
      (state === "missing" ||
        (state === "clean" && (w.branch ? removableBranch.has(w.branch) : detachedMerged)));
    return {
      path: w.path,
      branch: w.branch,
      sha: w.sha,
      state,
      sizeKiB: state === "missing" ? null : sizeKiB(w.path),
      removable,
    };
  });

  return { repo: top, branches, worktrees, stashes: listStashes(repo, opts.now) };
}

/**
 * Remove what `report` marks removable: worktrees first, then branches.
 * A worktree git refuses to remove is reported and keeps its branch.
 * Returns one line per action.
 */
export function apply(repo: string, report: Report): string[] {
  const done: string[] = [];
  const stillHeld = new Set<string>();
  for (const w of report.worktrees) {
    if (!w.removable || w.state === "missing") continue;
    const r = run(repo, ["git", "worktree", "remove", w.path]);
    if (r.code === 0) {
      done.push(`removed worktree ${w.path}`);
    } else {
      done.push(`kept worktree ${w.path}: ${r.err.trim()}`);
      if (w.branch) stillHeld.add(w.branch);
    }
  }
  if (report.worktrees.some((w) => w.state === "missing")) {
    git(repo, "worktree", "prune");
    done.push("pruned missing worktrees");
  }
  for (const b of report.branches) {
    if (!b.removable || stillHeld.has(b.name)) continue;
    git(repo, "branch", "-D", b.name);
    done.push(`deleted branch ${b.name} (was ${b.sha}; restore: git branch ${b.name} ${b.sha})`);
  }
  return done;
}

function humanKiB(kib: number | null): string {
  if (kib === null) return "-";
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)}G`;
  if (kib >= 1024) return `${Math.round(kib / 1024)}M`;
  return `${kib}K`;
}

function table(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>(
    (w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)),
    [],
  );
  return rows.map(
    (r) =>
      "  " +
      r
        .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
        .join("  ")
        .trimEnd(),
  );
}

/** One line per branch, worktree and stash, plus a summary. */
export function formatReport(report: Report, applied: boolean): string {
  const home = process.env.HOME;
  const show = (p: string) => {
    const rel = relative(report.repo, p);
    if (!rel) return ".";
    if (!rel.startsWith("..")) return rel;
    return home && p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
  };
  const mark = (removable: boolean) => (removable ? "rm" : "keep");
  const out: string[] = [];

  const nb = report.branches.filter((b) => b.removable).length;
  out.push(`branches: ${report.branches.length}, ${nb} removable`);
  out.push(
    ...table(
      report.branches.map((b) => [
        mark(b.removable),
        b.name,
        b.verdict,
        b.keep ? `[${b.keep}]` : "",
      ]),
    ),
  );

  const nw = report.worktrees.filter((w) => w.removable).length;
  const total = report.worktrees.reduce((s, w) => s + (w.sizeKiB ?? 0), 0);
  out.push(`worktrees: ${report.worktrees.length}, ${nw} removable, ${humanKiB(total)} total`);
  out.push(
    ...table(
      report.worktrees.map((w) => [
        mark(w.removable),
        show(w.path),
        w.branch ?? `(detached ${w.sha.slice(0, 7)})`,
        w.state,
        humanKiB(w.sizeKiB),
      ]),
    ),
  );

  out.push(`stashes: ${report.stashes.length} (never dropped)`);
  out.push(...table(report.stashes.map((s) => [s.ref, `${s.ageDays}d`, s.branch, s.message])));

  if (!applied && (nb > 0 || nw > 0)) {
    out.push(`dry run: make tidy APPLY=1 removes ${nb} branches and ${nw} worktrees`);
  }
  return out.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const applyFlag = argv.includes("--apply");
  const repo = process.cwd();
  const fetched = run(repo, ["git", "fetch", "--quiet", "--prune", "origin"]);
  if (fetched.code !== 0) {
    console.error(`tidy: git fetch failed: ${fetched.err.trim()}`);
    return 1;
  }
  // Open PRs protect their branches, so a failed lookup stops the run.
  const prs = run(repo, [
    "gh",
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "500",
    "--json",
    "number,headRefName,isCrossRepository",
  ]);
  if (prs.code !== 0) {
    console.error(`tidy: gh pr list failed, so open PRs are unknown: ${prs.err.trim()}`);
    return 1;
  }
  const report = inspect(repo, { openPrs: JSON.parse(prs.out) as OpenPr[], now: new Date() });
  console.log(formatReport(report, applyFlag));
  if (applyFlag) for (const l of apply(repo, report)) console.log(l);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
