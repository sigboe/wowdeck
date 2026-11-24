/**
 * The Ledger's Export (GLOSSARY: Ledger): one WoW account's records as the
 * ZIP of CSVs TradeSkillMaster's desktop app writes, so tools made for that
 * export read it. Project-owned; the desktop app 1.0.15 (its Data Export
 * form and export worker) is a reference for the layout only, nothing is
 * copied from it. The account's file is only read.
 */
import { closeSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { FileSystemError, ValidationError } from "../errors";
import { writeZipFiles, type ZipFile } from "../wtf/ZipWriter";
import { ledgerItemName } from "./ItemNames";
import { hasRows, RECORD_CSVS } from "./LedgerFigures";
import type { LuaTable } from "./SavedVariables";

/** The datasets in the desktop app's order, by the name their files carry. */
const DATASETS = ["Sales", "Buys", "Income", "Expense", "Expired", "Cancelled"] as const;
const recordKey = /^r@(.+)@internalData@(csv(?:Sales|Buys|Income|Expense|Expired|Cancelled))$/;
const BOM = "\ufeff";
const utf8 = new TextEncoder();
const NOTHING_TO_EXPORT = "No sales, purchases or other records to export yet";

/**
 * The realms with a row in at least one of their record CSVs, read as the
 * Ledger reads them (a CSV of its header alone records nothing), sorted as
 * the Realm filter sorts them. Gold logs are no records.
 */
export function exportRealms(db: LuaTable): string[] {
  const realms = new Set<string>();
  for (const [key, value] of Object.entries(db)) {
    const match = recordKey.exec(key);
    if (match && !realms.has(match[1]!) && hasRows(value, RECORD_CSVS[match[2]!]!.headers)) realms.add(match[1]!);
  }
  return [...realms].sort((a, b) => a.localeCompare(b, "en"));
}

/** Whether Export has something to write for `realm` (null: All realms). */
export function exportable(db: LuaTable, realm: string | null): boolean {
  const realms = exportRealms(db);
  return realm === null ? realms.length > 0 : realms.includes(realm);
}

/**
 * A realm name that is safe in a file name on every system the ZIP may be
 * opened on: characters Windows or a ZIP path reserve become `_`, and dots
 * and spaces at either end go. The desktop app uses the name as it is.
 */
export function safeRealmName(realm: string): string {
  const name = realm.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  return name === "" ? "_" : name;
}

/**
 * A stored CSV as the desktop app exports it: unchanged, except that a CSV
 * with an `itemString` column (and no `itemName` yet) gets an `itemName`
 * column after it, the cached name without commas, else the item string.
 * Empty lines stay empty.
 */
export function exportCsv(stored: string, itemInfo: LuaTable | null): string {
  const lines = stored.split("\n");
  const header = lines[0]!.split(",");
  const column = header.indexOf("itemString");
  if (column < 0 || header.includes("itemName")) return stored;
  return lines.map((line, index) => {
    if (line === "") return line;
    const fields = line.split(",");
    const itemString = fields[column] ?? "";
    const name = index === 0 ? "itemName" : (itemInfo && ledgerItemName(itemInfo, itemString)) ?? itemString;
    fields.splice(column + 1, 0, name.replaceAll(",", ""));
    return fields.join(",");
  }).join("\n");
}

/**
 * Each realm's name in the export's file names, in `realms`' order: its safe
 * name, or, when an earlier realm's safe name is the same, the safe name with
 * `_2`, `_3`, … (the first number no realm's own safe name is), so no two
 * realms share a file. Names that differ only in case count as the same:
 * Windows and macOS would unpack them onto one file.
 */
export function realmFileNames(realms: string[]): Map<string, string> {
  const key = (name: string) => name.toLowerCase();
  const safe = realms.map(safeRealmName);
  const own = new Set(safe.map(key));
  const taken = new Set<string>();
  const names = new Map<string, string>();
  realms.forEach((realm, index) => {
    const base = safe[index]!;
    let name = base;
    for (let n = 2; taken.has(key(name)); n++) {
      name = `${base}_${n}`;
      if (own.has(key(name))) name = base; // another realm's own name: try the next number
    }
    taken.add(key(name));
    names.set(realm, name);
  });
  return names;
}

/** The export's files, built one at a time as the ZIP writer asks for them. */
function* exportFiles(db: LuaTable, itemInfo: LuaTable | null, realms: string[], date: string): Generator<ZipFile> {
  const fileNames = realmFileNames(realms);
  for (const realm of realms) {
    for (const dataset of DATASETS) {
      const stored = db[`r@${realm}@internalData@csv${dataset}`];
      const csv = typeof stored === "string" ? exportCsv(stored, itemInfo) : "";
      yield { name: `TSM_${fileNames.get(realm)!}_${dataset}_${date}.csv`, data: utf8.encode(BOM + csv) };
    }
  }
}

/** The temporary file an export writes before it publishes `name` (`TSM_…_<date>.zip`). */
const tempName = (name: string) => `.${name}.${randomBytes(4).toString("hex")}.part`;
/** Exactly the names tempName gives, so cleaning up never touches another file. */
const ourTemp = /^\.TSM_.+_\d{4}-\d{2}-\d{2}\.zip\.[0-9a-f]{8}\.part$/;
/** The temporary files of exports running in this engine, which a cleanup leaves alone. */
const running = new Set<string>();

/**
 * Remove the temporary files an export killed mid-write left in `folder`:
 * regular files named exactly as tempName names them, other than those of
 * exports still running. A file that can't be removed stays.
 */
function removeStaleTemps(folder: string): void {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return; // the write that follows says why
  }
  for (const name of names) {
    const path = join(folder, name);
    if (!ourTemp.test(name) || running.has(path)) continue;
    try {
      if (lstatSync(path).isFile()) unlinkSync(path);
    } catch (err) {
      console.error(`[ledger] couldn't remove an old temporary export file: ${String(err)}`);
    }
  }
}

/** File operations publishing uses; tests make them fail. */
export interface PublishFs {
  link: (existing: string, path: string) => void;
  rename: (from: string, to: string) => void;
}
const nodeFs: PublishFs = { link: linkSync, rename: renameSync };
const errorCode = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code;
/** What link answers on a file system without hard links (FAT and exFAT answer EPERM). */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"]);
const MAX_COPIES = 1000;

/**
 * Give the finished ZIP at `temp` the name `name` in `folder`, or that name
 * with ` (n)` before `.zip` when it is taken, and answer the path. No file
 * is ever replaced, even one made meanwhile: a hard link fails on a taken
 * name. Where the file system has no hard links, an exclusive create claims
 * the name first and the ZIP is renamed onto that claim; a failed rename
 * removes the claim. `temp` is gone afterwards, unless removing it failed
 * (logged; the next export removes it).
 */
function publish(temp: string, folder: string, name: string, fs: PublishFs): string {
  const stem = name.replace(/\.zip$/, "");
  let hardLinks = true;
  for (let n = 0; n < MAX_COPIES; n++) {
    const path = join(folder, n === 0 ? name : `${stem} (${n}).zip`);
    if (hardLinks) {
      try {
        fs.link(temp, path);
      } catch (err) {
        if (errorCode(err) === "EEXIST") continue;
        if (!NO_HARD_LINKS.has(errorCode(err) ?? "")) throw err;
        hardLinks = false;
      }
      if (hardLinks) {
        try {
          unlinkSync(temp);
        } catch (err) {
          console.error(`[ledger] couldn't remove the temporary export file: ${String(err)}`);
        }
        return path;
      }
    }
    let claim: number;
    try {
      claim = openSync(path, "wx");
    } catch (err) {
      if (errorCode(err) === "EEXIST") continue;
      throw err;
    }
    closeSync(claim);
    try {
      fs.rename(temp, path);
    } catch (err) {
      try {
        unlinkSync(path);
      } catch {
        /* nothing more to do: the error below is the one to report */
      }
      throw err;
    }
    return path;
  }
  throw new Error(`EEXIST: ${MAX_COPIES} exports of that name already`);
}

/** A failed write as the player reads it (C06); the raw error is logged. */
function writeError(err: unknown): Error {
  if (err instanceof ValidationError) return err;
  const raw = String(err);
  console.error(`[ledger] export failed: ${raw}`);
  if (/ENOSPC/.test(raw)) return new FileSystemError("Not enough free space");
  if (/EACCES|EPERM|EROFS/.test(raw)) return new FileSystemError("No permission to write to that folder");
  if (/ENOENT|ENOTDIR/.test(raw)) return new ValidationError("That folder isn't available. Choose another");
  return new FileSystemError("Couldn't write the file");
}

export type ZipWrite = typeof writeZipFiles;

/**
 * Write the ZIP of `realm` (null: every realm with records) into `folder`
 * and answer its path. A realm without a record row is an invalid request
 * that writes nothing. `now` dates the file names (its UTC day, as the
 * desktop app's) and the entries. Temporary files an interrupted export
 * left in `folder` go first. The ZIP is written to a hidden temporary file
 * in `folder` and published under a free name (publish), so a failure
 * leaves neither and no file is replaced.
 */
export async function writeLedgerExport(options: {
  db: LuaTable;
  itemInfo: LuaTable | null;
  realm: string | null;
  folder: string;
  now: number;
  write?: ZipWrite;
  /** Tests make publishing fail. */
  link?: PublishFs["link"];
  rename?: PublishFs["rename"];
}): Promise<string> {
  const { db, itemInfo, realm, folder, now, write = writeZipFiles } = options;
  const fs: PublishFs = { link: options.link ?? nodeFs.link, rename: options.rename ?? nodeFs.rename };
  let isFolder = false;
  try {
    isFolder = isAbsolute(folder) && statSync(folder).isDirectory();
  } catch {
    /* missing: answered below */
  }
  if (!isFolder) throw new ValidationError("That folder isn't available. Choose another");
  const withRecords = exportRealms(db);
  const realms = realm === null ? withRecords : withRecords.filter((r) => r === realm);
  if (realms.length === 0) throw new ValidationError(NOTHING_TO_EXPORT);

  const date = new Date(now).toISOString().slice(0, 10);
  const name = `TSM_${realms.length === 1 ? safeRealmName(realms[0]!) : `${realms.length}_Realms`}_${date}.zip`;
  removeStaleTemps(folder);
  const temp = join(folder, tempName(name));
  running.add(temp);
  try {
    await write(temp, exportFiles(db, itemInfo, realms, date), { mtime: new Date(now) });
    return publish(temp, folder, name, fs);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      /* the writer already removed it, or publishing did */
    }
    throw writeError(err);
  } finally {
    running.delete(temp);
  }
}

/**
 * Where the folder picker starts: `remembered` while it is still a folder,
 * else `~/Documents`, created when missing, else the home folder.
 */
export function exportStartFolder(remembered: string | null, homeDir: string): string {
  try {
    if (remembered && statSync(remembered).isDirectory()) return remembered;
  } catch {
    /* gone: fall back */
  }
  const documents = join(homeDir, "Documents");
  try {
    mkdirSync(documents, { recursive: true });
    return documents;
  } catch (err) {
    console.error(`[ledger] couldn't create the Documents folder: ${String(err)}`);
    return homeDir;
  }
}
