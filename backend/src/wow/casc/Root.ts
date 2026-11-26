/**
 * The root file: FileDataID → content key. Project-owned; the layout
 * follows wow.export's `parseRootFile` (MIT, Kruithne/wow.export at
 * 81cc25e4): the `TSFM` header of 8.2 and later (versions 0 to 2) and the
 * headerless Classic layout before it.
 *
 * The file lists every file of the game, a few million, in blocks that
 * share a locale and content flags. A lookup streams it once for a set of
 * asked IDs and keeps only their keys, so memory stays at one BLTE chunk
 * plus the answer. wow.export keeps the whole table.
 */
import type { BlteFile } from "./Blte";

const MAGIC = 0x4d465354; // "TSFM" on disk
const LOCALE_EN_US = 0x2;
const LOW_VIOLENCE = 0x80;
const NO_NAME_HASH = 0x10000000;

/**
 * The content key of each asked FileDataID, from an enUS block without the
 * low-violence flag. Icons are the same in every locale; enUS is in every
 * install's all-locale blocks.
 */
export function contentKeys(file: BlteFile, fileIds: ReadonlySet<number>): Map<number, Uint8Array> {
  const found = new Map<number, Uint8Array>();
  const size = file.size;
  if (size === null || fileIds.size === 0) return found;
  const u32 = (offset: number) => {
    const bytes = file.read(offset, 4);
    return bytes ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) : null;
  };

  let at = 0;
  let version = -1; // -1: headerless Classic layout
  let namelessAllowed = false;
  if (u32(0) === MAGIC) {
    const headerSize = u32(4);
    const second = u32(8);
    if (headerSize === null || second === null) return found;
    if (headerSize === 0x18) {
      // 10.1.7 and later: size, version, then the file counts.
      version = second;
      if (version !== 1 && version !== 2) return found;
      const total = u32(12);
      const named = u32(16);
      if (total === null || named === null) return found;
      namelessAllowed = total !== named;
      at = headerSize;
    } else {
      // 8.2: the counts come straight after the magic.
      version = 0;
      namelessAllowed = headerSize !== second;
      at = 12;
    }
  }

  const blockHeader = version === 2 ? 17 : 12;
  while (at + blockHeader <= size && found.size < fileIds.size) {
    const header = file.read(at, blockHeader);
    if (!header) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const count = view.getUint32(0, true);
    let contentFlags: number;
    let localeFlags: number;
    if (version === 2) {
      localeFlags = view.getUint32(4, true);
      contentFlags = view.getUint32(8, true) | view.getUint32(12, true) | (view.getUint8(16) << 17);
    } else {
      contentFlags = view.getUint32(4, true);
      localeFlags = view.getUint32(8, true);
    }
    at += blockHeader;

    const nameHashes = version >= 0 && namelessAllowed && (contentFlags & NO_NAME_HASH) !== 0 ? 0 : 8;
    // Modern blocks hold all keys, then all name hashes; Classic interleaves them.
    const keyStride = version >= 0 ? 16 : 24;
    const blockSize = count * 4 + count * 16 + count * nameHashes;
    if (count === 0 || at + blockSize > size) {
      if (count === 0) continue;
      break;
    }
    const usable = (localeFlags & LOCALE_EN_US) !== 0 && (contentFlags & LOW_VIOLENCE) === 0;
    if (!usable) {
      at += blockSize;
      continue;
    }

    const deltas = file.read(at, count * 4);
    if (!deltas) break;
    const ids = new DataView(deltas.buffer, deltas.byteOffset, deltas.byteLength);
    const keysAt = at + count * 4;
    let id = 0;
    const hits: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      id += ids.getInt32(i * 4, true);
      if (fileIds.has(id) && !found.has(id)) hits.push([id, i]);
      id += 1;
    }
    if (hits.length > 0) {
      const keys = file.read(keysAt, count * keyStride);
      if (!keys) break;
      for (const [fileId, i] of hits) found.set(fileId, keys.slice(i * keyStride, i * keyStride + 16));
    }
    at += blockSize;
  }
  return found;
}
