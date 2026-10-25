import { CLIENT_FULL_NAMES } from "../src/wow/utils/client-display-names";
import { describe, expect, test } from "bun:test";
import { getClientFullName, getClientTypeLabel, isLegacyAutoDisplayName } from "../src/wow/utils/gametype";
import { WowClientType } from "../src/wow/types";

describe("client display names", () => {
  test("getClientFullName uses WowUp's full names", () => {
    expect(getClientFullName(WowClientType.ClassicBeta)).toBe("World of Warcraft: Forever");
    expect(getClientFullName(WowClientType.Retail)).toBe("World of Warcraft");
  });

  test("getClientTypeLabel uses the short names", () => {
    expect(getClientTypeLabel(WowClientType.ClassicBeta)).toBe("Forever");
  });

  test("isLegacyAutoDisplayName accepts WowUp's full names", () => {
    expect(isLegacyAutoDisplayName("World of Warcraft: Forever")).toBe(true);
    expect(isLegacyAutoDisplayName("My WoW")).toBe(false);
  });
  test("every full name is still recognised as an old auto-generated name", () => {
    for (const name of Object.values(CLIENT_FULL_NAMES)) {
      expect(isLegacyAutoDisplayName(name)).toBe(true);
    }
    expect(Object.keys(CLIENT_FULL_NAMES)).toHaveLength(10);
  });
});
