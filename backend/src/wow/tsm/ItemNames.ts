import { inflateRawSync } from "node:zlib";
import { SequenceEvents } from "cbor2/decoder";
import type { LuaTable, LuaValue } from "./SavedVariables";

const FIELDS_PER_ITEM = 15;
const CBOR_ARRAY = 4;
const CBOR_MAP = 5;
const CBOR_TAG = 6;
const CBOR_SIMPLE = 7;
const CBOR_INDEFINITE = 31;
// Leave room for large item libraries while bounding synchronous parsing.
const MAX_ITEM_FIELDS = 100_000 * FIELDS_PER_ITEM;
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
    const values = new SequenceEvents(inflate(data), { maxDepth: 2 });
    const root = values.read();
    if (!root || root[0] !== CBOR_ARRAY) return null;
    const length = Number(root[2]);
    const indefinite = root[1] === CBOR_INDEFINITE;
    if (!indefinite && (length > MAX_ITEM_FIELDS || length % FIELDS_PER_ITEM !== 0)) return null;

    const names = new Map<string, string>();
    let itemString: string | null = null;
    let index = 0;
    for (; index < length; index++) {
      const entry = values.read();
      if (!entry) return null;
      const [type, info, value] = entry;
      if (indefinite && type === CBOR_SIMPLE && info === CBOR_INDEFINITE) break;
      if (index >= MAX_ITEM_FIELDS || info === CBOR_INDEFINITE ||
          type === CBOR_ARRAY || type === CBOR_MAP || type === CBOR_TAG) return null;

      const field = index % FIELDS_PER_ITEM;
      if (field === 0) itemString = text(value);
      if (field === 1 && itemString) {
        const name = text(value);
        if (name) names.set(itemString, name);
      }
    }
    if (index % FIELDS_PER_ITEM !== 0 || values.read()) return null;
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

function legacyNames(cache: LuaTable, joined: boolean): Map<string, string> {
  const names = new Map<string, string>();
  try {
    let nameChunks = legacyChunks(cache.names);
    let itemChunks = legacyChunks(cache.itemStrings);
    // Nested data uses LongString, whose chunks can split a name or ID.
    if (joined) {
      nameChunks = [nameChunks.join("")];
      itemChunks = [itemChunks.join("")];
    }
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
      ?? (typeof data === "object" ? legacyNames(data, true) : legacyNames(cache, false));
    indexes.set(cache, names);
  }
  const base = itemString.split(":", 2).join(":");
  return names.get(itemString) ?? names.get(base);
}
