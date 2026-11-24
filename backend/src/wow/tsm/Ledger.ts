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

/** Record keys: realm accounting CSVs, character and Warband bank gold logs, guild gold logs (a table of CSVs). */
const csvKey = /^r@.+@internalData@csv(?:Sales|Buys|Income|Expense|Expired|Cancelled)$/;
const goldLogKey = /^(?:s@.+@internalData@goldLog|g@.+@internalData@warbankGoldLog)$/;
const guildLogKey = /^f@.+@internalData@guildGoldLog$/;

/** A CSV with at least one line after its header. */
const hasRows = (value: LuaValue | undefined) => typeof value === "string" && /\n\s*\S/.test(value);

function hasRecords(db: Readonly<Record<string, LuaValue>>): boolean {
  for (const [key, value] of Object.entries(db)) {
    if ((csvKey.test(key) || goldLogKey.test(key)) && hasRows(value)) return true;
    if (guildLogKey.test(key) && typeof value === "object" && Object.values(value).some(hasRows)) return true;
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
   * The Ledger of `account`, or of the engine's pick: the only account, else
   * the one the game wrote last. Throws when the file cannot be read as saved
   * data, so a broken file never reads as an empty Ledger.
   */
  async ledger(installation: WowInstallation, account?: string): Promise<TradeSkillMasterLedger> {
    const gameRunning = (await this.#gameRunning()) === "running";
    const found = accounts(installation);
    const chosen = found.find((a) => a.name === account) ??
      found.reduce<(typeof found)[number] | undefined>((last, a) => (!last || a.mtimeMs > last.mtimeMs ? a : last), undefined);
    if (!chosen) {
      const installed = existsSync(join(getAddonsPath(installation), "TradeSkillMaster"));
      return { state: installed ? "noAccount" : "noAddon", accounts: [], account: null, recordedAt: null, gameRunning };
    }
    const saved = readTradeSkillMaster(savedFile(installation, chosen.name), this.#reader);
    if (saved.status !== "ok" && saved.status !== "missing") {
      console.error("[ledger] TradeSkillMaster.lua not readable:", saved.status);
      throw new Error(`TradeSkillMaster.lua is ${saved.status}`);
    }
    return {
      state: saved.status === "ok" && hasRecords(saved.db) ? "ready" : "noRecords",
      accounts: found.map((a) => a.name),
      account: chosen.name,
      recordedAt: Math.floor(chosen.mtimeMs),
      gameRunning,
    };
  }
}
