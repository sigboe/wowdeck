/**
 * The Ledger (GLOSSARY): what the TradeSkillMaster addon recorded for one
 * WoW account of an installation, read from its TradeSkillMaster.lua with
 * the shared SavedVariables reader. Project-owned; the addon's file format
 * is documented in spec #308. Files are data, never Lua code, and are only
 * read.
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GameRunning, TradeSkillMasterLedger } from "../../api/contracts";
import { getAddonsPath } from "../installation/InstallationDetector";
import type { WowInstallation } from "../models";
import { detectGameRunning } from "../wtf/GameProcessGuard";
import { readTradeSkillMaster, safePath, savedVariables, type LuaValue, type SavedVariablesReader } from "./SavedVariables";

/** Where the game saves the addon's records for one WoW account. */
const savedFile = (installation: WowInstallation, account: string) =>
  join(installation.location, "WTF/Account", account, "SavedVariables/TradeSkillMaster.lua");

/**
 * The headers the addon reads each record CSV under (spec #308, "Records"),
 * by key. Sales and buys from older files name the other player buyer or
 * seller.
 */
const trade = (other: string) => `itemString,stackSize,quantity,price,${other},player,time,source`;
const money = ["type,amount,otherPlayer,player,time"];
const auctions = ["itemString,stackSize,quantity,player,time"];
const csvHeaders: [RegExp, string[]][] = [
  [/^r@.+@internalData@csvSales$/, [trade("otherPlayer"), trade("buyer")]],
  [/^r@.+@internalData@csvBuys$/, [trade("otherPlayer"), trade("seller")]],
  [/^r@.+@internalData@csv(?:Income|Expense)$/, money],
  [/^r@.+@internalData@csv(?:Expired|Cancelled)$/, auctions],
  [/^(?:s@.+@internalData@goldLog|g@ @internalData@warbankGoldLog)$/, ["minute,copper"]],
];
const guildLogKey = /^f@.+@internalData@guildGoldLog$/;

/**
 * A CSV the addon reads at least one row from: a header it knows, then a
 * first row with the header's field count (a row with another count ends
 * the CSV). Only the first two lines are looked at.
 */
function hasRows(value: LuaValue | undefined, headers: string[]): boolean {
  if (typeof value !== "string") return false;
  const end = value.indexOf("\n");
  if (end < 0 || !headers.includes(value.slice(0, end))) return false;
  const next = value.indexOf("\n", end + 1);
  const row = value.slice(end + 1, next < 0 ? undefined : next);
  return row.split(",").length === value.slice(0, end).split(",").length;
}

function hasRecords(db: Readonly<Record<string, LuaValue>>): boolean {
  for (const [key, value] of Object.entries(db)) {
    const headers = csvHeaders.find(([pattern]) => pattern.test(key))?.[1];
    if (headers && hasRows(value, headers)) return true;
    if (guildLogKey.test(key) && typeof value === "object" && Object.values(value).some((log) => hasRows(log, ["minute,copper"]))) return true;
  }
  return false;
}

/** The installation's WoW accounts holding a TradeSkillMaster.lua, with its last-write time. */
function accounts(installation: WowInstallation): { name: string; mtimeMs: number }[] {
  const root = join(installation.location, "WTF/Account");
  if (!safePath(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "SavedVariables").map((e) => e.name);
  } catch { return []; }
  return names.sort().flatMap((name) => {
    try {
      const st = lstatSync(savedFile(installation, name));
      return st.isFile() ? [{ name, mtimeMs: st.mtimeMs }] : [];
    } catch { return []; }
  });
}

export class TradeSkillMasterLedgerReader {
  readonly #gameRunning: () => Promise<GameRunning>;
  readonly #reader: SavedVariablesReader;
  constructor(options: { gameRunning?: () => Promise<GameRunning>; reader?: SavedVariablesReader } = {}) {
    this.#gameRunning = options.gameRunning ?? (() => detectGameRunning());
    this.#reader = options.reader ?? savedVariables;
  }

  /**
   * The Ledger of `account`, or of the engine's pick: the account written
   * last that has records, else the account written last. Without the addon
   * and without records anywhere the state is noAddon. Throws when a file it
   * reads cannot be read as saved data, so a broken file never reads as an
   * empty Ledger.
   */
  async ledger(installation: WowInstallation, account?: string): Promise<TradeSkillMasterLedger> {
    const gameRunning = (await this.#gameRunning()) === "running";
    const found = accounts(installation);
    const installed = existsSync(join(getAddonsPath(installation), "TradeSkillMaster"));
    if (found.length === 0) {
      return { state: installed ? "noAccount" : "noAddon", accounts: [], account: null, recordedAt: null, gameRunning };
    }
    const records = (name: string): boolean => {
      const saved = readTradeSkillMaster(savedFile(installation, name), this.#reader);
      if (saved.status !== "ok" && saved.status !== "missing") {
        console.error("[ledger] TradeSkillMaster.lua not readable:", saved.status);
        throw new Error(`TradeSkillMaster.lua is ${saved.status}`);
      }
      return saved.status === "ok" && hasRecords(saved.db);
    };
    const asked = found.find((a) => a.name === account);
    // Newest first, so the usual case reads one file.
    const newestFirst = [...found].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const chosen = asked ?? newestFirst.find((a) => records(a.name)) ?? newestFirst[0]!;
    const ready = records(chosen.name);
    // Without the addon, an empty Ledger asks for it unless another account has records.
    const noAddon = !ready && !installed && !found.some((a) => a !== chosen && records(a.name));
    return {
      state: ready ? "ready" : noAddon ? "noAddon" : "noRecords",
      accounts: found.map((a) => a.name),
      account: chosen.name,
      recordedAt: Math.floor(chosen.mtimeMs),
      gameRunning,
    };
  }
}
