/**
 * The Ledger's filter choices and figures (ADR 0018), derived from one
 * account's TradeSkillMasterDB on every call: the record CSVs are scanned in
 * place, so nothing beyond the parsed file is kept. Project-owned; the rules
 * follow the TradeSkillMaster addon's in-game Dashboard (4.15.9), which is a
 * behaviour reference only, and the record format in spec #308.
 */
import {
  TSM_LEDGER_PERIODS,
  type TradeSkillMasterLedgerCharacter,
  type TradeSkillMasterLedgerFigures,
  type TradeSkillMasterLedgerFlow,
  type TradeSkillMasterLedgerPeriod,
} from "../../api/contracts";
import type { LuaTable, LuaValue } from "./SavedVariables";

const SECONDS_PER_DAY = 86_400;
/** Each period's length in days, as the in-game Dashboard counts it. */
const PERIOD_DAYS: Record<Exclude<TradeSkillMasterLedgerPeriod, "All">, number> = {
  "1D": 1, "1W": 7, "1M": 30, "3M": 91, "6M": 183, "1Y": 365, "2Y": 730,
};

const trade = (other: string) => `itemString,stackSize,quantity,price,${other},player,time,source`;
const SALES = [trade("otherPlayer"), trade("buyer")];
const BUYS = [trade("otherPlayer"), trade("seller")];
const MONEY = ["type,amount,otherPlayer,player,time"];
const AUCTIONS = ["itemString,stackSize,quantity,player,time"];
export const GOLD_LOG = ["minute,copper"];

/** The record CSVs of a realm (`r@<realm>@internalData@<csv>`): accepted headers and the player column. */
export const RECORD_CSVS: Record<string, { headers: string[]; player: number }> = {
  csvSales: { headers: SALES, player: 5 },
  csvBuys: { headers: BUYS, player: 5 },
  csvIncome: { headers: MONEY, player: 3 },
  csvExpense: { headers: MONEY, player: 3 },
  csvExpired: { headers: AUCTIONS, player: 3 },
  csvCancelled: { headers: AUCTIONS, player: 3 },
};
const recordKey = /^r@(.+)@internalData@(csv\w+)$/;
const characterLogKey = /^s@(.+)@internalData@goldLog$/;
const guildLogKey = /^f@(.+)@internalData@guildGoldLog$/;
const warbankLogKey = "g@ @internalData@warbankGoldLog";
/** `Name - Faction - Realm`, read the way the addon reads it. */
const characterKey = /^(.+) - .+ - (.+)$/;
/** `Faction - Realm`. */
const factionRealm = /^.+? - (.+)$/;

/**
 * The rows of a CSV the way the addon decodes it: the first line must be one
 * of `headers`, and a row with another field count ends the CSV. Rows are
 * sliced one at a time from the stored string, never split all at once.
 */
export function* csvRows(value: LuaValue | undefined, headers: string[]): Generator<string[]> {
  if (typeof value !== "string") return;
  let end = value.indexOf("\n");
  if (end < 0 || !headers.includes(value.slice(0, end))) return;
  const fields = value.slice(0, end).split(",").length;
  while (end >= 0) {
    const start = end + 1;
    end = value.indexOf("\n", start);
    const row = value.slice(start, end < 0 ? undefined : end).split(",");
    if (row.length !== fields) return;
    yield row;
  }
}

export const hasRows = (value: LuaValue | undefined, headers: string[]): boolean => !csvRows(value, headers).next().done;

/** Lua's tonumber for the decimal and hex numbers the addon writes; NaN for anything else. */
function luaNumber(text: string): number {
  const trimmed = text.trim();
  const value = trimmed === "" ? NaN : Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

const MAX_ITEM_ID = 999_999;

/**
 * A record's item string as the addon keys it: a bare id or `item:<id>` is
 * `i:<id>`, an id beyond any item is no item (null), and zeros at the end of
 * a longer `i:`/`p:` string go. Other strings stay as written: the addon itself
 * writes only `i:` and `p:` strings.
 */
function itemKey(text: string): string | null {
  let item = text.trim();
  const id = /^(?:item:)?(\d+)$/.exec(item)?.[1];
  if (id !== undefined) item = `i:${id}`;
  const plain = /^[ip]:(\d+)$/.exec(item);
  if (plain) return Number(plain[1]) > MAX_ITEM_ID ? null : item;
  if (/^i:[0-9\-:i+]+$/.test(item) || /^p:[i0-9:]+$/.test(item)) {
    item = item.replaceAll(":0:", "::");
    while (/:0?$/.test(item)) item = item.replace(/:0?$/, "");
  }
  return item === "" ? null : item;
}

/** A realm's records and an account's gold logs, located once per call. */
interface Layout {
  /** Realm → its record CSVs by name. */
  records: Map<string, Map<string, LuaValue>>;
  /** Character logs: name, realm and CSV. */
  characterLogs: { name: string; realm: string; log: LuaValue }[];
  /** Guild logs: realm and CSV. */
  guildLogs: { realm: string; log: LuaValue }[];
  warbankLog: LuaValue | undefined;
}

function layout(db: LuaTable): Layout {
  const result: Layout = { records: new Map(), characterLogs: [], guildLogs: [], warbankLog: db[warbankLogKey] };
  for (const [key, value] of Object.entries(db)) {
    let match = recordKey.exec(key);
    if (match && RECORD_CSVS[match[2]!]) {
      const realm = match[1]!;
      if (!result.records.has(realm)) result.records.set(realm, new Map());
      result.records.get(realm)!.set(match[2]!, value);
      continue;
    }
    match = characterLogKey.exec(key);
    const character = match && characterKey.exec(match[1]!);
    if (character) {
      result.characterLogs.push({ name: character[1]!, realm: character[2]!, log: value });
      continue;
    }
    match = guildLogKey.exec(key);
    if (match && typeof value === "object") {
      const realm = factionRealm.exec(match[1]!)?.[1];
      if (realm) for (const log of Object.values(value)) result.guildLogs.push({ realm, log });
    }
  }
  return result;
}

const byText = (a: string, b: string) => a.localeCompare(b, "en");
const characterId = (name: string, realm: string) => `${name} - ${realm}`;

export interface LedgerSelection {
  realm?: string;
  character?: string;
  period?: string;
}

export interface LedgerView {
  realms: string[];
  realm: string | null;
  characters: TradeSkillMasterLedgerCharacter[];
  character: string | null;
  period: TradeSkillMasterLedgerPeriod;
  /** Present when `withFigures` was asked for. */
  figures: TradeSkillMasterLedgerFigures | null;
}

/**
 * The filter choices for `db` with the effective selection (a realm or
 * character that is not a choice is All), and, with `withFigures`, the
 * figures for that selection at `nowMs`.
 */
export function ledgerView(db: LuaTable, asked: LedgerSelection, nowMs: number, withFigures: boolean): LedgerView {
  const data = layout(db);
  const realms = [...data.records]
    .filter(([, csvs]) => [...csvs].some(([name, csv]) => hasRows(csv, RECORD_CSVS[name]!.headers)))
    .map(([realm]) => realm)
    .sort(byText);
  const realm = asked.realm !== undefined && realms.includes(asked.realm) ? asked.realm : null;

  // Every character of the records' player column and of the gold logs, per realm.
  const named = new Map<string, { name: string; realm: string }>();
  const add = (name: string, of: string) => {
    if (name !== "" && (realm === null || of === realm)) named.set(characterId(name, of), { name, realm: of });
  };
  for (const [of, csvs] of data.records) {
    for (const [name, csv] of csvs) {
      const { headers, player } = RECORD_CSVS[name]!;
      for (const row of csvRows(csv, headers)) add(row[player]!, of);
    }
  }
  for (const { name, realm: of, log } of data.characterLogs) if (hasRows(log, GOLD_LOG)) add(name, of);
  const severalRealms = new Set([...named.values()].map((c) => c.realm)).size > 1;
  const characters = [...named].map(([id, c]): TradeSkillMasterLedgerCharacter => ({
    id,
    label: realm === null && severalRealms ? id : c.name,
    kind: "character",
  })).sort((a, b) => byText(a.label, b.label) || byText(a.id, b.id));
  const character = asked.character !== undefined && named.has(asked.character) ? asked.character : null;
  const period = ((TSM_LEDGER_PERIODS as readonly string[]).includes(asked.period ?? "") ? asked.period : "All") as TradeSkillMasterLedgerPeriod;

  return {
    realms,
    realm,
    characters,
    character,
    period,
    figures: withFigures ? figures(data, realm, character === null ? null : named.get(character)!, period, nowMs) : null,
  };
}

/** One kind of record (sales or purchases) summed over a window. */
interface Tally {
  amount: number;
  quantity: number;
  /** The highest price per item. */
  topPrice: number;
  perItem: Map<string, number>;
  topItem: string | null;
}
const tally = (): Tally => ({ amount: 0, quantity: 0, topPrice: 0, perItem: new Map(), topItem: null });

function figures(
  data: Layout,
  realm: string | null,
  character: { name: string; realm: string } | null,
  period: TradeSkillMasterLedgerPeriod,
  nowMs: number,
): TradeSkillMasterLedgerFigures {
  const now = Math.floor(nowMs / 1000);
  const range = period === "All" ? null : PERIOD_DAYS[period] * SECONDS_PER_DAY;
  const inScope = (of: string) => (character ? of === character.realm : realm === null || of === realm);

  // Sales and purchases only, from every source; both windows are open at
  // both ends, and All has no window and no previous period.
  const current = { sale: tally(), buy: tally() };
  const previous = { sale: 0, buy: 0 };
  for (const [of, csvs] of data.records) {
    if (!inScope(of)) continue;
    for (const [kind, name] of [["sale", "csvSales"], ["buy", "csvBuys"]] as const) {
      for (const [itemText, stackText, quantityText, priceText, , player, timeText] of csvRows(csvs.get(name), RECORD_CSVS[name]!.headers)) {
        const itemString = itemKey(itemText!);
        const quantity = luaNumber(quantityText!);
        const price = Math.floor(luaNumber(priceText!));
        const time = Math.floor(luaNumber(timeText!));
        // The addon drops a row with a field it cannot read.
        if (itemString === null || Number.isNaN(luaNumber(stackText!)) || Number.isNaN(quantity) || Number.isNaN(price) || Number.isNaN(time)) continue;
        if (character && player !== character.name) continue;
        const value = price * quantity;
        if (range === null || (time > now - range && time < now)) {
          const t = current[kind];
          t.amount += value;
          t.quantity += quantity;
          t.topPrice = Math.max(t.topPrice, price);
          const itemTotal = (t.perItem.get(itemString) ?? 0) + value;
          t.perItem.set(itemString, itemTotal);
          // The first item to reach the highest total stays on top, as in game.
          if (t.topItem === null || itemTotal > t.perItem.get(t.topItem)!) t.topItem = itemString;
        } else if (range !== null && time > now - 2 * range && time < now - range) {
          previous[kind] += value;
        }
      }
    }
  }

  const days = range !== null ? range / SECONDS_PER_DAY : daysSinceFirstGold(data, realm, character, nowMs);
  const { sale, buy } = current;
  let profitItem: string | null = null;
  let profitBest = 0;
  for (const item of new Set([...sale.perItem.keys(), ...buy.perItem.keys()])) {
    const net = (sale.perItem.get(item) ?? 0) - (buy.perItem.get(item) ?? 0);
    if (net > profitBest) { profitBest = net; profitItem = item; }
  }
  const flow = (total: number, perDay: number, topItem: string | null, trend: number | null): TradeSkillMasterLedgerFlow =>
    ({ total, perDay, topItem, trend });
  const saleTrend = range === null ? null : sale.amount - previous.sale;
  const buyTrend = range === null ? null : buy.amount - previous.buy;
  return {
    earned: flow(sale.amount, sale.amount / days, sale.topItem, saleTrend),
    spent: flow(buy.amount, buy.amount / days, buy.topItem, buyTrend),
    profit: flow(
      sale.amount - buy.amount,
      (sale.amount - buy.amount) / days,
      profitItem,
      saleTrend === null || buyTrend === null ? null : saleTrend - buyTrend,
    ),
    dailySales: sale.quantity / days,
    dailyPurchases: buy.quantity / days,
    topSale: sale.topPrice,
    topPurchase: buy.topPrice,
  };
}

/**
 * All's divisor: whole days from the first point of the selection's gold
 * logs to now, at least 1. One character selects its own log; All
 * characters select the realm's character and guild logs (every realm's
 * under All realms) and the account-wide Warband bank log.
 */
function daysSinceFirstGold(
  data: Layout,
  realm: string | null,
  character: { name: string; realm: string } | null,
  nowMs: number,
): number {
  const now = Math.floor(nowMs / 60_000) * 60;
  const logs: LuaValue[] = [];
  if (character) {
    for (const log of data.characterLogs) if (log.name === character.name && log.realm === character.realm) logs.push(log.log);
  } else {
    const inScope = (of: string) => realm === null || of === realm;
    for (const log of data.characterLogs) if (inScope(log.realm)) logs.push(log.log);
    for (const log of data.guildLogs) if (inScope(log.realm)) logs.push(log.log);
    if (data.warbankLog !== undefined) logs.push(data.warbankLog);
  }
  let start = now;
  for (const log of logs) {
    for (const [minute] of csvRows(log, GOLD_LOG)) {
      const first = luaNumber(minute!);
      if (!Number.isNaN(first)) start = Math.min(start, first * 60);
      break;
    }
  }
  return Math.max(1, Math.ceil((now - start) / SECONDS_PER_DAY));
}
