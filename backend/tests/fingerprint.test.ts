import { describe, expect, test } from "bun:test";
import { computeWowUpFingerprints, scanWowUpFolder } from "../src/wow/addons/FingerprintScanner";
import { compareTwoStrings } from "../src/wow/utils/string";
import { getGameVersion } from "../src/wow/utils/gameversion";

const ADDON_DIR = import.meta.dir + "/fixtures/wow/World of Warcraft/_retail_/Interface/AddOns/ConsolePort";

describe("WowUp fingerprint scanner", () => {
  test("hashes the files WoW loads (toc + bindings.xml)", async () => {
    const result = await scanWowUpFolder(ADDON_DIR);
    expect(result.source).toBe("wowup");
    expect(result.folderName).toBe("ConsolePort");
    // ConsolePort.toc + bindings.xml (toc references bindings.xml include)
    expect(result.fileCount).toBe(2);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  test("fingerprint is stable across runs", async () => {
    const a = await scanWowUpFolder(ADDON_DIR);
    const b = await scanWowUpFolder(ADDON_DIR);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test("fingerprints differ when file contents differ", async () => {
    const root = "/tmp/opencode/wowdeck-tests/fp";
    // note: the wowup toc regex requires <Folder>/<Folder>.toc naming
    const dirA = `${root}/TestAddonA`;
    const dirB = `${root}/TestAddonB`;
    for (const [dir, name] of [
      [dirA, "TestAddonA"],
      [dirB, "TestAddonB"],
    ] as const) {
      await Bun.write(`${dir}/${name}.toc`, `## Title: ${name}\n${name}.lua\n`);
    }
    await Bun.write(`${dirA}/TestAddonA.lua`, "print('a')\n");
    await Bun.write(`${dirB}/TestAddonB.lua`, "print('b')\n");
    const fpA = await scanWowUpFolder(dirA);
    expect(fpA.fileCount).toBe(2);
    const fpB = await scanWowUpFolder(dirB);
    expect(fpB.fileCount).toBe(2);
    // identical structure, different bytes -> different md5 inputs
    expect(fpA.fingerprint).not.toBe(fpB.fingerprint);
  });

  test("computeWowUpFingerprints attaches results to folders", async () => {
    const folders: import("../src/wow/models").AddonFolder[] = [
      {
        name: "ConsolePort",
        path: ADDON_DIR,
        status: "",
        tocs: [],
      },
      {
        name: "GitAddon",
        path: ADDON_DIR + "/../GitAddon",
        status: "Ignored",
        ignoreReason: "git_repo" as const,
        tocs: [],
      },
    ];
    await computeWowUpFingerprints(folders);
    expect(folders[0]!.scanResults?.wowup).toBeDefined();
    expect(folders[1]!.scanResults).toBeUndefined();
  });
});

describe("string similarity", () => {
  test("identical strings score 1", () => {
    expect(compareTwoStrings("elvui", "elvui")).toBe(1);
  });

  test("disjoint strings score low", () => {
    expect(compareTwoStrings("elvui", "deadly boss mods")).toBeLessThan(0.3);
  });

  test("case-insensitive usage mirrors string-similarity package", () => {
    // known value from the string-similarity package docs behavior
    const score = compareTwoStrings("elvui".toLowerCase(), "ElvUI".toLowerCase());
    expect(score).toBe(1);
  });
});

describe("game version", () => {
  test("interface code to version triple", () => {
    expect(getGameVersion("110005")).toBe("11.00.05");
    expect(getGameVersion("11503")).toBe("1.15.03");
    expect(getGameVersion("11.0.2")).toBe("11.0.2");
    expect(getGameVersion(undefined)).toBe("0.0.0");
  });
});
