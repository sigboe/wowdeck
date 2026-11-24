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

test("without the addon or any account's records, the Ledger asks for the addon", async () => {
  const { write, call } = fixture();
  // A WoW account the addon never saved to does not count.
  write("WTF/Account/MAIN/SavedVariables/Blizzard_Settings.lua", "Settings = {}\n");
  expect((await call()).result).toEqual({ state: "noAddon", accounts: [], account: null, recordedAt: null, gameRunning: false });
});

test("with the addon installed but nothing saved yet, the Ledger has no account", async () => {
  const { write, call } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  expect((await call()).result).toEqual({ state: "noAccount", accounts: [], account: null, recordedAt: null, gameRunning: false });
});

test("one account is picked by itself, and a file of headers and empty gold logs has no records", async () => {
  const { write, call, running } = fixture();
  write("Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc", "## Title: TradeSkillMaster\n");
  write(account("MAIN"), saved(empty), 1_800_000_000);
  expect((await call()).result).toEqual({
    state: "noRecords", accounts: ["MAIN"], account: "MAIN", recordedAt: 1_800_000_000_000, gameRunning: false,
  });
  running("running");
  expect((await call()).result.gameRunning).toBe(true);
  // Unknown is not running: nothing says this session is missing.
  running("unknown");
  expect((await call()).result.gameRunning).toBe(false);
});

test("any recorded row or gold log point makes the Ledger ready", async () => {
  const records: Record<string, string> = {
    sale: "r@Silvermoon@internalData@csvSales",
    buy: "r@Silvermoon@internalData@csvBuys",
    income: "r@Silvermoon@internalData@csvIncome",
    expense: "r@Silvermoon@internalData@csvExpense",
    expired: "r@Silvermoon@internalData@csvExpired",
    cancelled: "r@Silvermoon@internalData@csvCancelled",
    gold: "s@Hero - Horde - Silvermoon@internalData@goldLog",
    warbank: "g@ @internalData@warbankGoldLog",
  };
  for (const [name, key] of Object.entries(records)) {
    const { write, call } = fixture();
    write(account("MAIN"), saved({ ...empty, [key]: '"header\\n1,2"' }));
    expect([name, (await call()).result.state]).toEqual([name, "ready"]);
  }
  const { write, call } = fixture();
  write(account("MAIN"), saved({ ...empty, "f@Horde - Silvermoon@internalData@guildGoldLog": '{ ["Guild"] = "minute,copper\\n29000000,100" }' }));
  expect((await call()).result.state).toBe("ready");
});

test("several accounts: the one asked for, else the one written last; the addon's absence hides nothing", async () => {
  const { write, call } = fixture();
  write(account("ALT"), saved(empty), 1_800_000_500);
  write(account("MAIN"), saved({ ...empty, "g@ @internalData@warbankGoldLog": '"minute,copper\\n29000000,100"' }), 1_800_000_000);
  // An account folder without the addon's file is not an account of the Ledger.
  write("WTF/Account/NONE/SavedVariables/Other.lua", "Other = {}\n");
  expect((await call()).result).toMatchObject({ state: "noRecords", accounts: ["ALT", "MAIN"], account: "ALT", recordedAt: 1_800_000_500_000 });
  expect((await call({ account: "MAIN" })).result).toMatchObject({ state: "ready", account: "MAIN", recordedAt: 1_800_000_000_000 });
  // An account that is gone falls back to the engine's pick.
  expect((await call({ account: "GONE" })).result).toMatchObject({ account: "ALT" });
});

test("a file that is not plain saved data is an error, not an empty Ledger", async () => {
  const { write, call } = fixture();
  write(account("MAIN"), "TradeSkillMasterDB = os.execute('x')\n");
  const response = await call();
  expect(response.result).toBeUndefined();
  expect(response.error).toBeDefined();
});
