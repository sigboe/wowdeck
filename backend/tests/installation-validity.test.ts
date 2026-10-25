/**
 * Installation validity tiers. Fixtures mirror the documented matrix in
 * docs/installation-detection.md, including the real-world reference-
 * Deck layouts (Retail flavor with only Interface/, Classic flavors with
 * executables).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyFlavorDir,
  InstallationDetector,
} from "../src/wow/installation/InstallationDetector";
import { WowClientType } from "../src/wow/types";

const TMP = "/tmp/opencode/wowdeck-tests/validity";

function flavor(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function withExe(dir: string, exe: string): void {
  writeFileSync(join(dir, exe), "MZ fake");
}

function withInterface(dir: string): void {
  mkdirSync(join(dir, "Interface", "AddOns"), { recursive: true });
}

function withWtf(dir: string): void {
  mkdirSync(join(dir, "WTF", "Account"), { recursive: true });
}

/**
 * Real layout: `.build.info` is a shared, pipe-delimited table one
 * directory above the flavor dir, matched by Product against the
 * flavor's own `.flavor.info`. See docs/wow-client-identity.md.
 */
function withBuildInfo(dir: string, version = "11.0.2", product = "wow_test"): void {
  writeFileSync(join(dir, ".flavor.info"), `Product Flavor!STRING:0\n${product}\n`);
  writeFileSync(
    join(dir, "..", ".build.info"),
    `Product!STRING:0|Version!STRING:0\n${product}|${version}\n`,
  );
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("classifyFlavorDir", () => {
  test("valid retail: Wow.exe → confirmed", async () => {
    const dir = flavor(TMP, "retail-exe");
    withExe(dir, "Wow.exe");
    withInterface(dir);
    expect(await classifyFlavorDir(dir)).toBe("confirmed");
  });

  test("valid classic era: WowClassic.exe → confirmed", async () => {
    const dir = flavor(TMP, "era-exe");
    withExe(dir, "WowClassic.exe");
    withInterface(dir);
    expect(await classifyFlavorDir(dir)).toBe("confirmed");
  });

  test("valid classic beta: WowB.exe → confirmed (real reference-Deck layout)", async () => {
    const dir = flavor(TMP, "beta-exe");
    withExe(dir, "WowB.exe");
    withInterface(dir);
    withWtf(dir);
    expect(await classifyFlavorDir(dir)).toBe("confirmed");
  });

  test("arm64 executables count as confirmed", async () => {
    const dir = flavor(TMP, "arm-exe");
    withExe(dir, "WowClassic-arm64.exe");
    expect(await classifyFlavorDir(dir)).toBe("confirmed");
  });

  test("every whitelisted client executable confirms", async () => {
    for (const [i, exe] of [
      "Wow.exe",
      "WowT.exe",
      "WowB.exe",
      "WowClassic.exe",
      "WowClassicT.exe",
      "WowClassicB.exe",
      "Wow-arm64.exe",
    ].entries()) {
      const dir = flavor(TMP, `exe-${i}`);
      withExe(dir, exe);
      expect(await classifyFlavorDir(dir)).toBe("confirmed");
    }
  });

  test("build.info without exe → likely (Battle.net managed, streamed)", async () => {
    const dir = flavor(TMP, "buildinfo");
    withBuildInfo(dir);
    expect(await classifyFlavorDir(dir)).toBe("likely");
  });

  test("Data/ without exe → likely (partial download)", async () => {
    const dir = flavor(TMP, "data");
    mkdirSync(join(dir, "Data"), { recursive: true });
    expect(await classifyFlavorDir(dir)).toBe("likely");
  });

  test("leftover addon data only (Interface/WTF/DLLs) → addon-data, never auto-registered", async () => {
    const dir = flavor(TMP, "leftovers");
    withInterface(dir);
    withWtf(dir);
    writeFileSync(join(dir, "dbghelp.dll"), "fake");
    writeFileSync(join(dir, "WoW.mfil"), "fake");
    expect(await classifyFlavorDir(dir)).toBe("addon-data");
  });

  test("real reference-Deck retail layout (Interface only) → addon-data", async () => {
    const dir = flavor(TMP, "deck-retail");
    withInterface(dir);
    expect(await classifyFlavorDir(dir)).toBe("addon-data");
  });

  test("empty directory → invalid", async () => {
    const dir = flavor(TMP, "empty");
    expect(await classifyFlavorDir(dir)).toBe("invalid");
  });

  test("directory with only random files → invalid", async () => {
    const dir = flavor(TMP, "malformed");
    writeFileSync(join(dir, "notes.txt"), "not a game");
    expect(await classifyFlavorDir(dir)).toBe("invalid");
  });

  test("unrelated executables do not confirm", async () => {
    const dir = flavor(TMP, "other-exe");
    withExe(dir, "Agent.exe");
    withInterface(dir);
    expect(await classifyFlavorDir(dir)).toBe("addon-data");
  });
});

describe("InstallationDetector validity gating", () => {
  const ROOT = join(TMP, "wow");
  const HOME = join(TMP, "home");

  beforeAll(() => {
    // confirmed: era with executable
    const era = flavor(join(ROOT, "World of Warcraft"), "_classic_era_");
    withExe(era, "WowClassic.exe");
    withInterface(era);
    // likely: beta with build info, no exe
    const beta = flavor(join(ROOT, "World of Warcraft"), "_classic_beta_");
    withBuildInfo(beta, "1.15.7");
    withInterface(beta);
    // addon-data: retail with only Interface/ (reference-Deck layout)
    const retail = flavor(join(ROOT, "World of Warcraft"), "_retail_");
    withInterface(retail);
    mkdirSync(HOME, { recursive: true });
  });

  test("detect auto-registers only confirmed and likely tiers", async () => {
    const detector = new InstallationDetector({
      homeDir: HOME,
      customPaths: [ROOT],
      scanSteam: false,
      scanRemovableMedia: false,
    });
    const installs = await detector.detect();
    const labels = installs.map((i) => i.label).sort();
    expect(labels).toEqual(["_classic_beta_", "_classic_era_"]);
    expect(installs.find((i) => i.label === "_classic_beta_")!.clientType).toBe(WowClientType.ClassicBeta);
  });

  test("detectCandidates reports all tiers with sources for the UI", async () => {
    const detector = new InstallationDetector({
      homeDir: HOME,
      customPaths: [ROOT],
      scanSteam: false,
      scanRemovableMedia: false,
    });
    const candidates = await detector.detectCandidates();
    expect(candidates).toHaveLength(3);

    const retail = candidates.find((c) => c.location.endsWith("_retail_"))!;
    expect(retail.validity).toBe("addon-data");
    expect(retail.detectionSource).toBe("custom");

    const era = candidates.find((c) => c.location.endsWith("_classic_era_"))!;
    expect(era.validity).toBe("confirmed");
  });

  test("candidate dedupe keeps the most specific detection source", async () => {
    // same WoW root reachable via custom path and via ~/Applications
    const appsRoot = join(HOME, "Applications", "World of Warcraft");
    mkdirSync(appsRoot, { recursive: true });
    const era2 = flavor(appsRoot, "_classic_era_");
    withExe(era2, "WowClassic.exe");
    withInterface(era2);
    // note: different path than ROOT, so both appear; a true duplicate is
    // the same path probed twice:
    const detector = new InstallationDetector({
      homeDir: HOME,
      customPaths: [ROOT, join(ROOT, "World of Warcraft")],
      scanSteam: false,
      scanRemovableMedia: false,
    });
    const candidates = await detector.detectCandidates();
    const eraCandidates = candidates.filter((c) => c.location.endsWith("_classic_era_") && c.location.startsWith(ROOT));
    expect(eraCandidates).toHaveLength(1);
    expect(eraCandidates[0]!.detectionSource).toBe("custom");
  });
});
