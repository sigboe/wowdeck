import { describe, expect, test } from "bun:test";
import { curseForgeFileVersion } from "../src/wow/providers/curseforge/fileVersion";

// Real display names from a real install, 2026-10-17.
describe("curseForgeFileVersion", () => {
  const day = "2026-10-16T08:00:00Z";
  test("an author's own version text stays as it is", () => {
    expect(curseForgeFileVersion("12.1.15-3-gc539b0a", day)).toBe("12.1.15-3-gc539b0a");
    expect(curseForgeFileVersion("v4.11.23-127-g5966adf", day)).toBe("v4.11.23-127-g5966adf");
    expect(curseForgeFileVersion("Details.20261015.15339.172", day)).toBe("Details.20261015.15339.172");
    expect(curseForgeFileVersion("837", day)).toBe("837");
  });
  test("a file name gives its trailing version", () => {
    expect(curseForgeFileVersion("AtlasLootClassic-Continued-12488.zip", day)).toBe("12488");
    expect(curseForgeFileVersion("Peggle+ (Flight Minigames) 2.3.1.zip", day)).toBe("2.3.1");
    expect(curseForgeFileVersion("WoWTranslator_V2.09.zip", day)).toBe("2.09");
  });
  test("a file name without a version gives the release day", () => {
    expect(curseForgeFileVersion("ControllerForever.zip", day)).toBe("16 Oct release");
    expect(curseForgeFileVersion("KicoreControllerFishingFix.zip", day)).toBe("16 Oct release");
  });
});
