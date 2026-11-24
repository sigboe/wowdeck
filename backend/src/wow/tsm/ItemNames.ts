import { inflateRawSync } from "node:zlib";
import { decode } from "cbor2/decoder";
import type { LuaTable, LuaValue } from "./SavedVariables";

const FIELDS_PER_ITEM = 15;
const SEPARATOR = "\x02";
// One account's item metadata is much smaller than its accounting records.
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function inflate(data: string): Buffer {
  const bytes = Uint8Array.fromBase64(data);
  return inflateRawSync(bytes, { maxOutputLength: MAX_CACHE_BYTES });
}

const text = (value: unknown) =>
  value instanceof Uint8Array ? utf8.decode(value) : typeof value === "string" ? value : null;

function currentNames(data: string): Map<string, string> | null {
  try {
    const rows: unknown = decode(inflate(data), { maxDepth: 2, preferMap: true, ignoreGlobalTags: true });
    if (!Array.isArray(rows) || rows.length % FIELDS_PER_ITEM !== 0) return null;
    const names = new Map<string, string>();
    for (let index = 0; index < rows.length; index += FIELDS_PER_ITEM) {
      const itemString = text(rows[index]);
      const name = text(rows[index + 1]);
      if (!itemString || !name) return null;
      names.set(itemString, name);
    }
    return names;
  } catch {
    // An unreadable cache can still sit beside valid accounting records.
    return null;
  }
}

function legacyChunks(value: LuaValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];

  const chunks: string[] = [];
  for (let index = 1; typeof value[index] === "string"; index++) {
    chunks.push(value[index] as string);
  }
  // Older chunks contain complete lists. LongString's compressed chunks
  // instead split one base64 stream across several SavedVariables strings.
  return value.compressed === true ? [utf8.decode(inflate(chunks.join("")))] : chunks;
}

function legacyNames(cache: LuaTable): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const nameChunks = legacyChunks(cache.names);
    const itemChunks = legacyChunks(cache.itemStrings);
    if (nameChunks.length !== itemChunks.length) return names;
    for (const [index, chunk] of itemChunks.entries()) {
      const itemStrings = chunk.split(SEPARATOR);
      const labels = nameChunks[index]!.split(SEPARATOR);
      if (itemStrings.length !== labels.length) continue;
      for (const [position, itemString] of itemStrings.entries()) {
        const name = labels[position]!;
        if (itemString && name) names.set(itemString, name);
      }
    }
  } catch {
    // The legacy lists are optional too.
  }
  return names;
}

// Use the same lifetime as the parsed SavedVariables table. A logout or
// reload that rewrites the file gives the reader a new table.
const indexes = new WeakMap<LuaTable, ReadonlyMap<string, string>>();

export function ledgerItemName(cache: LuaTable, itemString: string): string | undefined {
  let names = indexes.get(cache);
  if (!names) {
    const data = cache.data;
    names = (typeof data === "string" ? currentNames(data) : null)
      ?? legacyNames(typeof data === "object" ? data : cache);
    indexes.set(cache, names);
  }
  const base = itemString.split(":", 2).join(":");
  return names.get(itemString) ?? names.get(base);
}
