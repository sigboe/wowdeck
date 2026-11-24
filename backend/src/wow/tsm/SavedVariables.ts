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

export type LuaValue = string | number | boolean | null | LuaTable;
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
const escape = /\\(?:(\d{1,3})|x([0-9A-Fa-f]{2})|u\{([0-9A-Fa-f]{1,8})\}|z\s*|(\r\n?|\n\r?)|([\s\S]))/g;
/** An escape that produces a byte above 127, so the string is decoded as bytes. */
const highByte = /\\(?:1[2-9]\d|2\d\d|x[89A-Fa-f])/;

/** Decodes a quoted Lua string's body. Lua strings are bytes; the file is UTF-8. */
function unescape(body: string): string {
  if (!body.includes("\\")) return body;
  const bytes = highByte.test(body);
  const source = bytes ? Buffer.from(body, "utf8").toString("latin1") : body;
  const result = source.replace(escape, (_all, dec?: string, hex?: string, unicode?: string, newline?: string, other?: string) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
      if (code > 255) throw new Invalid();
      return String.fromCharCode(code);
    }
    if (unicode !== undefined) {
      const point = parseInt(unicode, 16);
      if (point > 0x10ffff) throw new Invalid();
      const char = String.fromCodePoint(point);
      return bytes ? Buffer.from(char, "utf8").toString("latin1") : char;
    }
    if (newline !== undefined) return "\n";
    if (other === undefined) return ""; // \z skips the following whitespace.
    const simple = escapes[other];
    if (simple === undefined) throw new Invalid();
    return simple;
  });
  return bytes ? Buffer.from(result, "latin1").toString("utf8") : result;
}

const number = /-?0[xX][0-9A-Fa-f]+|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const opening = /\[=*\[/y;
const name = /[A-Za-z_]\w*/y;
const space = /(?:\s+|--(?!\[=*\[)[^\n]*|--\[(=*)\[[\s\S]*?\]\1\])*/y;

/**
 * A restricted parser for the data WoW writes into SavedVariables: one
 * `Name = value` statement per saved global, where values are strings,
 * numbers, booleans, nil and tables. It rejects everything else and never
 * evaluates input. Globals in `skip` are checked but not built.
 */
function parse(source: string, skip: ReadonlySet<string>): Record<string, LuaValue> {
  let pos = 0;
  const ws = () => { space.lastIndex = pos; space.exec(source); pos = space.lastIndex; };
  const sticky = (re: RegExp): string | undefined => {
    re.lastIndex = pos;
    const match = re.exec(source);
    if (!match) return undefined;
    pos = re.lastIndex;
    return match[0];
  };
  const atLongBracket = () => { opening.lastIndex = pos; return opening.test(source); };
  const expect = (char: string) => { ws(); if (source[pos] !== char) throw new Invalid(); pos++; };
  const longBracket = (): string | undefined => {
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
    return source.slice(start, end);
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
    const body = source.slice(pos + 1, end);
    pos = end + 1;
    return build ? unescape(body) : "";
  };
  function value(depth: number, build: boolean): LuaValue {
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
        const field = sticky(name);
        ws();
        if (field !== undefined && source[pos] === "=" && source[pos + 1] !== "=") { key = field; pos++; }
        else if (field === undefined && source[pos] === "[" && !atLongBracket()) {
          pos++;
          key = String(value(depth + 1, true));
          expect("]"); expect("=");
        } else { pos = start; key = String(index++); }
        const item = value(depth + 1, build);
        if (build) table[key] = item;
        ws();
        if (source[pos] === "," || source[pos] === ";") pos++;
        else if (source[pos] !== "}") throw new Invalid();
      }
    }
    if (char === '"' || char === "'") return quoted(build);
    if (char === "[") { const text = longBracket(); if (text !== undefined) return text; }
    const word = sticky(name);
    if (word !== undefined) {
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "nil") return null;
      throw new Invalid();
    }
    const digits = sticky(number);
    if (digits !== undefined) {
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
    const global = sticky(name);
    if (global === undefined) throw new Invalid();
    expect("=");
    const keep = !skip.has(global);
    const result = value(0, keep);
    if (keep) globals[global] = result;
    else delete globals[global];
    ws();
    if (source[pos] === ";") pos++;
  }
}

interface Cached { mtimeMs: number; size: number; result: SavedVariablesRead }

/**
 * Reads SavedVariables files and remembers each parsed file by last-write
 * time and size, so an unchanged file is parsed once. Callers share the
 * returned tables and must not change them.
 */
export class SavedVariablesReader {
  readonly #cache = new Map<string, Cached>();
  readonly #limit: number;
  readonly #skip: ReadonlySet<string>;
  constructor(options: { limit?: number; skip?: string[] } = {}) {
    this.#limit = options.limit ?? savedVariablesLimit;
    this.#skip = new Set(options.skip ?? []);
  }
  read(path: string): SavedVariablesRead {
    if (!safePath(path)) {
      this.#cache.delete(path);
      try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" }; }
      return { status: "unreadable" };
    }
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      this.#cache.delete(path);
      return { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
    }
    try {
      const st = fstatSync(fd);
      const cached = this.#cache.get(path);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.result;
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
        try { result = { status: "ok", globals: parse(buffer.toString("utf8", 0, length), this.#skip) }; }
        catch (error) {
          if (!(error instanceof Invalid) && !(error instanceof RangeError)) throw error;
          result = { status: "invalid" };
        }
      }
      this.#cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, result });
      return result;
    } catch {
      this.#cache.delete(path);
      return { status: "unreadable" };
    } finally { closeSync(fd); }
  }
}

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
