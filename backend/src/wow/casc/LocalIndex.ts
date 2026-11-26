/**
 * The local index (`Data/data/<bucket><version>.idx`): encoded key → where
 * the file sits in the `data.NNN` archives. Project-owned; the layout
 * follows wow.export's `casc-source-local.js` (MIT, Kruithne/wow.export at
 * 81cc25e4).
 *
 * The keys are split over 16 buckets, each in its own file; a bucket can
 * have older versions beside the newest, which are stale. wow.export reads
 * every `.idx` and lets the first win; this reads only the newest of each
 * bucket. A lookup scans those for a set of asked keys and keeps only their
 * places: the files are a few MB each, and nothing stays in memory.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Where an encoded file sits: archive `data.<archive>`, its record's offset and size. */
export interface Location {
  archive: number;
  offset: number;
  size: number;
}

/** The index stores the first 9 bytes of each encoded key. */
export const INDEX_KEY_BYTES = 9;
const ENTRY = 18;
const INDEX_NAME = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i;
/** Far above a real bucket file (about 1.4 MB on a 2026 install); guards against junk. */
const MAX_INDEX_BYTES = 256 * 1024 * 1024;

/** The newest index file of each bucket in `dir`. */
async function newestIndexFiles(dir: string): Promise<string[]> {
  const newest = new Map<string, { name: string; version: number }>();
  for (const name of await readdir(dir)) {
    const match = INDEX_NAME.exec(name);
    if (!match) continue;
    const bucket = match[1]!.toLowerCase();
    const version = Number.parseInt(match[2]!, 16);
    if ((newest.get(bucket)?.version ?? -1) < version) newest.set(bucket, { name, version });
  }
  return [...newest.values()].map((file) => join(dir, file.name));
}

/** A 9-byte key prefix as one exact number for the first 6 bytes, then the rest. */
const head = (bytes: Uint8Array, at: number) =>
  bytes[at]! * 2 ** 40 + bytes[at + 1]! * 2 ** 32 + ((bytes[at + 2]! << 24) >>> 0) + (bytes[at + 3]! << 16) + (bytes[at + 4]! << 8) + bytes[at + 5]!;

/**
 * The places of the asked encoded keys found in `dir`'s index, keyed by the
 * hex of their first 9 bytes.
 */
export async function locate(dir: string, encodedKeys: readonly Uint8Array[]): Promise<Map<string, Location>> {
  const found = new Map<string, Location>();
  // Asked keys by their first 6 bytes; the last 3 confirm a match.
  const wanted = new Map<number, Uint8Array[]>();
  for (const key of encodedKeys) {
    if (key.length < INDEX_KEY_BYTES) continue;
    const h = head(key, 0);
    const list = wanted.get(h);
    if (list) list.push(key);
    else wanted.set(h, [key]);
  }
  if (wanted.size === 0) return found;

  for (const path of await newestIndexFiles(dir)) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch {
      continue;
    }
    if (bytes.length > MAX_INDEX_BYTES) continue;
    for (const [key, location] of scanIndex(bytes, wanted)) if (!found.has(key)) found.set(key, location);
    if (found.size === encodedKeys.length) break;
  }
  return found;
}

/** The asked keys' places in one index file, or none when its header is not the known layout. */
function scanIndex(bytes: Uint8Array, wanted: ReadonlyMap<number, Uint8Array[]>): Map<string, Location> {
  const found = new Map<string, Location>();
  if (bytes.length < 8) return found;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(0, true);
  // version u16, bucket, extra bytes, then the field sizes and the offset bits.
  if (headerSize < 8 || 8 + headerSize > bytes.length) return found;
  const sizeBytes = bytes[12];
  const offsetBytes = bytes[13];
  const keyBytes = bytes[14];
  const offsetBits = bytes[15]!;
  if (sizeBytes !== 4 || offsetBytes !== 5 || keyBytes !== INDEX_KEY_BYTES || offsetBits < 1 || offsetBits > 39) return found;
  const entriesAt = (8 + headerSize + 0x0f) & ~0x0f;
  if (entriesAt + 8 > bytes.length) return found;
  const entriesSize = view.getUint32(entriesAt, true);
  const first = entriesAt + 8;
  const end = Math.min(first + entriesSize, bytes.length);
  const archiveUnit = 2 ** offsetBits;

  for (let at = first; at + ENTRY <= end; at += ENTRY) {
    const candidates = wanted.get(head(bytes, at));
    if (!candidates) continue;
    const key = candidates.find((c) => c[6] === bytes[at + 6] && c[7] === bytes[at + 7] && c[8] === bytes[at + 8]);
    if (!key) continue;
    const id = Buffer.from(bytes.buffer, bytes.byteOffset + at, INDEX_KEY_BYTES).toString("hex");
    if (found.has(id)) continue;
    // 40 bits, big-endian: the archive number above `offsetBits`, the offset below.
    const packed = bytes[at + 9]! * 2 ** 32 + view.getUint32(at + 10);
    found.set(id, {
      archive: Math.floor(packed / archiveUnit),
      offset: packed % archiveUnit,
      size: view.getUint32(at + 14, true),
    });
  }
  return found;
}
