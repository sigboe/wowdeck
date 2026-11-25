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
  type TradeSkillMasterLedgerGold,
  type TradeSkillMasterLedgerPeriod,
} from "../../api/contracts";
import { goldGraph, goldLog, goldRange, MAX_CHARACTER_COPPER, MAX_WARBANK_COPPER, type SelectedLog } from "./LedgerGold";
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
const characterGuildsKey = /^f@(.+)@internalData@characterGuilds$/;
const guildUpdateKey = /^f@(.+)@internalData@guildGoldLogLastUpdate$/;
const warbankLogKey = "g@ @internalData@warbankGoldLog";
/** `Name - Faction - Realm`, read the way the addon reads it. */
const characterKey = /^(.+) - (.+) - (.+)$/;
/** `Faction - Realm`. */
const factionRealm = /^(.+?) - (.+)$/;
/** The addon stops counting a guild none of the player's characters is in once its last entry is this old. */
const STALE_GUILD = 30 * SECONDS_PER_DAY;
const WARBANK = "warbank";

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

/** A CSV with one of `headers` as its first line, with or without rows. */
const hasHeader = (value: LuaValue | undefined, headers: string[]): boolean => {
  if (typeof value !== "string") return false;
  const end = value.indexOf("\n");
  return headers.includes(end < 0 ? value : value.slice(0, end));
};

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
  /** Character logs: name, faction, realm and CSV. */
  characterLogs: { name: string; faction: string; realm: string; log: LuaValue }[];
  /** Guild logs: name, faction, realm and CSV. */
  guildLogs: { name: string; faction: string; realm: string; log: LuaValue }[];
  warbankLog: LuaValue | undefined;
  /** `Faction - Realm` → character name → the guild it is in. */
  characterGuilds: Map<string, LuaTable>;
  /** `Faction - Realm` → guild → when its gold was last logged, in seconds. */
  guildUpdates: Map<string, LuaTable>;
}

function layout(db: LuaTable): Layout {
  const result: Layout = {
    records: new Map(), characterLogs: [], guildLogs: [], warbankLog: db[warbankLogKey], characterGuilds: new Map(), guildUpdates: new Map(),
  };
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
      result.characterLogs.push({ name: character[1]!, faction: character[2]!, realm: character[3]!, log: value });
      continue;
    }
    if (typeof value !== "object") continue;
    match = guildLogKey.exec(key);
    const guilds = match && factionRealm.exec(match[1]!);
    if (guilds) {
      for (const [name, log] of Object.entries(value)) result.guildLogs.push({ name, faction: guilds[1]!, realm: guilds[2]!, log });
      continue;
    }
    match = characterGuildsKey.exec(key);
    if (match) {
      result.characterGuilds.set(match[1]!, value);
      continue;
    }
    match = guildUpdateKey.exec(key);
    if (match) result.guildUpdates.set(match[1]!, value);
  }
  return result;
}

/** What the Character filter selects: a character, the Warband bank or a guild. */
type Choice =
  | { kind: "character"; name: string; realm: string }
  | { kind: "warbank" }
  | { kind: "guild"; name: string; faction: string; realm: string };
const guildId = (g: { name: string; faction: string; realm: string }) => `guild:${g.name} - ${g.faction} - ${g.realm}`;

const byText = (a: string, b: string) => a.localeCompare(b, "en");
const characterId = (name: string, realm: string) => `${name} - ${realm}`;

export interface LedgerSelection {
  realm?: string;
  character?: string;
  period?: string;
  /** The gold graph's plot width in CSS px; absent, the addon's step limit alone. */
  plotWidth?: number;
}

export interface LedgerView {
  realms: string[];
  realm: string | null;
  characters: TradeSkillMasterLedgerCharacter[];
  character: string | null;
  period: TradeSkillMasterLedgerPeriod;
  itemCount: number;
  /** Present when `withFigures` was asked for. */
  figures: TradeSkillMasterLedgerFigures | null;
  /** Present when `withFigures` was asked for and the selection has a gold log point. */
  gold: TradeSkillMasterLedgerGold | null;
}

/**
 * The filter choices for `db` with the effective selection (a realm or
 * character that is not a choice is All), and, with `withFigures`, the
 * figures for that selection at `nowMs`.
 */
export function ledgerView(db: LuaTable, asked: LedgerSelection, nowMs: number, withFigures: boolean): LedgerView {
  const data = layout(db);
  const { selected, range, ...filters } = selectTrades(data, asked);
  const trades = withFigures ? tradeTallies(data, filters.realm, selected, range, nowMs) : null;
  const logs = withFigures ? selectedLogs(data, filters.realm, selected, nowMs) : [];
  return {
    ...filters,
    itemCount: trades ? itemKeys(trades.current).length : 0,
    figures: trades ? figures(trades, range, logs, nowMs) : null,
    gold: withFigures ? goldGraph(logs, range, nowMs, asked.plotWidth) : null,
  };
}

function selectTrades(data: Layout, asked: LedgerSelection) {
  // Every realm with records: a record CSV's row or a character's or guild's gold-log point.
  const realms = [...new Set([
    ...[...data.records]
      .filter(([, csvs]) => [...csvs].some(([name, csv]) => hasRows(csv, RECORD_CSVS[name]!.headers)))
      .map(([realm]) => realm),
    ...[...data.characterLogs, ...data.guildLogs].filter((l) => hasRows(l.log, GOLD_LOG)).map((l) => l.realm),
  ])].sort(byText);
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
  // The Warband bank under every realm, and the realm's guilds with a gold log.
  // The addon lists the Warband bank whenever it keeps the log, points or not:
  // only a game with a Warband bank saves it, so its header marks one.
  const others = new Map<string, Choice>();
  if (hasHeader(data.warbankLog, GOLD_LOG)) others.set(WARBANK, { kind: "warbank" });
  const guilds = data.guildLogs.filter((g) => (realm === null || g.realm === realm) && hasRows(g.log, GOLD_LOG));
  const severalRealms = new Set([...named.values(), ...guilds].map((c) => c.realm)).size > 1;
  const label = (name: string, of: string) => (realm === null && severalRealms ? `${name} - ${of}` : name);
  const characters = [...named].map(([id, c]): TradeSkillMasterLedgerCharacter => ({
    id,
    label: label(c.name, c.realm),
    kind: "character",
  })).sort((a, b) => byText(a.label, b.label) || byText(a.id, b.id));
  if (others.has(WARBANK)) characters.push({ id: WARBANK, label: "Warband bank", kind: "warbank" });
  const guildChoices = guilds.map((g): TradeSkillMasterLedgerCharacter => {
    others.set(guildId(g), { kind: "guild", name: g.name, faction: g.faction, realm: g.realm });
    return { id: guildId(g), label: label(g.name, g.realm), kind: "guild" };
  }).sort((a, b) => byText(a.label, b.label) || byText(a.id, b.id));
  characters.push(...guildChoices);
  const choice = (id: string | undefined): Choice | undefined => {
    if (id === undefined) return undefined;
    const c = named.get(id);
    return c ? { kind: "character", ...c } : others.get(id);
  };
  const selected = choice(asked.character);
  const character = selected ? asked.character! : null;
  const period = ((TSM_LEDGER_PERIODS as readonly string[]).includes(asked.period ?? "") ? asked.period : "All") as TradeSkillMasterLedgerPeriod;
  const range = period === "All" ? null : PERIOD_DAYS[period] * SECONDS_PER_DAY;
  return { realms, realm, characters, character, period, selected: selected ?? null, range };
}

/** Per-item totals for the same selection and time window as the summary. */
export function ledgerItemTotals(db: LuaTable, asked: LedgerSelection, nowMs: number, exact: boolean) {
  const data = layout(db);
  const { realm, character, selected, range } = selectTrades(data, asked);
  if (exact && (realm !== (asked.realm ?? null) || character !== (asked.character ?? null))) return [];
  const { current } = tradeTallies(data, realm, selected, range, nowMs);
  return itemKeys(current).map((itemString) => {
    const earned = current.sale.perItem.get(itemString) ?? 0;
    const spent = current.buy.perItem.get(itemString) ?? 0;
    const sold = current.sale.perItemQuantity.get(itemString) ?? 0;
    const bought = current.buy.perItemQuantity.get(itemString) ?? 0;
    return { itemString, sold, earned, bought, spent, net: earned - spent };
  }).sort((a, b) => (b.earned + b.spent) - (a.earned + a.spent) || byText(a.itemString, b.itemString));
}

/** One kind of record (sales or purchases) summed over a window. */
interface Tally {
  amount: number;
  quantity: number;
  /** The highest price per item. */
  topPrice: number;
  perItem: Map<string, number>;
  /** Items per item string, summed as `quantity` is. */
  perItemQuantity: Map<string, number>;
  topItem: string | null;
}
const tally = (): Tally => ({ amount: 0, quantity: 0, topPrice: 0, perItem: new Map(), perItemQuantity: new Map(), topItem: null });

function itemKeys({ sale, buy }: { sale: Tally; buy: Tally }): string[] {
  // The list is for item and battle pet strings, including their variants.
  return [...new Set([...sale.perItem.keys(), ...buy.perItem.keys()])]
    .filter((item) => /^[ip]:\d+(?::[0-9+i:-]+)?$/.test(item));
}

function tradeTallies(
  data: Layout,
  realm: string | null,
  selected: Choice | null,
  range: number | null,
  nowMs: number,
) {
  const now = Math.floor(nowMs / 1000);
  // The Warband bank and a guild trade nothing: their figures are zero.
  const character = selected?.kind === "character" ? selected : null;
  const inScope = (of: string) =>
    selected === null ? realm === null || of === realm : character !== null && of === character.realm;

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
          t.perItemQuantity.set(itemString, (t.perItemQuantity.get(itemString) ?? 0) + quantity);
          // The first item to reach the highest total stays on top, as in game.
          if (t.topItem === null || itemTotal > t.perItem.get(t.topItem)!) t.topItem = itemString;
        } else if (range !== null && time > now - 2 * range && time < now - range) {
          previous[kind] += value;
        }
      }
    }
  }

  return { current, previous };
}

function figures(
  { current, previous }: ReturnType<typeof tradeTallies>,
  range: number | null,
  logs: SelectedLog[],
  nowMs: number,
): TradeSkillMasterLedgerFigures {
  // All divides by the whole days since the selection's first gold-log point, at least 1.
  const { start, end } = goldRange(logs, nowMs);
  const days = range !== null ? range / SECONDS_PER_DAY : Math.max(1, Math.ceil((end - start) / SECONDS_PER_DAY));
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
 * The selection's gold logs, as the addon loads them: one character selects
 * its own log; All characters select the realm's character and guild logs
 * (every realm's under All realms) and the account-wide Warband bank log.
 * Character and Warband bank logs are cleaned of misread balances. A guild
 * none of the player's characters of its faction and realm is in, logged
 * last over 30 days ago, counts only until its last entry.
 */
function selectedLogs(data: Layout, realm: string | null, selected: Choice | null, nowMs: number): SelectedLog[] {
  const logs: SelectedLog[] = [];
  const inScope = (of: string) => realm === null || of === realm;
  const characters = data.characterLogs.filter((c) =>
    selected === null ? inScope(c.realm) : selected.kind === "character" && c.name === selected.name && c.realm === selected.realm);
  for (const c of characters) logs.push({ log: goldLog(csvRows(c.log, GOLD_LOG), MAX_CHARACTER_COPPER) });
  if ((selected === null || selected.kind === "warbank") && data.warbankLog !== undefined) {
    logs.push({ log: goldLog(csvRows(data.warbankLog, GOLD_LOG), MAX_WARBANK_COPPER) });
  }
  const guilds = data.guildLogs.filter((g) =>
    selected === null ? inScope(g.realm) : selected.kind === "guild" && guildId(g) === guildId(selected));
  if (guilds.length === 0) return logs;
  // A guild is current while a character with a gold log is in it. The addon
  // sees the realm it runs on, so only the guild's own faction and realm count.
  const current = new Set<string>();
  for (const c of data.characterLogs) {
    const guild = data.characterGuilds.get(`${c.faction} - ${c.realm}`)?.[c.name];
    if (typeof guild === "string") current.add(guildId({ name: guild, faction: c.faction, realm: c.realm }));
  }
  const stale = Math.floor(nowMs / 1000) - STALE_GUILD;
  for (const g of guilds) {
    const log = goldLog(csvRows(g.log, GOLD_LOG));
    const last = log.minutes.at(-1);
    const updated = data.guildUpdates.get(`${g.faction} - ${g.realm}`)?.[g.name];
    const lastEntry = last === undefined ? Infinity : last * 60;
    const ended = !current.has(guildId(g)) && Math.max(lastEntry, typeof updated === "number" ? updated : 0) < stale;
    logs.push(ended ? { log, until: lastEntry } : { log });
  }
  return logs;
}
