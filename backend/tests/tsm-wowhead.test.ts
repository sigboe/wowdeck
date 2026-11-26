import { describe, expect, test } from "bun:test";
import { wowheadSection } from "../src/wow/tsm/Wowhead";
import { WowClientType } from "../src/wow/types";

describe("wowheadSection", () => {
  test.each([
    [WowClientType.Retail, "11.2.7", ""],
    [WowClientType.RetailPtr, "12.1.7", "ptr"],
    [WowClientType.RetailXPtr, undefined, "ptr"],
    [WowClientType.ClassicEra, "1.15.8", "classic"],
    [WowClientType.ClassicEraPtr, "1.15.8", "classic-ptr"],
    [WowClientType.Forever, "1.0.2", "forever"],
    [WowClientType.Classic, "5.5.3", "mop-classic"],
    [WowClientType.Classic, "4.4.2", "cata"],
    [WowClientType.ClassicTitan, "3.80.0", "wotlk"],
    [WowClientType.Anniversary, "2.5.5", "tbc"],
    [WowClientType.Anniversary, "1.15.7", "classic"],
  ] as const)("client %i at %s links to %p", (clientType, version, section) => {
    expect(wowheadSection({ clientType, version })).toBe(section);
  });

  test.each([
    [WowClientType.Beta, "12.0.0"],
    [WowClientType.ClassicBeta, "5.5.0"],
    [WowClientType.ClassicCnBeta, "1.0.0"],
    [WowClientType.ClassicPtr, "5.5.3"],
    [WowClientType.None, "11.0.0"],
  ] as const)("client %i has no section", (clientType, version) => {
    expect(wowheadSection({ clientType, version })).toBeNull();
  });

  test("a progression Classic client without a known version has no section", () => {
    expect(wowheadSection({ clientType: WowClientType.Classic, version: undefined })).toBeNull();
    expect(wowheadSection({ clientType: WowClientType.ClassicTitan, version: "unknown" })).toBeNull();
    expect(wowheadSection({ clientType: WowClientType.Classic, version: "6.0.1" })).toBeNull();
  });
});
