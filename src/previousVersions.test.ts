import { describe, expect, test } from "bun:test";
import { previousVersionsSummary } from "./previousVersions";

describe("Previous versions row summary (#207)", () => {
  test("on, with versions kept: the space and how many addons", () => {
    expect(previousVersionsSummary(true, { bytes: 12_000_000, count: 4 })).toBe(
      "On · 12 MB for 4 addons",
    );
  });

  test("one addon is singular", () => {
    expect(previousVersionsSummary(true, { bytes: 2_500, count: 1 })).toBe(
      "On · 2.5 KB for 1 addon",
    );
  });

  test("on, nothing kept yet", () => {
    expect(previousVersionsSummary(true, { bytes: 0, count: 0 })).toBe("On · None kept");
  });

  test("on, usage not known yet", () => {
    expect(previousVersionsSummary(true, null)).toBe("On");
  });

  test("off with nothing kept", () => {
    expect(previousVersionsSummary(false, { bytes: 0, count: 0 })).toBe("Off");
    expect(previousVersionsSummary(false, null)).toBe("Off");
  });

  test("off while versions from before are still kept names their space", () => {
    expect(previousVersionsSummary(false, { bytes: 12_000_000, count: 4 })).toBe(
      "Off · 12 MB for 4 addons",
    );
  });
});
