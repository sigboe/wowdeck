/** The offered build's release notes as plain text (ADR-0004), engine side. */

import { describe, expect, test } from "bun:test";
import { releaseNotesText } from "../src/wow/plugin/ReleaseNotesText";

describe("releaseNotesText", () => {
  test("Markdown becomes plain text", () => {
    const markdown = [
      "## What's Changed",
      "",
      "* **Update channel**: pick _Stable_ or Beta by @sigboe in https://github.com/sigboe/wowdeck/pull/24",
      "- See [the docs](https://example.com/docs) ![badge](https://x/b.svg)",
      "<!-- generated -->",
      "<script>alert(1)</script>Fixed `/reload` &amp; more",
      "",
      "",
      "",
      "**Full Changelog**: https://github.com/sigboe/wowdeck/compare/v0.2.0...v0.3.0",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      [
        "What's Changed",
        "",
        "• Update channel: pick Stable or Beta by @sigboe in https://github.com/sigboe/wowdeck/pull/24",
        "• See the docs",
        "alert(1)Fixed /reload & more",
        "",
        "Full Changelog: https://github.com/sigboe/wowdeck/compare/v0.2.0...v0.3.0",
      ].join("\n"),
    );
  });

  test("plain text that only looks like markup stays as written", () => {
    const markdown = [
      "Faster when x < y and a > b; use Vec<T> here",
      "See <https://example.com/docs> or https://x.com/_private_/y",
      "2 * 3 * 4",
      "```",
      "code_line *x* # not a heading",
      "```",
      "Bad \u0001 byte",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      [
        "Faster when x < y and a > b; use Vec<T> here See https://example.com/docs or https://x.com/_private_/y 2 * 3 * 4",
        "code_line *x* # not a heading",
        "Bad  byte",
      ].join("\n"),
    );
  });

  test("a wrapped bullet joins into one line", () => {
    const markdown = [
      "- Beta updates: pick Beta in the update panel to get new",
      "  features early, or Stable to stay on releases.",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      "• Beta updates: pick Beta in the update panel to get new features early, or Stable to stay on releases.",
    );
  });

  test("a wrapped paragraph joins; bullets, headings and blank lines keep their lines", () => {
    const markdown = [
      "Players on a slow connection see",
      "   progress sooner.",
      "",
      "",
      "### Fixed",
      "- One",
      "- Two that wraps",
      "  onto a second line",
      "1. Numbered",
      "",
      "Next paragraph.",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      [
        "Players on a slow connection see progress sooner.",
        "",
        "Fixed",
        "• One",
        "• Two that wraps onto a second line",
        "1. Numbered",
        "",
        "Next paragraph.",
      ].join("\n"),
    );
  });

  test("code fence lines stay verbatim, indentation included", () => {
    const markdown = [
      "Run this:",
      "```",
      "if (x) {",
      "  reload();",
      "}",
      "```",
      "Then wait.",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      ["Run this:", "if (x) {", "  reload();", "}", "Then wait."].join("\n"),
    );
  });

  test("nested bullets, rules, tables, hard breaks and removed markup keep their lines", () => {
    const markdown = [
      "- Top",
      "  - Nested that wraps",
      "    onto two lines",
      "",
      "Title",
      "-----",
      "Ends with a hard break  ",
      "next line",
      "| a | b |",
      "| 1 | 2 |",
      "para",
      "* * *",
      "after",
      "<!-- note -->",
      "continued?",
    ].join("\n");
    expect(releaseNotesText(markdown)).toBe(
      [
        "• Top",
        "  • Nested that wraps",
        "    onto two lines",
        "",
        "Title",
        "-----",
        "Ends with a hard break",
        "next line",
        "| a | b |",
        "| 1 | 2 |",
        "para",
        "• * *",
        "after",
        "continued?",
      ].join("\n"),
    );
  });

  test("notes that are empty once stripped are none", () => {
    expect(releaseNotesText("<!-- -->\n  \n")).toBeNull();
  });
});
