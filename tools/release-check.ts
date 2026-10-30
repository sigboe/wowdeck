/**
 * Whether the tree can be released as `<version>`: the checks a PR into
 * `main` must pass (.github/workflows/ci.yml, "Release gate") and that the
 * release workflow (.github/workflows/release.yml) repeats before it
 * publishes. Merging `next` into `main` is the release, so a gap found here
 * after the merge is already too late.
 *
 *   git tag -l 'v*' | bun tools/release-check.ts <version> [CHANGELOG.md]
 *
 * Tags arrive one per line on stdin. Problems go to stderr, one per line,
 * and fail the run; a releasable tree prints nothing and exits 0.
 */
import { sectionNotes } from "./release-notes";

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Every reason `version` cannot be released from this changelog; empty when it can. */
export function releaseProblems(version: string, changelog: string, tags: string[]): string[] {
  const problems: string[] = [];
  if (!STABLE.test(version)) {
    problems.push(`version ${version} is not X.Y.Z; run make version-set VERSION=X.Y.Z on next`);
  }
  if (tags.includes(`v${version}`)) {
    problems.push(`v${version} is already released; bump the version with make version-set on next`);
  }
  if (sectionNotes(changelog, version) === null) {
    problems.push(`CHANGELOG.md has no notes under "## [${version}]"`);
  }
  if (sectionNotes(changelog, "Unreleased") !== null) {
    problems.push(
      `CHANGELOG.md still has entries under "## [Unreleased]"; move them into "## [${version}]"`,
    );
  }
  return problems;
}

async function main(argv: string[]): Promise<number> {
  const [version, path = "CHANGELOG.md", ...rest] = argv;
  if (!version || rest.length > 0) {
    console.error("usage: release-check.ts <X.Y.Z> [CHANGELOG.md]  (tags on stdin)");
    return 1;
  }
  const tags = (await Bun.stdin.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const problems = releaseProblems(version, await Bun.file(path).text(), tags);
  for (const problem of problems) console.error(problem);
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
