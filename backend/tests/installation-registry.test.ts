import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationDetector } from "../src/wow/installation/InstallationDetector";
import { WowClientType } from "../src/wow/types";

let root: string;
let home: string;
let prefix: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wowdeck-registry-"));
  home = join(root, "home");
  prefix = join(home, ".local/share/Steam/steamapps/compatdata/123/pfx");
  mkdirSync(join(prefix, "dosdevices"), { recursive: true });
  mkdirSync(join(prefix, "drive_c"), { recursive: true });
  symlinkSync("../drive_c", join(prefix, "dosdevices/c:"));
  symlinkSync("/", join(prefix, "dosdevices/z:"));
  writeFileSync(
    join(home, ".local/share/Steam/steamapps/libraryfolders.vdf"),
    `"path" "${home}/.local/share/Steam"`,
  );
  writeFileSync(join(home, ".local/share/Steam/steamapps/appmanifest_123.acf"), '"appid" "123"');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function detector(customPaths: string[] = []) {
  return new InstallationDetector({ homeDir: home, customPaths, scanRemovableMedia: false });
}
function flavor(wowRoot: string, name: string, evidence = "Wow.exe") {
  const path = join(wowRoot, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, evidence), "");
  return path;
}
function registry(
  path: string,
  target = prefix,
  section = "Software\\Wow6432Node\\Blizzard Entertainment\\World of Warcraft",
  value = "InstallPath",
) {
  writeFileSync(
    join(target, "system.reg"),
    `WINE REGISTRY Version 2\n\n[${section.replaceAll("\\", "\\\\")}] 1730000000\n"${value}"="${path.replaceAll("\\", "\\\\")}"\n`,
  );
}

test("a C drive flavor entry discovers every sibling and preserves validity tiers", async () => {
  const wow = join(prefix, "drive_c/Games/World of Warcraft");
  const retail = flavor(wow, "_retail_");
  const era = flavor(wow, "_classic_era_", "Data");
  rmSync(join(era, "Data"));
  mkdirSync(join(era, "Data"));
  const beta = flavor(wow, "_classic_beta_", "placeholder");
  mkdirSync(join(beta, "Interface"));
  flavor(wow, "_forever_", "placeholder"); // invalid, no game or addon evidence
  registry("C:\\Games\\World of Warcraft\\_retail_\\");
  expect(await detector().detectCandidates()).toEqual(
    [
      {
        location: retail,
        clientType: WowClientType.Retail,
        validity: "confirmed" as const,
        detectionSource: "prefix-registry" as const,
      },
      {
        location: era,
        clientType: WowClientType.ClassicEra,
        validity: "likely" as const,
        detectionSource: "prefix-registry" as const,
      },
      {
        location: beta,
        clientType: WowClientType.ClassicBeta,
        validity: "addon-data" as const,
        detectionSource: "prefix-registry" as const,
      },
    ].sort((a, b) => a.clientType - b.clientType),
  );
  expect((await detector().detect()).map((i) => i.location).sort()).toEqual([retail, era].sort());
});

test("a Lutris prefix under the default Games library is visited without system.yml", async () => {
  const lutris = join(home, "Games/battlenet");
  mkdirSync(join(lutris, "dosdevices"), { recursive: true });
  symlinkSync("/", join(lutris, "dosdevices/z:"));
  const wow = join(root, "elsewhere/World of Warcraft");
  const retail = flavor(wow, "_retail_");
  registry(`Z:${wow.replaceAll("/", "\\")}\\_retail_\\`, lutris);
  expect((await detector().detectCandidates()).map((i) => i.location)).toEqual([retail]);
});

test("D drive symlinks discover an SD install without following raw device entries", async () => {
  const mount = join(root, "sd");
  const retail = flavor(join(mount, "World of Warcraft"), "_retail_");
  symlinkSync(mount, join(prefix, "dosdevices/d:"));
  symlinkSync("/dev/does-not-exist", join(prefix, "dosdevices/d::"));
  registry("D:\\World of Warcraft\\");
  expect((await detector().detectCandidates()).map((i) => i.location)).toEqual([retail]);
  rmSync(join(prefix, "dosdevices/d:"));
  expect(await detector().detectCandidates()).toEqual([]);
});

function fixture(name: string): string {
  return readFileSync(
    join(import.meta.dir, "fixtures/installation-registry", name),
    "utf8",
  ).replaceAll(String.raw`Z:\\home\\<user>`, `Z:${home.replaceAll("/", "\\\\")}`);
}

test("recorded Z path shapes find Retail beside Forever and Beta and retain registry priority", async () => {
  const wow = join(home, "Applications/World of Warcraft");
  const retail = flavor(wow, "_retail_");
  const forever = flavor(wow, "_forever_");
  const beta = flavor(wow, "_classic_beta_");
  const era = flavor(wow, "_classic_era_");
  writeFileSync(join(prefix, "system.reg"), fixture("blizzard-system.reg"));
  const candidates = await detector().detectCandidates();
  expect(candidates.map((i) => [i.location, i.clientType, i.detectionSource])).toEqual(
    [
      [retail, WowClientType.Retail, "prefix-registry"],
      [beta, WowClientType.ClassicBeta, "prefix-registry"],
      [era, WowClientType.ClassicEra, "prefix-registry"],
      [forever, WowClientType.Forever, "prefix-registry"],
    ].sort((a, b) => Number(a[1]) - Number(b[1])),
  );
  expect(
    (await detector([wow]).detectCandidates()).every((i) => i.detectionSource === "custom"),
  ).toBe(true);
});

test("case differences resolve to disk names, while ambiguous segments are skipped", async () => {
  const wow = join(prefix, "drive_c/Games/World of Warcraft");
  const retail = flavor(wow, "_retail_");
  registry("c:\\games\\WORLD OF WARCRAFT\\_RETAIL_\\");
  expect((await detector().detectCandidates()).map((i) => i.location)).toEqual([retail]);
  flavor(join(prefix, "drive_c/gAMES/World of Warcraft"), "_retail_");
  expect(await detector().detectCandidates()).toEqual([]);
  // An exact path wins even on a filesystem with two case variants.
  registry("C:\\Games\\World of Warcraft\\_retail_\\");
  expect((await detector().detectCandidates()).map((i) => i.location)).toEqual([retail]);
});

test.each(["lutris", "bottles", "flatpak-bottles", "custom"])(
  "%s prefix registries discover an installation outside their prefix",
  async (launcher) => {
    const launcherPrefix =
      launcher === "lutris"
        ? join(root, "library/battlenet")
        : launcher === "bottles"
          ? join(home, ".local/share/bottles/bottles/WoW")
          : launcher === "flatpak-bottles"
            ? join(home, ".var/app/com.usebottles.bottles/data/bottles/bottles/WoW")
            : join(root, "custom-prefix");
    mkdirSync(join(launcherPrefix, "dosdevices"), { recursive: true });
    symlinkSync("/", join(launcherPrefix, "dosdevices/z:"));
    if (launcher === "lutris") {
      mkdirSync(join(home, ".config/lutris"), { recursive: true });
      writeFileSync(join(home, ".config/lutris/system.yml"), `game_path: ${root}/library\n`);
    }
    const wow = join(root, "external/World of Warcraft");
    const era = flavor(wow, "_classic_era_");
    registry(
      `Z:${wow.replaceAll("/", "\\")}`,
      launcherPrefix,
      "Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\World of Warcraft Classic Era",
      "InstallLocation",
    );
    expect(
      await detector(launcher === "custom" ? [launcherPrefix] : []).detectCandidates(),
    ).toEqual([
      {
        location: era,
        clientType: WowClientType.ClassicEra,
        validity: "confirmed" as const,
        detectionSource: "prefix-registry" as const,
      },
    ]);
  },
);

test.each(["missing", "unreadable", "stale", "private-server", "unmapped", "ambiguous"])(
  "%s registry hits cannot stop other discoveries or expose registry data in logs",
  async (variant) => {
    const independent = flavor(join(root, "independent/World of Warcraft"), "_retail_");
    const secret = "account-token-do-not-log";
    if (variant === "unreadable") mkdirSync(join(prefix, "system.reg")); // EISDIR even when run as root
    if (variant === "stale") registry(`Z:\\missing\\${secret}\\_forever_\\`);
    if (variant === "private-server") {
      mkdirSync(join(home, "Applications/TurtleWoW"), { recursive: true });
      writeFileSync(join(home, "Applications/TurtleWoW/Wow.exe"), "");
      writeFileSync(join(prefix, "system.reg"), fixture("private-server-system.reg"));
    }
    if (variant === "unmapped") registry(`Q:\\${secret}\\World of Warcraft`);
    if (variant === "ambiguous") {
      flavor(join(prefix, "drive_c/Games/World of Warcraft"), "_retail_");
      flavor(join(prefix, "drive_c/gAMES/World of Warcraft"), "_retail_");
      registry("C:\\games\\World of Warcraft");
    }
    const logs: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      expect((await detector([independent]).detect()).map((i) => i.location)).toEqual([
        independent,
      ]);
      const registryLogs = logs.filter(
        (args) => JSON.parse(String(args[0])).component === "prefix-registry",
      );
      if (!["private-server"].includes(variant)) expect(registryLogs.length).toBeGreaterThan(0);
      for (const args of registryLogs) {
        expect(args).toHaveLength(1);
        expect(JSON.parse(String(args[0]))).toEqual({
          component: "prefix-registry",
          reason: {
            "private-server": undefined,
            missing: "missing-registry",
            unreadable: "unreadable-registry",
            stale: "missing-path",
            unmapped: "unmapped-drive",
            ambiguous: "ambiguous-path",
          }[variant],
        });
      }
      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(JSON.stringify(logs)).not.toContain(root);
    } finally {
      spy.mockRestore();
    }
  },
);

test("only WoW Blizzard keys supply paths; user.reg and product.db never supply candidates", async () => {
  const wow = join(root, "hidden/World of Warcraft");
  flavor(wow, "_retail_");
  const path = `Z:${wow.replaceAll("/", "\\")}`;
  registry(path, prefix, "Software\\Wow6432Node\\Blizzard Entertainment\\Battle.net");
  writeFileSync(join(prefix, "user.reg"), readFileSync(join(prefix, "system.reg")));
  writeFileSync(join(prefix, "product.db"), readFileSync(join(prefix, "system.reg")));
  expect(await detector().detectCandidates()).toEqual([]);
  // Put a valid WoW record only in the forbidden files, leaving system.reg unrelated.
  const unrelated = readFileSync(join(prefix, "system.reg"));
  registry(path);
  const valid = readFileSync(join(prefix, "system.reg"));
  writeFileSync(join(prefix, "user.reg"), valid);
  writeFileSync(join(prefix, "product.db"), valid);
  writeFileSync(join(prefix, "system.reg"), unrelated);
  expect(await detector().detectCandidates()).toEqual([]);
});

test("each detected flavor logs every source that found it, without paths", async () => {
  const wow = join(home, "Applications/World of Warcraft");
  flavor(wow, "_forever_");
  registry(`Z:${wow.replaceAll("/", "\\")}\\_forever_\\`);
  const lines: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  try {
    await detector([wow]).detectCandidates();
  } finally {
    spy.mockRestore();
  }
  const logs = lines.map((l) => JSON.parse(l)).filter((l) => l.component === "detection");
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ flavor: "_forever_", validity: "confirmed" });
  expect(logs[0].sources[0]).toBe("custom");
  expect(logs[0].sources).toContain("prefix-registry");
  expect(lines.join("\n")).not.toContain(root);
});

test.each([null, "/no-such-grep-executable"])("registry discovery works when grep is unavailable or fails (%s)", async (grep) => {
  const { prefixRegistryDiscoveries } = await import("../src/wow/installation/PrefixRegistry");
  const retail = flavor(join(root, "outside/World of Warcraft"), "_retail_");
  registry(`Z:${retail.replaceAll("/", "\\")}`);
  const which = spyOn(Bun, "which").mockReturnValue(grep);
  try {
    expect((await prefixRegistryDiscoveries([prefix])).flatMap(r => r.roots)).toEqual([join(retail, "..")]);
  } finally {
    which.mockRestore();
  }
});

test("grep handles newline filenames and searches batches beyond the first 128 registries", async () => {
  const { prefixRegistryDiscoveries } = await import("../src/wow/installation/PrefixRegistry");
  const prefixes: string[] = [];
  for (let i = 0; i < 129; i++) {
    const p = join(root, `prefix ${i}\nline`);
    mkdirSync(p);
    writeFileSync(join(p, "system.reg"), "WINE REGISTRY Version 2\n");
    prefixes.push(p);
  }
  const last = prefixes.at(-1)!;
  mkdirSync(join(last, "dosdevices"));
  symlinkSync("/", join(last, "dosdevices/z:"));
  const retail = flavor(join(root, "outside/World of Warcraft"), "_retail_");
  registry(`Z:${retail.replaceAll("/", "\\")}`, last);
  expect((await prefixRegistryDiscoveries(prefixes)).flatMap(r => r.roots)).toEqual([join(retail, "..")]);
});
