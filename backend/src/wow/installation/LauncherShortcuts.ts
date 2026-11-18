/**
 * Project-owned resolution of Steam shortcuts that start a game through Lutris or Bottles.
 * Launch options are read as literal words; any shell expression yields no target.
 */
import { Database } from "bun:sqlite";
import { basename, isAbsolute, join } from "node:path";
import { isDirectory, listDirectory, pathExists, readTextFile } from "../fs/safe-fs";
import { unquotePath, type SteamShortcut } from "./SteamShortcuts";

/** The Wine prefix a launcher shortcut runs in, and the program it starts there. */
export interface LauncherTarget {
  prefix: string;
  exe: string;
  args: string;
}

/** Undefined unless the shortcut starts a Lutris game or a Bottles bottle that resolves to a prefix. */
export async function launcherShortcutTarget(shortcut: SteamShortcut, homeDir: string): Promise<LauncherTarget | undefined> {
  const words = literalWords(shortcut.launchOptions);
  const exe = unquotePath(shortcut.exe);
  if (!words || !exe) return undefined;
  const argv = words.includes("%command%") ? words.map(w => (w === "%command%" ? exe : w)) : [exe, ...words];
  if (argv[0] === "env" || basename(argv[0]!) === "env") argv.shift();
  if (argv[0] === "--") argv.shift();
  while (argv.length && /^[A-Za-z_][A-Za-z_0-9]*=/.test(argv[0]!)) argv.shift();
  const [program = "", ...rest] = argv;
  const lutris = { native: lutrisHome(homeDir, false), flatpak: lutrisHome(homeDir, true) };
  const bottles = { native: join(homeDir, ".local/share/bottles/bottles"), flatpak: join(homeDir, ".var/app/com.usebottles.bottles/data/bottles/bottles") };
  switch (basename(program)) {
    case "lutris":
      return lutrisTarget(rest, [lutris.native]);
    case "bottles":
    case "bottles-cli":
      return bottlesTarget(rest, [bottles.native]);
    case "xdg-open":
      if (rest[0]?.startsWith("lutris:")) return lutrisTarget(rest, [lutris.native, lutris.flatpak]);
      if (rest[0]?.startsWith("bottles:")) return bottlesTarget(rest, [bottles.native, bottles.flatpak]);
      return undefined;
    case "flatpak": {
      if (rest[0] !== "run") return undefined;
      let i = 1;
      while (rest[i]?.startsWith("-")) i++;
      if (rest[i] === "net.lutris.Lutris") return lutrisTarget(rest.slice(i + 1), [lutris.flatpak]);
      if (rest[i] === "com.usebottles.bottles") return bottlesTarget(rest.slice(i + 1), [bottles.flatpak]);
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Shell words without quotes, or undefined when the text holds anything a shell would
 * expand, redirect, chain or substitute. Nothing is ever evaluated.
 */
function literalWords(input: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  for (const c of input) {
    if (quote) {
      if (c === quote) quote = "";
      else if (quote === '"' && /[$`\\!]/.test(c)) return undefined;
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\n" || c === "\r") {
      return undefined;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else if (/[$`\\;&|<>(){}*?[\]~#!]/.test(c)) {
      return undefined;
    } else {
      word += c;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) words.push(word);
  return words;
}

interface LutrisHome {
  database: string;
  gameConfigs: string[];
}

/** Lutris has kept game configs under both its config and data folders across releases. */
function lutrisHome(homeDir: string, flatpak: boolean): LutrisHome {
  const base = flatpak ? join(homeDir, ".var/app/net.lutris.Lutris") : homeDir;
  const data = join(base, flatpak ? "data/lutris" : ".local/share/lutris");
  const config = join(base, flatpak ? "config/lutris" : ".config/lutris");
  return { database: join(data, "pga.db"), gameConfigs: [join(config, "games"), join(data, "games")] };
}

async function lutrisTarget(args: string[], homes: LutrisHome[]): Promise<LauncherTarget | undefined> {
  const ids = args.map(arg => /^lutris:rungameid\/(\d+)$/.exec(arg)?.[1]).filter(id => id !== undefined);
  if (ids.length !== 1) return undefined;
  for (const home of homes) {
    const configpath = await lutrisConfigPath(home.database, Number(ids[0]));
    if (!configpath) continue;
    for (const folder of home.gameConfigs) {
      const game = (await readYaml(join(folder, `${configpath}.yml`)))?.game;
      if (!isPlainObject(game) || typeof game.prefix !== "string" || !isAbsolute(game.prefix)) continue;
      return { prefix: game.prefix, exe: stringOr(game.exe), args: stringOr(game.args) };
    }
  }
  return undefined;
}

async function lutrisConfigPath(database: string, id: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(id) || !(await pathExists(database))) return undefined;
  let db: Database | undefined;
  try {
    db = new Database(database, { readonly: true });
    const row = db.query("SELECT configpath FROM games WHERE id = ?").get(id) as { configpath?: unknown } | null;
    const configpath = row?.configpath;
    // A file name inside the games folder, never a path out of it.
    return typeof configpath === "string" && /^[^/\\\0]+$/.test(configpath) && !/^\.\.?$/.test(configpath) ? configpath : undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

async function bottlesTarget(args: string[], roots: string[]): Promise<LauncherTarget | undefined> {
  let bottle: string | undefined;
  let program: string | undefined;
  let executable: string | undefined;
  const uri = /^bottles:run\/([^/]+)(?:\/([^/]+))?$/.exec(args[0] ?? "");
  if (uri) [, bottle, program] = uri;
  else {
    for (let i = 0; i < args.length && args[i] !== "--"; i++) {
      const [flag, inline] = args[i]!.startsWith("--") ? args[i]!.split(/=(.*)/s) : [args[i]!];
      const value = (): string | undefined => inline ?? args[++i];
      if (flag === "-b" || flag === "--bottle") bottle = value();
      else if (flag === "-p" || flag === "--program") program = value();
      else if (flag === "-e" || flag === "--executable") executable = value();
    }
  }
  if (!bottle) return undefined;
  for (const root of roots) {
    const folder = await bottleFolder(root, bottle);
    if (!folder) continue;
    if (executable) return { prefix: folder.path, exe: executable, args: "" };
    const programs = folder.config?.External_Programs;
    const entry = program && isPlainObject(programs)
      ? Object.values(programs).find(p => isPlainObject(p) && p.name === program)
      : undefined;
    return isPlainObject(entry)
      ? { prefix: folder.path, exe: stringOr(entry.path) || stringOr(entry.executable), args: stringOr(entry.arguments) }
      : { prefix: folder.path, exe: "", args: "" };
  }
  return undefined;
}

/** A bottle is named by its config's Name; its folder name is the fallback. */
async function bottleFolder(root: string, name: string): Promise<{ path: string; config?: Record<string, unknown> } | undefined> {
  let byFolder: { path: string; config?: Record<string, unknown> } | undefined;
  for (const entry of await listDirectory(root)) {
    if (!entry.isDirectory) continue;
    const config = await readYaml(join(entry.path, "bottle.yml"));
    if (config?.Name === name) return { path: entry.path, config };
    if (entry.name === name) byFolder = { path: entry.path, config };
  }
  return byFolder && (await isDirectory(byFolder.path)) ? byFolder : undefined;
}

async function readYaml(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = Bun.YAML.parse(await readTextFile(path));
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}
