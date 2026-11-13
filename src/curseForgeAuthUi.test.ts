/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { curseForgeRowState, userKeyStatusLabel } from "./curseForgeAuthUi";
import type { CurseForgeAuthStatus, ProviderInfo } from "./types";

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

describe("curseForgeRowState", () => {
  // The engine's `configured` is the usability rule: true while some key
  // (built-in or the player's) is not known to be rejected.
  const curse = (configured: boolean): ProviderInfo => ({
    id: "Curse",
    name: "CurseForge",
    enabled: configured,
    available: configured,
    requiresApiKey: true,
    configured,
    allowEdit: true,
    catalogSearch: true,
    discovers: true,
  });

  test("no usable key: a > row that opens the key modal", () => {
    const rejected = status({ activeSource: "none", bundledStatus: "invalid" });
    expect(curseForgeRowState(curse(false), rejected)).toBe("keyRow");
    const noBundled = status({
      activeSource: "none",
      bundledPresent: false,
      bundledStatus: "unvalidated",
    });
    expect(curseForgeRowState(curse(false), noBundled)).toBe("keyRow");
  });

  test("both keys rejected: still the > row", () => {
    const both = status({
      activeSource: "none",
      bundledStatus: "invalid",
      userConfigured: true,
      userStatus: "invalid",
    });
    expect(curseForgeRowState(curse(false), both)).toBe("keyRow");
  });

  test("the player's own key in use: a toggle with the API key action", () => {
    for (const userStatus of ["valid", "unknown", "unvalidated"] as const) {
      const own = status({
        activeSource: "user",
        bundledStatus: "invalid",
        userConfigured: true,
        userStatus,
      });
      expect(curseForgeRowState(curse(true), own)).toBe("ownKeyToggle");
    }
  });

  test("built-in access working: a plain toggle", () => {
    expect(curseForgeRowState(curse(true), status())).toBe("toggle");
  });

  test("built-in access not yet checked or briefly failing counts as usable", () => {
    for (const bundledStatus of ["unvalidated", "unknown"] as const) {
      expect(curseForgeRowState(curse(true), status({ bundledStatus }))).toBe("toggle");
    }
  });

  test("a saved key the built-in access outranks: a plain toggle", () => {
    const shadowed = status({ userConfigured: true, userStatus: "valid" });
    expect(curseForgeRowState(curse(true), shadowed)).toBe("toggle");
  });

  test("auth status still loading: the provider's usability decides", () => {
    expect(curseForgeRowState(curse(false), null)).toBe("keyRow");
    expect(curseForgeRowState(curse(true), null)).toBe("toggle");
  });
});
