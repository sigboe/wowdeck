import { describe, expect, test } from "bun:test";
import { getTocForGameType, getTocForGameType2 } from "../src/wow/utils/toc";
import { getClientTypeForFolderName, getFolderNameForClientType } from "../src/wow/toc/toc";
import { getClientTypeLabel } from "../src/wow/utils/gametype";
import { WowClientType } from "../src/wow/types";

describe("getTocForGameType", () => {
  const tocs = ["Foo.toc", "Foo-Classic.toc", "Foo-Mainline.toc", "Foo-Vanilla.toc", "Foo-BCC.toc", "Foo-Mists.toc"];

  test("retail prefers -Mainline", () => {
    expect(getTocForGameType(tocs, WowClientType.Retail)).toBe("Foo-Mainline.toc");
  });

  test("classic era prefers -Classic or -Vanilla", () => {
    expect(getTocForGameType(tocs, WowClientType.ClassicEra)).toBe("Foo-Classic.toc");
    expect(getTocForGameType(["Foo.toc", "Foo-Vanilla.toc"], WowClientType.ClassicEra)).toBe("Foo-Vanilla.toc");
  });

  test("classic progression prefers -Mists", () => {
    expect(getTocForGameType(tocs, WowClientType.Classic)).toBe("Foo-Mists.toc");
  });

  test("anniversary prefers -BCC", () => {
    expect(getTocForGameType(tocs, WowClientType.Anniversary)).toBe("Foo-BCC.toc");
  });

  test("falls back to base toc when no flavor toc matches", () => {
    expect(getTocForGameType(["Foo.toc", "Foo-Vanilla.toc"], WowClientType.Retail)).toBe("Foo.toc");
  });

  test("returns empty string when nothing matches", () => {
    expect(getTocForGameType(["Foo-Vanilla.toc"], WowClientType.Retail)).toBe("");
  });

  test("getTocForGameType2 falls back to folder-name match", () => {
    const folder = {
      name: "ATT-Classic",
      path: "/x/ATT-Classic",
      status: "",
      tocs: [{ fileName: "AllTheThings.toc", filePath: "/x/ATT-Classic/AllTheThings.toc", interface: [], dependencyList: [] }],
    };
    const toc = getTocForGameType2(folder, WowClientType.Anniversary);
    expect(toc?.fileName).toBe("AllTheThings.toc");
  });
});

describe("flavor folder mapping", () => {
  test("folder name to client type round trip", () => {
    for (const folder of ["_retail_", "_classic_", "_classic_era_", "_ptr_", "_classic_ptr_", "_classic_era_ptr_", "_beta_", "_classic_beta_", "_xptr_", "_anniversary_"]) {
      const clientType = getClientTypeForFolderName(folder);
      expect(clientType).not.toBe(WowClientType.None);
      expect(getFolderNameForClientType(clientType)).toBe(folder);
    }
  });

  test("unknown folder maps to None", () => {
    expect(getClientTypeForFolderName("_wut_")).toBe(WowClientType.None);
  });

  test("labels are short, CurseForge-style names", () => {
    // Forever matches WowUp's own rename as of v2.24.0 ("WoW Forever
    // support", 2026-10-10) and CurseForge's existing short name for the
    // same client — not the pinned reference checkout, which predates the rename
    // and still called it "MoP Classic Beta".
    expect(getClientTypeLabel(WowClientType.Retail)).toBe("Retail");
    expect(getClientTypeLabel(WowClientType.RetailPtr)).toBe("Retail PTR");
    expect(getClientTypeLabel(WowClientType.RetailXPtr)).toBe("Retail XPTR");
    expect(getClientTypeLabel(WowClientType.Beta)).toBe("Retail Beta");
    expect(getClientTypeLabel(WowClientType.Classic)).toBe("Classic");
    expect(getClientTypeLabel(WowClientType.ClassicPtr)).toBe("Classic PTR");
    expect(getClientTypeLabel(WowClientType.ClassicBeta)).toBe("Forever");
    expect(getClientTypeLabel(WowClientType.ClassicEra)).toBe("Classic Era");
    expect(getClientTypeLabel(WowClientType.ClassicEraPtr)).toBe("Classic Era PTR");
    expect(getClientTypeLabel(WowClientType.Anniversary)).toBe("Anniversary");
  });

  test("unknown client type falls back safely", () => {
    expect(getClientTypeLabel(WowClientType.None)).toBe("Unknown");
  });
});
