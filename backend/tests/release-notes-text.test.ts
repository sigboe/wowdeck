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
        "Faster when x < y and a > b; use Vec<T> here",
        "See https://example.com/docs or https://x.com/_private_/y",
        "2 * 3 * 4",
        "code_line *x* # not a heading",
        "Bad  byte",
      ].join("\n"),
    );
  });

  test("notes that are empty once stripped are none", () => {
    expect(releaseNotesText("<!-- -->\n  \n")).toBeNull();
  });
});
