/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { friendlyUrlImportError } from "./urlImportErrors";

describe("friendlyUrlImportError", () => {
  test("maps known provider error codes to a clear sentence, not the raw backend message", () => {
    expect(
      friendlyUrlImportError({
        code: "github_no_compatible_release",
        message:
          "[GitHub] no release compatible with Classic Beta found in the 5 most recent release(s) of WowUp/WowUp.Addon",
      }),
    ).toBe("This repository has no release for your WoW version.");
    expect(
      friendlyUrlImportError({
        code: "github_rate_limited",
        message: "[GitHub] GitHub API rate limit exceeded",
      }),
    ).toMatch(/limiting requests/i);
    expect(
      friendlyUrlImportError({
        code: "github_forbidden",
        message: "[GitHub] repository not accessible",
      }),
    ).toMatch(/private/i);
    expect(friendlyUrlImportError({ code: "source_removed", message: "x" })).toMatch(
      /no longer available/i,
    );
  });

  test("falls back to the backend's own message for an unmapped code (already a clear sentence, never raw exception text)", () => {
    expect(
      friendlyUrlImportError({
        code: "not_found",
        message: "addon for url not found: https://example.com",
      }),
    ).toBe("addon for url not found: https://example.com");
    expect(
      friendlyUrlImportError({
        code: "invalid_input",
        message: "not a recognized GitHub or WowInterface URL",
      }),
    ).toBe("not a recognized GitHub or WowInterface URL");
    expect(friendlyUrlImportError({ code: "unknown_error", message: "some backend message" })).toBe(
      "some backend message",
    );
  });
});
