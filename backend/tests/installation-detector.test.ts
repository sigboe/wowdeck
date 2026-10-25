import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createInstallationForFlavorDir,
  findFlavorDirs,
  InstallationDetector,
  parseLibraryFoldersVdf,
} from "../src/wow/installation/InstallationDetector";
import { WowClientType } from "../src/wow/types";

const TMP = "/tmp/opencode/wowdeck-tests/detect";

const PRODUCT_FOR_FLAVOR: Record<string, string> = {
  _retail_: "wow",
  _classic_era_: "wow_classic_era",
  _classic_beta_: "wow_classic_beta",
};

/**
 * Real Blizzard layout: `.build.info` is one shared, pipe-delimited
 * table in the WoW root (not per flavor), with one row per installed
 * product; each flavor dir carries its own `.flavor.info` naming which
 * row is "its" via the Product column. See docs/wow-client-identity.md.
 */
function makeWowRoot(root: string, flavors: string[] = ["_retail_", "_classic_era_"], withBuildInfo = true): void {
  const wowRoot = join(root, "World of Warcraft");
  const rows: string[] = [];
  for (const flavor of flavors) {
    const flavorDir = join(wowRoot, flavor);
    mkdirSync(join(flavorDir, "Interface", "AddOns"), { recursive: true });
    const product = PRODUCT_FOR_FLAVOR[flavor] ?? flavor.replace(/_/g, "");
    writeFileSync(join(flavorDir, ".flavor.info"), `Product Flavor!STRING:0\n${product}\n`);
    if (withBuildInfo) {
      rows.push(`${product}|11.0.2`);
    }
  }
  if (withBuildInfo && rows.length) {
    writeFileSync(
      join(wowRoot, ".build.info"),
      `Product!STRING:0|Version!STRING:0\n${rows.join("\n")}\n`,
    );
  }
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  // Lutris-style install under fake home
  makeWowRoot(join(TMP, "home/Applications"));
  // Steam prefix install
  makeWowRoot(join(TMP, "home/.local/share/Steam/steamapps/compatdata/12345/pfx/drive_c/Program Files (x86)"));
  mkdirSync(join(TMP, "home/.local/share/Steam/steamapps"), { recursive: true });
  writeFileSync(
    join(TMP, "home/.local/share/Steam/steamapps/libraryfolders.vdf"),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${TMP}/home/.local/share/Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${TMP}/steamlib"\n\t}\n}\n`,
  );
  // second library with its own WoW
  makeWowRoot(join(TMP, "steamlib/steamapps/compatdata/999/pfx/drive_c/Program Files (x86)"));
  // SD card
  makeWowRoot(join(TMP, "media/deck/SDCARD"));
  // decoy: dir named like WoW but without flavor dirs
  mkdirSync(join(TMP, "home/Games/World of Warcraft/NotAFlavor"), { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("parseLibraryFoldersVdf", () => {
  test("extracts library paths", () => {
    const vdf = `"libraryfolders"\n{\n"0"\n{\n"path" "/a/b"\n}\n"1"\n{\n"path" "C:\\\\SteamLib"\n}\n}`;
    expect(parseLibraryFoldersVdf(vdf).sort()).toEqual(["/a/b", "C:\\SteamLib"].sort());
  });
});

describe("findFlavorDirs", () => {
  test("finds flavors from wow root", async () => {
    const dirs = await findFlavorDirs(join(TMP, "home/Applications/World of Warcraft"));
    expect(dirs.length).toBeGreaterThan(0);
  });

  test("accepts a flavor dir directly", async () => {
    const dirs = await findFlavorDirs(join(TMP, "home/Applications/World of Warcraft/_retail_"));
    expect(dirs).toHaveLength(1);
  });

  test("accepts a prefix root containing the wow dir", async () => {
    const dirs = await findFlavorDirs(
      join(TMP, "home/.local/share/Steam/steamapps/compatdata/12345/pfx/drive_c/Program Files (x86)"),
    );
    expect(dirs.length).toBeGreaterThan(0);
  });
});

describe("createInstallationForFlavorDir", () => {
  test("maps flavor folder to client type and reads version", async () => {
    const install = await createInstallationForFlavorDir(
      join(TMP, "home/Applications/World of Warcraft/_retail_"),
    );
    expect(install).not.toBeNull();
    expect(install!.clientType).toBe(WowClientType.Retail);
    expect(install!.version).toBe("11.0.2");
    expect(install!.id).toHaveLength(12);
  });

  test("rejects non-flavor dirs", async () => {
    const install = await createInstallationForFlavorDir("/some/dir/NotAFlavor");
    expect(install).toBeNull();
  });
});

describe("InstallationDetector", () => {
  test("detects Lutris, Steam-prefix and SD-card installs, deduped", async () => {
    const detector = new InstallationDetector({
      homeDir: join(TMP, "home"),
      removableMediaBase: join(TMP, "media", "deck"),
    });
    const installs = await detector.detect();
    const locations = installs.map((i) => i.location).sort();
    // home has Applications + Steam compatdata installs; media has SD card copy
    expect(locations.length).toBeGreaterThanOrEqual(3);
    expect(locations.some((l) => l.includes("Applications"))).toBe(true);
    expect(locations.some((l) => l.includes("compatdata/12345"))).toBe(true);
    expect(locations.some((l) => l.includes("SDCARD"))).toBe(true);
    // dedupe: same flavor only once per location
    expect(new Set(installs.map((i) => i.location)).size).toBe(installs.length);
  });

  test("custom paths are scanned", async () => {
    const detector = new InstallationDetector({
      homeDir: join(TMP, "home"),
      customPaths: [join(TMP, "steamlib/steamapps/compatdata/999/pfx/drive_c/Program Files (x86)")],
      scanSteam: false,
      scanRemovableMedia: false,
    });
    const installs = await detector.detect();
    expect(installs.some((i) => i.location.includes("compatdata/999"))).toBe(true);
    expect(installs.every((i) => !i.location.includes("compatdata/12345"))).toBe(true);
  });

  test("decoy without flavor dirs is not detected", async () => {
    const detector = new InstallationDetector({
      homeDir: join(TMP, "home"),
      customPaths: [join(TMP, "home/Games/World of Warcraft")],
      scanSteam: false,
      scanRemovableMedia: false,
    });
    const installs = await detector.detect();
    expect(installs.filter((i) => i.location.includes("home/Games"))).toHaveLength(0);
  });
});
