/**
 * Streaming zip reader for addon archives (project-owned).
 *
 * Reads the central directory with ranged reads and inflates one entry at
 * a time, straight to its file, in small chunks. Memory stays at one read
 * chunk plus what it inflates to, whatever the archive's size.
 *
 * It replaces fflate's whole-archive `unzip`, which holds the archive and
 * every inflated file in memory and starts one worker thread per entry of
 * 320 kB or more, all at once. An addon with many large files (textures,
 * sounds, data tables) then took gigabytes and the kernel killed the engine
 * mid-install.
 *
 * The central directory is the authority for names, sizes and offsets, as
 * in fflate's `unzip`: entries written with a data descriptor (sizes after
 * the data) and zip64 archives both read correctly.
 */

import { Inflate, strFromU8 } from "fflate";
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff;
const ZIP64_EXTRA_ID = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/**
 * Compressed bytes read per step. Deflate expands at most about 1032 times,
 * so one step inflates to 66 MiB in the worst case and far less in practice.
 */
const READ_CHUNK = 64 * 1024;
/**
 * An entry no larger than this, compressed and inflated, is read and
 * inflated in one step: most addon files are small, and a stream per file
 * costs more than the file. Larger entries stream.
 *
 * The one step uses Bun's native zlib, not fflate: its output limit stops
 * inflating at the declared size. fflate's `inflateSync` given a fixed
 * output buffer keeps decoding past its end, so a small entry that
 * declares a few bytes and inflates to a gigabyte held the engine for
 * half a minute.
 */
const ONE_STEP_COMPRESSED = 1024 * 1024;
const ONE_STEP_INFLATED = 8 * 1024 * 1024;

/** The archive is not a zip this reader can unpack; the message says why (for the log). */
export class ZipFormatError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ZipFormatError";
  }
}

export interface ZipEntry {
  /** The entry's path as stored; a directory ends in a slash. */
  name: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function bad(reason: string): never {
  throw new ZipFormatError(reason);
}

async function readExactly(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) {
      bad("unexpected end of file");
    }
    done += bytesRead;
  }
  return buffer;
}

function uint64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    bad("a zip64 value is out of range");
  }
  return Number(value);
}

/** Where the central directory is, from the end-of-central-directory record (zip64's when present). */
async function locateCentralDirectory(fh: FileHandle, size: number): Promise<{ offset: number; length: number }> {
  if (size < EOCD_SIZE) {
    bad("too small to be a zip");
  }
  const tailLength = Math.min(size, MAX_EOCD_SEARCH);
  const tailStart = size - tailLength;
  const tail = await readExactly(fh, tailLength, tailStart);
  let eocd = -1;
  for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    bad("no end-of-central-directory record");
  }
  let length = tail.readUInt32LE(eocd + 12);
  let offset = tail.readUInt32LE(eocd + 16);
  const zip64 = tail.readUInt16LE(eocd + 10) === 0xffff || length === 0xffffffff || offset === 0xffffffff;
  const locatorAt = tailStart + eocd - 20;
  if (zip64 && locatorAt >= 0) {
    const locator = await readExactly(fh, 20, locatorAt);
    if (locator.readUInt32LE(0) === ZIP64_LOCATOR_SIG) {
      const record = await readExactly(fh, 56, uint64(locator, 8));
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
        bad("no zip64 end-of-central-directory record");
      }
      length = uint64(record, 40);
      offset = uint64(record, 48);
    }
  }
  if (offset + length > size) {
    bad("the central directory lies outside the file");
  }
  return { offset, length };
}

/** Every entry the central directory lists, in its order. Throws a ZipFormatError for a file that is no readable zip. */
export async function readZipEntries(fh: FileHandle): Promise<ZipEntry[]> {
  const { size } = await fh.stat();
  const { offset, length } = await locateCentralDirectory(fh, size);
  const directory = await readExactly(fh, length, offset);
  const entries: ZipEntry[] = [];
  let at = 0;
  while (at < directory.length) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CDFH_SIG) {
      bad("the central directory is damaged");
    }
    const flags = directory.readUInt16LE(at + 8);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const nameAt = at + 46;
    const extraAt = nameAt + nameLength;
    const next = extraAt + extraLength + commentLength;
    if (next > directory.length) {
      bad("the central directory is damaged");
    }
    let compressedSize = directory.readUInt32LE(at + 20);
    let uncompressedSize = directory.readUInt32LE(at + 24);
    let localHeaderOffset = directory.readUInt32LE(at + 42);
    // zip64: a 32-bit field of all ones has its real value in the extra
    // field, in this fixed order, each present only when its field is.
    for (let field = extraAt; field + 4 <= extraAt + extraLength; ) {
      const id = directory.readUInt16LE(field);
      const fieldLength = directory.readUInt16LE(field + 2);
      if (id === ZIP64_EXTRA_ID) {
        let value = field + 4;
        const end = Math.min(value + fieldLength, extraAt + extraLength);
        const take = (): number => {
          if (value + 8 > end) {
            bad("a zip64 extra field is damaged");
          }
          value += 8;
          return uint64(directory, value - 8);
        };
        if (uncompressedSize === 0xffffffff) uncompressedSize = take();
        if (compressedSize === 0xffffffff) compressedSize = take();
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = take();
        break;
      }
      field += 4 + fieldLength;
    }
    entries.push({
      // Bit 11 marks a UTF-8 name; without it fflate reads the bytes as Latin-1, and so do we.
      name: strFromU8(directory.subarray(nameAt, extraAt), !(flags & 0x800)),
      method: directory.readUInt16LE(at + 10),
      encrypted: (flags & 1) !== 0,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    at = next;
  }
  return entries;
}

function writeAll(fd: number, chunk: Uint8Array): void {
  for (let written = 0; written < chunk.length; ) {
    written += writeSync(fd, chunk, written, chunk.length - written);
  }
}

/**
 * Write one entry's content to `destinationPath` (created or replaced; its
 * directory must exist). Throws a ZipFormatError when the entry cannot be
 * read or does not have the size the central directory declares.
 */
export async function writeZipEntry(fh: FileHandle, entry: ZipEntry, destinationPath: string): Promise<void> {
  if (entry.encrypted) {
    bad("an entry is encrypted");
  }
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    bad(`unknown compression type ${entry.method}`);
  }
  // Thirty bytes from the page cache: not worth a trip through the event loop per entry.
  const header = Buffer.alloc(30);
  if (readSync(fh.fd, header, 0, 30, entry.localHeaderOffset) !== 30 || header.readUInt32LE(0) !== LFH_SIG) {
    bad("an entry's local header is missing");
  }
  const dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);

  if (
    entry.method === METHOD_DEFLATE &&
    entry.compressedSize <= ONE_STEP_COMPRESSED &&
    entry.uncompressedSize <= ONE_STEP_INFLATED
  ) {
    const compressed = await readExactly(fh, entry.compressedSize, dataStart);
    let content: Uint8Array;
    try {
      // The limit stops zlib at the declared size; one more byte shows an entry larger than declared.
      content = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
    } catch (err) {
      if ((err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") {
        bad("an entry is larger than declared");
      }
      bad(`an entry does not inflate: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (content.length !== entry.uncompressedSize) {
      bad(content.length > entry.uncompressedSize ? "an entry is larger than declared" : "an entry is smaller than declared");
    }
    const fd = openSync(destinationPath, "w");
    try {
      writeAll(fd, content);
    } finally {
      closeSync(fd);
    }
    return;
  }

  const fd = openSync(destinationPath, "w");
  try {
    let written = 0;
    const write = (chunk: Uint8Array): void => {
      written += chunk.length;
      // Also the zip-bomb guard: an entry never grows past its declared size.
      if (written > entry.uncompressedSize) {
        bad("an entry is larger than declared");
      }
      writeAll(fd, chunk);
    };
    const inflate = entry.method === METHOD_DEFLATE ? new Inflate((chunk) => write(chunk)) : null;
    const buffer = Buffer.alloc(Math.min(READ_CHUNK, Math.max(entry.compressedSize, 1)));
    for (let read = 0; read < entry.compressedSize; ) {
      const want = Math.min(buffer.length, entry.compressedSize - read);
      const { bytesRead } = await fh.read(buffer, 0, want, dataStart + read);
      if (bytesRead === 0) {
        bad("unexpected end of file");
      }
      read += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      if (inflate) {
        try {
          inflate.push(chunk, read === entry.compressedSize);
        } catch (err) {
          if (err instanceof ZipFormatError) throw err;
          bad(`an entry does not inflate: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        write(chunk);
      }
    }
    if (inflate && entry.compressedSize === 0) {
      bad("a compressed entry has no data");
    }
    if (written !== entry.uncompressedSize) {
      bad("an entry is smaller than declared");
    }
  } finally {
    closeSync(fd);
  }
}
