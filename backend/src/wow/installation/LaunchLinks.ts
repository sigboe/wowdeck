/**
 * Proven links (project-owned; GLOSSARY: Proven link): the Steam shortcut
 * seen launching an installation, read from the running WoW client.
 *
 * Steam starts a non-Steam shortcut with its app id in the environment and,
 * under Proton, the prefix too. Which variables carry them is read
 * tolerantly until a device run confirms them (#279): the app id from
 * `SteamGameId` (a 64-bit game id with the app id in its high half, or the
 * app id itself), `SteamAppId` or `STEAM_COMPAT_APP_ID`; the prefix from
 * `WINEPREFIX`, else `STEAM_COMPAT_DATA_PATH`/pfx. The executable path comes
 * from the command line.
 *
 * Never log the environment, the command line or any path: they carry the
 * user's name, and an environment can carry secrets (logging policy).
 */

import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fsProcReader, type ProcReader } from "../wtf/GameProcessGuard";
import { readTextFile, writeFileAtomic } from "../fs/safe-fs";
import { translate } from "./PrefixRegistry";
import { isWowClientExecutable } from "./WowExecutables";

/** One proven link as stored: the installation by its location. */
export interface LaunchRecord {
  appId: number;
  accountId?: number;
  location: string;
}

const FILE = "steam-launch-links.json";
const APP_ID_KEYS = ["SteamGameId", "SteamAppId", "STEAM_COMPAT_APP_ID"] as const;

function environment(environ: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const entry of environ.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return env;
}

/** Every Steam app id the environment names; a 64-bit shortcut game id gives its high half. */
function launchingAppIds(env: Map<string, string>): number[] {
  const ids: number[] = [];
  for (const key of APP_ID_KEYS) {
    const value = env.get(key)?.trim() ?? "";
    if (!/^[0-9]{1,20}$/.test(value)) continue;
    const n = BigInt(value);
    const id = n > 0xffffffffn ? n >> 32n : n;
    if (id > 0n && id <= 0xffffffffn) ids.push(Number(id));
  }
  return ids;
}

function prefixOf(env: Map<string, string>): string | undefined {
  const wine = env.get("WINEPREFIX");
  if (wine?.startsWith("/")) return wine;
  const compat = env.get("STEAM_COMPAT_DATA_PATH");
  return compat?.startsWith("/") ? join(compat, "pfx") : undefined;
}

/** The WoW client paths a command line names. */
function clientPaths(cmdline: string): string[] {
  return cmdline.split("\0").filter((arg) => isWowClientExecutable(arg.split(/[\\/]/).pop() ?? ""));
}

/** The Linux folder holding a client path: a Linux path as it is, a Windows one through the prefix. */
async function clientFolder(path: string, prefix: string | undefined): Promise<string | undefined> {
  if (path.startsWith("/")) return dirname(path);
  const windowsDir = path.slice(0, path.lastIndexOf("\\"));
  return prefix && /^[a-z]:\\/i.test(windowsDir) ? translate(prefix, windowsDir) : undefined;
}

const canonical = (path: string) => realpath(path).then((p) => p.toLowerCase(), () => path.toLowerCase());

/**
 * The listed installation locations a WoW client launched by `appId` runs
 * from now: one look at /proc, no waiting.
 */
export async function runningLaunches(
  appId: number,
  locations: readonly string[],
  reader: ProcReader = fsProcReader,
): Promise<string[]> {
  const known = await Promise.all(locations.map(async (location) => ({ location, key: await canonical(location) })));
  const found = new Set<string>();
  for (const pid of (await reader.pids()) ?? []) {
    const paths = clientPaths((await reader.read(pid, "cmdline")) ?? "");
    if (!paths.length) continue;
    const env = environment((await reader.read(pid, "environ")) ?? "");
    if (!launchingAppIds(env).includes(appId)) continue;
    for (const path of paths) {
      const folder = await clientFolder(path, prefixOf(env));
      const key = folder && (await canonical(folder));
      for (const k of known) if (k.key === key) found.add(k.location);
    }
  }
  return [...found];
}

const sameRecord = (a: LaunchRecord, b: LaunchRecord) =>
  a.appId === b.appId && a.accountId === b.accountId && a.location.toLowerCase() === b.location.toLowerCase();

function isRecord(value: unknown): value is LaunchRecord {
  const r = value as LaunchRecord;
  return (
    typeof r === "object" && r !== null &&
    Number.isSafeInteger(r.appId) &&
    (r.accountId === undefined || Number.isSafeInteger(r.accountId)) &&
    typeof r.location === "string"
  );
}

/** The proven links stored in the data folder; none when the file is missing or unreadable. */
export async function readLaunchRecords(dataDir: string): Promise<LaunchRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readTextFile(join(dataDir, FILE)));
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** Store proven links, once each, keeping those already there. */
export async function addLaunchRecords(dataDir: string, records: LaunchRecord[]): Promise<void> {
  const stored = await readLaunchRecords(dataDir);
  const fresh = records.filter((r) => !stored.some((s) => sameRecord(s, r)));
  if (fresh.length) await writeFileAtomic(join(dataDir, FILE), JSON.stringify([...stored, ...fresh], null, 2));
}
