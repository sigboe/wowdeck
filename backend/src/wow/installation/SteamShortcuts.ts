/** Project-owned reader for Steam's binary KeyValues shortcuts, without upstream code. */
import { basename, isAbsolute, join } from "node:path";
import { isWowLaunchExecutable } from "./WowExecutables";
type Value = string | number | Map<string, Value>;

export interface SteamShortcut {
  appId: number;
  name?: string;
  exe: string;
  startDir: string;
  launchOptions: string;
}

/** A shared Battle.net prefix must not attach a Diablo/Overwatch-specific shortcut. */
export function isWowShortcut(shortcut: SteamShortcut): boolean {
  const exe = shortcut.exe.trim().replace(/^"(.*)"$/, "$1").replaceAll("\\", "/");
  const product = /--exec(?:=|\s+)(?:["'])?launch\s+([^\s"']+)/i.exec(shortcut.launchOptions)?.[1]
    ?? /battlenet:\/\/([^\s/"'?]+)/i.exec(shortcut.launchOptions)?.[1];
  return product ? /^wow/i.test(product) : isWowLaunchExecutable(basename(exe));
}

/** Literal leading environment assignments only; never interpret shell expressions. */
export function shortcutPrefixOverrides(shortcut: SteamShortcut): string[] {
  const prefixes = new Set<string>();
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  const input = shortcut.launchOptions;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "\\" && quote !== "'") {
      if (i + 1 === input.length) return [];
      token += input[++i];
    } else if (quote) {
      if (c === quote) quote = "";
      else token += c;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "\n" || c === "\r") {
      break;
    } else if (/\s/.test(c)) {
      if (token) tokens.push(token);
      if (token === "%command%") break;
      token = "";
    } else if (c === "`") {
      token += c;
      break;
    } else if (/[;&|<>]/.test(c)) {
      break;
    } else {
      token += c;
    }
  }
  if (!quote) {
    if (token) tokens.push(token);
    if (tokens[0] === "env") tokens.shift();
    if (tokens[0] === "--") tokens.shift();
    for (const assignment of tokens) {
      const match = /^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/.exec(assignment);
      if (!match) break;
      const [, name, path] = match;
      if (!path || !isAbsolute(path) || /[$`]/.test(path)) continue;
      if (name === "STEAM_COMPAT_DATA_PATH") prefixes.add(join(path, "pfx"));
      if (name === "WINEPREFIX") prefixes.add(path);
    }
  }
  return [...prefixes];
}

/** Prefix ancestry is a discovery hint, not evidence of Proton's chosen runtime prefix. */
export function shortcutPrefixes(shortcut: SteamShortcut): string[] {
  const overrides = shortcutPrefixOverrides(shortcut);
  if (overrides.length) return overrides;
  const prefixes = new Set<string>();
  for (const raw of [shortcut.exe, shortcut.startDir]) {
    const path = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(path)) continue;
    const index = path.lastIndexOf("/pfx/");
    if (index >= 0) prefixes.add(path.slice(0, index + 4));
    else if (path.endsWith("/pfx")) prefixes.add(path);
  }
  return [...prefixes];
}

/** Throws on truncated, unsupported or excessively nested input. Callers isolate each file. */
export function readSteamShortcuts(bytes: Uint8Array): SteamShortcut[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  const take = (length: number): number => {
    const start = offset;
    offset += length;
    if (offset > bytes.length) throw new Error("Truncated binary VDF");
    return start;
  };
  const string = (): string => {
    const start = offset;
    while (bytes[take(1)] !== 0) {
      /* NUL-terminated UTF-8 */
    }
    return decoder.decode(bytes.subarray(start, offset - 1));
  };
  const object = (depth: number): Map<string, Value> => {
    if (depth > 32) throw new Error("Binary VDF nesting limit");
    const values = new Map<string, Value>();
    while (true) {
      const type = bytes[take(1)];
      if (type === 8) return values;
      const key = string().toLowerCase();
      switch (type) {
        case 0:
          values.set(key, object(depth + 1));
          break;
        case 1:
          values.set(key, string());
          break;
        case 2:
          values.set(key, view.getUint32(take(4), true));
          break;
        // Float, pointer and color values are irrelevant to discovery.
        case 3:
        case 4:
        case 6:
          take(4);
          break;
        case 7:
        case 10:
          take(8);
          break;
        case 5:
          while (view.getUint16(take(2), true) !== 0) {
            /* UTF-16 string */
          }
          break;
        default:
          throw new Error("Unsupported binary VDF type");
      }
    }
  };
  const root = object(0);
  if (offset !== bytes.length) throw new Error("Trailing binary VDF data");
  const shortcuts = root.get("shortcuts");
  if (!(shortcuts instanceof Map)) return [];
  const result: SteamShortcut[] = [];
  for (const entry of shortcuts.values()) {
    if (!(entry instanceof Map)) continue;
    const appId = entry.get("appid");
    if (typeof appId !== "number") continue;
    const exe = entry.get("exe");
    const startDir = entry.get("startdir");
    const launchOptions = entry.get("launchoptions");
    result.push({
      appId,
      name: typeof entry.get("appname") === "string" ? (entry.get("appname") as string).trim() : "",
      exe: typeof exe === "string" ? exe : "",
      startDir: typeof startDir === "string" ? startDir : "",
      launchOptions: typeof launchOptions === "string" ? launchOptions : "",
    });
  }
  return result;
}
