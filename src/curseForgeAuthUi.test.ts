/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { shouldShowCurseForgeKeySection, userKeyStatusLabel } from "./curseForgeAuthUi";
import type { CurseForgeAuthStatus } from "./types";

function status(overrides: Partial<CurseForgeAuthStatus> = {}): CurseForgeAuthStatus {
  return {
    activeSource: "bundled",
    bundledPresent: true,
    bundledStatus: "valid",
    userConfigured: false,
    userStatus: "unvalidated",
    ...overrides,
  };
}

describe("shouldShowCurseForgeKeySection", () => {
  test("hidden when the bundled key is confirmed valid", () => {
    expect(shouldShowCurseForgeKeySection(status({ bundledStatus: "valid" }))).toBe(false);
  });

  test("shown when there is no bundled key at all", () => {
    expect(
      shouldShowCurseForgeKeySection(
        status({ bundledPresent: false, bundledStatus: "unvalidated" }),
      ),
    ).toBe(true);
  });

  test("shown when the bundled key is confirmed invalid", () => {
    expect(shouldShowCurseForgeKeySection(status({ bundledStatus: "invalid" }))).toBe(true);
  });

  // A transient failure (not yet a confirmed verdict either way) must
  // still show the section — only a confirmed `valid` bundled key
  // hides it.
  test("shown while bundled status is merely unknown (a transient failure)", () => {
    expect(shouldShowCurseForgeKeySection(status({ bundledStatus: "unknown" }))).toBe(true);
  });

  test("shown during the brief unvalidated startup window", () => {
    expect(shouldShowCurseForgeKeySection(status({ bundledStatus: "unvalidated" }))).toBe(true);
  });

  test("a configured-but-inactive user key never affects visibility on its own", () => {
    expect(
      shouldShowCurseForgeKeySection(
        status({ bundledStatus: "valid", userConfigured: true, userStatus: "valid" }),
      ),
    ).toBe(false);
  });
});

describe("userKeyStatusLabel", () => {
  test("not configured", () => {
    expect(userKeyStatusLabel(status({ userConfigured: false }))).toMatch(/no .* saved/i);
  });

  test("valid (active source is the user key)", () => {
    const label = userKeyStatusLabel(
      status({ userConfigured: true, userStatus: "valid", activeSource: "user" }),
    );
    expect(label).toBe("Your key works");
  });

  test("valid (active source is still the bundled key)", () => {
    const label = userKeyStatusLabel(
      status({ userConfigured: true, userStatus: "valid", activeSource: "bundled" }),
    );
    expect(label).toBe("Your key works");
  });

  test("invalid", () => {
    expect(userKeyStatusLabel(status({ userConfigured: true, userStatus: "invalid" }))).toMatch(
      /rejected/i,
    );
  });

  test("unknown (transient) never says 'invalid' or 'rejected'", () => {
    const label = userKeyStatusLabel(status({ userConfigured: true, userStatus: "unknown" }));
    expect(label).not.toMatch(/invalid|rejected/i);
  });

  test("unvalidated never says 'invalid' or 'rejected'", () => {
    const label = userKeyStatusLabel(status({ userConfigured: true, userStatus: "unvalidated" }));
    expect(label).not.toMatch(/invalid|rejected/i);
  });

  test("never includes anything that looks like a key value", () => {
    for (const userStatus of ["valid", "invalid", "unknown", "unvalidated"] as const) {
      const label = userKeyStatusLabel(status({ userConfigured: true, userStatus }));
      expect(label).not.toMatch(/[a-f0-9]{20,}/i); // no hex-ish long strings
    }
  });
});
