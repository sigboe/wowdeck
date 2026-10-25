import { describe, expect, test } from "bun:test";
import { parseUrlAllowingMissingScheme } from "../src/wow/providers/url-parsing";

describe("parseUrlAllowingMissingScheme", () => {
  test("parses a URL that already has a scheme, unchanged", () => {
    expect(parseUrlAllowingMissingScheme("https://github.com/owner/repo")?.href).toBe(
      "https://github.com/owner/repo",
    );
  });

  test("falls back to https:// when no scheme is present", () => {
    const url = parseUrlAllowingMissingScheme("github.com/owner/repo");
    expect(url?.protocol).toBe("https:");
    expect(url?.hostname).toBe("github.com");
  });

  test("returns null for genuinely invalid input, even with the fallback", () => {
    expect(parseUrlAllowingMissingScheme("not a url at all")).toBeNull();
    expect(parseUrlAllowingMissingScheme("")).toBeNull();
  });

  test("does not override an existing non-https scheme", () => {
    const url = parseUrlAllowingMissingScheme("ftp://example.com/file");
    expect(url?.protocol).toBe("ftp:");
  });
});
