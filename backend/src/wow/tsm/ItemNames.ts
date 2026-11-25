import { inflateRawSync } from "node:zlib";
import { SequenceEvents } from "cbor2/decoder";
import type { LuaTable, LuaValue } from "./SavedVariables";

/**
 * The addon's current cache stores these fields per item, in this order:
 * itemString, name, itemLevel, minLevel, maxStack, vendorSell, invSlotId,
 * texture, classId, subClassId, quality, isBOP, isCraftingReagent,
 * expansionId, craftedQuality (spec #323).
 */
const FIELDS_PER_ITEM = 15;
const NAME_FIELD = 1;
const QUALITY_FIELD = 10;
/** WoW's qualities: 0 Poor … 8 WoW Token. */
const MAX_QUALITY = 8;
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

/** What the cache says about one item. Only named entries are kept. */
interface CachedItem {
  name: string;
  quality: number | null;
}

const qualityOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_QUALITY ? value : null;

function currentItems(data: string): Map<string, CachedItem> | null {
  try {
    const values = new SequenceEvents(inflate(data), { maxDepth: 2 });
    const root = values.read();
    if (!root || root[0] !== CBOR_ARRAY) return null;
    const length = Number(root[2]);
    const indefinite = root[1] === CBOR_INDEFINITE;
    if (!indefinite && (length > MAX_ITEM_FIELDS || length % FIELDS_PER_ITEM !== 0)) return null;

    const items = new Map<string, CachedItem>();
    let itemString: string | null = null;
    let item: CachedItem | null = null;
    let index = 0;
    for (; index < length; index++) {
      const entry = values.read();
      if (!entry) return null;
      const [type, info, value] = entry;
      if (indefinite && type === CBOR_SIMPLE && info === CBOR_INDEFINITE) break;
      if (index >= MAX_ITEM_FIELDS || info === CBOR_INDEFINITE ||
          type === CBOR_ARRAY || type === CBOR_MAP || type === CBOR_TAG) return null;

      const field = index % FIELDS_PER_ITEM;
      if (field === 0) {
        itemString = text(value);
        item = null;
      }
      if (field === NAME_FIELD && itemString) {
        const name = text(value);
        if (name) {
          item = { name, quality: null };
          items.set(itemString, item);
        }
      }
      if (field === QUALITY_FIELD && item) item.quality = qualityOf(value);
    }
    if (index % FIELDS_PER_ITEM !== 0 || values.read()) return null;
    return items;
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

/** The older lists store names only: no quality. */
function legacyItems(cache: LuaTable, joined: boolean): Map<string, CachedItem> {
  const items = new Map<string, CachedItem>();
  try {
    let nameChunks = legacyChunks(cache.names);
    let itemChunks = legacyChunks(cache.itemStrings);
    // Nested data uses LongString, whose chunks can split a name or ID.
    if (joined) {
      nameChunks = [nameChunks.join("")];
      itemChunks = [itemChunks.join("")];
    }
    if (nameChunks.length !== itemChunks.length) return items;
    for (const [index, chunk] of itemChunks.entries()) {
      const itemStrings = chunk.split(SEPARATOR);
      const labels = nameChunks[index]!.split(SEPARATOR);
      if (itemStrings.length !== labels.length) continue;
      for (const [position, itemString] of itemStrings.entries()) {
        const name = labels[position]!;
        if (itemString && name) items.set(itemString, { name, quality: null });
      }
    }
  } catch {
    // The legacy lists are optional too.
  }
  return items;
}

// Use the same lifetime as the parsed SavedVariables table. A logout or
// reload that rewrites the file gives the reader a new table.
const indexes = new WeakMap<LuaTable, ReadonlyMap<string, CachedItem>>();

/** The cache's entry for the full item string, else for its base item. */
function cachedItem(cache: LuaTable, itemString: string): CachedItem | undefined {
  let items = indexes.get(cache);
  if (!items) {
    const data = cache.data;
    items = (typeof data === "string" ? currentItems(data) : null)
      ?? (typeof data === "object" ? legacyItems(data, true) : legacyItems(cache, false));
    indexes.set(cache, items);
  }
  const base = itemString.split(":", 2).join(":");
  return items.get(itemString) ?? items.get(base);
}

export function ledgerItemName(cache: LuaTable, itemString: string): string | undefined {
  return cachedItem(cache, itemString)?.name;
}

/**
 * An item's quality as the addon reads it: a battle pet's from its item
 * string (`p:species:level:quality:…`), else the cache's. Null when unknown.
 */
export function ledgerItemQuality(cache: LuaTable | null, itemString: string): number | null {
  const pet = /^p:\d+:\d+:(\d+)/.exec(itemString)?.[1];
  if (pet !== undefined) {
    const quality = qualityOf(Number(pet));
    if (quality !== null) return quality;
  }
  return (cache && cachedItem(cache, itemString)?.quality) ?? null;
}
