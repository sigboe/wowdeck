/**
 * Reads files by FileDataID from a Battle.net WoW install's local storage
 * (`<WoW root>/Data`), for one build. Project-owned; the formats follow
 * wow.export (MIT, Kruithne/wow.export at 81cc25e4), see `Blte.ts`,
 * `LocalIndex.ts`, `Encoding.ts` and `Root.ts`.
 *
 * Nothing is written to disk. A lookup resolves a set of IDs in one pass:
 * root (ID → content key), encoding (→ encoded key), then the local index
 * (→ archive, offset, size). Only those places stay in memory, as long as
 * the build does: after that each file is one read of its record. Game
 * files are data, never run; every lookup or read that fails reads as
 * missing.
 */
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BlteFile } from "./Blte";
import { encodedKeys } from "./Encoding";
import { fromHex, hex } from "./keys";
import { INDEX_KEY_BYTES, locate, type Location } from "./LocalIndex";
import { contentKeys } from "./Root";

/** An archive record starts with a 30-byte header: the reversed key, size, flags, checksums. */
const RECORD_HEADER = 0x1e;
/** Far above any root or encoding file; guards against junk sizes. */
const MAX_RECORD_BYTES = 512 * 1024 * 1024;

interface BuildConfig {
  root: Uint8Array;
  encoding: Uint8Array;
}

/** The root and encoding keys from a build config: `name = value` lines. */
export function parseBuildConfig(text: string): BuildConfig | null {
  const values = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([\w-]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) values.set(match[1]!, match[2]!.trim().split(/\s+/));
  }
  const root = fromHex(values.get("root")?.[0] ?? "");
  // `encoding = <content key> <encoded key>`: the file is read by its encoded key.
  const encoding = fromHex(values.get("encoding")?.[1] ?? "");
  return root && encoding ? { root, encoding } : null;
}

export class CascStorage {
  readonly buildKey: string;
  readonly #data: string;
  readonly #config: BuildConfig;
  /** Each FileDataID looked up so far: its place, or null when the build has none. */
  readonly #places = new Map<number, Location | null>();
  /** The root's encoded key, once encoding gave it. */
  #rootKey: Uint8Array | null = null;
  /** Where the encoding and root files sit: fixed for the build, so one index scan each. */
  readonly #tablePlaces = new Map<string, Location>();
  /** Lookups run one at a time: a second one finds the first one's answers. */
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(dataDir: string, buildKey: string, config: BuildConfig) {
    this.#data = dataDir;
    this.buildKey = buildKey;
    this.#config = config;
  }

  /** The storage of `wowRoot` for build `buildKey` (`.build.info`), or null without one. */
  static async open(wowRoot: string, buildKey: string): Promise<CascStorage | null> {
    if (!/^[0-9a-f]{32}$/i.test(buildKey)) return null;
    const key = buildKey.toLowerCase();
    const dataDir = join(wowRoot, "Data");
    try {
      const text = await readFile(join(dataDir, "config", key.slice(0, 2), key.slice(2, 4), key), "utf8");
      const config = parseBuildConfig(text);
      return config ? new CascStorage(dataDir, key, config) : null;
    } catch {
      return null;
    }
  }

  /**
   * The places of `fileIds`, resolving every ID not seen yet in one pass.
   * `alsoLikely` adds IDs the caller will probably ask for next (the rest of
   * a list), so later pages need no pass of their own.
   */
  locate(fileIds: readonly number[], alsoLikely: () => Iterable<number> = () => []): Promise<Map<number, Location | null>> {
    const run = this.#queue.then(() => this.#locate(fileIds, alsoLikely));
    this.#queue = run.catch(() => {});
    return run;
  }

  /** The decoded bytes of `fileId`, or null when the build has no readable copy. */
  async read(fileId: number): Promise<Uint8Array | null> {
    const place = (await this.locate([fileId])).get(fileId);
    if (!place) return null;
    const file = await this.#record(place);
    return file?.all() ?? null;
  }

  async #locate(fileIds: readonly number[], alsoLikely: () => Iterable<number>): Promise<Map<number, Location | null>> {
    const valid = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff;
    const missing = new Set(fileIds.filter((id) => valid(id) && !this.#places.has(id)));
    if (missing.size > 0) {
      for (const id of alsoLikely()) if (valid(id) && !this.#places.has(id)) missing.add(id);
      await this.#resolve(missing);
    }
    return new Map(fileIds.map((id) => [id, this.#places.get(id) ?? null]));
  }

  /** One pass for `ids`: every one ends with a place or null. */
  async #resolve(ids: Set<number>): Promise<void> {
    const found = new Map<number, Location>();
    try {
      const encoding = await this.#file(this.#config.encoding);
      if (encoding) {
        this.#rootKey ??= encodedKeys(encoding, [this.#config.root]).get(hex(this.#config.root)) ?? null;
        const root = this.#rootKey && await this.#file(this.#rootKey);
        if (root) {
          const ckeys = contentKeys(root, ids);
          const ekeys = encodedKeys(encoding, [...ckeys.values()]);
          const byIndexKey = new Map<string, number[]>();
          for (const [id, ckey] of ckeys) {
            const ekey = ekeys.get(hex(ckey));
            if (!ekey) continue;
            const indexKey = hex(ekey.subarray(0, INDEX_KEY_BYTES));
            const list = byIndexKey.get(indexKey);
            if (list) list.push(id);
            else byIndexKey.set(indexKey, [id]);
          }
          const places = await locate(join(this.#data, "data"), [...byIndexKey.keys()].map((k) => fromHex(k)!));
          for (const [indexKey, place] of places) for (const id of byIndexKey.get(indexKey) ?? []) found.set(id, place);
        }
      }
    } catch (error) {
      console.error("[casc] lookup failed:", error instanceof Error ? error.message : String(error));
    }
    for (const id of ids) this.#places.set(id, found.get(id) ?? null);
  }

  /** The encoding or root file, read by its encoded key through the index. */
  async #file(encodedKey: Uint8Array): Promise<BlteFile | null> {
    const key = hex(encodedKey.subarray(0, INDEX_KEY_BYTES));
    let place = this.#tablePlaces.get(key);
    if (!place) {
      place = (await locate(join(this.#data, "data"), [encodedKey])).get(key);
      if (place) this.#tablePlaces.set(key, place);
    }
    return place ? this.#record(place) : null;
  }

  /** The BLTE file of one archive record. */
  async #record(place: Location): Promise<BlteFile | null> {
    const length = place.size - RECORD_HEADER;
    if (length < 8 || length > MAX_RECORD_BYTES) return null;
    const name = `data.${String(place.archive).padStart(3, "0")}`;
    let handle;
    try {
      handle = await open(join(this.#data, "data", name), "r");
      const bytes = new Uint8Array(length);
      const { bytesRead } = await handle.read(bytes, 0, length, place.offset + RECORD_HEADER);
      return bytesRead === length ? BlteFile.parse(bytes) : null;
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }
}
