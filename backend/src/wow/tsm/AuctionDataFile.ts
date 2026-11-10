/**
 * Format adapted from tsm-app-linux (MIT), tsm/wow/lua_writer.py and
 * tsm/core/services/auction.py, commit 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md.
 *
 * One TradeSkillMaster auction data file (AppData.lua), addressed by path.
 * Which installation and folder a path belongs to is the sync session's call.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export interface AuctionEntry {
  tag: string;
  keys: string[];
  time: number;
  /** Auction house ID; realm data carrying one is pruned to followed keys. */
  ah?: number;
  data: string;
  /** A Refresh: replaces newer data on disk. */
  forced?: boolean;
}

/** The managed entries on disk when read. */
export interface AuctionSnapshot {
  /** Latest time written for this key (optionally one tag), app info excluded; null when none. */
  latest(key: string, tag?: string): number | null;
  /** Whether an entry with this tag and key is at least this new. */
  covers(tag: string, key: string, time: number): boolean;
}

export type ApplyResult = { ok: true } | { ok: false; step: "read" | "write" | "rename" };

export interface AuctionDataFile {
  /** Throws on read errors other than a missing file. */
  read(path: string): AuctionSnapshot;
  /** Prunes keys outside `allowed`, applies `updates` in place and swaps the file in atomically. */
  apply(path: string, allowed: ReadonlySet<string>, updates: readonly AuctionEntry[]): ApplyResult;
}

/** Whether `entries` hold one with this tag and key at least this new. */
export function covers(entries: readonly AuctionEntry[], tag: string, key: string, time: number): boolean {
  return entries.some((e) => e.tag === tag && e.keys.includes(key) && e.time >= time);
}

/** Tags WoWDeck manages; lines with any other tag stay as they are. */
export const auctionDataTags: ReadonlySet<string> = new Set([
  "AUCTIONDB_NON_COMMODITY_DATA",
  "AUCTIONDB_NON_COMMODITY_SCAN_STAT",
  "AUCTIONDB_NON_COMMODITY_HISTORICAL",
  "AUCTIONDB_COMMODITY_SCAN_STAT",
  "AUCTIONDB_COMMODITY_HISTORICAL",
  "AUCTIONDB_COMMODITY_DATA",
  "AUCTIONDB_REGION_STAT",
  "AUCTIONDB_REGION_HISTORICAL",
  "AUCTIONDB_REGION_SALE",
  "SHOPPING",
  "APP_INFO",
]);

function quote(value: unknown): string {
  return (
    '"' +
    String(value ?? "").replace(
      /[\\"\]\x00-\x1f\x7f]/g,
      (ch) => "\\" + ch.charCodeAt(0).toString().padStart(3, "0"),
    ) +
    '"'
  );
}
function wrap(e: AuctionEntry): string {
  const code =
    e.keys.length === 1
      ? `select(2, ...).LoadData("${e.tag}",${quote(e.keys[0])},[[return ${e.data}]])`
      : `for _,r in ipairs({${e.keys.map(quote).join(",")}}) do select(2, ...).LoadData("${e.tag}",r,[[return ${e.data}]]) end`;
  return `${code} --<${e.tag},${e.keys.join("|")},${e.time}${e.ah === undefined ? "" : "," + e.ah}>\n`;
}
/** Managed entries, and every other line kept verbatim. A line counts as managed only if it renders back exactly. */
function parse(text: string): { entries: AuctionEntry[]; raw: string[] } {
  const entries: AuctionEntry[] = [],
    raw: string[] = [];
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const m = line.trimEnd().match(/^(.*?) --<([A-Z_]+),([^,]+),(\d+)(?:,(\d+))?>$/);
    if (m && auctionDataTags.has(m[2]!)) {
      const data = m[1]!.match(/\[\[return (.*)\]\]/)?.[1];
      const entry = {
        tag: m[2]!,
        keys: m[3]!.split("|"),
        time: Number(m[4]),
        ah: m[5] ? Number(m[5]) : undefined,
        data: data ?? "",
      };
      if (data && wrap(entry).trimEnd() === line.trimEnd()) {
        entries.push(entry);
        continue;
      }
    }
    raw.push(line);
  }
  return { entries, raw };
}
function parseFile(path: string) {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parse("");
    throw error;
  }
}

function read(path: string): AuctionSnapshot {
  const { entries } = parseFile(path);
  return {
    latest: (key, tag) =>
      Math.max(
        0,
        ...entries
          .filter((e) => e.tag !== "APP_INFO" && e.keys.includes(key) && (tag === undefined || e.tag === tag))
          .map((e) => e.time),
      ) || null,
    covers: (tag, key, time) => covers(entries, tag, key, time),
  };
}

function apply(path: string, allowed: ReadonlySet<string>, updates: readonly AuctionEntry[]): ApplyResult {
  const tmp = path + ".wowdeck-tmp";
  /* The suffix is ours alone: a leftover from an interrupted write is safe to drop.
     rmSync unlinks a link rather than its target, and refuses a directory. */
  const failed = (step: "read" | "write" | "rename"): ApplyResult => {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* Not a file we can remove (a directory in the way); the next apply retries. */
    }
    return { ok: false, step };
  };
  let state: ReturnType<typeof parse>;
  try {
    state = parseFile(path);
  } catch {
    return failed("read");
  }
  // Realm data (an auction house ID, non-commodity or shopping) keeps followed keys only.
  state.entries = state.entries.flatMap((e) => {
    if (e.ah === undefined && !e.tag.startsWith("AUCTIONDB_NON_COMMODITY") && e.tag !== "SHOPPING") return [e];
    const keys = e.keys.filter((k) => allowed.has(k));
    return keys.length ? [{ ...e, keys }] : [];
  });
  for (const update of updates) {
    // Newer data on disk wins unless forced; equal times replace.
    const keys = update.keys.filter(
      (key) =>
        (update.ah === undefined || allowed.has(key)) &&
        (update.forced ||
          !state.entries.some((e) => e.tag === update.tag && e.keys.includes(key) && e.time > update.time)),
    );
    state.entries = state.entries.flatMap((e) => {
      if (e.tag !== update.tag) return [e];
      const remaining = e.keys.filter((k) => !keys.includes(k));
      return remaining.length ? [{ ...e, keys: remaining }] : [];
    });
    if (keys.length) state.entries.push({ ...update, keys });
  }
  const raw = state.raw.join("");
  const content = raw + (raw && !raw.endsWith("\n") ? "\n" : "") + state.entries.map(wrap).join("");
  let step: "write" | "rename" = "write";
  try {
    rmSync(tmp, { force: true });
    writeFileSync(tmp, content, { flag: "wx" });
    step = "rename";
    renameSync(tmp, path);
    return { ok: true };
  } catch {
    return failed(step); // The previous file stays intact.
  }
}

/** The app info entry for a pushed payload, at `now` (seconds). */
export function appInfoEntry(payload: Record<string, any>, now: number): AuctionEntry {
  const number = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const message = payload.message ?? {};
  const news = Array.isArray(payload.news) ? payload.news : [];
  const data = `{version="1.0.9",lastSync=${now},message={id=${number(message.id)},msg=${quote(message.msg)}},news={${news.map((n: any) => `{title=${quote(n.title)},content=${quote(n.content)},timestamp=${number(n.timestamp)},link=${quote(n.link)}}`).join(",")}}}`;
  return { tag: "APP_INFO", keys: ["Global"], time: now, data };
}

export const auctionDataFile: AuctionDataFile = { read, apply };
