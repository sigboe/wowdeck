import { describe, expect, test } from "bun:test";
import { sectionNotes } from "./release-notes";

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Added

- Beta channel.

## [0.2.0] - 2026-10-25

### Fixed

- Updates install.

## [0.1.0] - 2026-10-24

## [0.0.9] - 2026-10-23

- Last one.

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0
`;

describe("sectionNotes", () => {
  test("returns the unreleased section's body", () => {
    expect(sectionNotes(CHANGELOG, "Unreleased")).toBe("### Added\n\n- Beta channel.");
  });

  test("matches a version heading with a date suffix and stops at the next heading", () => {
    expect(sectionNotes(CHANGELOG, "0.2.0")).toBe("### Fixed\n\n- Updates install.");
  });

  test("stops at the link references after the last section", () => {
    expect(sectionNotes(CHANGELOG, "0.0.9")).toBe("- Last one.");
  });

  test("is null for an empty or missing section", () => {
    expect(sectionNotes(CHANGELOG, "0.1.0")).toBeNull();
    expect(sectionNotes(CHANGELOG, "9.9.9")).toBeNull();
  });

  test("does not match a version by prefix", () => {
    expect(sectionNotes(CHANGELOG, "0.2")).toBeNull();
  });
});
