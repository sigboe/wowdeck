/**
 * Discovery formats adapted from tsm/wow/accounts.py, saved_variables.py and
 * game_versions.py, tsm-app-linux (MIT), commit 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md. Files are data, never Lua code.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import type { WowInstallation } from "../models";

const versions: Record<string, { folder: string; prefix: string }> = {
  Retail: { folder: "_retail_", prefix: "" },
  Wrath: { folder: "_classic_", prefix: "BCC-" },
  "Classic Era": { folder: "_classic_era_", prefix: "Classic-" },
  "Classic Era - Hardcore": { folder: "_classic_era_", prefix: "HC-" },
  "Season of Discovery": { folder: "_classic_era_", prefix: "SoD-" },
  "Classic Era - Fresh": { folder: "_anniversary_", prefix: "Fresh-" },
  Forever: { folder: "_forever_", prefix: "Forever-" },
};
export const realmFolders = Object.fromEntries(Object.entries(versions).map(([name, v]) => [name, v.folder]));
export function regionKey(version: string, region: string): string | undefined {
  return versions[version] ? versions[version].prefix + region.toUpperCase() : undefined;
}
export function realmKey(name: string, faction: string): string {
  return faction.toUpperCase() === "ALL" ? name : name + "-" + faction[0]!.toUpperCase() + faction.slice(1).toLowerCase();
}
export function matchesFlavor(i: WowInstallation, version: string): boolean {
  return realmFolders[version] === basename(i.location) || (i.clientType === 0 && version === "Retail");
}
function safePath(path: string): boolean {
  try {
    for (let part = path; dirname(part) !== part; part = dirname(part)) {
      if (lstatSync(part).isSymbolicLink()) return false;
    }
    return true;
  } catch { return false; }
}
function directories(path: string): string[] {
  if (!safePath(path)) return [];
  try { return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "SavedVariables").map((e) => e.name).sort(); }
  catch { return []; }
}
function text(path: string): string {
  if (!safePath(path)) return "";
  try { const st = lstatSync(path); return st.isFile() && st.size <= 16 * 1024 * 1024 ? readFileSync(path, "utf8") : ""; }
  catch { return ""; }
}
/**
 * Restricted SavedVariables table reader: rejects expressions and never
 * evaluates input. A file holds one `Name = value` statement per global the
 * addon saves (TradeSkillMaster.lua also saves TSMItemInfoDB); this returns
 * the table assigned to `global`.
 */
function saved(path: string, global: string): Record<string, any> {
  const source = text(path);
  const lexer = /\s+|--[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[(=*)\[[\s\S]*?\]\1\]|[A-Za-z_][\w]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]=,;]/gy;
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    lexer.lastIndex = offset;
    const token = lexer.exec(source)?.[0];
    if (!token) return {};
    offset = lexer.lastIndex;
    if (!/^\s|^--/.test(token)) tokens.push(token);
  }
  let pos = 0;
  const string = (s: string) => s.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  function value(depth: number): any {
    if (depth > 40) throw new Error("Nested data");
    const token = tokens[pos++];
    if (token === "{") {
      const result: Record<string, any> = Object.create(null);
      let index = 1;
      while (tokens[pos] !== "}") {
        let key: string;
        if (tokens[pos] === "[") {
          pos++; key = String(value(depth + 1));
          if (tokens[pos++] !== "]" || tokens[pos++] !== "=") throw new Error("Invalid key");
        } else if (tokens[pos + 1] === "=") { key = tokens[pos++]!; pos++; }
        else key = String(index++);
        result[key] = value(depth + 1);
        if ([",", ";"].includes(tokens[pos]!)) pos++;
        else if (tokens[pos] !== "}") throw new Error("Invalid table");
      }
      pos++; return result;
    }
    if (token?.startsWith('"') || token?.startsWith("'")) return string(token);
    if (token?.startsWith("[[") || token?.startsWith("[=")) {
      const opening = token.match(/^\[(=*)\[/)!;
      return token.slice(opening[0].length, -opening[0].length);
    }
    if (token && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return Number(token);
    if (token === "true" || token === "false" || token === "nil") return null;
    throw new Error("Unsupported data");
  }
  try {
    let found: unknown;
    while (pos < tokens.length) {
      const name = tokens[pos++]!;
      if (!/^[A-Za-z_]\w*$/.test(name) || tokens[pos++] !== "=") return {};
      const result = value(0);
      if (name === global) found = result;
    }
    return found && typeof found === "object" ? (found as Record<string, any>) : {};
  } catch { return {}; }
}
export interface CharacterRealm {
  installationId: string; name: string; region: string; faction: string;
  recent: number; retail: boolean;
}
export function discoverCharacters(installations: WowInstallation[]): CharacterRealm[] {
  const result: CharacterRealm[] = [];
  for (const i of installations) {
    const retail = i.clientType === 0;
    const wtf = join(i.location, "WTF");
    const portal = text(join(wtf, "Config.wtf")).match(/SET\s+portal\s+"([a-z]+)"/i)?.[1]?.toLowerCase();
    for (const account of directories(join(wtf, "Account"))) {
      const root = join(wtf, "Account", account);
      const times = new Map<string, number>();
      for (const realm of directories(root)) {
        for (const character of directories(join(root, realm))) {
          try { const st = lstatSync(join(root, realm, character)); times.set(realm, Math.max(times.get(realm) ?? 0, st.mtimeMs)); }
          catch { /* Character disappeared during scan. */ }
        }
      }
      if (retail) {
        if (portal) for (const [name, recent] of times) result.push({ installationId: i.id, name, region: portal, faction: "ALL", recent, retail });
      } else {
        const helper = saved(join(root, "SavedVariables/TradeSkillMaster_AppHelper.lua"), "TradeSkillMaster_AppHelperDB");
        const db = saved(join(root, "SavedVariables/TradeSkillMaster.lua"), "TradeSkillMasterDB");
        const region = typeof helper.region === "string" ? helper.region.split("-").find((s: string) => /^(eu|us|kr|tw|cn)$/i.test(s))?.toLowerCase() : undefined;
        const scopes = db._scopeKeys?.factionrealm;
        if (!region || !scopes || typeof scopes !== "object") continue;
        for (const scope of Object.values(scopes)) {
          if (typeof scope !== "string") continue;
          const match = scope.match(/^(Horde|Alliance) - (.+)$/);
          if (!match) continue;
          result.push({ installationId: i.id, name: match[2]!, region, faction: match[1]!.toUpperCase(), recent: times.get(match[2]!) ?? Math.max(0, ...times.values()), retail });
        }
      }
    }
  }
  return result.sort((a, b) => b.recent - a.recent || Number(b.retail) - Number(a.retail) || a.name.localeCompare(b.name) || a.faction.localeCompare(b.faction));
}
