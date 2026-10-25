import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanAddons } from "../src/wow/addons/AddonScanner";
import { getAddonsPath } from "../src/wow/installation/InstallationDetector";
import { createInstallationForFlavorDir } from "../src/wow/installation/InstallationDetector";
import { getTocForGameType2 } from "../src/wow/utils/toc";
import { WowClientType } from "../src/wow/types";

const FIXTURE_WOW = join(import.meta.dir, "fixtures/wow/World of Warcraft");

// The checkout marker is an empty `.git` directory, which git itself refuses
// to track: create it here so a fresh clone scans the same fixture.
beforeAll(() => {
  mkdirSync(join(FIXTURE_WOW, "_retail_", "Interface", "AddOns", "GitAddon", ".git"), { recursive: true });
});

describe("AddonScanner", () => {
  test("scans an installation and parses all tocs", async () => {
    const installation = (await createInstallationForFlavorDir(join(FIXTURE_WOW, "_retail_")))!;
    expect(getAddonsPath(installation)).toBe(join(FIXTURE_WOW, "_retail_", "Interface", "AddOns"));

    const folders = await scanAddons(installation);
    const names = folders.map((f) => f.name).sort();
    // hidden dir skipped, toc-less dir skipped
    expect(names).toEqual(["AtlasLootClassic", "ConsolePort", "GitAddon"]);

    const consolePort = folders.find((f) => f.name === "ConsolePort")!;
    expect(consolePort.tocs).toHaveLength(1);
    expect(consolePort.tocs[0]!.title).toBe("Console Port");
    expect(consolePort.fileStats?.isDirectory).toBe(true);

    const atlas = folders.find((f) => f.name === "AtlasLootClassic")!;
    expect(atlas.tocs).toHaveLength(2);

    const gitAddon = folders.find((f) => f.name === "GitAddon")!;
    expect(gitAddon.ignoreReason).toBe("git_repo");
  });

  test("flavor toc selection works per client type", async () => {
    const installation = (await createInstallationForFlavorDir(join(FIXTURE_WOW, "_retail_")))!;
    const folders = await scanAddons(installation);
    const atlas = folders.find((f) => f.name === "AtlasLootClassic")!;

    // retail: base toc wins over -Classic toc
    const retailToc = getTocForGameType2(atlas, WowClientType.Retail);
    expect(retailToc?.fileName).toBe("AtlasLoot.toc");

    const classicToc = getTocForGameType2(atlas, WowClientType.ClassicEra);
    expect(classicToc?.fileName).toBe("AtlasLoot-Classic.toc");
  });

  test("classic era installation scans independently", async () => {
    const installation = (await createInstallationForFlavorDir(join(FIXTURE_WOW, "_classic_era_")))!;
    const folders = await scanAddons(installation);
    expect(folders.map((f) => f.name)).toEqual(["Ace3"]);
    expect(folders[0]!.tocs[0]!.version).toBe("Release-11305-69");
  });

  test("missing AddOns directory yields empty list, not an error", async () => {
    const installation = (await createInstallationForFlavorDir(join(FIXTURE_WOW, "_retail_")))!;
    const farAway = { ...installation, location: "/tmp/opencode/definitely-missing/_retail_" };
    expect(await scanAddons(farAway)).toEqual([]);
  });
});
