/**
 * The encoding file: content key (the hash of a file's bytes) → encoded key
 * (the key its BLTE copy is stored under). Project-owned; the layout follows
 * wow.export's `parseEncodingFile` (MIT, Kruithne/wow.export at 81cc25e4).
 *
 * Its pages are sorted by content key and a page index lists each page's
 * first key, so a lookup reads the index, then only the pages holding the
 * asked keys. wow.export reads every page.
 */
import type { BlteFile } from "./Blte";
import { compareKeys, hex } from "./keys";

const MAGIC = 0x454e; // "EN"
const HEADER = 22;

/** The encoded key of each asked content key the file lists, keyed by the content key's hex. */
export function encodedKeys(file: BlteFile, contentKeys: readonly Uint8Array[]): Map<string, Uint8Array> {
  const found = new Map<string, Uint8Array>();
  const header = file.read(0, HEADER);
  if (!header || contentKeys.length === 0) return found;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint16(0) !== MAGIC || view.getUint8(2) !== 1) return found;
  const ckeySize = view.getUint8(3);
  const ekeySize = view.getUint8(4);
  const pageSize = view.getUint16(5) * 1024;
  const pageCount = view.getUint32(9);
  const specSize = view.getUint32(18);
  if (ckeySize < 1 || ekeySize < 1 || pageSize < 1) return found;

  const indexStart = HEADER + specSize;
  const indexEntry = ckeySize + 16; // first key, then the page's MD5
  const index = file.read(indexStart, pageCount * indexEntry);
  if (!index) return found;
  const pagesStart = indexStart + pageCount * indexEntry;
  const firstKey = (page: number) => index.subarray(page * indexEntry, page * indexEntry + ckeySize);

  // Each asked key belongs to the last page whose first key is not above it.
  const byPage = new Map<number, Uint8Array[]>();
  for (const key of contentKeys) {
    if (key.length !== ckeySize) continue;
    let lo = 0;
    let hi = pageCount - 1;
    if (hi < 0 || compareKeys(firstKey(0), key) > 0) continue;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (compareKeys(firstKey(mid), key) <= 0) lo = mid;
      else hi = mid - 1;
    }
    const keys = byPage.get(lo);
    if (keys) keys.push(key);
    else byPage.set(lo, [key]);
  }

  // Pages in file order, so BLTE decodes each chunk once.
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const bytes = file.read(pagesStart + page * pageSize, pageSize);
    if (!bytes) continue;
    const wanted = new Set(byPage.get(page)!.map(hex));
    for (let at = 0; at + 6 + ckeySize <= bytes.length && wanted.size > 0;) {
      const keyCount = bytes[at]!;
      if (keyCount === 0) break; // the rest of the page is padding
      const entry = 6 + ckeySize + keyCount * ekeySize;
      if (at + entry > bytes.length) break;
      const ckey = hex(bytes.subarray(at + 6, at + 6 + ckeySize));
      if (wanted.delete(ckey)) {
        const ekeyAt = at + 6 + ckeySize;
        found.set(ckey, bytes.slice(ekeyAt, ekeyAt + ekeySize));
      }
      at += entry;
    }
  }
  return found;
}
