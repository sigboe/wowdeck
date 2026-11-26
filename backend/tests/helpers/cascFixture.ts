/**
 * A tiny Battle.net install for tests: `.build.info`, a flavor folder, a
 * build config, local index buckets, one `data.000` archive, an encoding
 * file and a root file, all written from scratch. No game file is copied.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const md5 = (bytes: Uint8Array) => Uint8Array.from(createHash("md5").update(bytes).digest());
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** One BLTE chunk: `N` raw, `Z` zlib, `E` encrypted (opaque bytes). */
export type ChunkMode = "N" | "Z" | "E";

/** `data` as BLTE, split into `chunks` chunks of `mode`. */
export function blte(data: Uint8Array, mode: ChunkMode = "Z", chunks = 1): Uint8Array {
  const parts: { stored: Uint8Array; size: number }[] = [];
  const step = Math.ceil(data.length / chunks) || 1;
  for (let at = 0; at < Math.max(data.length, 1); at += step) {
    const slice = data.subarray(at, at + step);
    const body = mode === "Z" ? deflateSync(slice) : slice;
    parts.push({ stored: Uint8Array.of(mode.charCodeAt(0), ...body), size: slice.length });
  }
  const headerSize = 12 + parts.length * 24;
  const out = new Uint8Array(headerSize + parts.reduce((n, p) => n + p.stored.length, 0));
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4c, 0x54, 0x45]);
  view.setUint32(4, headerSize);
  view.setUint32(8, (0x0f << 24) | parts.length);
  let at = headerSize;
  parts.forEach((part, i) => {
    view.setUint32(12 + i * 24, part.stored.length);
    view.setUint32(16 + i * 24, part.size);
    out.set(md5(part.stored), 20 + i * 24);
    out.set(part.stored, at);
    at += part.stored.length;
  });
  return out;
}

/** An encoding file: sorted pages of `pageKb` KiB, with a page index. */
function encodingFile(entries: { ckey: Uint8Array; ekey: Uint8Array; size: number }[], pageKb: number): Uint8Array {
  const sorted = [...entries].sort((a, b) => Buffer.compare(a.ckey, b.ckey));
  const pageSize = pageKb * 1024;
  const pages: Uint8Array[] = [];
  let page = new Uint8Array(pageSize);
  let at = 0;
  const firstKeys: Uint8Array[] = [];
  for (const entry of sorted) {
    if (at + 38 > pageSize) {
      pages.push(page);
      page = new Uint8Array(pageSize);
      at = 0;
    }
    if (at === 0) firstKeys.push(entry.ckey);
    page[at] = 1;
    new DataView(page.buffer).setUint32(at + 2, entry.size);
    page.set(entry.ckey, at + 6);
    page.set(entry.ekey, at + 22);
    at += 38;
  }
  pages.push(page);
  const spec = new TextEncoder().encode("z\0");
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  header.set([0x45, 0x4e, 1, 16, 16]);
  view.setUint16(5, pageKb);
  view.setUint16(7, 4);
  view.setUint32(9, pages.length);
  view.setUint32(13, 0);
  view.setUint32(18, spec.length);
  const index = new Uint8Array(pages.length * 32);
  firstKeys.forEach((key, i) => {
    index.set(key, i * 32);
    index.set(md5(pages[i]!), i * 32 + 16);
  });
  return Buffer.concat([header, spec, index, ...pages]);
}

/** A root block: its flags, then `[fileId, content key]` pairs in ID order. */
export interface RootBlock {
  locale: number;
  content?: number;
  files: [number, Uint8Array][];
}

/** A version-2 `TSFM` root without name hashes. */
function rootFile(blocks: RootBlock[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const total = blocks.reduce((n, b) => n + b.files.length, 0);
  const header = new Uint8Array(24);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, 0x4d465354, true);
  hv.setUint32(4, 24, true);
  hv.setUint32(8, 2, true);
  hv.setUint32(12, total, true);
  hv.setUint32(16, 0, true);
  parts.push(header);
  for (const block of blocks) {
    const n = block.files.length;
    const bytes = new Uint8Array(17 + n * 20);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, n, true);
    v.setUint32(4, block.locale, true);
    v.setUint32(8, (block.content ?? 0) | 0x10000000, true);
    let previous = -1;
    block.files.forEach(([id, ckey], i) => {
      v.setInt32(17 + i * 4, id - previous - 1, true);
      previous = id;
      bytes.set(ckey, 17 + n * 4 + i * 16);
    });
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

export interface CascFixtureFile {
  id: number;
  bytes: Uint8Array;
  mode?: ChunkMode;
}

/**
 * Write an install under `root` whose `flavor` folder lists `files`, and
 * answer the build key. `extraRoot` adds blocks (another locale, low
 * violence) ahead of the enUS one.
 */
export function writeCascFixture(root: string, files: CascFixtureFile[], options: {
  flavor?: string;
  product?: string;
  extraRoot?: RootBlock[];
  /** Content keys the encoding file lists beyond the real files, to fill several pages. */
  fillerKeys?: number;
} = {}): { buildKey: string; flavorDir: string } {
  const flavor = options.flavor ?? "_classic_era_";
  const product = options.product ?? "wow_classic_era";
  const flavorDir = join(root, flavor);
  const dataDir = join(root, "Data", "data");
  mkdirSync(flavorDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const archive: Uint8Array[] = [];
  let archiveSize = 0;
  const indexEntries: { ekey: Uint8Array; offset: number; size: number }[] = [];
  const encodingEntries: { ckey: Uint8Array; ekey: Uint8Array; size: number }[] = [];
  /** Store bytes as BLTE in the archive; answer its keys. */
  const store = (bytes: Uint8Array, mode: ChunkMode, chunks = 1) => {
    const encoded = blte(bytes, mode, chunks);
    const ckey = md5(bytes);
    const ekey = md5(encoded);
    const record = new Uint8Array(0x1e + encoded.length);
    record.set([...ekey].reverse(), 0);
    new DataView(record.buffer).setUint32(16, record.length, true);
    record.set(encoded, 0x1e);
    indexEntries.push({ ekey, offset: archiveSize, size: record.length });
    archive.push(record);
    archiveSize += record.length;
    encodingEntries.push({ ckey, ekey, size: bytes.length });
    return { ckey, ekey };
  };

  const ckeys = new Map<number, Uint8Array>();
  for (const file of files) ckeys.set(file.id, store(file.bytes, file.mode ?? "N").ckey);
  const rootBytes = rootFile([
    ...(options.extraRoot ?? []),
    { locale: 0x2, files: [...ckeys].sort((a, b) => a[0] - b[0]) },
  ]);
  const rootKeys = store(rootBytes, "Z", 3);
  for (let i = 0; i < (options.fillerKeys ?? 0); i++) {
    encodingEntries.push({ ckey: md5(Uint8Array.of(i, i >> 8, 7)), ekey: md5(Uint8Array.of(i, i >> 8, 9)), size: 1 });
  }
  const encoding = encodingFile(encodingEntries, 1);
  const encodingKeys = store(encoding, "Z", 4);
  writeFileSync(join(dataDir, "data.000"), Buffer.concat(archive));

  // Index buckets by the key's first nibble; each newest file beside a stale one.
  const buckets = new Map<number, typeof indexEntries>();
  for (const entry of indexEntries) {
    const bucket = entry.ekey[0]! & 0x0f;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
  }
  for (const [bucket, entries] of buckets) {
    const name = (version: number) => `${bucket.toString(16).padStart(2, "0")}${version.toString(16).padStart(8, "0")}.idx`;
    writeFileSync(join(dataDir, name(2)), indexFile(entries));
    // A stale version pointing past the archive's end.
    writeFileSync(join(dataDir, name(1)), indexFile(entries.map((e) => ({ ...e, offset: e.offset + 10_000_000 }))));
  }

  const buildConfig = `# Build Configuration\n\nroot = ${hexOf(rootKeys.ckey)}\nencoding = ${hexOf(md5(encoding))} ${hexOf(encodingKeys.ekey)}\n`;
  const buildKey = hexOf(md5(new TextEncoder().encode(buildConfig)));
  const configDir = join(root, "Data", "config", buildKey.slice(0, 2), buildKey.slice(2, 4));
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, buildKey), buildConfig);
  writeFileSync(
    join(root, ".build.info"),
    `Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|Version!STRING:0|Product!STRING:0\neu|1|${buildKey}|1.15.9.1|${product}\n`,
  );
  writeFileSync(join(flavorDir, ".flavor.info"), `Product Flavor!STRING:0\n${product}\n`);
  return { buildKey, flavorDir };
}

function indexFile(entries: { ekey: Uint8Array; offset: number; size: number }[]): Uint8Array {
  const header = new Uint8Array(0x28);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x10, true);
  view.setUint16(8, 7, true);
  header.set([4, 5, 9, 30], 12);
  view.setUint32(0x20, entries.length * 18, true);
  const body = new Uint8Array(entries.length * 18);
  const bv = new DataView(body.buffer);
  entries.forEach((entry, i) => {
    body.set(entry.ekey.subarray(0, 9), i * 18);
    body[i * 18 + 9] = 0; // archive 0: the high bits
    bv.setUint32(i * 18 + 10, entry.offset);
    bv.setUint32(i * 18 + 14, entry.size, true);
  });
  return Buffer.concat([header, body]);
}

/** A BLP2 header for `width`×`height` with the given mip payloads. */
export function blp(options: {
  encoding: 1 | 2 | 3;
  alphaDepth?: number;
  alphaType?: number;
  width: number;
  height: number;
  mips: Uint8Array[];
  palette?: Uint8Array;
}): Uint8Array {
  const paletteBytes = options.encoding === 1 ? (options.palette ?? new Uint8Array(1024)) : new Uint8Array(0);
  const header = new Uint8Array(148);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x32504c42, true);
  view.setUint32(4, 1, true);
  header.set([options.encoding, options.alphaDepth ?? 0, options.alphaType ?? 0, options.mips.length > 1 ? 1 : 0], 8);
  view.setUint32(12, options.width, true);
  view.setUint32(16, options.height, true);
  let at = 148 + paletteBytes.length;
  options.mips.forEach((mip, i) => {
    view.setUint32(20 + i * 4, at, true);
    view.setUint32(84 + i * 4, mip.length, true);
    at += mip.length;
  });
  return Buffer.concat([header, paletteBytes, ...options.mips]);
}
