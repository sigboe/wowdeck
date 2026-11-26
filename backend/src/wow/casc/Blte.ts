/**
 * BLTE, the container every file in WoW's local storage is kept in
 * (project-owned). The layout follows wow.export's `blte-reader.js`
 * (MIT, Kruithne/wow.export at 81cc25e4).
 *
 * A file is split into chunks, each stored raw (`N`) or zlib-compressed
 * (`Z`). Chunks are decoded only when a read reaches them, so a lookup in a
 * large table (the encoding file) inflates only the chunks it touches.
 * Encrypted (`E`), recursive (`F`) and LZ4 (`4`) chunks read as missing:
 * nothing WoWDeck shows needs them. Game files are data: every length is
 * checked, and a malformed file reads as missing.
 */
import { inflateSync } from "node:zlib";

const MAGIC = 0x424c5445; // "BLTE"

interface Chunk {
  /** Where the chunk's stored bytes start in the BLTE data, and how many. */
  start: number;
  stored: number;
  /** Where its decoded bytes start in the file, and how many (-1: unknown, one chunk only). */
  offset: number;
  size: number;
}

/** A BLTE file's decoded bytes, read on demand. */
export class BlteFile {
  readonly #data: Uint8Array;
  readonly #chunks: Chunk[];
  /** The decoded size, or -1 until the only chunk of a headerless file is decoded. */
  #size: number;
  /** The last chunk decoded: reads run in order, so one is enough. */
  #last: { index: number; bytes: Uint8Array } | null = null;

  private constructor(data: Uint8Array, chunks: Chunk[], size: number) {
    this.#data = data;
    this.#chunks = chunks;
    this.#size = size;
  }

  /** The file in `data`, or null when it is not BLTE or its chunk table is broken. */
  static parse(data: Uint8Array): BlteFile | null {
    if (data.length < 8) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0) !== MAGIC) return null;
    const headerSize = view.getUint32(4);
    if (headerSize === 0) {
      return new BlteFile(data, [{ start: 8, stored: data.length - 8, offset: 0, size: -1 }], -1);
    }
    if (headerSize < 12 || headerSize > data.length) return null;
    const count = view.getUint32(8) & 0xffffff;
    if (view.getUint8(8) !== 0x0f || 12 + count * 24 > headerSize) return null;
    const chunks: Chunk[] = [];
    let start = headerSize;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const stored = view.getUint32(12 + i * 24);
      const size = view.getUint32(16 + i * 24);
      if (stored < 1 || start + stored > data.length) return null;
      chunks.push({ start, stored, offset, size });
      start += stored;
      offset += size;
    }
    return new BlteFile(data, chunks, offset);
  }

  /** The decoded size; null when the file cannot be decoded. */
  get size(): number | null {
    if (this.#size < 0) this.#chunk(0);
    return this.#size < 0 ? null : this.#size;
  }

  /** The whole file decoded, or null. */
  all(): Uint8Array | null {
    const size = this.size;
    return size === null ? null : this.read(0, size);
  }

  /** `length` decoded bytes from `offset`, or null when they cannot be decoded. */
  read(offset: number, length: number): Uint8Array | null {
    const size = this.size;
    if (size === null || offset < 0 || length < 0 || offset + length > size) return null;
    let index = this.#find(offset);
    const first = this.#chunk(index);
    if (!first) return null;
    const chunk = this.#chunks[index]!;
    const at = offset - chunk.offset;
    if (at + length <= first.length) return first.subarray(at, at + length);
    // The range spans chunks: copy them together.
    const out = new Uint8Array(length);
    out.set(first.subarray(at), 0);
    let filled = first.length - at;
    while (filled < length) {
      const next = this.#chunk(++index);
      if (!next) return null;
      const take = Math.min(next.length, length - filled);
      out.set(next.subarray(0, take), filled);
      filled += take;
    }
    return out;
  }

  /** The chunk holding decoded `offset` (binary search). */
  #find(offset: number): number {
    let lo = 0;
    let hi = this.#chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#chunks[mid]!.offset <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  #chunk(index: number): Uint8Array | null {
    if (this.#last?.index === index) return this.#last.bytes;
    const chunk = this.#chunks[index];
    if (!chunk) return null;
    const bytes = decodeChunk(this.#data.subarray(chunk.start, chunk.start + chunk.stored), chunk.size);
    if (!bytes) return null;
    if (chunk.size < 0) {
      chunk.size = bytes.length;
      this.#size = bytes.length;
    }
    this.#last = { index, bytes };
    return bytes;
  }
}

/** One chunk's bytes: its mode byte, then the data. `size` < 0 means unknown. */
function decodeChunk(stored: Uint8Array, size: number): Uint8Array | null {
  const mode = stored[0];
  const body = stored.subarray(1);
  let bytes: Uint8Array;
  if (mode === 0x4e /* N */) {
    bytes = body;
  } else if (mode === 0x5a /* Z */) {
    try {
      // The cap keeps a malformed size field from inflating without bound.
      bytes = inflateSync(body, size >= 0 ? { maxOutputLength: Math.max(size, 1) } : { maxOutputLength: MAX_UNSIZED });
    } catch {
      return null;
    }
  } else {
    return null;
  }
  return size < 0 || bytes.length === size ? bytes : null;
}

/** A headerless file is one small chunk; the cap guards against junk. */
const MAX_UNSIZED = 64 * 1024 * 1024;
