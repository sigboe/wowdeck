import { test, expect } from "bun:test";
import { mkdtempSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTradeSkillMaster, SavedVariablesReader, savedVariables, savedVariablesLimit } from "../src/wow/tsm/SavedVariables";

function file(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "tsm-sv-")), "TradeSkillMaster.lua");
  writeFileSync(path, content);
  return path;
}

const savedFile = `
TradeSkillMasterDB = {
  ["r@Silvermoon@internalData@csvSales"] = "itemString,stackSize,quantity,price,otherPlayer,player,time,source\\ni:2589,1,20,15,Bob,Hero,1700000000,Auction",
  ["_scopeKeys"] = {
    ["factionrealm"] = {
      "Horde - Silvermoon", -- [1]
    },
  },
  ["g@ @internalData@warbankGoldLog"] = [[minute,copper
28333333,1000000]],
  ["s@Hero - Horde - Silvermoon@internalData@goldLog"] = "minute,copper\\n28333333,500000",
  ["f@Horde - Silvermoon@internalData@isLeader"] = true,
}
TSMItemInfoDB = {
  ["version"] = 15,
  ["names"] = "Linen Cloth\\002Copper Ore",
  ["data"] = "AQID",
}
TSMItemCacheDB = {
  ["huge"] = { 1, 2, 3, { 4, 5 } },
}
`;

test("reads TradeSkillMasterDB and the raw TSMItemInfoDB, skipping TSMItemCacheDB", () => {
  const path = file(savedFile);
  const result = readTradeSkillMaster(path);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.db["r@Silvermoon@internalData@csvSales"]).toBe(
    "itemString,stackSize,quantity,price,otherPlayer,player,time,source\ni:2589,1,20,15,Bob,Hero,1700000000,Auction");
  expect(result.db["g@ @internalData@warbankGoldLog"]).toBe("minute,copper\n28333333,1000000");
  expect(result.db["s@Hero - Horde - Silvermoon@internalData@goldLog"]).toBe("minute,copper\n28333333,500000");
  expect(result.db["f@Horde - Silvermoon@internalData@isLeader"]).toBe(true);
  expect(result.db._scopeKeys).toEqual({ factionrealm: { 1: "Horde - Silvermoon" } });
  expect(result.itemInfo).toEqual({ version: 15, names: "Linen Cloth\u0002Copper Ore", data: "AQID" });
  const globals = savedVariables.read(path);
  expect(globals.status === "ok" && Object.keys(globals.globals)).toEqual(["TradeSkillMasterDB", "TSMItemInfoDB"]);
});

test("a file above the old 16 MiB cap parses, and one above the limit is refused unread", () => {
  const row = "\\ni:2589,1,20,15,Bob,Hero,1700000000,Auction";
  const rows = 400_000;
  const path = file(`TradeSkillMasterDB = {\n  ["r@Silvermoon@internalData@csvSales"] = "itemString${row.repeat(rows)}",\n}\n`);
  expect(statSync(path).size).toBeGreaterThan(16 * 1024 * 1024);
  const large = readTradeSkillMaster(path);
  expect(large.status).toBe("ok");
  if (large.status === "ok") expect(String(large.db["r@Silvermoon@internalData@csvSales"]).split("\n")).toHaveLength(rows + 1);

  // A sparse file: refusing it must not depend on reading its contents.
  const huge = file("");
  truncateSync(huge, savedVariablesLimit + 1);
  expect(readTradeSkillMaster(huge)).toEqual({ status: "tooLarge" });
});

test("an unchanged file is parsed once; a new last-write time or size parses it again", () => {
  const path = file('TradeSkillMasterDB = { ["a"] = 1 }');
  utimesSync(path, 1000, 1000);
  const first = readTradeSkillMaster(path);
  expect(readTradeSkillMaster(path)).toBe(first);

  utimesSync(path, 2000, 2000);
  const touched = readTradeSkillMaster(path);
  expect(touched).not.toBe(first);
  expect(touched).toEqual(first);
  expect(readTradeSkillMaster(path)).toBe(touched);

  // Same last-write time, new size: the content is read again.
  writeFileSync(path, 'TradeSkillMasterDB = { ["a"] = 22 }');
  utimesSync(path, 2000, 2000);
  const resized = readTradeSkillMaster(path);
  expect(resized.status === "ok" && resized.db.a).toBe(22);
});

test("the cache keeps a few recent files: older ones are parsed again, the newest always stays", () => {
  const reader = new SavedVariablesReader({ entries: 2, budget: 100 });
  const [a, b, c] = ["A", "B", "C"].map((name) => file(`${name} = { ["x"] = "${"y".repeat(30)}" }`));
  const first = reader.read(a!);
  reader.read(b!);
  expect(reader.read(a!)).toBe(first);
  // A third file pushes out the one read longest ago (b, since a was just read).
  const third = reader.read(c!);
  expect(reader.read(a!)).toBe(first);
  // b was parsed again, and pushed out c.
  const second = reader.read(b!);
  expect(reader.read(b!)).toBe(second);
  expect(reader.read(c!)).not.toBe(third);

  // Over the byte budget only the newest file stays, however large it is.
  const small = new SavedVariablesReader({ entries: 4, budget: 60 });
  const big = file(`Big = { ["x"] = "${"y".repeat(200)}" }`);
  const keptA = small.read(a!);
  const keptBig = small.read(big);
  expect(small.read(big)).toBe(keptBig);
  expect(small.read(a!)).not.toBe(keptA);
});

test("expressions, calls, symlinks and pipes are refused; nothing is evaluated", () => {
  for (const content of [
    'TradeSkillMasterDB = { region = (function() return "EU" end)() }',
    'TradeSkillMasterDB = { a = os.exit() }',
    'TradeSkillMasterDB = { a = 1 + 2 }',
    'TradeSkillMasterDB = { a = "x" .. "y" }',
    'TradeSkillMasterDB = { a = OtherGlobal }',
    'TradeSkillMasterDB = {} print("hi")',
    'TradeSkillMasterDB = {}\nTSMItemCacheDB = { a = loadstring("x")() }',
  ]) expect(readTradeSkillMaster(file(content))).toEqual({ status: "invalid" });
  expect(readTradeSkillMaster(join(mkdtempSync(join(tmpdir(), "tsm-sv-")), "TradeSkillMaster.lua"))).toEqual({ status: "missing" });
  const link = join(mkdtempSync(join(tmpdir(), "tsm-sv-")), "TradeSkillMaster.lua");
  symlinkSync(file("TradeSkillMasterDB = {}"), link);
  expect(readTradeSkillMaster(link)).toEqual({ status: "unreadable" });
  // Opening a named pipe for reading would wait for a writer.
  const pipe = join(mkdtempSync(join(tmpdir(), "tsm-sv-")), "TradeSkillMaster.lua");
  expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
  expect(readTradeSkillMaster(pipe)).toEqual({ status: "unreadable" });
});

test("strings decode Lua escapes as UTF-8 bytes, and nil fields are absent", () => {
  const result = readTradeSkillMaster(file([
    "TradeSkillMasterDB = {",
    '  bytes = "Caf\\195\\169 \\x41",',
    "  raw = \"Café\",",
    '  unicode = "\\u{E9}\\u{1F600}",',
    '  mixed = "\\195\\169\\u{E9}",',
    '  quotes = \'it\\\'s "x" \\\\ y\',',
    '  skip = "a\\z   b",',
    '  continued = "a\\',
    'b",',
    "  [\"gone\"] = nil,",
    "  nil, true,",
    "  long = [==[",
    "a]]b]==],",
    "}",
    "TSMItemInfoDB = nil",
  ].join("\n")));
  expect(result).toEqual({ status: "ok", itemInfo: null, db: {
    bytes: "Café A", raw: "Café", unicode: "é\u{1F600}", mixed: "éé", quotes: "it's \"x\" \\ y",
    skip: "ab", continued: "a\nb", 2: true, long: "a]]b",
  } });
  for (const bad of ['"\\q"', '"\\256"', '"\\u{110000}"', '"open']) {
    expect(readTradeSkillMaster(file(`TradeSkillMasterDB = { a = ${bad} }`))).toEqual({ status: "invalid" });
  }
  expect(readTradeSkillMaster(file("TradeSkillMasterDB = { [nil] = 1 }"))).toEqual({ status: "invalid" });
});
