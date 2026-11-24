/**
 * The Ledger (GLOSSARY): what the TradeSkillMaster addon recorded for one
 * WoW account of an installation, read from its TradeSkillMaster.lua with
 * the shared SavedVariables reader. Project-owned; the addon's file format
 * is documented in spec #308. Files are data, never Lua code, and are only
 * read.
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GameRunning, TradeSkillMasterLedger, TradeSkillMasterLedgerItem, TradeSkillMasterLedgerItemsPage, TradeSkillMasterLedgerItemsParams } from "../../api/contracts";
import { getAddonsPath } from "../installation/InstallationDetector";
import type { WowInstallation } from "../models";
import { WowClientType } from "../types";
import { detectGameRunning } from "../wtf/GameProcessGuard";
import { ledgerItemName } from "./ItemNames";
import { GOLD_LOG, hasRows, ledgerItemTotals, ledgerView, RECORD_CSVS, type LedgerSelection } from "./LedgerFigures";
import { readTradeSkillMaster, safePath, savedVariables, type LuaTable, type LuaValue, type SavedVariablesReader } from "./SavedVariables";

/** The clients the addon counts as Retail, where it records gold rounded to 1,000 gold. */
const RETAIL = new Set([WowClientType.Retail, WowClientType.RetailPtr, WowClientType.RetailXPtr, WowClientType.Beta]);

// Steam measures each mounted focus stop. The JSONL reply also needs room
// for its envelope under the Python bridge's 16 MiB line limit.
const ITEM_PAGE_ROWS = 40;
const ITEM_PAGE_BYTES = 64 * 1024;

function itemPage(
  items: ReturnType<typeof ledgerItemTotals>,
  itemInfo: LuaTable | null,
  offset: number,
): TradeSkillMasterLedgerItemsPage {
  const rows: TradeSkillMasterLedgerItem[] = [];
  let bytes = 2; // array brackets
  let index = offset;
  for (; index < items.length && rows.length < ITEM_PAGE_ROWS; index++) {
    const item = items[index]!;
    const name = (itemInfo && ledgerItemName(itemInfo, item.itemString)) ?? item.itemString;
    let row = { ...item, name };
    let size = Buffer.byteLength(JSON.stringify(row));
    // A malformed record/cache can hold a single string larger than the page.
    // Keep its amounts and its place in the list, with a shortened label.
    if (size + 2 > ITEM_PAGE_BYTES) {
      const shorten = (text: string) => text.length > 1024 ? text.slice(0, 1024) + "…" : text;
      row = { ...item, itemString: shorten(item.itemString), name: shorten(name) };
      size = Buffer.byteLength(JSON.stringify(row));
    }
    const comma = rows.length > 0 ? 1 : 0;
    if (bytes + comma + size > ITEM_PAGE_BYTES) break;
    bytes += comma + size;
    rows.push(row);
  }
  return { rows, nextOffset: index < items.length ? index : null };
}

export const LEDGER_SAVED_FILE = "TradeSkillMaster.lua";

/** Where the game saves the addon's records for one WoW account. */
const savedFile = (installation: WowInstallation, account: string) =>
  join(installation.location, "WTF/Account", account, "SavedVariables", LEDGER_SAVED_FILE);

const recordKey = /^r@.+@internalData@(csv\w+)$/;
const goldLogKey = /^(?:s@.+@internalData@goldLog|g@ @internalData@warbankGoldLog)$/;
const guildLogKey = /^f@.+@internalData@guildGoldLog$/;

/**
 * Whether the addon would read at least one record from the file: a row of
 * a record CSV or a gold log point (csvRows: a known header, then rows with
 * the header's field count).
 */
function hasRecords(db: Readonly<Record<string, LuaValue>>): boolean {
  for (const [key, value] of Object.entries(db)) {
    const csv = RECORD_CSVS[recordKey.exec(key)?.[1] ?? ""];
    if (csv && hasRows(value, csv.headers)) return true;
    if (goldLogKey.test(key) && hasRows(value, GOLD_LOG)) return true;
    if (guildLogKey.test(key) && typeof value === "object" && Object.values(value).some((log) => hasRows(log, GOLD_LOG))) return true;
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
  readonly #now: () => number;
  // Reuse the sort on adjacent reads. A rewritten file or a moving period
  // window invalidates the totals.
  #items?: {
    db: LuaTable;
    key: string;
    totals: ReturnType<typeof ledgerItemTotals>;
  };
  constructor(options: { gameRunning?: () => Promise<GameRunning>; reader?: SavedVariablesReader; now?: () => number } = {}) {
    this.#gameRunning = options.gameRunning ?? (() => detectGameRunning());
    this.#reader = options.reader ?? savedVariables;
    this.#now = options.now ?? Date.now;
  }

  /**
   * The Ledger of `account`, or of the engine's pick: the account written
   * last that has records, else the account written last. Without the addon
   * and without records anywhere the state is noAddon. The filters and
   * figures follow `selection` (ledgerView). Throws when a file it reads
   * cannot be read as saved data, so a broken file never reads as an empty
   * Ledger.
   */
  async ledger(installation: WowInstallation, account?: string, selection: LedgerSelection = {}): Promise<TradeSkillMasterLedger> {
    const gameRunning = (await this.#gameRunning()) === "running";
    const retail = RETAIL.has(installation.clientType);
    const found = accounts(installation);
    const installed = existsSync(join(getAddonsPath(installation), "TradeSkillMaster"));
    if (found.length === 0) {
      return {
        state: installed ? "noAccount" : "noAddon", accounts: [], account: null, recordedAt: null, gameRunning, retail,
        ...ledgerView(Object.create(null), selection, this.#now(), false),
      };
    }
    const { chosen, saved } = this.#readAccount(installation, found, account);
    const ready = saved !== null && hasRecords(saved.db);
    // Without the addon, an empty Ledger asks for it unless another account has records.
    const noAddon = !ready && !installed && !found.some((a) => a !== chosen && this.#hasRecords(installation, a.name));
    const view = ledgerView(saved?.db ?? Object.create(null), selection, this.#now(), ready);
    const itemInfo = saved?.itemInfo;
    if (view.figures && itemInfo) {
      for (const flow of [view.figures.earned, view.figures.spent, view.figures.profit]) {
        if (flow.topItem === null) continue;
        const name = ledgerItemName(itemInfo, flow.topItem);
        if (name !== undefined) flow.topItemName = name;
      }
    }
    return {
      state: ready ? "ready" : noAddon ? "noAddon" : "noRecords",
      accounts: found.map((a) => a.name),
      account: chosen.name,
      recordedAt: Math.floor(chosen.mtimeMs),
      gameRunning,
      retail,
      ...view,
    };
  }

  ledgerItems(installation: WowInstallation, params: TradeSkillMasterLedgerItemsParams): TradeSkillMasterLedgerItemsPage {
    const { account, exact = false, realm, character, period, offset = 0 } = params;
    const found = accounts(installation);
    const asked = found.find((a) => a.name === account);
    if (found.length === 0 || (exact && !asked)) return { rows: [], nextOffset: null };
    const saved = asked ? this.#read(installation, asked.name) : this.#readAccount(installation, found).saved;
    if (!saved) return { rows: [], nextOffset: null };

    const now = this.#now();
    const key = JSON.stringify([exact, realm, character, period, !period || period === "All" ? null : Math.floor(now / 1000)]);
    if (this.#items?.db !== saved.db || this.#items.key !== key) {
      this.#items = { db: saved.db, key, totals: ledgerItemTotals(saved.db, params, now, exact) };
    }
    return itemPage(this.#items.totals, saved.itemInfo, Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
  }

  #read(installation: WowInstallation, name: string) {
    const saved = readTradeSkillMaster(savedFile(installation, name), this.#reader);
    if (saved.status !== "ok" && saved.status !== "missing") {
      console.error("[ledger] TradeSkillMaster.lua not readable:", saved.status);
      throw new Error(`TradeSkillMaster.lua is ${saved.status}`);
    }
    return saved.status === "ok" ? saved : null;
  }

  #hasRecords(installation: WowInstallation, name: string): boolean {
    const saved = this.#read(installation, name);
    return saved !== null && hasRecords(saved.db);
  }

  #readAccount(installation: WowInstallation, found: ReturnType<typeof accounts>, account?: string) {
    const asked = found.find((a) => a.name === account);
    // Newest first, so the usual case reads one file.
    const newestFirst = [...found].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const chosen = asked ?? newestFirst.find((a) => this.#hasRecords(installation, a.name)) ?? newestFirst[0]!;
    return { chosen, saved: this.#read(installation, chosen.name) };
  }
}
