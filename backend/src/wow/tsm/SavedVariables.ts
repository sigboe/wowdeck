/**
 * Restricted SavedVariables reader shared by character discovery and the
 * Ledger. The data layout it serves follows tsm/wow/saved_variables.py,
 * tsm-app-linux (MIT), commit 1908e34930f742a3a9ce754faf4e1839431fff3a; the
 * parser is WoWDeck's own (upstream matches regular expressions).
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md. Files are data, never Lua code.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";

/**
 * TradeSkillMaster.lua keeps up to about 55,000 sales and as many purchase
 * rows per realm, beside income, expense, expired and cancelled records and
 * the item caches, so a player with several realms passes 100 MiB.
 */
export const savedVariablesLimit = 256 * 1024 * 1024;

/** A Lua value as SavedVariables hold it. Nil fields are absent, as in Lua. */
export type LuaValue = string | number | boolean | LuaTable;
export interface LuaTable { [key: string]: LuaValue }

export type SavedVariablesRead =
  | { status: "ok"; globals: Readonly<Record<string, LuaValue>> }
  /** No such file. */
  | { status: "missing" }
  /** Larger than the reader's limit; refused before reading. */
  | { status: "tooLarge" }
  /** A symlink, not a regular file, or unreadable. */
  | { status: "unreadable" }
  /** Not plain `Name = table` data: expressions, calls or malformed text. */
  | { status: "invalid" };

/** True when no component of `path` is a symlink. */
export function safePath(path: string): boolean {
  try {
    for (let part = path; dirname(part) !== part; part = dirname(part)) {
      if (lstatSync(part).isSymbolicLink()) return false;
    }
    return true;
  } catch { return false; }
}

class Invalid extends Error {}

const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"', "'": "'" };
/** Lua's whitespace (C's isspace), not JavaScript's wider `\s`. */
const escape = /\\(?:(\d{1,3})|x([0-9A-Fa-f]{2})|u\{([0-9A-Fa-f]{1,8})\}|z[ \t\n\v\f\r]*|(\r\n?|\n\r?)|([\s\S]))/g;

/**
 * Decodes a quoted Lua string's body, given as bytes (one Latin-1 character
 * per byte): escapes become the bytes Lua makes of them, and the result is
 * decoded as UTF-8, the file's encoding.
 */
function unescape(body: string): string {
  const result = body.replace(escape, (_all, dec?: string, hex?: string, unicode?: string, newline?: string, other?: string) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
      if (code > 255) throw new Invalid();
      return String.fromCharCode(code);
    }
    if (unicode !== undefined) {
      const point = parseInt(unicode, 16);
      if (point > 0x10ffff) throw new Invalid();
      return Buffer.from(String.fromCodePoint(point), "utf8").toString("latin1");
    }
    if (newline !== undefined) return "\n";
    if (other === undefined) return ""; // \z skips the following whitespace.
    const simple = escapes[other];
    if (simple === undefined) throw new Invalid();
    return simple;
  });
  return Buffer.from(result, "latin1").toString("utf8");
}

const number = /-?0[xX][0-9A-Fa-f]+|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const opening = /\[=*\[/y;
const name = /[A-Za-z_]\w*/y;
const space = /(?:[ \t\n\v\f\r]+|--(?!\[=*\[)[^\n]*|--\[(=*)\[[\s\S]*?\]\1\])*/y;

/**
 * A restricted parser for the data WoW writes into SavedVariables: one
 * `Name = value` statement per saved global, where values are strings,
 * numbers, booleans, nil and tables. It rejects everything else and never
 * evaluates input. Globals in `skip` are checked but not built.
 *
 * It scans the file's bytes as Latin-1 text, one character per byte, and
 * copies every string it keeps out of `bytes`. A slice of the scanned text
 * would keep the whole file's text alive for as long as the parsed tables
 * live (Bun shares a slice's storage with the string it came from).
 */
function parse(bytes: Buffer, skip: ReadonlySet<string>): Record<string, LuaValue> {
  const source = bytes.toString("latin1");
  // A UTF-8 byte order mark is not part of the data.
  let pos = source.startsWith("\xEF\xBB\xBF") ? 3 : 0;
  const ws = () => { space.lastIndex = pos; space.exec(source); pos = space.lastIndex; };
  /** Matches `re` at `pos`; returns the match's end, or -1. */
  const sticky = (re: RegExp): number => {
    re.lastIndex = pos;
    if (!re.test(source)) return -1;
    return re.lastIndex;
  };
  /** A name at `pos`, copied; undefined when there is none. */
  const word = (): string | undefined => {
    const start = pos;
    const end = sticky(name);
    if (end < 0) return undefined;
    pos = end;
    return bytes.toString("latin1", start, end);
  };
  const atLongBracket = () => { opening.lastIndex = pos; return opening.test(source); };
  const expect = (char: string) => { ws(); if (source[pos] !== char) throw new Invalid(); pos++; };
  /** A string's bytes from `start` to `end`, decoded and copied. */
  const text = (start: number, end: number, escaped: boolean): string => {
    if (escaped) {
      const body = source.slice(start, end);
      if (body.includes("\\")) return unescape(body);
    }
    return bytes.toString("utf8", start, end);
  };
  const longBracket = (build: boolean): string | undefined => {
    const open = /\[(=*)\[/y; open.lastIndex = pos;
    const match = open.exec(source);
    if (!match) return undefined;
    const close = "]" + match[1] + "]";
    const end = source.indexOf(close, open.lastIndex);
    if (end < 0) throw new Invalid();
    let start = open.lastIndex;
    // Lua drops a newline that directly follows the opening bracket.
    if (source[start] === "\r") start += source[start + 1] === "\n" ? 2 : 1;
    else if (source[start] === "\n") start += source[start + 1] === "\r" ? 2 : 1;
    pos = end + close.length;
    return build ? text(start, end, false) : "";
  };
  const quoted = (build: boolean): string => {
    const quote = source[pos]!;
    let end = pos + 1;
    for (;;) {
      const next = source.indexOf(quote, end);
      if (next < 0) throw new Invalid();
      let slashes = 0;
      while (source[next - 1 - slashes] === "\\") slashes++;
      if (slashes % 2 === 0) { end = next; break; }
      end = next + 1;
    }
    const start = pos + 1;
    pos = end + 1;
    return build ? text(start, end, true) : "";
  };
  /** Returns null for nil, which callers leave out. */
  function value(depth: number, build: boolean): LuaValue | null {
    if (depth > 40) throw new Invalid();
    ws();
    const char = source[pos];
    if (char === "{") {
      pos++;
      const table: LuaTable = Object.create(null);
      let index = 1;
      for (;;) {
        ws();
        if (source[pos] === "}") { pos++; return table; }
        let key: string;
        const start = pos;
        const field = word();
        ws();
        if (field !== undefined && source[pos] === "=" && source[pos + 1] !== "=") { key = field; pos++; }
        else if (field === undefined && source[pos] === "[" && !atLongBracket()) {
          pos++;
          const index = value(depth + 1, true);
          if (index === null) throw new Invalid();
          key = String(index);
          expect("]"); expect("=");
        } else { pos = start; key = String(index++); }
        const item = value(depth + 1, build);
        if (build && item !== null) table[key] = item;
        ws();
        if (source[pos] === "," || source[pos] === ";") pos++;
        else if (source[pos] !== "}") throw new Invalid();
      }
    }
    if (char === '"' || char === "'") return quoted(build);
    if (char === "[") { const long = longBracket(build); if (long !== undefined) return long; }
    const start = pos;
    if (sticky(name) >= 0) {
      const keyword = source.slice(start, name.lastIndex);
      pos = name.lastIndex;
      if (keyword === "true") return true;
      if (keyword === "false") return false;
      if (keyword === "nil") return null;
      throw new Invalid();
    }
    const end = sticky(number);
    if (end >= 0) {
      const digits = source.slice(start, end);
      pos = end;
      // A name or digit glued to a number (`1x`, `0x1g`) is not data.
      if (/[\w.]/.test(source[pos] ?? "")) throw new Invalid();
      return digits.startsWith("-") ? -Number(digits.slice(1)) : Number(digits);
    }
    throw new Invalid();
  }
  const globals: Record<string, LuaValue> = Object.create(null);
  for (;;) {
    ws();
    if (pos >= source.length) return globals;
    const global = word();
    if (global === undefined) throw new Invalid();
    expect("=");
    const keep = !skip.has(global);
    const result = value(0, keep);
    if (result === null) delete globals[global];
    else if (keep) globals[global] = result;
    ws();
    if (source[pos] === ";") pos++;
  }
}

/**
 * JavaScript's legacy `RegExp.input` keeps the last string a regular
 * expression matched, here the whole file's text, alive until the next
 * match. Matching a tiny string lets the text go once parsing is done.
 */
const forgetLastInput = () => { /$/.test(""); };

/** WoW rewrites a file at logout or /reload; a changed version changes these. */
interface Version { mtimeMs: number; ctimeMs: number; size: number; ino: number }
interface Cached extends Version { result: SavedVariablesRead }
const sameVersion = (a: Version, b: Version) =>
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size && a.ino === b.ino;

/**
 * How many parsed files the cache keeps, and how many file bytes they may
 * hold together. The newest file read is always kept, whatever its size, so the Ledger's repeated
 * reads of one large file parse it once, while a scan over many files
 * (character discovery) keeps only the last few.
 */
export const cachedFiles = 4;
export const cacheBudget = 32 * 1024 * 1024;

/**
 * Reads SavedVariables files and remembers the most recently read ones by
 * last-write time and size (and inode and change time), so an unchanged file
 * is parsed once. Callers share the returned tables and must not change them.
 */
export class SavedVariablesReader {
  /** Least recently read first. */
  readonly #cache = new Map<string, Cached>();
  readonly #limit: number;
  readonly #skip: ReadonlySet<string>;
  readonly #entries: number;
  readonly #budget: number;
  constructor(options: { limit?: number; skip?: string[]; entries?: number; budget?: number } = {}) {
    this.#limit = options.limit ?? savedVariablesLimit;
    this.#skip = new Set(options.skip ?? []);
    this.#entries = options.entries ?? cachedFiles;
    this.#budget = options.budget ?? cacheBudget;
  }
  /** Keep `entry` as the newest, then drop the oldest until the cache fits. */
  #remember(path: string, entry: Cached): void {
    this.#cache.delete(path);
    this.#cache.set(path, entry);
    // Only parsed files hold data; a refused one is just its status.
    const weight = (cached: Cached) => (cached.result.status === "ok" ? cached.size : 0);
    let bytes = 0;
    for (const cached of this.#cache.values()) bytes += weight(cached);
    for (const [oldest, cached] of this.#cache) {
      if (this.#cache.size <= 1 || (this.#cache.size <= this.#entries && bytes <= this.#budget)) break;
      this.#cache.delete(oldest);
      bytes -= weight(cached);
    }
  }
  read(path: string): SavedVariablesRead {
    let fd: number | undefined;
    try {
      if (!safePath(path)) {
        this.#cache.delete(path);
        try { lstatSync(path); } catch (error) { if (code(error) === "ENOENT") return { status: "missing" }; }
        return { status: "unreadable" };
      }
      // Never open a FIFO or device: opening one can block the engine.
      if (!lstatSync(path).isFile()) { this.#cache.delete(path); return { status: "unreadable" }; }
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const st = fstatSync(fd);
      const version: Version = { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, ino: st.ino };
      const cached = this.#cache.get(path);
      if (cached && sameVersion(cached, version)) { this.#remember(path, cached); return cached.result; }
      let result: SavedVariablesRead;
      if (!st.isFile()) result = { status: "unreadable" };
      else if (st.size > this.#limit) result = { status: "tooLarge" };
      else {
        const buffer = Buffer.allocUnsafe(st.size);
        let length = 0;
        while (length < st.size) {
          const read = readSync(fd, buffer, length, st.size - length, length);
          if (read === 0) break;
          length += read;
        }
        try { result = { status: "ok", globals: parse(length < st.size ? buffer.subarray(0, length) : buffer, this.#skip) }; }
        catch (error) {
          // RangeError: nesting deep enough to exhaust the stack.
          if (!(error instanceof Invalid) && !(error instanceof RangeError)) throw error;
          result = { status: "invalid" };
        } finally { forgetLastInput(); }
      }
      this.#remember(path, { ...version, result });
      return result;
    } catch (error) {
      this.#cache.delete(path);
      if (code(error) === "ENOENT") return { status: "missing" };
      console.error("[saved-variables] read failed:", code(error) ?? String(error));
      return { status: "unreadable" };
    } finally { if (fd !== undefined) closeSync(fd); }
  }
}

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

/**
 * The engine's shared reader. TSMItemCacheDB holds the addon's item
 * metadata cache, which nothing in WoWDeck reads, so it is never built.
 */
export const savedVariables = new SavedVariablesReader({ skip: ["TSMItemCacheDB"] });

const table = (value: LuaValue | undefined): LuaTable | null =>
  value !== null && typeof value === "object" ? value : null;

export type TradeSkillMasterSaved =
  | { status: "ok"; db: LuaTable; itemInfo: LuaTable | null }
  | Exclude<SavedVariablesRead, { status: "ok" }>;

/** One view per cached read, so an unchanged file yields the same tables. */
const tradeSkillMasterViews = new WeakMap<SavedVariablesRead, TradeSkillMasterSaved>();

/**
 * Reads a TradeSkillMaster.lua: TradeSkillMasterDB (empty when absent) and,
 * separately, the raw TSMItemInfoDB table, still encoded as the addon wrote it.
 */
export function readTradeSkillMaster(path: string, reader = savedVariables): TradeSkillMasterSaved {
  const result = reader.read(path);
  if (result.status !== "ok") return result;
  let saved = tradeSkillMasterViews.get(result);
  if (!saved) {
    saved = { status: "ok", db: table(result.globals.TradeSkillMasterDB) ?? Object.create(null), itemInfo: table(result.globals.TSMItemInfoDB) };
    tradeSkillMasterViews.set(result, saved);
  }
  return saved;
}
