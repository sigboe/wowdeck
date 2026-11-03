import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationDetector } from "../src/wow/installation/InstallationDetector";
import { WowClientType } from "../src/wow/types";

let home: string;
let steam: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wowdeck-shortcuts-"));
  steam = join(home, ".local/share/Steam");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function detector() {
  return new InstallationDetector({ homeDir: home, scanRemovableMedia: false });
}

// Synthetic binary KeyValues fixture, including fields Steam writes that discovery ignores.
function shortcuts(user: string, entries: Array<{ appid: number; exe: string; start: string }>) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const records = entries.map((entry, index) => {
    const appid = Buffer.alloc(4);
    appid.writeUInt32LE(entry.appid);
    return Buffer.concat([
      Buffer.from(`\0${index}\0\x02appid\0`),
      appid,
      string("AppName", "World of Warcraft"),
      string("Exe", entry.exe),
      string("StartDir", entry.start),
      Buffer.from("\0tags\0"),
      string("0", "Game"),
      Buffer.from([8, 8]),
    ]);
  });
  const config = join(steam, "userdata", user, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "shortcuts.vdf"),
    Buffer.concat([Buffer.from("\0shortcuts\0"), ...records, Buffer.from([8, 8])]),
  );
}

function flavor(path: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "Wow.exe"), "");
  return path;
}

test("a quoted WoW executable shortcut discovers a launcher-free installation", async () => {
  const retail = flavor(join(home, "unusual/client/_retail_"));
  shortcuts("100", [{ appid: 3000000001, exe: `\"${retail}/Wow.exe\"`, start: "" }]);
  expect(await detector().detectCandidates()).toEqual([
    {
      location: retail,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "steam-shortcut",
    },
  ]);
  expect((await detector().detect()).map((installation) => installation.location)).toEqual([
    retail,
  ]);
});

test("all Steam users contribute Exe and StartDir folder candidates with unchanged validity", async () => {
  const retail = flavor(join(home, "first/root/_retail_"));
  const era = join(home, "second/root/_classic_era_");
  mkdirSync(join(era, "Data"), { recursive: true });
  const beta = join(home, "third/root/_classic_beta_");
  mkdirSync(join(beta, "Interface"), { recursive: true });
  shortcuts("100", [{ appid: 3000000001, exe: retail, start: "" }]);
  shortcuts("200", [{ appid: 3000000002, exe: join(era, ".."), start: "" }]);
  steam = join(home, ".steam/steam");
  shortcuts("300", [{ appid: 3000000003, exe: "/missing/launcher.exe", start: `"${beta}"` }]);
  shortcuts("400", [{ appid: 3000000004, exe: "", start: join(era, "..") }]);
  expect(await detector().detectCandidates()).toEqual([
    {
      location: retail,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "steam-shortcut",
    },
    {
      location: beta,
      clientType: WowClientType.ClassicBeta,
      validity: "addon-data",
      detectionSource: "steam-shortcut",
    },
    {
      location: era,
      clientType: WowClientType.ClassicEra,
      validity: "likely",
      detectionSource: "steam-shortcut",
    },
  ]);
  expect((await detector().detect()).map((installation) => installation.location)).toEqual([
    retail,
    era,
  ]);
});

function prefix(appId: number, target: string, library = steam) {
  const path = join(library, "steamapps/compatdata", String(appId), "pfx");
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "system.reg"),
    `[Software\\\\Wow6432Node\\\\Blizzard Entertainment\\\\World of Warcraft]\n"InstallPath"="Z:${target.replaceAll("/", "\\\\")}"\n`,
  );
  return path;
}

test("registry discovery keeps live shortcut and installed Steam app prefixes, skipping deleted shortcuts", async () => {
  const live = flavor(join(home, "live/_retail_"));
  const native = flavor(join(home, "native/_classic_era_"));
  const stale = flavor(join(home, "stale/_classic_beta_"));
  prefix(3000000001, live);
  const library = join(home, "external-library");
  prefix(123, native, library);
  writeFileSync(join(steam, "steamapps/libraryfolders.vdf"), `"path" "${library}"`);
  prefix(3000000002, stale);
  // Real drive mappings, including Z: outside the prefix.
  for (const id of [3000000001, 123, 3000000002]) {
    const path = join(
      id === 123 ? library : steam,
      "steamapps/compatdata",
      String(id),
      "pfx/dosdevices",
    );
    mkdirSync(path);
    symlinkSync("/", join(path, "z:"));
  }
  shortcuts("100", [{ appid: 3000000000, exe: "/launcher/other.exe", start: "" }]);
  shortcuts("200", [{ appid: 3000000001, exe: "/launcher/Battle.net.exe", start: "" }]);
  writeFileSync(join(library, "steamapps/appmanifest_123.acf"), '"appid" "123"');
  expect(await detector().detectCandidates()).toEqual([
    {
      location: live,
      clientType: WowClientType.Retail,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
    {
      location: native,
      clientType: WowClientType.ClassicEra,
      validity: "confirmed",
      detectionSource: "prefix-registry",
    },
  ]);
});

test.each([
  ["missing", undefined],
  ["truncated", Buffer.from("\0shortcuts\0\0\x30\0\x02appid\0\xff")],
  ["unknown value type", Buffer.from("\0shortcuts\0\x7ffield\0\x08\x08")],
  ["unterminated string", Buffer.from("\0shortcuts\0\0\x30\0\x01Exe\0broken")],
])(
  "a shortcut file that is %s cannot stop another user's shortcuts or other discovery",
  async (_name, bytes) => {
    const retail = flavor(join(home, "elsewhere/_retail_"));
    const era = flavor(join(home, "Applications/World of Warcraft/_classic_era_"));
    const config = join(steam, "userdata/100/config");
    mkdirSync(config, { recursive: true });
    if (bytes) writeFileSync(join(config, "shortcuts.vdf"), bytes);
    shortcuts("200", [{ appid: 3000000001, exe: join(retail, "Wow.exe"), start: "" }]);
    expect(await detector().detectCandidates()).toEqual([
      {
        location: retail,
        clientType: WowClientType.Retail,
        validity: "confirmed",
        detectionSource: "steam-shortcut",
      },
      {
        location: era,
        clientType: WowClientType.ClassicEra,
        validity: "confirmed",
        detectionSource: "lutris",
      },
    ]);
  },
);

test("shortcut discovery deduplicates below custom and registry sources and above folder probes", async () => {
  const retail = flavor(join(home, "Applications/World of Warcraft/_retail_"));
  shortcuts("100", [{ appid: 3000000001, exe: join(retail, "Wow.exe"), start: retail }]);
  expect(
    (await detector().detectCandidates()).map((candidate) => candidate.detectionSource),
  ).toEqual(["steam-shortcut"]);
  const custom = new InstallationDetector({
    homeDir: home,
    customPaths: [retail],
    scanRemovableMedia: false,
  });
  expect((await custom.detectCandidates()).map((candidate) => candidate.detectionSource)).toEqual([
    "custom",
  ]);
  const path = prefix(3000000001, retail);
  mkdirSync(join(path, "dosdevices"));
  symlinkSync("/", join(path, "dosdevices/z:"));
  expect(
    (await detector().detectCandidates()).map((candidate) => candidate.detectionSource),
  ).toEqual(["prefix-registry"]);
});

test("disabling Steam discovery skips shortcuts and their prefix registries", async () => {
  const retail = flavor(join(home, "elsewhere/_retail_"));
  shortcuts("100", [{ appid: 3000000001, exe: retail, start: "" }]);
  const disabled = new InstallationDetector({
    homeDir: home,
    scanSteam: false,
    scanRemovableMedia: false,
  });
  expect(await disabled.detectCandidates()).toEqual([]);
});
