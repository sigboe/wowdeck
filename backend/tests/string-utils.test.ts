import { describe, expect, test } from "bun:test";
import { compareTwoStrings, plainTextSummary } from "../src/wow/utils/string";

describe("plainTextSummary", () => {
  test("README badges and heading marks leave nothing behind (WoWInterface, DEVICE 2026-10-22)", () => {
    const readme =
      "[![Build Status](https://travis-ci.org/WeakAuras/WeakAuras2.svg?branch=master)](https://travis-ci.org/WeakAuras/WeakAuras2)\r\n" +
      "[![Patreon](https://img.shields.io/badge/patreon-donate-orange.svg)](https://www.patreon.com/weakauras)\r\n\r\n" +
      "# WeakAuras 2\r\n\r\nWeakAuras is a powerful and flexible framework.";
    expect(plainTextSummary(readme)).toBe("WeakAuras 2 WeakAuras is a powerful and flexible framework.");
  });

  test("strips html, markdown links and entities", () => {
    expect(
      plainTextSummary(`<p>Quest helper &amp; database.</p><a href="https://x.y">Read more</a>`),
    ).toBe("Quest helper & database. Read more");
    expect(plainTextSummary("See ![alt](https://img) and [docs](https://d.x)")).toBe(
      "See and docs",
    );
    expect(plainTextSummary("Line1\nLine2   spaced")).toBe("Line1 Line2 spaced");
  });

  test("clamps length and drops empty text", () => {
    expect(plainTextSummary("x".repeat(300))!.length).toBe(200);
    expect(plainTextSummary("")).toBeUndefined();
    expect(plainTextSummary("<img src='a'>")).toBeUndefined();
  });
});

describe("compareTwoStrings", () => {
  test("identical strings score 1", () => {
    expect(compareTwoStrings("questie", "questie")).toBe(1);
  });
});
