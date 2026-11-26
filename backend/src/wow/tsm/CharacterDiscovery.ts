/**
 * Discovery formats adapted from tsm/wow/accounts.py, saved_variables.py and
 * game_versions.py, tsm-app-linux (MIT), commit 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md. Files are data, never Lua code.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { WowInstallation } from "../models";
import { readTradeSkillMaster, safePath, savedVariables } from "./SavedVariables";

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
        const helperFile = savedVariables.read(join(root, "SavedVariables/TradeSkillMaster_AppHelper.lua"));
        const helper = helperFile.status === "ok" ? helperFile.globals.TradeSkillMaster_AppHelperDB : undefined;
        const saved = readTradeSkillMaster(join(root, "SavedVariables/TradeSkillMaster.lua"));
        const helperRegion = helper && typeof helper === "object" ? helper.region : undefined;
        const region = typeof helperRegion === "string" ? helperRegion.split("-").find((s: string) => /^(eu|us|kr|tw|cn)$/i.test(s))?.toLowerCase() : undefined;
        const scopeKeys = saved.status === "ok" ? saved.db._scopeKeys : undefined;
        const scopes = scopeKeys && typeof scopeKeys === "object" ? scopeKeys.factionrealm : undefined;
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
