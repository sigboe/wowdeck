import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auctionDataFile, type AuctionEntry } from "../src/wow/tsm/AuctionDataFile";

const KEY = "Stormrage-Alliance";
const OTHER = "Area 52-Horde";

function file(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tsm-file-"));
  const path = join(dir, "AppData.lua");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}
function entry(over: Partial<AuctionEntry> & { tag: string; keys: string[] }): AuctionEntry {
  return { time: 100, data: "{x=1}", ...over };
}
/** The rendered line for one key, as TradeSkillMaster's AppHelper stores it. */
function line(tag: string, key: string, time: number, data = "{x=1}", ah?: number): string {
  return `select(2, ...).LoadData("${tag}","${key}",[[return ${data}]]) --<${tag},${key},${time}${ah === undefined ? "" : "," + ah}>\n`;
}

test("apply creates a missing file and read reports what it wrote", () => {
  const path = file();
  const result = auctionDataFile.apply(path, new Set([KEY]), [
    entry({ tag: "AUCTIONDB_NON_COMMODITY_DATA", keys: [KEY], time: 500, ah: 7 }),
  ]);
  expect(result).toEqual({ ok: true });
  expect(readFileSync(path, "utf8")).toBe(line("AUCTIONDB_NON_COMMODITY_DATA", KEY, 500, "{x=1}", 7));
  const snapshot = auctionDataFile.read(path);
  expect(snapshot.latest(KEY, "AUCTIONDB_NON_COMMODITY_DATA")).toBe(500);
  expect(snapshot.latest(OTHER, "AUCTIONDB_NON_COMMODITY_DATA")).toBeNull();
});

const NC = "AUCTIONDB_NON_COMMODITY_DATA";
const REGION = "AUCTIONDB_REGION_STAT";
const appInfo = (time: number) =>
  `select(2, ...).LoadData("APP_INFO","Global",[[return {version="1.0.9",lastSync=${time}}]]) --<APP_INFO,Global,${time}>\n`;

test("a missing or empty file reads as no entries, and applying nothing writes an empty file", () => {
  for (const path of [file(), file("")]) {
    const snapshot = auctionDataFile.read(path);
    expect(snapshot.latest(KEY)).toBeNull();
    expect(snapshot.covers(NC, KEY, 0)).toBe(false);
    expect(auctionDataFile.apply(path, new Set(), [])).toEqual({ ok: true });
    expect(readFileSync(path, "utf8")).toBe("");
  }
});

test("CRLF managed lines are read and rewritten with LF; CRLF raw lines are kept verbatim", () => {
  const path = file("-- note\r\n" + line(NC, KEY, 300, "{x=1}", 7).replace("\n", "\r\n"));
  expect(auctionDataFile.read(path).latest(KEY, NC)).toBe(300);
  expect(auctionDataFile.apply(path, new Set([KEY]), [])).toEqual({ ok: true });
  expect(readFileSync(path, "utf8")).toBe("-- note\r\n" + line(NC, KEY, 300, "{x=1}", 7));
});

test("a last line without a final newline is kept and the managed lines follow on their own line", () => {
  const raw = file("-- player note");
  auctionDataFile.apply(raw, new Set(), [entry({ tag: REGION, keys: ["US"], time: 5 })]);
  expect(readFileSync(raw, "utf8")).toBe("-- player note\n" + line(REGION, "US", 5));

  const managed = file(line(REGION, "US", 5).trimEnd());
  expect(auctionDataFile.read(managed).latest("US", REGION)).toBe(5);
  auctionDataFile.apply(managed, new Set(), []);
  expect(readFileSync(managed, "utf8")).toBe(line(REGION, "US", 5));
});

test("unknown and malformed lines stay verbatim before the managed entries and never give times", () => {
  const unknownTag = `select(2, ...).LoadData("OTHER","${KEY}",[[return {}]]) --<OTHER_DATA,${KEY},900>\n`;
  const malformedData = `select(2, ...).LoadData("${NC}","${KEY}",[[return ]]) --<${NC},${KEY},900,7>\n`;
  const mismatchedKey = `select(2, ...).LoadData("${NC}","${OTHER}",[[return {x=1}]]) --<${NC},${KEY},900,7>\n`;
  const extraSpace = line(NC, KEY, 900, "{x=1}", 7).replace("LoadData(", "LoadData( ");
  const badTime = `select(2, ...).LoadData("${NC}","${KEY}",[[return {x=1}]]) --<${NC},${KEY},soon,7>\n`;
  const garbage = "local x = 1 -- not ours\n";
  const raw = [unknownTag, malformedData, mismatchedKey, extraSpace, badTime, garbage];
  // Managed and raw lines interleaved: raw lines keep their order, managed ones are rendered after them.
  const path = file(raw[0]! + line(NC, KEY, 100, "{x=1}", 7) + raw.slice(1).join("") + line(REGION, "US", 50));
  const snapshot = auctionDataFile.read(path);
  expect(snapshot.latest(KEY)).toBe(100);
  expect(snapshot.latest(KEY, NC)).toBe(100);
  expect(snapshot.covers(NC, KEY, 101)).toBe(false);
  expect(snapshot.latest(OTHER)).toBeNull();

  expect(auctionDataFile.apply(path, new Set([KEY]), [])).toEqual({ ok: true });
  expect(readFileSync(path, "utf8")).toBe(raw.join("") + line(NC, KEY, 100, "{x=1}", 7) + line(REGION, "US", 50));
});

test("a multi-key update replaces only its keys and pruning drops unfollowed keys", () => {
  const multi = (tag: string, keys: string[], time: number, data: string, ah?: number) =>
    `for _,r in ipairs({${keys.map((k) => `"${k}"`).join(",")}}) do select(2, ...).LoadData("${tag}",r,[[return ${data}]]) end --<${tag},${keys.join("|")},${time}${ah === undefined ? "" : "," + ah}>\n`;
  const third = "Illidan-Horde";
  const path = file(multi(NC, [KEY, OTHER, third], 100, "{old=1}", 7));
  expect(auctionDataFile.read(path).latest(third, NC)).toBe(100);

  // OTHER is no longer followed; KEY gets new data; third keeps the old entry.
  const result = auctionDataFile.apply(path, new Set([KEY, third]), [
    entry({ tag: NC, keys: [KEY, OTHER], time: 200, ah: 7, data: "{new=1}" }),
  ]);
  expect(result).toEqual({ ok: true });
  expect(readFileSync(path, "utf8")).toBe(line(NC, third, 100, "{old=1}", 7) + line(NC, KEY, 200, "{new=1}", 7));
});

test("empty updates still prune; region data and app info survive following nothing", () => {
  const path = file(
    line(NC, KEY, 100, "{x=1}", 7) +
      line("AUCTIONDB_COMMODITY_DATA", KEY, 100, "{x=1}", 7) +
      line(NC, OTHER, 100) + // Non-commodity without an auction house ID.
      line("SHOPPING", OTHER, 100) + // Shopping without an auction house ID.
      line(REGION, "US", 100) +
      line("AUCTIONDB_REGION_HISTORICAL", "US", 90) +
      appInfo(100),
  );
  expect(auctionDataFile.apply(path, new Set(), [])).toEqual({ ok: true });
  expect(readFileSync(path, "utf8")).toBe(
    line(REGION, "US", 100) + line("AUCTIONDB_REGION_HISTORICAL", "US", 90) + appInfo(100),
  );
});

test("updates for unfollowed realms are dropped, region updates are always written", () => {
  const path = file();
  auctionDataFile.apply(path, new Set([KEY]), [
    entry({ tag: NC, keys: [OTHER], time: 100, ah: 9 }),
    entry({ tag: REGION, keys: ["EU"], time: 100 }),
  ]);
  expect(readFileSync(path, "utf8")).toBe(line(REGION, "EU", 100));
});

test("newer data on disk wins unless forced; equal and newer times replace; unrelated tags and keys survive", () => {
  const unrelated =
    line("AUCTIONDB_NON_COMMODITY_HISTORICAL", KEY, 150, "{hist=1}", 7) + line(NC, OTHER, 200, "{other=1}", 8);
  const cases: [Partial<AuctionEntry>, string][] = [
    [{ time: 100 }, line(NC, KEY, 200, "{disk=1}", 7)],
    [{ time: 200 }, line(NC, KEY, 200, "{new=1}", 7)],
    [{ time: 300 }, line(NC, KEY, 300, "{new=1}", 7)],
    [{ time: 100, forced: true }, line(NC, KEY, 100, "{new=1}", 7)],
  ];
  for (const [over, written] of cases) {
    const path = file(line(NC, KEY, 200, "{disk=1}", 7) + unrelated);
    auctionDataFile.apply(path, new Set([KEY, OTHER]), [
      entry({ tag: NC, keys: [KEY], ah: 7, data: "{new=1}", ...over }),
    ]);
    const content = readFileSync(path, "utf8");
    expect(content).toContain(written);
    expect(content).toContain(unrelated);
    expect(content.split("\n").length - 1).toBe(3);
  }
});

test("read errors other than a missing file throw and apply reports the read step", () => {
  const target = join(mkdtempSync(join(tmpdir(), "tsm-file-")), "AppData.lua");
  mkdirSync(join(target, "occupied"), { recursive: true });
  expect(() => auctionDataFile.read(target)).toThrow();
  // A directory at the target fails the read before any temp file is made; a leftover is still dropped.
  writeFileSync(target + ".wowdeck-tmp", "leftover");
  expect(auctionDataFile.apply(target, new Set(), [entry({ tag: REGION, keys: ["US"] })])).toEqual({
    ok: false,
    step: "read",
  });
  expect(existsSync(join(target, "occupied"))).toBe(true);
  expect(existsSync(target + ".wowdeck-tmp")).toBe(false);

  const underAFile = join(file("plain"), "AppData.lua");
  expect(() => auctionDataFile.read(underAFile)).toThrow();
});

test("a directory where the temp file goes fails the write; the file stays and an independent target still writes", () => {
  const blocked = file(line(REGION, "US", 100));
  mkdirSync(join(blocked + ".wowdeck-tmp", "occupied"), { recursive: true });
  const free = file(line(REGION, "US", 100));
  const update = [entry({ tag: REGION, keys: ["US"], time: 200 })];
  expect(auctionDataFile.apply(blocked, new Set(), update)).toEqual({ ok: false, step: "write" });
  expect(auctionDataFile.apply(free, new Set(), update)).toEqual({ ok: true });
  expect(readFileSync(blocked, "utf8")).toBe(line(REGION, "US", 100));
  expect(existsSync(join(blocked + ".wowdeck-tmp", "occupied"))).toBe(true);
  expect(readFileSync(free, "utf8")).toBe(line(REGION, "US", 200));
});

test("a missing folder fails the write and leaves nothing behind", () => {
  const path = join(mkdtempSync(join(tmpdir(), "tsm-file-")), "TradeSkillMaster_AppHelper", "AppData.lua");
  expect(auctionDataFile.apply(path, new Set(), [entry({ tag: REGION, keys: ["US"] })])).toEqual({
    ok: false,
    step: "write",
  });
  expect(existsSync(path + ".wowdeck-tmp")).toBe(false);
});

test("a leftover temp file or link is dropped, never written through", () => {
  const path = file(line(REGION, "US", 100));
  const outside = file("outside");
  symlinkSync(outside, path + ".wowdeck-tmp");
  expect(auctionDataFile.apply(path, new Set(), [entry({ tag: REGION, keys: ["US"], time: 200 })])).toEqual({
    ok: true,
  });
  expect(readFileSync(outside, "utf8")).toBe("outside");
  expect(readFileSync(path, "utf8")).toBe(line(REGION, "US", 200));
  expect(() => lstatSync(path + ".wowdeck-tmp")).toThrow();
});

test("freshness excludes app info and takes the latest time per key across tags", () => {
  const path = file(
    appInfo(999) +
      line(NC, KEY, 100, "{x=1}", 7) +
      line("AUCTIONDB_NON_COMMODITY_HISTORICAL", KEY, 300, "{x=1}", 7),
  );
  const snapshot = auctionDataFile.read(path);
  expect(snapshot.latest("Global")).toBeNull();
  expect(snapshot.covers("APP_INFO", "Global", 999)).toBe(true);
  expect(snapshot.latest(KEY)).toBe(300);
  expect(snapshot.latest(KEY, NC)).toBe(100);
  expect(snapshot.covers(NC, KEY, 100)).toBe(true);
  expect(snapshot.covers(NC, KEY, 101)).toBe(false);
  expect(snapshot.covers(REGION, KEY, 0)).toBe(false);
});

test("the app info entry escapes the payload and round-trips through the file", () => {
  const info = auctionDataFile.appInfoEntry(
    {
      message: { id: "x", msg: 'Say "hi"]]\n' },
      news: [{ title: "A\\B", content: "c", timestamp: 5, link: "l" }],
    },
    1700000000,
  );
  expect(info).toEqual({
    tag: "APP_INFO",
    keys: ["Global"],
    time: 1700000000,
    data: '{version="1.0.9",lastSync=1700000000,message={id=0,msg="Say \\034hi\\034\\093\\093\\010"},news={{title="A\\092B",content="c",timestamp=5,link="l"}}}',
  });
  const path = file();
  expect(auctionDataFile.apply(path, new Set(), [info])).toEqual({ ok: true });
  expect(auctionDataFile.read(path).covers("APP_INFO", "Global", 1700000000)).toBe(true);
  expect(auctionDataFile.appInfoEntry({}, 1).data).toBe(
    '{version="1.0.9",lastSync=1,message={id=0,msg=""},news={}}',
  );
});
