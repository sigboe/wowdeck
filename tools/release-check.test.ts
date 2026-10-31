import { describe, expect, test } from "bun:test";
import { releaseProblems } from "./release-check";

const changelog = (unreleased: string, version: string) => `# Changelog

## [Unreleased]
${unreleased}
## [1.1.0] - 2026-11-01
${version}
## [1.0.0] - 2026-10-30

- First.

[Unreleased]: https://example.com/compare/v1.1.0...HEAD
`;

const READY = changelog("", "\n### Added\n\n- Something.\n");

describe("releaseProblems", () => {
  test("passes a new version with notes and nothing unreleased", () => {
    expect(releaseProblems("1.1.0", READY, ["v1.0.0", "v1.0.1-beta.4"])).toEqual([]);
  });

  test("refuses entries still under Unreleased", () => {
    const problems = releaseProblems("1.1.0", changelog("\n- Forgotten.\n", "\n- Something.\n"), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("[Unreleased]");
  });

  test("refuses a version without notes", () => {
    const problems = releaseProblems("1.1.0", changelog("", ""), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"## [1.1.0]"');
  });

  test("refuses a version that is already tagged", () => {
    const problems = releaseProblems("1.0.0", READY, ["v1.0.0"]);
    expect(problems).toEqual([expect.stringContaining("already released")]);
  });

  test("refuses a pre-release version", () => {
    const problems = releaseProblems("1.1.0-rc.1", READY, []);
    expect(problems.some((p) => p.includes("not X.Y.Z"))).toBe(true);
  });
});
