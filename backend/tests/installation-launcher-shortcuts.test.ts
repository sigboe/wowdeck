import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationDetector } from "../src/wow/installation/InstallationDetector";

// Steam shortcuts that start WoW through Lutris or Bottles, resolved through the launcher's own config.

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wowdeck-launchers-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function detect() {
  return new InstallationDetector({ homeDir: home, scanRemovableMedia: false }).detect();
}

// Synthetic binary KeyValues shortcuts.vdf for Steam user 100.
function shortcuts(entries: Array<{ appid: number; name: string; exe: string; start?: string; options: string }>) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const records = entries.map((entry, index) => {
    const appid = Buffer.alloc(4);
    appid.writeUInt32LE(entry.appid);
    return Buffer.concat([
      Buffer.from(`\0${index}\0\x02appid\0`),
      appid,
      string("AppName", entry.name),
      string("Exe", entry.exe),
      string("StartDir", entry.start ?? ""),
      string("LaunchOptions", entry.options),
      Buffer.from([8]),
    ]);
  });
  const config = join(home, ".local/share/Steam/userdata/100/config");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "shortcuts.vdf"), Buffer.concat([Buffer.from("\0shortcuts\0"), ...records, Buffer.from([8, 8])]));
}

function flavor(path: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "Wow.exe"), "");
  return path;
}

// A Wine prefix whose registry records the WoW install path.
function winePrefix(path: string, target: string) {
  mkdirSync(join(path, "dosdevices"), { recursive: true });
  symlinkSync("/", join(path, "dosdevices/z:"));
  writeFileSync(
    join(path, "system.reg"),
    `[Software\\\\Wow6432Node\\\\Blizzard Entertainment\\\\World of Warcraft]\n"InstallPath"="Z:${target.replaceAll("/", "\\\\")}"\n`,
  );
  return path;
}

// Lutris keeps its game list in pga.db and each game's options in games/<configpath>.yml.
function lutrisGame(data: string, config: string, id: number, configpath: string, yml: string) {
  mkdirSync(join(config, "games"), { recursive: true });
  writeFileSync(join(config, "games", `${configpath}.yml`), yml);
  mkdirSync(data, { recursive: true });
  const db = new Database(join(data, "pga.db"));
  db.run("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, runner TEXT, configpath TEXT, directory TEXT)");
  db.run("INSERT INTO games (id, name, slug, runner, configpath) VALUES (?, ?, ?, 'wine', ?)", [id, configpath, configpath, configpath]);
  db.close();
}

const battleNet = (pfx: string) => `${pfx}/drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe`;

test("a Lutris shortcut links the installation in that Lutris game's prefix", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  // Outside every default prefix location, so only the Lutris game's config can lead here.
  const pfx = winePrefix(join(home, "wine/my wow"), retail);
  lutrisGame(join(home, ".local/share/lutris"), join(home, ".config/lutris"), 7, "battlenet-1700000000",
    `game:\n  exe: ${battleNet(pfx)}\n  prefix: ${pfx}\nwine:\n  version: wine-ge\n`);
  shortcuts([{ appid: 42, name: "WoW via Lutris", exe: '"/usr/bin/lutris"', start: '"/usr/bin"', options: "lutris:rungameid/7" }]);
  const found = await detect();
  expect(found.map(i => i.location)).toEqual([retail]);
  expect(found[0]!.steamGames).toEqual([{ appId: 42, name: "WoW via Lutris", accountId: 100 }]);
});

test("a Flatpak Lutris shortcut resolves through the Flatpak's own Lutris data", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const pfx = winePrefix(join(home, "wine/flatpak-wow"), retail);
  const app = join(home, ".var/app/net.lutris.Lutris");
  lutrisGame(join(app, "data/lutris"), join(app, "data/lutris"), 3, "world-of-warcraft-1",
    `game:\n  exe: ${pfx}/drive_c/Program Files (x86)/World of Warcraft/_retail_/Wow.exe\n  prefix: '${pfx}'\n`);
  shortcuts([{ appid: 42, name: "World of Warcraft", exe: '"flatpak"', options: "run net.lutris.Lutris 'lutris:rungameid/3'" }]);
  expect((await detect())[0]!.steamGames).toEqual([{ appId: 42, name: "World of Warcraft", accountId: 100 }]);
});

test("a Lutris game launching another Blizzard product from a shared prefix is not linked", async () => {
  const retail = flavor(join(home, "outside/_retail_"));
  const pfx = winePrefix(join(home, "wine/battlenet"), retail);
  const data = join(home, ".local/share/lutris");
  lutrisGame(data, data, 1, "wow", `game:\n  exe: ${battleNet(pfx)}\n  args: --exec="launch WoW"\n  prefix: ${pfx}\n`);
  lutrisGame(data, data, 2, "diablo", `game:\n  exe: ${battleNet(pfx)}\n  args: --exec="launch Fen"\n  prefix: ${pfx}\n`);
  shortcuts([
    { appid: 42, name: "WoW", exe: "/usr/bin/lutris", options: "lutris:rungameid/1" },
    { appid: 43, name: "Diablo", exe: "/usr/bin/lutris", options: "lutris:rungameid/2" },
  ]);
  expect((await detect())[0]!.steamGames).toEqual([{ appId: 42, name: "WoW", accountId: 100 }]);
});

// Bottles stores each bottle's Wine prefix in its folder, named in bottle.yml.
function bottle(root: string, folder: string, name: string, target: string) {
  const path = winePrefix(join(root, folder), target);
  writeFileSync(join(path, "bottle.yml"), [
    "External_Programs:",
    "  0b5e6c1d-1111-4b4b-9c9c-000000000001:",
    "    arguments: ''",
    "    executable: Battle.net Launcher.exe",
    "    name: Battle.net Launcher",
    `    path: ${battleNet(path)}`,
    "  0b5e6c1d-1111-4b4b-9c9c-000000000002:",
    "    arguments: --exec=\"launch Fen\"",
    "    executable: Battle.net.exe",
    "    name: Diablo IV",
    `    path: ${path}/drive_c/Program Files (x86)/Battle.net/Battle.net.exe`,
    `Name: ${name}`,
    `Path: ${folder}`,
    "",
  ].join("\n"));
  return path;
}

test.each([
  ["native bottles-cli", ".local/share/bottles/bottles", "/usr/bin/bottles-cli", "run -b 'Blizzard Games' -p 'Battle.net Launcher'"],
  ["native URI", ".local/share/bottles/bottles", "xdg-open", "bottles:run/'Blizzard Games'/'Battle.net Launcher'"],
  ["Flatpak", ".var/app/com.usebottles.bottles/data/bottles/bottles", "flatpak",
    "run --command=bottles-cli com.usebottles.bottles run -p 'Battle.net Launcher' -b 'Blizzard Games' -- %u"],
])("a %s Bottles shortcut links the installation in that bottle", async (_name, root, exe, options) => {
  const retail = flavor(join(home, "outside/_retail_"));
  bottle(join(home, root), "Blizzard-Games", "Blizzard Games", retail);
  shortcuts([
    { appid: 42, name: "WoW in Bottles", exe: `"${exe}"`, start: `"${join(home, root, "Blizzard-Games")}"`, options },
    { appid: 43, name: "Diablo in Bottles", exe: `"${exe}"`, options: options.replace("Battle.net Launcher", "Diablo IV") },
  ]);
  const found = await detect();
  expect(found.map(i => i.location)).toEqual([retail]);
  expect(found[0]!.steamGames).toEqual([{ appId: 42, name: "WoW in Bottles", accountId: 100 }]);
});

// Each case would link if read loosely: the game id and bottle name stay intact around the shell syntax.
test.each([
  ["a variable", "lutris:rungameid/7 $EXTRA"],
  ["command substitution", "lutris:rungameid/7 `touch /tmp/never`"],
  ["a chained command", "lutris:rungameid/7 ; touch /tmp/never"],
  ["a double-quoted expansion", 'lutris:rungameid/7 "$HOME"'],
  ["an unclosed quote", "lutris:rungameid/7 'unclosed"],
  ["a glob", "lutris:rungameid/7 *"],
  ["a new line", "lutris:rungameid/7\ntouch /tmp/never"],
  ["two games", "lutris:rungameid/7 lutris:rungameid/8"],
  ["a Bottles variable", "run -b Blizzard -e Wow.exe $EXTRA"],
  ["a Bottles redirect", "run -b Blizzard -e Wow.exe > /tmp/never"],
])("launch options with %s are never interpreted and link nothing", async (_name, options) => {
  const retail = flavor(join(home, "outside/_retail_"));
  const pfx = winePrefix(join(home, "wine/wow"), retail);
  const data = join(home, ".local/share/lutris");
  for (const id of [7, 8]) lutrisGame(data, data, id, `wow-${id}`, `game:\n  exe: ${battleNet(pfx)}\n  prefix: ${pfx}\n`);
  bottle(join(home, ".local/share/bottles/bottles"), "Blizzard", "Blizzard", retail);
  const exe = options.startsWith("run") ? "/usr/bin/bottles-cli" : "/usr/bin/lutris";
  shortcuts([{ appid: 42, name: "WoW", exe, options }]);
  expect((await detect()).flatMap(i => i.steamGames ?? [])).toEqual([]);
});
