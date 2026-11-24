/**
 * The Ledger's Export (GLOSSARY: Ledger): one WoW account's records as the
 * ZIP of CSVs TradeSkillMaster's desktop app writes, so tools made for that
 * export read it. Project-owned; the desktop app 1.0.15 (its Data Export
 * form and export worker) is a reference for the layout only, nothing is
 * copied from it. The account's file is only read.
 */
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { FileSystemError, ValidationError } from "../errors";
import { writeZipFiles, type ZipFile } from "../wtf/ZipWriter";
import { ledgerItemName } from "./ItemNames";
import type { LuaTable } from "./SavedVariables";

/** The datasets in the desktop app's order, by the name their files carry. */
const DATASETS = ["Sales", "Buys", "Income", "Expense", "Expired", "Cancelled"] as const;
const recordKey = /^r@(.+)@internalData@csv(Sales|Buys|Income|Expense|Expired|Cancelled)$/;
const BOM = "\ufeff";
const utf8 = new TextEncoder();

/** The realms with a row in at least one of their record CSVs, sorted as the Realm filter sorts them. */
export function exportRealms(db: LuaTable): string[] {
  const realms = new Set<string>();
  for (const [key, value] of Object.entries(db)) {
    const realm = recordKey.exec(key)?.[1];
    // A line after the header; a CSV of its header alone records nothing.
    if (realm !== undefined && typeof value === "string" && /\n[^\n]/.test(value)) realms.add(realm);
  }
  return [...realms].sort((a, b) => a.localeCompare(b, "en"));
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

/** The export's files, built one at a time as the ZIP writer asks for them. */
function* exportFiles(db: LuaTable, itemInfo: LuaTable | null, realms: string[], date: string): Generator<ZipFile> {
  for (const realm of realms) {
    for (const dataset of DATASETS) {
      const stored = db[`r@${realm}@internalData@csv${dataset}`];
      const csv = typeof stored === "string" ? exportCsv(stored, itemInfo) : "";
      yield { name: `TSM_${safeRealmName(realm)}_${dataset}_${date}.csv`, data: utf8.encode(BOM + csv) };
    }
  }
}

/** `name` in `folder`, or with ` (n)` before `.zip` when that is taken. */
function freePath(folder: string, name: string): string {
  const stem = name.replace(/\.zip$/, "");
  let path = join(folder, name);
  for (let n = 1; existsSync(path); n++) path = join(folder, `${stem} (${n}).zip`);
  return path;
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
 * and answer its path. `now` dates the file names (its UTC day, as the
 * desktop app's) and the entries. The ZIP is written to a hidden temporary
 * file in `folder` and renamed into place, so a failure leaves neither.
 */
export async function writeLedgerExport(options: {
  db: LuaTable;
  itemInfo: LuaTable | null;
  realm: string | null;
  folder: string;
  now: number;
  write?: ZipWrite;
}): Promise<string> {
  const { db, itemInfo, realm, folder, now, write = writeZipFiles } = options;
  let isFolder = false;
  try {
    isFolder = isAbsolute(folder) && statSync(folder).isDirectory();
  } catch {
    /* missing: answered below */
  }
  if (!isFolder) throw new ValidationError("That folder isn't available. Choose another");
  const realms = realm === null ? exportRealms(db) : [realm];
  if (realms.length === 0) throw new ValidationError("No sales, purchases or other records to export yet");

  const date = new Date(now).toISOString().slice(0, 10);
  const name = `TSM_${realms.length === 1 ? safeRealmName(realms[0]!) : `${realms.length}_Realms`}_${date}.zip`;
  const temp = join(folder, `.${name}.${randomBytes(4).toString("hex")}.part`);
  try {
    await write(temp, exportFiles(db, itemInfo, realms, date), { mtime: new Date(now) });
    const path = freePath(folder, name);
    renameSync(temp, path);
    return path;
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      /* the writer already removed it */
    }
    throw writeError(err);
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
