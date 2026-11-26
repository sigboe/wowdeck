import { test, expect } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { encode } from "cbor2/encoder";
import { JsonlServer } from "../src/bridge/jsonl";
import { providersHandlers } from "../src/api/handlers/providers";
import { TradeSkillMasterLedgerReader } from "../src/wow/tsm/Ledger";
import { writeLedgerExport } from "../src/wow/tsm/LedgerExport";
import { SavedVariablesReader } from "../src/wow/tsm/SavedVariables";
import { listZipEntries, readZipEntryText } from "../src/wow/wtf/ZipReader";
import { writeZipFiles } from "../src/wow/wtf/ZipWriter";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import type { GameRunning } from "../src/api/contracts";
import { subset } from "./helpers/subset";
import { blp, writeCascFixture } from "./helpers/cascFixture";
import { GameTextures } from "../src/wow/textures/GameTextures";

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
  const installation = { id: "era", location: join(dir, "_classic_era_"), clientType: WowClientType.ClassicEra } as WowInstallation;
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
  let lineBytes = 0;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
    lineBytes = Buffer.byteLength(line) + 1; // stdout newline
  });
  rpc.handle(providersHandlers(subset({ tsmLedger: ledger, gameTextures: new GameTextures(), installationService: { require: () => installation } })));
  const call = async (params: object = {}, method = "tradeskillmaster.ledger") => {
    await rpc.handleLine(JSON.stringify({ id: 1, method, params: { installationId: "era", ...params } }));
    return response;
  };
  return { dir, write, call, remove: (path: string) => rmSync(join(installation.location, path)), lineBytes: () => lineBytes, running: (state: GameRunning) => { running = state; } };
}

const account = (name: string) => `WTF/Account/${name}/SavedVariables/TradeSkillMaster.lua`;
/** Nothing to choose and nothing to count. */
const noFilters = { realms: [], realm: null, characters: [], character: null, period: "All", itemCount: 0, exportable: false, figures: null, gold: null };

test("without the addon or any account's records, the Ledger asks for the addon", async () => {
  const { write, call } = fixture();
  // A WoW account the addon never saved to does not count.
  write("WTF/Account/MAIN/SavedVariables/Blizzard_Settings.lua", "Settings = {}\n");
  expect((await call()).result).toEqual({ state: "noAddon", accounts: [], account: null, recordedAt: null, gameRunning: false, retail: false, wowhead: "classic", ...noFilters });
});

test("with the addon installed but nothing saved yet, the Ledger has no account", async () => {
  const { write, call } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  expect((await call()).result).toEqual({ state: "noAccount", accounts: [], account: null, recordedAt: null, gameRunning: false, retail: false, wowhead: "classic", ...noFilters });
});

test("one account is picked by itself, and a file of headers and empty gold logs has no records", async () => {
  const { write, call, running } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  write(account("MAIN"), saved(empty), 1_800_000_000);
  expect((await call()).result).toEqual({
    state: "noRecords", accounts: ["MAIN"], account: "MAIN", recordedAt: 1_800_000_000_000, gameRunning: false, retail: false, wowhead: "classic", ...noFilters,
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
    state: "noAddon", accounts: ["ALT", "MAIN"], account: "ALT", recordedAt: 1_800_000_500_000, gameRunning: false, retail: false, wowhead: "classic", ...noFilters,
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

test("the Ledger reads names from the saved legacy item cache and prefers an exact match", async () => {
  const { write, call } = fixture();
  const legacy = readFileSync(new URL("./fixtures/tsm/ledger-item-names-legacy.lua", import.meta.url), "utf8");
  const db = {
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:2589:123,1,2,15,Bob,Hero,${NOW},Auction`]),
    "r@Silvermoon@internalData@csvBuys": csv(TRADE, [`i:4306,1,1,5,Bob,Hero,${NOW},Auction`]),
  };
  write(account("MAIN"), saved(db) + legacy, NOW);
  const { figures } = (await call()).result;
  expect(figures.earned).toMatchObject({ total: 30, topItem: "i:2589:123", topItemName: "Linen Cloth" });
  expect(figures.spent).toMatchObject({ total: 5, topItem: "i:4306", topItemName: "Silk Cloth" });
  expect(figures.profit.topItemName).toBe("Linen Cloth");
  expect((await call({}, "tradeskillmaster.ledgerItems")).result.rows).toEqual([
    // The legacy cache stores no quality and no icon.
    { itemString: "i:2589:123", name: "Linen Cloth", sold: 2, earned: 30, bought: 0, spent: 0, net: 30, quality: null, texture: null },
    { itemString: "i:4306", name: "Silk Cloth", sold: 0, earned: 0, bought: 1, spent: 5, net: -5, quality: null, texture: null },
  ]);

  // Rewriting the same file replaces its names. Flat legacy lists also work.
  const flat = String.raw`TSMItemInfoDB = { names = "Linen Cloth\002Linen Variant", itemStrings = "i:2589\002i:2589:123" }`;
  write(account("MAIN"), saved(db) + flat, NOW + 1);
  const refreshed = (await call()).result.figures;
  expect(refreshed.earned.topItemName).toBe("Linen Variant");
  expect(refreshed.spent.topItem).toBe("i:4306");
  expect(refreshed.spent.topItemName).toBeUndefined();
});

test("the Ledger reads top item names from the Deck's modern item cache", async () => {
  const { write, call } = fixture();
  // The original data literal saved by TSM v4.15.9 on Forever. Only item metadata.
  const capture = new URL("./fixtures/tsm/ledger-item-names-modern.b64", import.meta.url);
  const data = readFileSync(capture, "utf8");
  const db = saved({
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:2589:123,1,2,15,Bob,Hero,${NOW},Auction`]),
    "r@Silvermoon@internalData@csvBuys": csv(TRADE, [`i:2730,1,1,5,Bob,Hero,${NOW},Auction`]),
  });
  write(account("MAIN"), db + `TSMItemInfoDB = { data = "${data}" }`, NOW);
  const { figures } = (await call()).result;
  expect(figures.earned).toMatchObject({ total: 30, topItem: "i:2589:123", topItemName: "Linen Cloth" });
  expect(figures.spent).toMatchObject({ total: 5, topItem: "i:2730", topItemName: "Green Hills of Stranglethorn - Page 6" });
});

test("All items reads each item's quality from the modern item cache, a battle pet's from its item string", async () => {
  const { write, call } = fixture();
  const data = readFileSync(new URL("./fixtures/tsm/ledger-item-names-modern.b64", import.meta.url), "utf8");
  // Prices set the order: one item per quality the capture holds, a variant
  // of a cached item, a battle pet the cache lacks and an uncached item.
  const sales = ["i:2589", "i:3041:123", "i:10623", "i:122284", "p:39:1:3", "i:999999"]
    .map((item, index) => `${item},1,1,${100 - index},Bob,Hero,${NOW},Auction`);
  write(account("MAIN"), saved({ ...empty, "r@Silvermoon@internalData@csvSales": csv(TRADE, sales) }) + `TSMItemInfoDB = { data = "${data}" }`, NOW);
  const rows = (await call({}, "tradeskillmaster.ledgerItems")).result.rows;
  expect(rows.map(({ itemString, name, quality }: { itemString: string; name: string; quality: number | null }) => [itemString, name, quality])).toEqual([
    ["i:2589", "Linen Cloth", 1],
    ["i:3041:123", "\"Mage-Eye\" Blunderbuss", 2],
    ["i:10623", "Winter's Bite", 3],
    ["i:122284", "WoW Token", 8],
    ["p:39:1:3", "p:39:1:3", 3],
    ["i:999999", "i:999999", null],
  ]);
});

test("Ledger items carry the cached icon, and their icons read from the game's files", async () => {
  const { dir, write, call } = fixture();
  // One 4×4 red DXT1 icon; 200 is cached but not in the game's files.
  const red = blp({ encoding: 2, width: 4, height: 4, mips: [Uint8Array.of(0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0)] });
  writeCascFixture(dir, [{ id: 133919, bytes: red, mode: "Z" }]);
  const fields = (texture: number) => [0, 0, 0, 0, 0, texture, 0, 0, 1, 0, 0, 0, -1];
  const cache = deflateRawSync(encode(["i:6292", "10 Pound Mud Snapper", ...fields(133919), "i:2589", "Linen Cloth", ...fields(200)])).toString("base64");
  const sales = ["i:6292", "i:2589", "i:999"].map((item, index) => `${item},1,1,${10 - index},Bob,Hero,${NOW},Auction`);
  write(account("MAIN"), saved({ ...empty, "r@Silvermoon@internalData@csvSales": csv(TRADE, sales) }) + `TSMItemInfoDB = { data = "${cache}" }`, NOW);

  const rows = (await call({}, "tradeskillmaster.ledgerItems")).result.rows;
  expect(rows.map((row: { itemString: string; texture: number | null }) => [row.itemString, row.texture])).toEqual([
    ["i:6292", 133919],
    ["i:2589", 200],
    ["i:999", null],
  ]);
  const { icons } = (await call({ account: "MAIN", textures: [133919, 200], size: 36 }, "tradeskillmaster.itemIcons")).result;
  expect(Object.keys(icons)).toEqual(["133919"]);
  expect(icons["133919"]).toStartWith("data:image/png;base64,iVBORw0KGgo");

  for (const params of [{ textures: [1.5], size: 36 }, { textures: Array(65).fill(1), size: 36 }, { textures: [1], size: 0 }, { textures: "1", size: 36 }]) {
    expect((await call(params, "tradeskillmaster.itemIcons")).error).toBeDefined();
  }
});

test("a battle pet's item string wins over its cached quality, and an entry without a name has no quality", async () => {
  const { write, call } = fixture();
  const sales = ["p:40:25:2", "i:2589"].map((item, index) => `${item},1,1,${10 - index},Bob,Hero,${NOW},Auction`);
  const fields = (quality: number) => [0, 0, 0, 0, 0, 0, 0, 0, quality, 0, 0, 0, -1];
  const cache = deflateRawSync(encode(["p:40:25:2", "Pet", ...fields(4), "i:2589", "", ...fields(3)])).toString("base64");
  write(account("MAIN"), saved({ ...empty, "r@Silvermoon@internalData@csvSales": csv(TRADE, sales) }) + `TSMItemInfoDB = { data = "${cache}" }`, NOW);
  expect((await call({}, "tradeskillmaster.ledgerItems")).result.rows).toMatchObject([
    { itemString: "p:40:25:2", name: "Pet", quality: 2 },
    { itemString: "i:2589", name: "i:2589", quality: null },
  ]);
});

test("the Ledger joins nested legacy lists independently of their chunk boundaries", async () => {
  const { write, call } = fixture();
  const db = saved({
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:2589,1,1,15,Bob,Hero,${NOW},Auction`]),
  });
  const nested = String.raw`TSMItemInfoDB = {
    data = { names = { "Linen ", "Cloth\002Wool Cloth" }, itemStrings = { "i:2589\002i:", "2592" } },
  }`;
  write(account("MAIN"), db + nested, NOW);
  expect((await call()).result.figures.earned.topItemName).toBe("Linen Cloth");
});

test("unnamed modern rows leave named items and base fallback available", async () => {
  const { write, call } = fixture();
  const db = saved({
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:2589:123,1,1,15,Bob,Hero,${NOW},Auction`]),
  });
  // Synthetic regression for unnamed rows. The captured-cache test is separate.
  const fields = Array<number>(13).fill(0);
  const rows = encode(["i:2589", "Linen Cloth", ...fields, "i:2589:123", "", ...fields]);
  const cache = deflateRawSync(rows).toString("base64");
  write(account("MAIN"), db + `TSMItemInfoDB = { data = "${cache}" }`, NOW);
  expect((await call()).result.figures.earned.topItemName).toBe("Linen Cloth");
});

test("missing and corrupt item caches leave the Ledger's item strings and totals available", async () => {
  const { write, call } = fixture();
  const db = saved({
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [`i:2589:123,1,2,15,Bob,Hero,${NOW},Auction`]),
  });
  for (const [index, itemInfo] of ["", 'TSMItemInfoDB = { data = "AAAA" }'].entries()) {
    write(account("MAIN"), db + itemInfo, NOW + index);
    const { state, figures } = (await call()).result;
    expect(state).toBe("ready");
    expect(figures.earned).toEqual({ total: 30, perDay: 30, topItem: "i:2589:123", trend: null });
  }
});

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

function figuresFixture(main: Record<string, string> = mainDb(), clientType = WowClientType.ClassicEra) {
  const dir = mkdtempSync(join(tmpdir(), "tsm-ledger-figures-"));
  const installation = { id: "era", location: join(dir, "_classic_era_"), clientType } as WowInstallation;
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
  return async (params: object = {}, method = "tradeskillmaster.ledger") => {
    await rpc.handleLine(JSON.stringify({ id: 1, method, params: { installationId: "era", ...params } }));
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
}

test("the item RPC shares the summary's filters and counts only bought and sold items by volume", async () => {
  const call = figuresFixture({
    ...mainDb(),
    "r@Silvermoon@internalData@csvBuys": csv(TRADE, [
      ...mainBuys,
      `i:6,1,1,800,X,Trader,${NOW - DAY},Auction`,
    ]),
    "r@Silvermoon@internalData@csvCancelled": csv(AUCTIONS, [`i:100,1,1,Trader,${NOW - DAY}`]),
    "r@Silvermoon@internalData@csvExpired": csv(AUCTIONS, [`i:101,1,1,Trader,${NOW - DAY}`]),
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [
      ...mainSales,
      `Money Transfer,1,1,99999,X,Hero,${NOW - 3600},Trade`,
    ]),
  });
  const items = async (params: object = {}) => (await call(params, "tradeskillmaster.ledgerItems")).rows;
  // Sold and Bought count items, not records: a stack of 20 is 20.
  const row = (itemString: string, earned: number, spent: number, sold: number, bought: number) => ({
    itemString, name: itemString, sold, earned, bought, spent, net: earned - spent, quality: null, texture: null,
  });
  expect(await items()).toEqual([
    row("i:1", 2550, 2000, 22, 10), row("i:9", 1000, 0, 1, 0), row("i:6", 0, 800, 0, 1), row("i:2", 300, 130, 10, 4),
    row("i:3", 100, 0, 4, 0), row("i:5", 0, 70, 0, 1),
  ]);
  expect((await call()).itemCount).toBe(6);
  const filters = { realm: "Silvermoon", character: "Hero - Silvermoon", period: "1W" };
  expect(await items(filters)).toEqual([row("i:1", 2000, 2000, 20, 10), row("i:2", 300, 120, 10, 3)]);
  expect((await call(filters)).itemCount).toBe(2);
  expect(await items({ account: "ALT" })).toEqual([row("i:7", 5, 0, 1, 0)]);
  for (const character of ["warbank", "guild:Guild - Horde - Silvermoon", "Banker - Silvermoon"]) {
    expect(await items({ character })).toEqual([]);
    expect((await call({ character })).itemCount).toBe(0);
  }
});

test("All items sorts the whole list by any column in either direction, ties by volume then item string", async () => {
  const { write, call } = fixture();
  // item: sold, earned, bought, spent, net, volume
  // A i:10 Bolt: 5, 50, 0, 0, 50, 50; B i:20 apple: 1, 50, 2, 20, 30, 70
  // C i:30 Cloth: 0, 0, 3, 90, -90, 90; D i:5 (no name): 2, 50, 0, 0, 50, 50
  // E i:40 (no name): 0, 0, 1, 50, -50, 50; F i:20:1 apple: 1, 50, 0, 0, 50, 50
  const sale = (item: string, quantity: number, price: number) => `${item},1,${quantity},${price},Bob,Hero,${NOW},Auction`;
  const letters = new Map([["i:10", "A"], ["i:20", "B"], ["i:30", "C"], ["i:5", "D"], ["i:40", "E"], ["i:20:1", "F"]]);
  const names = String.raw`TSMItemInfoDB = { names = "Bolt\002apple\002Cloth\002apple", itemStrings = "i:10\002i:20\002i:30\002i:20:1" }`;
  write(account("MAIN"), saved({
    ...empty,
    "r@Silvermoon@internalData@csvSales": csv(TRADE, [sale("i:10", 5, 10), sale("i:20", 1, 50), sale("i:5", 2, 25), sale("i:20:1", 1, 50)]),
    "r@Silvermoon@internalData@csvBuys": csv(TRADE, [sale("i:20", 2, 10), sale("i:30", 3, 30), sale("i:40", 1, 50)]),
  }) + names, NOW);
  const order = async (params: object) =>
    (await call(params, "tradeskillmaster.ledgerItems")).result.rows.map((row: { itemString: string }) => letters.get(row.itemString)).join("");
  expect(await order({})).toBe("CBAFED");
  const expected: Record<string, [string, string]> = {
    volume: ["CBAFED", "AFEDBC"],
    sold: ["ADBFCE", "CEBFDA"],
    earned: ["BAFDCE", "CEBAFD"],
    bought: ["CBEAFD", "AFDEBC"],
    spent: ["CEBAFD", "AFDBEC"],
    net: ["AFDBEC", "CEBAFD"],
    // Z to A, then A to Z; unnamed items last both ways, by item ID.
    name: ["CABFDE", "BFACDE"],
  };
  for (const [sort, [descending, ascending]] of Object.entries(expected)) {
    expect([sort, await order({ sort, descending: true })]).toEqual([sort, descending]);
    expect([sort, await order({ sort, descending: false })]).toEqual([sort, ascending]);
  }
  // A column's first state: A to Z for names, highest first for the rest.
  expect(await order({ sort: "name" })).toBe("BFACDE");
  expect(await order({ sort: "net" })).toBe("AFDBEC");
});

test("a four-realm Ledger fits the Python bridge's JSONL limit", async () => {
  const { write, call, lineBytes } = fixture();
  const tradesPerRealm = 55_000;
  const db = Object.fromEntries(Array.from({ length: 4 }, (_, realm) => [
    `r@Realm ${realm}@internalData@csvSales`,
    csv(TRADE, Array.from({ length: tradesPerRealm }, (_, row) =>
      `i:2589:123:456:${realm + 1}:${row + 1},1,1,15,Bob,Hero,${NOW},Auction`)),
  ]));
  write(account("MAIN"), saved(db), NOW);
  const response = await call({ account: "MAIN" }, "tradeskillmaster.ledgerItems");
  expect(response.error).toBeUndefined();
  expect(lineBytes()).toBeLessThan(16 * 1024 * 1024);
  expect(response.result.rows).toHaveLength(40);
  expect(response.result.nextOffset).toBe(40);
  const last = await call({ account: "MAIN", offset: 4 * tradesPerRealm - 1 }, "tradeskillmaster.ledgerItems");
  expect(last.result.rows).toHaveLength(1);
  expect(last.result.nextOffset).toBeNull();
});

test("item pages split by serialized UTF-8 bytes and still reach every row in order", async () => {
  const { write, call, lineBytes } = fixture();
  const ids = Array.from({ length: 70 }, (_, index) => `i:${index + 1}`);
  const longName = '雪"'.repeat(1000); // JSON quoting and multibyte UTF-8
  const oversizedName = "雪".repeat(30_000);
  const names = ids.map((_, index) => index === 0 ? oversizedName : longName).map((name) => JSON.stringify(name).slice(1, -1));
  const separator = String.raw`\002`;
  const cache = `TSMItemInfoDB = { names = "${names.join(separator)}", itemStrings = "${ids.join(separator)}" }`;
  write(account("MAIN"), saved({
    "r@Silvermoon@internalData@csvSales": csv(TRADE, ids.map((id, index) =>
      `${id},1,1,${ids.length - index},Bob,Hero,${NOW},Auction`)),
  }) + cache, NOW);
  const pages = async (sort: object) => {
    let offset: number | null = 0;
    const seen: string[] = [];
    while (offset !== null) {
      const { result } = await call({ account: "MAIN", offset, ...sort }, "tradeskillmaster.ledgerItems");
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThan(40);
      expect(lineBytes()).toBeLessThan(65 * 1024); // 64 KiB rows plus the reply envelope
      if (offset === 0 && !("sort" in sort)) {
        expect(result.rows[0]).toMatchObject({ itemString: ids[0], earned: ids.length, name: "雪".repeat(1024) + "…" });
        expect(result.rows[1].name).toBe(longName);
      }
      seen.push(...result.rows.map((row: { itemString: string }) => row.itemString));
      expect(result.nextOffset).toBe(seen.length < ids.length ? seen.length : null);
      offset = result.nextOffset;
    }
    return seen;
  };
  expect(await pages({})).toEqual(ids);
  // The sort covers every page, not each page on its own.
  expect(await pages({ sort: "earned", descending: false })).toEqual([...ids].reverse());
});

test("a Ledger item refresh keeps the filters that were open", async () => {
  const { write, call, remove } = fixture();
  const items = (params: object) => call({ exact: true, account: "MAIN", ...params }, "tradeskillmaster.ledgerItems");
  const trade = (id: number, player: string) => csv(TRADE, [`i:${id},1,1,15,Bob,${player},${NOW},Auction`]);
  const argent = { "r@Argent Dawn@internalData@csvSales": trade(2, "Hero") };
  write(account("MAIN"), saved({ ...argent, "r@Silvermoon@internalData@csvSales": trade(1, "Hero") }), NOW);
  write(account("ALT"), saved(argent), NOW);
  expect((await items({ realm: "Silvermoon" })).result.rows).toMatchObject([{ itemString: "i:1" }]);
  write(account("MAIN"), saved(argent), NOW + 1);
  expect((await items({ realm: "Silvermoon" })).result.rows).toEqual([]);
  // The summary can still fall back to All when the same filter disappears.
  expect((await call({ account: "MAIN", realm: "Silvermoon" })).result.realm).toBeNull();
  write(account("MAIN"), saved({ "r@Silvermoon@internalData@csvSales": trade(3, "Alt") }), NOW + 2);
  expect((await items({ character: "Hero - Silvermoon" })).result.rows).toEqual([]);
  remove(account("MAIN"));
  expect((await items({})).result.rows).toEqual([]);
});

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
  expect((await call()).result).toMatchObject({ state: "noRecords", realms: [], characters: [], realm: null, character: null, period: "All", itemCount: 0, figures: null });
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

test("All graphs from the selection's first point to now, sampled as the addon's graph samples a plot of the given width", async () => {
  const call = figuresFixture(goldDb());
  const { points } = (await call()).gold;
  // Argent Dawn's Hero logged first, 3 days ago.
  expect(points[0]).toEqual([(NOW - 3 * DAY) * 1000, 7]);
  expect(points.at(-1)).toEqual([NOW * 1000, 13707]);
  // Without a width, at most 300 steps: 3 days over 300 is 864 s, a whole
  // minute up 900 s; the addon keeps every second step (1,800 s apart) more
  // than a step from the end: 144, then now.
  expect(points.length).toBe(145);
  // A plot 270 px wide takes a step per 3 px, 90 steps: 2,880 s each, every
  // second one kept up to two steps from the end (45), then now.
  const narrow = (await call({ plotWidth: 270 })).gold.points;
  expect(narrow.length).toBe(46);
  expect(narrow[1]).toEqual([(NOW - 3 * DAY + 5760) * 1000, 7]);
  expect(narrow.at(-1)).toEqual([NOW * 1000, 13707]);
  // A plot wider than 900 px still plots at most 300 steps.
  expect((await call({ plotWidth: 1800 })).gold.points.length).toBe(145);
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

test("a gold-log row whose minute or copper is no whole number in range is skipped, so the graph still ends", async () => {
  const good = [`${minute(2 * HOUR)},500`, `${minute(HOUR)},800`];
  const absurd = [
    "-1e308,100", // a minute before 1970, as far as it goes
    "1e308,100", // a minute far past any clock
    `${minute(HOUR) + 0.5},100`, // half a minute
    "9007199254740993,100", // beyond a whole number JavaScript holds exactly
    `${minute(3 * HOUR)},1e300`, // copper beyond any balance
    `${minute(3 * HOUR)},-5`, // copper below zero
    `${minute(3 * HOUR)},1.5`, // half a copper
  ];
  const call = figuresFixture(goldDb({ "s@Alt - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [absurd[0]!, ...good, ...absurd.slice(1)]) }));
  for (const period of ["All", "1D"]) {
    const { gold } = await call({ character: "Alt - Silvermoon", period });
    expect([period, steps(gold.points)]).toEqual([period, [[2 * HOUR, 500], [HOUR, 800]]]);
    expect(gold).toMatchObject({ high: 800, low: 500, dailyChange: 300 });
  }
  // Under All characters too.
  expect((await call()).gold.points.at(-1)).toEqual([NOW * 1000, 13_707 - 500 + 800]);
});

test("Realm lists every realm with records, gold-log points counting as records", async () => {
  const call = figuresFixture(goldDb({
    "s@Solo - Alliance - Stormrage@internalData@goldLog": csv(GOLD, [`${minute(HOUR)},42`]),
    "f@Horde - Kazzak@internalData@guildGoldLog": `{ ["Bank"] = ${csv(GOLD, [`${minute(HOUR)},7`])} }`,
    // A log with no point is no record.
    "s@Idle - Horde - Draenor@internalData@goldLog": csv(GOLD, []),
    "f@Horde - Ragnaros@internalData@guildGoldLog": `{ ["Empty"] = ${csv(GOLD, [])} }`,
  }));
  expect((await call()).realms).toEqual(["Argent Dawn", "Kazzak", "Silvermoon", "Stormrage"]);
  const stormrage = await call({ realm: "Stormrage" });
  expect(stormrage).toMatchObject({ realm: "Stormrage", characters: [{ id: "Solo - Stormrage", label: "Solo", kind: "character" }, { id: "warbank" }] });
  // The realm's own logs and the Warband bank; its figures are zero.
  expect(steps(stormrage.gold.points).at(-1)).toEqual([HOUR, 10_042]);
  expect(stormrage.figures.earned.total).toBe(0);
  const kazzak = await call({ realm: "Kazzak" });
  expect(kazzak.characters.map((c: { id: string }) => c.id)).toEqual(["warbank", "guild:Bank - Horde - Kazzak"]);
  expect(steps(kazzak.gold.points).at(-1)).toEqual([HOUR, 10_007]);
});

test("a guild stays current only through a character of its own faction and realm", async () => {
  const stale = {
    "f@Horde - Silvermoon@internalData@guildGoldLog": `{ ["Guild"] = ${csv(GOLD, [`${minute(60 * DAY)},200`, `${minute(40 * DAY)},300`])} }`,
    "f@Horde - Silvermoon@internalData@guildGoldLogLastUpdate": `{ ["Guild"] = ${NOW - 31 * DAY} }`,
  };
  const gold = async (db: Record<string, string>) =>
    steps((await figuresFixture(goldDb({ ...stale, ...db }))({ character: "guild:Guild - Horde - Silvermoon" })).gold.points);
  // A same-named guild elsewhere keeps nothing current: on another realm, or on the other faction.
  expect(await gold({
    "s@Other - Horde - Kazzak@internalData@goldLog": csv(GOLD, [`${minute(HOUR)},1`]),
    "f@Horde - Kazzak@internalData@characterGuilds": '{ ["Other"] = "Guild" }',
    "s@Hero - Alliance - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(HOUR)},1`]),
    "f@Alliance - Silvermoon@internalData@characterGuilds": '{ ["Hero"] = "Guild" }',
  })).toEqual([[60 * DAY, 200], [40 * DAY, 0]]);
  // A character of its own faction and realm keeps it current.
  expect(await gold({ "f@Horde - Silvermoon@internalData@characterGuilds": '{ ["Alt"] = "Guild" }' })).toEqual([[60 * DAY, 200], [40 * DAY, 300]]);
});

test("the Warband bank is a choice whenever the addon saved its log, even with no point", async () => {
  // The addon saves the log's header on a game with a Warband bank (Retail, Forever).
  const call = figuresFixture(goldDb({ "g@ @internalData@warbankGoldLog": csv(GOLD, []) }));
  expect((await call()).characters.map((c: { id: string }) => c.id)).toContain("warbank");
  const bank = await call({ character: "warbank" });
  expect(bank).toMatchObject({ character: "warbank", gold: null });
  expect([bank.figures.earned.total, bank.figures.spent.total, bank.figures.dailySales]).toEqual([0, 0, 0]);
  // Classic Era, which has none, leaves the key an empty string: no Warband bank.
  const era = figuresFixture(goldDb({ "g@ @internalData@warbankGoldLog": '""' }));
  expect((await era()).characters.map((c: { id: string }) => c.id)).not.toContain("warbank");
});

test("a Retail installation's Ledger says so: the addon records gold there in steps of 1,000 gold", async () => {
  for (const [type, retail] of [
    [WowClientType.Retail, true], [WowClientType.RetailPtr, true], [WowClientType.RetailXPtr, true], [WowClientType.Beta, true],
    [WowClientType.ClassicEra, false], [WowClientType.Classic, false], [WowClientType.Anniversary, false], [WowClientType.Forever, false],
  ] as const) {
    expect([WowClientType[type], (await figuresFixture(goldDb(), type)()).retail]).toEqual([WowClientType[type], retail]);
  }
});

// ---------------------------------------------------------------------------
// Export: the desktop app's ZIP of CSVs, read back with the backup ZIP reader.

const BOM = "\ufeff";
const EXPORT_NOW = Date.UTC(2026, 10, 24, 23, 30); // late evening: the file names carry the UTC day
const modernNames = () => `TSMItemInfoDB = { data = "${readFileSync(new URL("./fixtures/tsm/ledger-item-names-modern.b64", import.meta.url), "utf8")}" }`;
/** Two realms with records, one only with headers, and one whose name is no safe file name. */
const exportDb = {
  "r@Silvermoon@internalData@csvSales": csv(TRADE, [
    `i:2589:123,1,2,15,Bob,Hero,${NOW},Auction`,
    `i:2730,1,1,5,Bob,Hero,${NOW},Auction`,
    `i:999999,1,1,5,Bob,Hero,${NOW},Vendor`,
  ]),
  "r@Silvermoon@internalData@csvBuys": csv(TRADE, [`i:2589,1,1,5,Bob,Alt,${NOW},Auction`]),
  "r@Silvermoon@internalData@csvIncome": csv(MONEY, [`Money Transfer,1000,Alt,Hero,${NOW}`]),
  "r@Silvermoon@internalData@csvExpense": csv(MONEY, [`Postage,30,Alt,Alt,${NOW}`, `Repair Bill,500,Merchant,Hero,${NOW}`]),
  "r@Silvermoon@internalData@csvExpired": csv(AUCTIONS, [`i:2589,1,20,Hero,${NOW}`]),
  "r@Silvermoon@internalData@csvCancelled": csv(AUCTIONS, []),
  // Older files say buyer; the stored header is kept as it is.
  "r@Argent Dawn@internalData@csvSales": csv(TRADE.replace("otherPlayer", "buyer"), [`i:2589,1,1,15,X,Hero,${NOW},Auction`]),
  "r@Empty@internalData@csvSales": csv(TRADE, []),
  "r@Bad:Realm/Name.@internalData@csvExpired": csv(AUCTIONS, [`i:2589,1,1,Hero,${NOW}`]),
  "s@Hero - Horde - Silvermoon@internalData@goldLog": csv(GOLD, [`${minute(DAY)},500`]),
  // A realm the Realm filter lists for its gold log alone: nothing to export.
  "s@Miser - Horde - Hoard@internalData@goldLog": csv(GOLD, [`${minute(DAY)},900`]),
};

function exportFixture(options: { remembered?: string | null; writeZip?: typeof writeZipFiles } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tsm-ledger-export-"));
  const installation = { id: "era", location: join(dir, "_classic_era_"), clientType: WowClientType.ClassicEra } as WowInstallation;
  const file = join(installation.location, account("MAIN"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, saved(exportDb) + modernNames());
  const home = join(dir, "home");
  const folder = join(dir, "exports");
  mkdirSync(folder, { recursive: true });
  mkdirSync(home);
  const ledger = new TradeSkillMasterLedgerReader({
    gameRunning: async () => "not_running",
    reader: new SavedVariablesReader(),
    now: () => EXPORT_NOW,
    writeZip: options.writeZip,
  });
  const settings = { tsmLedgerExportFolder: options.remembered ?? null };
  const store = { settings, updateSettings: (patch: Partial<typeof settings>) => Object.assign(settings, patch) };
  let response: any;
  const rpc = new JsonlServer((line) => { response = JSON.parse(line); });
  rpc.handle(providersHandlers(subset({
    tsmLedger: ledger, installationService: { require: () => installation }, homeDir: home, store: store as never,
  })));
  const call = async (method: string, params: object = {}) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method, params }));
    return response;
  };
  const exportTo = (params: object = {}) =>
    call("tradeskillmaster.ledgerExport", { installationId: "era", account: "MAIN", folder, ...params });
  return { file, folder, home, settings, call, exportTo };
}

/** Every entry of a ZIP, by name, as text. */
async function readZip(path: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const entry of await listZipEntries(path)) entries[entry.name] = await readZipEntryText(path, entry);
  return entries;
}

test("Export writes one realm's records as the desktop app's ZIP: six BOM-prefixed CSVs with item names", async () => {
  const { file, folder, settings, exportTo } = exportFixture();
  const before = readFileSync(file, "utf8");
  // Character and Period are no export parameters: the whole realm is written.
  const response = await exportTo({ realm: "Silvermoon" });
  expect(response.error).toBeUndefined();
  const path = join(folder, "TSM_Silvermoon_2026-11-24.zip");
  expect(response.result).toEqual({ path });
  const zip = await readZip(path);
  expect(Object.keys(zip)).toEqual(
    ["Sales", "Buys", "Income", "Expense", "Expired", "Cancelled"].map((dataset) => `TSM_Silvermoon_${dataset}_2026-11-24.csv`),
  );
  for (const text of Object.values(zip)) expect(text.startsWith(BOM)).toBe(true);
  const rows = (dataset: string) => zip[`TSM_Silvermoon_${dataset}_2026-11-24.csv`]!.slice(1).split("\n");
  // itemName after itemString, from the recorded item cache; an item the cache
  // lacks keeps its item string. Every stored field is unchanged.
  expect(rows("Sales")).toEqual([
    "itemString,itemName,stackSize,quantity,price,otherPlayer,player,time,source",
    `i:2589:123,Linen Cloth,1,2,15,Bob,Hero,${NOW},Auction`,
    `i:2730,Green Hills of Stranglethorn - Page 6,1,1,5,Bob,Hero,${NOW},Auction`,
    `i:999999,i:999999,1,1,5,Bob,Hero,${NOW},Vendor`,
  ]);
  expect(rows("Buys")).toHaveLength(2);
  // Income and expense have no item: stored as they are.
  expect(rows("Income")).toEqual([MONEY, `Money Transfer,1000,Alt,Hero,${NOW}`]);
  expect(rows("Expense")).toHaveLength(3);
  expect(rows("Expired")).toEqual(["itemString,itemName,stackSize,quantity,player,time", `i:2589,Linen Cloth,1,20,Hero,${NOW}`]);
  expect(rows("Cancelled")).toEqual(["itemString,itemName,stackSize,quantity,player,time"]);
  // The folder is remembered; the records and the folder hold nothing else.
  expect(settings.tsmLedgerExportFolder).toBe(folder);
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(readdirSync(folder)).toEqual(["TSM_Silvermoon_2026-11-24.zip"]);
});

test("Export of all realms names the realm count and makes realm names safe in file names", async () => {
  const { folder, exportTo } = exportFixture();
  const response = await exportTo();
  // Empty, whose CSVs hold headers only, is no realm with records.
  const path = join(folder, "TSM_3_Realms_2026-11-24.zip");
  expect(response.result).toEqual({ path });
  const zip = await readZip(path);
  const names = Object.keys(zip);
  expect(names).toHaveLength(18);
  expect(names.filter((name) => name.endsWith("_Sales_2026-11-24.csv"))).toEqual([
    "TSM_Argent Dawn_Sales_2026-11-24.csv", "TSM_Bad_Realm_Name_Sales_2026-11-24.csv", "TSM_Silvermoon_Sales_2026-11-24.csv",
  ]);
  expect(zip["TSM_Argent Dawn_Sales_2026-11-24.csv"]).toBe(
    `${BOM}itemString,itemName,stackSize,quantity,price,buyer,player,time,source\ni:2589,Linen Cloth,1,1,15,X,Hero,${NOW},Auction`,
  );
  // A dataset the realm never saved is an empty file, as in the desktop app.
  expect(zip["TSM_Argent Dawn_Expired_2026-11-24.csv"]).toBe(BOM);
  expect(zip["TSM_Bad_Realm_Name_Expired_2026-11-24.csv"]!.split("\n")).toHaveLength(2);
  // A second export the same day keeps the first.
  expect((await exportTo()).result).toEqual({ path: join(folder, "TSM_3_Realms_2026-11-24 (1).zip") });
  expect((await exportTo({ realm: "Bad:Realm/Name." })).result).toEqual({ path: join(folder, "TSM_Bad_Realm_Name_2026-11-24.zip") });
});

test("Export removes commas from item names", async () => {
  const { file, folder, exportTo } = exportFixture();
  writeFileSync(file, saved(exportDb) + String.raw`TSMItemInfoDB = { names = "Tome of Fire, Volume 2", itemStrings = "i:2589" }`);
  await exportTo({ realm: "Silvermoon" });
  const zip = await readZip(join(folder, "TSM_Silvermoon_2026-11-24.zip"));
  expect(zip["TSM_Silvermoon_Expired_2026-11-24.csv"]).toBe(`${BOM}itemString,itemName,stackSize,quantity,player,time\ni:2589,Tome of Fire Volume 2,1,20,Hero,${NOW}`);
});

test("a failed export leaves no partial ZIP, says why, and remembers no folder", async () => {
  // The real writer, failing after the first CSV is in the ZIP.
  const { folder, settings, exportTo } = exportFixture({
    writeZip: (path, files, options) => writeZipFiles(path, (function* () {
      let count = 0;
      for (const file of files) {
        if (count++ === 1) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        yield file;
      }
    })(), options),
  });
  const response = await exportTo({ realm: "Silvermoon" });
  expect(response.error).toMatchObject({ message: "Not enough free space" });
  expect(readdirSync(folder)).toEqual([]);
  expect(settings.tsmLedgerExportFolder).toBeNull();

  const ok = exportFixture();
  // A folder that is gone, an account without the addon's file, nothing to export.
  expect((await ok.exportTo({ folder: join(ok.folder, "gone") })).error).toMatchObject({ code: "invalid_request", message: "That folder isn't available. Choose another" });
  expect((await ok.exportTo({ account: "GONE" })).error).toMatchObject({ code: "not_found" });
  writeFileSync(ok.file, saved(empty));
  expect((await ok.exportTo()).error).toMatchObject({ code: "invalid_request" });
  expect(readdirSync(ok.folder)).toEqual([]);
});

test("Export refuses a realm without records, and the Ledger says whether the shown realm has any", async () => {
  const { file, folder, call, exportTo } = exportFixture();
  const ledger = async (params: object = {}) =>
    (await call("tradeskillmaster.ledger", { installationId: "era", account: "MAIN", ...params })).result;
  expect(await ledger()).toMatchObject({ state: "ready", realm: null, exportable: true });
  expect(await ledger({ realm: "Silvermoon" })).toMatchObject({ realm: "Silvermoon", exportable: true });
  // Hoard is a Realm choice for its gold log, with no record to export.
  expect(await ledger({ realm: "Hoard" })).toMatchObject({ realm: "Hoard", exportable: false });
  for (const realm of ["Hoard", "Empty", "Nowhere"]) {
    expect([realm, (await exportTo({ realm })).error]).toMatchObject([
      realm, { code: "invalid_request", message: "No sales, purchases or other records to export yet" },
    ]);
  }
  expect(readdirSync(folder)).toEqual([]);

  // Gold logs alone make a ready Ledger with nothing to export, on any realm.
  writeFileSync(file, saved({ "s@Miser - Horde - Hoard@internalData@goldLog": csv(GOLD, [`${minute(DAY)},900`]) }));
  expect(await ledger()).toMatchObject({ state: "ready", realms: ["Hoard"], exportable: false });
  expect((await exportTo()).error).toMatchObject({ code: "invalid_request" });
  expect(readdirSync(folder)).toEqual([]);
});

test("Export keeps realms apart whose safe names are the same, ignoring case as Windows does", async () => {
  const { file, exportTo } = exportFixture();
  const expired = (quantity: number) => csv(AUCTIONS, [`i:2589,1,${quantity},Hero,${NOW}`]);
  writeFileSync(file, saved({
    "r@Bad:X@internalData@csvExpired": expired(1),
    "r@Bad/X@internalData@csvExpired": expired(2),
    "r@bad_x@internalData@csvExpired": expired(3),
    // Its own name is the first suffix the others would take.
    "r@Bad_X_2@internalData@csvExpired": expired(4),
  }));
  const path = (await exportTo()).result.path;
  const zip = await readZip(path);
  const quantities = Object.fromEntries(Object.entries(zip)
    .filter(([name]) => name.includes("_Expired_"))
    .map(([name, text]) => [name, Number(text.split("\n")[1]!.split(",")[3])]));
  // Realms in the Realm filter's order; the first keeps its name.
  expect(quantities).toEqual({
    "TSM_bad_x_Expired_2026-11-24.csv": 3,
    "TSM_Bad_X_2_Expired_2026-11-24.csv": 4,
    "TSM_Bad_X_3_Expired_2026-11-24.csv": 1,
    "TSM_Bad_X_4_Expired_2026-11-24.csv": 2,
  });
  expect(Object.keys(zip)).toHaveLength(24);
});

/** One realm's records, written by writeLedgerExport itself, into a fresh folder. */
const exportUnit = (options: Partial<Parameters<typeof writeLedgerExport>[0]> = {}) => {
  const folder = options.folder ?? mkdtempSync(join(tmpdir(), "tsm-ledger-publish-"));
  return {
    folder,
    run: () => writeLedgerExport({ db: { "r@Silvermoon@internalData@csvExpired": `${AUCTIONS}\ni:2589,1,1,Hero,${NOW}` }, itemInfo: null, realm: "Silvermoon", folder, now: EXPORT_NOW, ...options }),
  };
};
const fsError = (code: string) => Object.assign(new Error(`${code}: test, link`), { code });

test("Export never replaces a file, even one made while it publishes, with hard links or without", async () => {
  // Without hard links (FAT and exFAT SD cards answer EPERM) it claims the
  // name with an exclusive create and renames the ZIP onto its own claim.
  for (const hardLinks of [true, false]) {
    const folder = mkdtempSync(join(tmpdir(), "tsm-ledger-publish-"));
    writeFileSync(join(folder, "TSM_Silvermoon_2026-11-24.zip"), "first");
    let raced = false;
    const { run } = exportUnit({
      folder,
      link: (from, to) => {
        // Another program takes the next name between our tries.
        if (!raced) writeFileSync(join(folder, "TSM_Silvermoon_2026-11-24 (1).zip"), "racer");
        raced = true;
        if (!hardLinks) throw fsError("EPERM");
        linkSync(from, to);
      },
    });
    const path = await run();
    expect([hardLinks, path]).toEqual([hardLinks, join(folder, "TSM_Silvermoon_2026-11-24 (2).zip")]);
    expect(readFileSync(join(folder, "TSM_Silvermoon_2026-11-24.zip"), "utf8")).toBe("first");
    expect(readFileSync(join(folder, "TSM_Silvermoon_2026-11-24 (1).zip"), "utf8")).toBe("racer");
    expect((await listZipEntries(path)).map((e) => e.name)).toHaveLength(6);
    // The temporary file is gone.
    expect(readdirSync(folder).sort()).toEqual([
      "TSM_Silvermoon_2026-11-24 (1).zip", "TSM_Silvermoon_2026-11-24 (2).zip", "TSM_Silvermoon_2026-11-24.zip",
    ]);
  }
});

test("a failed publish leaves neither the ZIP, its temporary file nor a claimed name", async () => {
  const linkFails = exportUnit({ link: () => { throw fsError("EIO"); } });
  await expect(linkFails.run()).rejects.toThrow("Couldn't write the file");
  expect(readdirSync(linkFails.folder)).toEqual([]);

  const renameFails = exportUnit({
    link: () => { throw fsError("EPERM"); },
    rename: () => { throw fsError("EIO"); },
  });
  await expect(renameFails.run()).rejects.toThrow("Couldn't write the file");
  expect(readdirSync(renameFails.folder)).toEqual([]);
});

test("Export removes the temporary files an interrupted export left there, and only those", async () => {
  const { folder, run } = exportUnit();
  const ours = [".TSM_Silvermoon_2026-11-20.zip.0a1b2c3d.part", ".TSM_3_Realms_2026-11-23.zip.deadbeef.part"];
  const others = [
    ".TSM_Silvermoon_2026-11-20.zip.0a1b2c3.part",
    ".TSM_Silvermoon_2026-11-20.zip.0A1B2C3D.part",
    "TSM_Silvermoon_2026-11-20.zip.0a1b2c3d.part",
    ".TSM_Silvermoon_2026-11-20.zip.0a1b2c3d.part.bak",
    ".TSM_Silvermoon.zip.0a1b2c3d.part",
    ".Other_2026-11-20.zip.0a1b2c3d.part",
    "notes.txt",
  ];
  for (const name of [...ours, ...others]) writeFileSync(join(folder, name), "x");
  // A folder with our name is not our file.
  mkdirSync(join(folder, ".TSM_Folder_2026-11-20.zip.00000000.part"));
  await run();
  expect(readdirSync(folder).sort()).toEqual(
    [...others, ".TSM_Folder_2026-11-20.zip.00000000.part", "TSM_Silvermoon_2026-11-24.zip"].sort(),
  );
});

test("Export leaves the temporary file of an export still running", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let written!: () => void;
  const isWritten = new Promise<void>((resolve) => { written = resolve; });
  const folder = mkdtempSync(join(tmpdir(), "tsm-ledger-publish-"));
  const first = exportUnit({
    folder,
    // Written, and not yet published when the second export starts.
    write: async (path, files, options) => {
      await writeZipFiles(path, files, options);
      written();
      await held;
    },
  }).run();
  await isWritten;
  const second = await exportUnit({ folder }).run();
  release();
  const firstPath = await first;
  expect([firstPath, second].sort()).toEqual([
    join(folder, "TSM_Silvermoon_2026-11-24 (1).zip"), join(folder, "TSM_Silvermoon_2026-11-24.zip"),
  ]);
  expect((await listZipEntries(firstPath)).map((e) => e.name)).toHaveLength(6);
});

test("Export's folder picker starts in Documents, created when missing, then in the remembered folder", async () => {
  const { home, folder, call, exportTo } = exportFixture();
  expect((await call("tradeskillmaster.ledgerExportFolder")).result).toEqual({ folder: join(home, "Documents") });
  expect(statSync(join(home, "Documents")).isDirectory()).toBe(true);
  await exportTo({ realm: "Silvermoon" });
  expect((await call("tradeskillmaster.ledgerExportFolder")).result).toEqual({ folder });
  // A remembered folder that is gone falls back to Documents.
  rmSync(folder, { recursive: true });
  expect((await call("tradeskillmaster.ledgerExportFolder")).result).toEqual({ folder: join(home, "Documents") });
});
