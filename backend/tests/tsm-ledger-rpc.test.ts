import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlServer } from "../src/bridge/jsonl";
import { providersHandlers } from "../src/api/handlers/providers";
import { TradeSkillMasterLedgerReader } from "../src/wow/tsm/Ledger";
import { SavedVariablesReader } from "../src/wow/tsm/SavedVariables";
import type { WowInstallation } from "../src/wow/models";
import type { GameRunning } from "../src/api/contracts";
import { subset } from "./helpers/subset";

/** A hand-written TradeSkillMaster.lua: empty CSVs carry only their header, as the addon writes them. */
const saved = (db: Record<string, string>) =>
  "TradeSkillMasterDB = {\n" +
  Object.entries(db).map(([key, value]) => `  [${JSON.stringify(key)}] = ${value},\n`).join("") +
  "}\n";
const empty = {
  "r@Silvermoon@internalData@csvSales": '"itemString,stackSize,quantity,price,otherPlayer,player,time,source"',
  "r@Silvermoon@internalData@csvBuys": '"itemString,stackSize,quantity,price,otherPlayer,player,time,source"',
  "r@Silvermoon@internalData@csvIncome": '"type,amount,otherPlayer,player,time"',
  "r@Silvermoon@internalData@csvExpense": '"type,amount,otherPlayer,player,time"',
  "r@Silvermoon@internalData@csvExpired": '"itemString,stackSize,quantity,player,time"',
  "r@Silvermoon@internalData@csvCancelled": '"itemString,stackSize,quantity,player,time"',
  "g@ @internalData@warbankGoldLog": '""',
  "s@Hero - Horde - Silvermoon@internalData@goldLog": '"minute,copper"',
  "f@Horde - Silvermoon@internalData@guildGoldLog": '{ ["Guild"] = "minute,copper" }',
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tsm-ledger-"));
  const installation = { id: "era", location: join(dir, "_classic_era_"), clientType: 2 } as WowInstallation;
  mkdirSync(installation.location, { recursive: true });
  const write = (path: string, content: string, seconds?: number) => {
    const full = join(installation.location, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    if (seconds !== undefined) utimesSync(full, seconds, seconds);
  };
  let running: GameRunning = "not_running";
  const ledger = new TradeSkillMasterLedgerReader({
    gameRunning: async () => running,
    reader: new SavedVariablesReader(),
  });
  let response: any;
  const rpc = new JsonlServer((line) => { response = JSON.parse(line); });
  rpc.handle(providersHandlers(subset({ tsmLedger: ledger, installationService: { require: () => installation } })));
  const call = async (params: object = {}) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method: "tradeskillmaster.ledger", params: { installationId: "era", ...params } }));
    return response;
  };
  return { write, call, running: (state: GameRunning) => { running = state; } };
}

const account = (name: string) => `WTF/Account/${name}/SavedVariables/TradeSkillMaster.lua`;
/** Nothing to choose and nothing to count. */
const noFilters = { realms: [], realm: null, characters: [], character: null, period: "All", figures: null, gold: null };

test("without the addon or any account's records, the Ledger asks for the addon", async () => {
  const { write, call } = fixture();
  // A WoW account the addon never saved to does not count.
  write("WTF/Account/MAIN/SavedVariables/Blizzard_Settings.lua", "Settings = {}\n");
  expect((await call()).result).toEqual({ state: "noAddon", accounts: [], account: null, recordedAt: null, gameRunning: false, ...noFilters });
});

test("with the addon installed but nothing saved yet, the Ledger has no account", async () => {
  const { write, call } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  expect((await call()).result).toEqual({ state: "noAccount", accounts: [], account: null, recordedAt: null, gameRunning: false, ...noFilters });
});

test("one account is picked by itself, and a file of headers and empty gold logs has no records", async () => {
  const { write, call, running } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  write(account("MAIN"), saved(empty), 1_800_000_000);
  expect((await call()).result).toEqual({
    state: "noRecords", accounts: ["MAIN"], account: "MAIN", recordedAt: 1_800_000_000_000, gameRunning: false, ...noFilters,
  });
  running("running");
  expect((await call()).result.gameRunning).toBe(true);
  // Unknown is not running: nothing says this session is missing.
  running("unknown");
  expect((await call()).result.gameRunning).toBe(false);
});

const sale = "i:2589,1,20,15,Bob,Hero,1700000000,Auction";
const header = (key: string) => JSON.parse(empty[key as keyof typeof empty]) as string;

test("any recorded row or gold log point makes the Ledger ready", async () => {
  const records: Record<string, [string, string]> = {
    sale: ["r@Silvermoon@internalData@csvSales", sale],
    buy: ["r@Silvermoon@internalData@csvBuys", sale],
    income: ["r@Silvermoon@internalData@csvIncome", "Money Transfer,1000,Alt,Hero,1700000000"],
    expense: ["r@Silvermoon@internalData@csvExpense", "Postage,30,Alt,Hero,1700000000"],
    expired: ["r@Silvermoon@internalData@csvExpired", "i:2589,1,20,Hero,1700000000"],
    cancelled: ["r@Silvermoon@internalData@csvCancelled", "i:2589,1,20,Hero,1700000000"],
    gold: ["s@Hero - Horde - Silvermoon@internalData@goldLog", "29000000,100"],
  };
  for (const [name, [key, row]] of Object.entries(records)) {
    const { write, call } = fixture();
    write(account("MAIN"), saved({ ...empty, [key]: JSON.stringify(`${header(key)}\n${row}`) }));
    expect([name, (await call()).result.state]).toEqual([name, "ready"]);
  }
  for (const [name, value] of Object.entries({
    warbank: ["g@ @internalData@warbankGoldLog", '"minute,copper\\n29000000,100"'],
    guild: ["f@Horde - Silvermoon@internalData@guildGoldLog", '{ ["Guild"] = "minute,copper\\n29000000,100" }'],
    // Older files name the other player buyer or seller.
    olderSales: ["r@Silvermoon@internalData@csvSales", JSON.stringify(`itemString,stackSize,quantity,price,buyer,player,time,source\n${sale}`)],
  })) {
    const { write, call } = fixture();
    write(account("MAIN"), saved({ ...empty, [value[0]!]: value[1]! }));
    expect([name, (await call()).result.state]).toEqual([name, "ready"]);
  }
});

test("rows the addon would not read are no records: a wrong field count ends a CSV, an unknown header drops it", async () => {
  for (const csv of [
    `${header("r@Silvermoon@internalData@csvSales")}\n1,2\n${sale}`,
    `${header("r@Silvermoon@internalData@csvSales")}\n\n${sale}`,
    `itemString,price\n1,2`,
  ]) {
    const { write, call } = fixture();
    write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
    write(account("MAIN"), saved({ ...empty, "r@Silvermoon@internalData@csvSales": JSON.stringify(csv) }));
    expect([csv, (await call()).result.state]).toEqual([csv, "noRecords"]);
  }
});

test("several accounts: the one asked for, else the newest with records, else the newest", async () => {
  const { write, call } = fixture();
  write(account("ALT"), saved(empty), 1_800_000_500);
  write(account("MAIN"), saved({ ...empty, "g@ @internalData@warbankGoldLog": '"minute,copper\\n29000000,100"' }), 1_800_000_000);
  write(account("OLD"), saved({ ...empty, "g@ @internalData@warbankGoldLog": '"minute,copper\\n29000000,100"' }), 1_700_000_000);
  // An account folder without the addon's file is not an account of the Ledger.
  write("WTF/Account/NONE/SavedVariables/Other.lua", "Other = {}\n");
  // An empty account written last does not hide an older account's records;
  // the time is the shown account's, which dates the records on screen.
  expect((await call()).result).toMatchObject({ state: "ready", accounts: ["ALT", "MAIN", "OLD"], account: "MAIN", recordedAt: 1_800_000_000_000 });
  expect((await call({ account: "ALT" })).result).toMatchObject({ state: "noRecords", account: "ALT", recordedAt: 1_800_000_500_000 });
  // An account that is gone falls back to the engine's pick.
  expect((await call({ account: "GONE" })).result).toMatchObject({ account: "MAIN" });

  // Without records anywhere, the account written last.
  const none = fixture();
  none.write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  none.write(account("ALT"), saved(empty), 1_800_000_000);
  none.write(account("MAIN"), saved(empty), 1_800_000_500);
  expect((await none.call()).result).toMatchObject({ state: "noRecords", account: "MAIN", recordedAt: 1_800_000_500_000 });
});

test("without the addon, records still show; files with no records ask for the addon", async () => {
  const { write, call } = fixture();
  write(account("MAIN"), "TradeSkillMasterDB = {}\n", 1_800_000_000);
  write(account("ALT"), saved(empty), 1_800_000_500);
  expect((await call()).result).toEqual({
    state: "noAddon", accounts: ["ALT", "MAIN"], account: "ALT", recordedAt: 1_800_000_500_000, gameRunning: false, ...noFilters,
  });
  write(account("MAIN"), saved({ ...empty, "r@Silvermoon@internalData@csvSales": JSON.stringify(`${header("r@Silvermoon@internalData@csvSales")}\n${sale}`) }), 1_800_000_000);
  expect((await call()).result).toMatchObject({ state: "ready", account: "MAIN" });
});

test("a file that is not plain saved data is an error, not an empty Ledger", async () => {
  const { write, call } = fixture();
  write(account("MAIN"), "TradeSkillMasterDB = os.execute('x')\n");
  const response = await call();
  expect(response.result).toBeUndefined();
  expect(response.error).toBeDefined();
});

// ---------------------------------------------------------------------------
// Filters and figures (ADR 0018). Time comes from the reader's injected clock.

const NOW = 1_800_000_000; // seconds; a whole minute
const DAY = 86_400;
const csv = (header: string, rows: string[]) => JSON.stringify([header, ...rows].join("\n"));
const TRADE = "itemString,stackSize,quantity,price,otherPlayer,player,time,source";
const MONEY = "type,amount,otherPlayer,player,time";
const AUCTIONS = "itemString,stackSize,quantity,player,time";
const GOLD = "minute,copper";
const minute = (secondsAgo: number) => (NOW - secondsAgo) / 60;

/**
 * Account MAIN: Silvermoon (Hero, Alt, Trader who trades without a gold log,
 * Banker with a gold log only) and Argent Dawn (another Hero, in the older
 * buyer/seller format). Prices are per item; totals are price × quantity.
 */
const mainSales = [
  `i:1,1,20,100,Buyer,Hero,${NOW - 3600},Auction`, // 2000
  `i:2,5,10,30,Buyer,Hero,${NOW - 2 * DAY},COD`, // 300
  `i:1,1,1,500,Bob,Alt,${NOW - 3 * DAY},Trade`, // 500
  `i:3,1,4,25,Merchant,Trader,${NOW - 10 * DAY},Vendor`, // 100
  `i:1,1,1,50,Buyer,Hero,${NOW - 8 * DAY},Auction`, // 50
];
const mainBuys = [
  `i:2,1,3,40,Seller,Hero,${NOW - 2 * DAY},Auction`, // 120
  `i:5,1,1,70,Merchant,Trader,${NOW - 5 * DAY},Vendor`, // 70
  `i:2,1,1,10,Seller,Alt,${NOW - 9 * DAY},COD`, // 10
  `i:1,1,10,200,Seller,Hero,${NOW - 4 * DAY},Auction`, // 2000
];
/** Mail between alts on both sides, postage and a repair bill: none of it counts. */
const mainMoney = {
  "r@Silvermoon@internalData@csvIncome": csv(MONEY, [`Money Transfer,10000,Alt,Hero,${NOW - DAY}`, `Garrison,400,Merchant,Hero,${NOW - DAY}`]),
  "r@Silvermoon@internalData@csvExpense": csv(MONEY, [
    `Money Transfer,10000,Hero,Alt,${NOW - DAY}`,
    `Postage,30,Alt,Alt,${NOW - DAY}`,
    `Repair Bill,500,Merchant,Hero,${NOW - DAY}`,
  ]),
};
const mainDb = (money: Record<string, string> = mainMoney) => ({
  "r@Silvermoon@internalData@csvSales": csv(TRADE, mainSales),
  "r@Silvermoon@internalData@csvBuys": csv(TRADE, mainBuys),
  "r@Silvermoon@internalData@csvIncome": csv(MONEY, []),
  "r@Silvermoon@internalData@csvExpense": csv(MONEY, []),
  ...money,
  "r@Silvermoon@internalData@csvExpired": csv(AUCTIONS, [`i:3,1,1,Trader,${NOW - DAY}`]),
  "r@Argent Dawn@internalData@csvSales": csv(TRADE.replace("otherPlayer", "buyer"), [`i:9,1,1,1000,X,Hero,${NOW - DAY / 2},Auction`]),
  "r@Argent Dawn@internalData@csvBuys": csv(TRADE.replace("otherPlayer", "seller"), []),
  // A realm whose CSVs hold only headers has no records.
  "r@Empty@internalData@csvSales": csv(TRADE, []),
  "s@Hero - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(20 * DAY)},100`, `${minute(DAY)},500`]),
  "s@Alt - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(5 * DAY)},100`]),
  "s@Banker - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(2 * DAY)},100`]),
  "s@Hero - Alliance - Argent Dawn@internalData@goldLog": csv(GOLD, [`${minute(40 * DAY + 3600)},100`]),
  "g@ @internalData@warbankGoldLog": csv(GOLD, [`${minute(30 * DAY)},100`]),
  "f@Horde - Silvermoon@internalData@guildGoldLog": `{ ["Guild"] = ${csv(GOLD, [`${minute(25 * DAY)},100`])} }`,
});
/** Account ALT: Silvermoon only, with its own Hero. */
const altDb = {
  "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:7,1,1,5,Buyer,Hero,${NOW - DAY},Auction`]),
};

function figuresFixture(main: Record<string, string> = mainDb()) {
  const dir = mkdtempSync(join(tmpdir(), "tsm-ledger-figures-"));
  const installation = { id: "era", location: join(dir, "_classic_era_"), clientType: 2 } as WowInstallation;
  const write = (path: string, content: string, seconds: number) => {
    const full = join(installation.location, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    utimesSync(full, seconds, seconds);
  };
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n", NOW);
  write(account("MAIN"), saved(main), NOW - 60);
  write(account("ALT"), saved(altDb), NOW - 600);
  const ledger = new TradeSkillMasterLedgerReader({
    gameRunning: async () => "not_running",
    reader: new SavedVariablesReader(),
    now: () => NOW * 1000 + 999,
  });
  let response: any;
  const rpc = new JsonlServer((line) => { response = JSON.parse(line); });
  rpc.handle(providersHandlers(subset({ tsmLedger: ledger, installationService: { require: () => installation } })));
  return async (params: object = {}) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method: "tradeskillmaster.ledger", params: { installationId: "era", ...params } }));
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
}

test("filter choices: realms with records, characters from records and gold logs, the Warband bank and logged guilds, All by default", async () => {
  const call = figuresFixture();
  const all = await call();
  expect(all).toMatchObject({ state: "ready", account: "MAIN", realm: null, character: null, period: "All" });
  expect(all.realms).toEqual(["Argent Dawn", "Silvermoon"]);
  // Across realms a character carries its realm: the records' player column has none.
  expect(all.characters).toEqual([
    { id: "Alt - Silvermoon", label: "Alt - Silvermoon", kind: "character" },
    { id: "Banker - Silvermoon", label: "Banker - Silvermoon", kind: "character" },
    { id: "Hero - Argent Dawn", label: "Hero - Argent Dawn", kind: "character" },
    { id: "Hero - Silvermoon", label: "Hero - Silvermoon", kind: "character" },
    { id: "Trader - Silvermoon", label: "Trader - Silvermoon", kind: "character" },
    // Then the account-wide Warband bank and each guild with a gold log.
    { id: "warbank", label: "Warband bank", kind: "warbank" },
    { id: "guild:Guild - Horde - Silvermoon", label: "Guild - Silvermoon", kind: "guild" },
  ]);
  const silvermoon = await call({ realm: "Silvermoon" });
  expect(silvermoon.realm).toBe("Silvermoon");
  expect(silvermoon.characters.map((c: { label: string }) => c.label)).toEqual(["Alt", "Banker", "Hero", "Trader", "Warband bank", "Guild"]);
  // The Warband bank counts under every realm; a guild only under its own.
  expect((await call({ realm: "Argent Dawn" })).characters.map((c: { id: string }) => c.id)).toEqual(["Hero - Argent Dawn", "warbank"]);
  expect((await call({ period: "1M" })).period).toBe("1M");
});

test("a filter that no longer applies falls back to All; another account keeps a character only if it has one", async () => {
  const call = figuresFixture();
  expect(await call({ realm: "Nowhere", character: "Ghost - Silvermoon" })).toMatchObject({ realm: null, character: null });
  // A character of another realm is not a choice under this one.
  expect(await call({ realm: "Argent Dawn", character: "Alt - Silvermoon" })).toMatchObject({ realm: "Argent Dawn", character: null });
  // Changing account: the frontend resets Realm to All and keeps Character.
  const alt = await call({ account: "ALT", character: "Hero - Silvermoon" });
  expect(alt).toMatchObject({ account: "ALT", realms: ["Silvermoon"], realm: null, character: "Hero - Silvermoon" });
  // One realm: no realm in the labels.
  expect(alt.characters).toEqual([{ id: "Hero - Silvermoon", label: "Hero", kind: "character" }]);
  expect(await call({ account: "ALT", character: "Trader - Silvermoon" })).toMatchObject({ character: null });
  expect(await call({ account: "ALT", realm: "Argent Dawn" })).toMatchObject({ realm: null });
});

test("All: sales and purchases from every source, per day since the first gold-log point", async () => {
  const call = figuresFixture();
  const { figures } = await call();
  // Earned 2000+300+500+100+50 (Silvermoon) + 1000 (Argent Dawn); spent 120+70+10+2000.
  // The oldest gold-log point is Argent Dawn's Hero, 40 days and 1 hour ago: 41 days.
  expect(figures).toEqual({
    earned: { total: 3950, perDay: 3950 / 41, topItem: "i:1", trend: null },
    spent: { total: 2200, perDay: 2200 / 41, topItem: "i:1", trend: null },
    // i:1 earned 2550 and cost 2000; i:9 earned 1000 and cost nothing.
    profit: { total: 1750, perDay: 1750 / 41, topItem: "i:9", trend: null },
    // Items, not records: 20+10+1+4+1+1 sold, 3+1+1+10 bought.
    dailySales: 37 / 41,
    dailyPurchases: 15 / 41,
    // The highest price per item, not the biggest record.
    topSale: 1000,
    topPurchase: 200,
  });
});

test("Money Transfer, Postage, Repair Bill and other income or expense never change a total", async () => {
  const withMoney = (await figuresFixture()()).figures;
  const withoutMoney = (await figuresFixture(mainDb({}))()).figures;
  expect(withMoney).toEqual(withoutMoney);
});

test("a period divides by its days and trends against the previous period of the same length", async () => {
  const call = figuresFixture();
  const week = (await call({ period: "1W" })).figures;
  // This week: 2000+300+500+1000 earned, 120+70+2000 spent. The week before: 100+50 earned, 10 spent.
  expect(week.earned).toEqual({ total: 3800, perDay: 3800 / 7, topItem: "i:1", trend: 3800 - 150 });
  expect(week.spent).toEqual({ total: 2190, perDay: 2190 / 7, topItem: "i:1", trend: 2190 - 10 });
  expect(week.profit).toEqual({ total: 1610, perDay: 1610 / 7, topItem: "i:9", trend: (3800 - 150) - (2190 - 10) });
  expect(week.dailySales).toBe(32 / 7);
  expect(week.dailyPurchases).toBe(14 / 7);
  const day = (await call({ period: "1D" })).figures;
  expect(day.earned).toMatchObject({ total: 3000, perDay: 3000, trend: 3000 });
  expect(day.spent).toMatchObject({ total: 0, perDay: 0, topItem: null, trend: 0 });
  // Each period's length in days, as the in-game Dashboard counts them.
  for (const [period, days] of [["1M", 30], ["3M", 91], ["6M", 183], ["1Y", 365], ["2Y", 730]] as const) {
    const { figures } = await call({ period });
    expect([period, figures.earned.perDay]).toEqual([period, 3950 / days]);
  }
});

test("a character matches by name within its realm; one without a gold log divides All by one day", async () => {
  const call = figuresFixture();
  const hero = (await call({ realm: "Silvermoon", character: "Hero - Silvermoon" })).figures;
  // Silvermoon's Hero only: Argent Dawn's Hero sold i:9. Hero's gold log starts 20 days ago.
  expect(hero.earned).toEqual({ total: 2350, perDay: 2350 / 20, topItem: "i:1", trend: null });
  expect(hero.spent).toEqual({ total: 2120, perDay: 2120 / 20, topItem: "i:1", trend: null });
  const namesake = (await call({ character: "Hero - Argent Dawn" })).figures;
  expect(namesake.earned).toEqual({ total: 1000, perDay: 1000 / 41, topItem: "i:9", trend: null });
  expect(namesake.spent).toEqual({ total: 0, perDay: 0, topItem: null, trend: null });
  const trader = (await call({ character: "Trader - Silvermoon" })).figures;
  expect(trader.earned).toMatchObject({ total: 100, perDay: 100 });
  expect(trader.spent).toMatchObject({ total: 70, perDay: 70 });
  const alt = (await call({ character: "Alt - Silvermoon" })).figures;
  expect(alt.profit).toMatchObject({ total: 490, topItem: "i:1" });
  // No item made a profit: no top item.
  const banker = (await call({ character: "Banker - Silvermoon" })).figures;
  expect(banker.profit).toEqual({ total: 0, perDay: 0, topItem: null, trend: null });
  // One realm counts its own records only; All characters there use its logs and the Warband bank.
  const realm = (await call({ realm: "Argent Dawn" })).figures;
  expect(realm.earned).toMatchObject({ total: 1000, perDay: 1000 / 41 });
  const silvermoon = (await call({ realm: "Silvermoon" })).figures;
  expect(silvermoon.earned).toMatchObject({ total: 2950, perDay: 2950 / 30 });
});

test("a record at either edge of a period belongs to neither window, as in game", async () => {
  const edges = figuresFixture({
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [
      `i:1,1,1,10,Buyer,Hero,${NOW - DAY},Auction`,
      `i:1,1,1,20,Buyer,Hero,${NOW - DAY + 1},Auction`,
      `i:1,1,1,40,Buyer,Hero,${NOW - 2 * DAY},Auction`,
      `i:1,1,1,80,Buyer,Hero,${NOW - 2 * DAY + 1},Auction`,
      `i:1,1,1,160,Buyer,Hero,${NOW},Auction`,
    ]),
  });
  const day = (await edges({ period: "1D" })).figures;
  expect(day.earned).toMatchObject({ total: 20, trend: 20 - 80 });
  // All has no time filter.
  expect((await edges()).figures.earned.total).toBe(310);
});

test("rows count as the addon reads them: an unreadable stack size drops a row, legacy item ids join their item", async () => {
  const call = figuresFixture({
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [
      `i:2,1,1,300,Buyer,Hero,${NOW - DAY},Auction`,
      // The addon writes item ids as i:<id>; older forms and trailing zeros are the same item.
      `123,1,1,100,Buyer,Hero,${NOW - DAY},Auction`,
      ` item:123 ,1,1,100,Buyer,Hero,${NOW - DAY},Auction`,
      `i:123:0,1,1,100,Buyer,Hero,${NOW - DAY},Auction`,
      `i:123,1,1,50,Buyer,Hero,${NOW - DAY},Auction`,
      `i:0,1,1,1,Buyer,Hero,${NOW - DAY},Auction`,
      // Dropped: a stack size that is not a number, an id beyond any item.
      `i:2,x,1,1000,Buyer,Hero,${NOW - DAY},Auction`,
      `i:1000000,1,1,1000,Buyer,Hero,${NOW - DAY},Auction`,
    ]),
  });
  const { earned } = (await call()).figures;
  expect(earned).toMatchObject({ total: 651, topItem: "i:123" });
});

test("an item sold at a loss is no top profit item", async () => {
  const call = figuresFixture({
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:1,1,1,80,Buyer,Hero,${NOW - DAY},Auction`]),
    "r@Silvermoon@internalData@csvBuys": csv(TRADE, [`i:1,1,1,100,Seller,Hero,${NOW - 2 * DAY},Auction`]),
  });
  expect((await call()).figures.profit).toMatchObject({ total: -20, topItem: null });
});

test("a period that is not one of the Ledger's is All, even one named like an object's property", async () => {
  const call = figuresFixture();
  for (const period of ["constructor", "toString", "__proto__", "5D"]) {
    const ledger = await call({ period });
    expect([period, ledger.period, ledger.figures.earned.total]).toEqual([period, "All", 3950]);
  }
});

test("without records the Ledger has no figures", async () => {
  const { write, call } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  write(account("MAIN"), saved(empty));
  expect((await call()).result).toMatchObject({ state: "noRecords", realms: [], characters: [], realm: null, character: null, period: "All", figures: null });
});

// ---------------------------------------------------------------------------
// The gold graph: the addon's GoldTracker and Dashboard (4.15.9) as the reference.

const HOUR = 3600;
/** Gold logs on Silvermoon, Argent Dawn, the Warband bank and a Silvermoon guild; a sale on each realm. */
const goldDb = (extra: Record<string, string> = {}) => ({
  "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:1,1,1,10,Buyer,Trader,${NOW - DAY},Auction`]),
  "r@Argent Dawn@internalData@csvSales": csv(TRADE, [`i:1,1,1,5,Buyer,Hero,${NOW - DAY},Auction`]),
  "s@Hero - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(12 * HOUR)},1000`, `${minute(6 * HOUR)},3000`]),
  "s@Alt - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(3 * HOUR)},500`]),
  "s@Hero - Alliance - Argent Dawn@internalData@goldLog": csv(GOLD, [`${minute(3 * DAY)},7`]),
  "g@ @internalData@warbankGoldLog": csv(GOLD, [`${minute(2 * DAY)},10000`]),
  "f@Horde - Silvermoon@internalData@guildGoldLog": `{ ["Guild"] = ${csv(GOLD, [`${minute(18 * HOUR)},200`])} }`,
  ...extra,
});
/** The points where the graph's value changes, with the first: [seconds before NOW, copper]. */
const steps = (points: [number, number][]) =>
  points
    .filter(([, copper], i) => i === 0 || copper !== points[i - 1]![1])
    .map(([ms, copper]) => [NOW - ms / 1000, copper]);

test("the graph sums the selection's gold logs, carries each forward and counts a log as zero before its first point", async () => {
  const call = figuresFixture(goldDb());
  const realm = (await call({ realm: "Silvermoon", period: "1D" })).gold;
  // Every Silvermoon character and guild, and the Warband bank: Argent Dawn's Hero does not count.
  expect(steps(realm.points)).toEqual([
    [DAY, 10000],
    [18 * HOUR, 10200],
    [12 * HOUR, 11200],
    [6 * HOUR, 13200],
    [3 * HOUR, 13700],
  ]);
  // The day from its start to now, sampled as the addon's graph samples it.
  expect(realm.points.length).toBe(145);
  expect(realm.points.at(-1)).toEqual([NOW * 1000, 13700]);
  // All realms adds Argent Dawn's Hero, whose balance carries forward from 3 days ago.
  expect(steps((await call({ period: "1D" })).gold.points)[0]).toEqual([DAY, 10007]);
});

test("one character, the Warband bank or a guild graphs only its own log; the bank and a guild trade nothing", async () => {
  const call = figuresFixture(goldDb());
  const hero = await call({ character: "Hero - Silvermoon", period: "1D" });
  // A period starts no earlier than the selection's first point, as in game.
  expect(steps(hero.gold.points)).toEqual([[12 * HOUR, 1000], [6 * HOUR, 3000]]);
  expect(steps((await call({ character: "warbank", period: "1D" })).gold.points)).toEqual([[DAY, 10000]]);
  const guild = await call({ character: "guild:Guild - Horde - Silvermoon", period: "1D" });
  expect(guild.character).toBe("guild:Guild - Horde - Silvermoon");
  expect(steps(guild.gold.points)).toEqual([[18 * HOUR, 200]]);
  // The Warband bank and a guild show zero trading figures, whatever the realm sold.
  for (const character of ["warbank", "guild:Guild - Horde - Silvermoon"]) {
    const { figures } = await call({ character });
    expect([character, figures.earned.total, figures.spent.total, figures.dailySales, figures.topSale]).toEqual([character, 0, 0, 0, 0]);
  }
  // Under another realm a guild is no choice, so the selection falls back to All characters.
  expect((await call({ realm: "Argent Dawn", character: "guild:Guild - Horde - Silvermoon" })).character).toBeNull();
});

test("a selection without a gold log point has no gold history", async () => {
  const call = figuresFixture(goldDb({ "s@Trader - Horde - Silvermoon@internalData@goldLog": csv(GOLD, []) }));
  const trader = await call({ character: "Trader - Silvermoon" });
  expect(trader).toMatchObject({ state: "ready", character: "Trader - Silvermoon", gold: null });
  expect(trader.figures.earned.total).toBe(10);
});

test("52-week High and Low sample every 6 hours of the last 52 weeks and now; the daily change is now minus 24 hours ago", async () => {
  const call = figuresFixture(goldDb({
    "s@Hero - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [
      `${minute(400 * DAY)},9000`, // before the 52 weeks (364 days): no high
      `${minute(399 * DAY)},10`, // carried into the 52 weeks: the low
      `${minute(200 * DAY)},5000`, // the high
      `${minute(200 * DAY - HOUR)},99999`, // between two samples: never seen
      `${minute(200 * DAY - 2 * HOUR)},5000`,
      `${minute(100 * DAY)},20`,
      `${minute(30 * HOUR)},300`, // the balance 24 hours ago
      `${minute(HOUR)},1000`, // now
    ]),
  }));
  const hero = await call({ character: "Hero - Silvermoon" });
  expect(hero.gold).toMatchObject({ high: 5000, low: 10, dailyChange: 700 });
  // The summary does not follow the period.
  expect((await call({ character: "Hero - Silvermoon", period: "1D" })).gold).toMatchObject({ high: 5000, low: 10, dailyChange: 700 });
  // A log younger than a day changes from its first point, not from zero.
  const young = figuresFixture(goldDb({ "s@Alt - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(2 * HOUR)},500`, `${minute(HOUR)},800`]) }));
  expect((await young({ character: "Alt - Silvermoon" })).gold).toMatchObject({ high: 800, low: 500, dailyChange: 300 });
});

test("All graphs from the selection's first point to now, sampled as the addon's graph", async () => {
  const call = figuresFixture(goldDb());
  const { points } = (await call()).gold;
  // Argent Dawn's Hero logged first, 3 days ago.
  expect(points[0]).toEqual([(NOW - 3 * DAY) * 1000, 7]);
  expect(points.at(-1)).toEqual([NOW * 1000, 13707]);
  // 3 days over 300 steps is 864 s, a whole minute up 900 s; the addon keeps
  // every second step (1,800 s apart) more than a step from the end: 144, then now.
  expect(points.length).toBe(145);
});

test("a character's or the Warband bank's misread balances are dropped as the addon drops them; a guild's are not", async () => {
  const BIG = 6_000 * 10_000; // above the 5,000 gold a zero must sit between to be a misread
  const log = csv(GOLD, [`${minute(4 * HOUR)},${BIG}`, `${minute(3 * HOUR)},0`, `${minute(2 * HOUR)},${BIG}`]);
  const call = figuresFixture(goldDb({
    "s@Hero - Horde - Silvermoon@internalData@goldLog": log,
    "g@ @internalData@warbankGoldLog": csv(GOLD, [`${minute(4 * HOUR)},5`, `${minute(3 * HOUR)},${1_000_000_000_001}`]),
    "f@Horde - Silvermoon@internalData@guildGoldLog": `{ ["Guild"] = ${log} }`,
  }));
  expect(steps((await call({ character: "Hero - Silvermoon", period: "1D" })).gold.points)).toEqual([[4 * HOUR, BIG]]);
  // Above 100 million gold is no Warband bank balance.
  expect(steps((await call({ character: "warbank", period: "1D" })).gold.points)).toEqual([[4 * HOUR, 5]]);
  expect(steps((await call({ character: "guild:Guild - Horde - Silvermoon", period: "1D" })).gold.points)).toEqual([
    [4 * HOUR, BIG], [3 * HOUR, 0], [2 * HOUR, BIG],
  ]);
});

test("a guild none of the player's characters is in, last logged over 30 days ago, counts only until its last entry", async () => {
  const guild = (lastUpdate: number, member?: string) => ({
    "f@Horde - Silvermoon@internalData@guildGoldLog": `{ ["Guild"] = ${csv(GOLD, [`${minute(60 * DAY)},200`, `${minute(40 * DAY)},300`])} }`,
    "f@Horde - Silvermoon@internalData@guildGoldLogLastUpdate": `{ ["Guild"] = ${lastUpdate} }`,
    ...(member ? { "f@Horde - Silvermoon@internalData@characterGuilds": `{ [${JSON.stringify(member)}] = "Guild" }` } : {}),
  });
  const gold = async (db: Record<string, string>) =>
    steps((await figuresFixture(goldDb(db))({ character: "guild:Guild - Horde - Silvermoon" })).gold.points);
  // Left: from its last entry on, it counts nothing.
  expect(await gold(guild(NOW - 31 * DAY))).toEqual([[60 * DAY, 200], [40 * DAY, 0]]);
  // Still led by a character with a gold log, or updated within 30 days: it carries forward.
  expect(await gold(guild(NOW - 31 * DAY, "Hero"))).toEqual([[60 * DAY, 200], [40 * DAY, 300]]);
  expect(await gold(guild(NOW - 29 * DAY))).toEqual([[60 * DAY, 200], [40 * DAY, 300]]);
});
