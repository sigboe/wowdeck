/**
 * Ranged zip reader (project-owned): end-of-central-directory + central
 * directory + a single entry, without ever reading the whole archive.
 *
 * Listing backups must stay cheap (upstream opens every zip in full to
 * read its metadata). Classic (non-zip64) archives only — that is all
 * desktop WowUp's AdmZip and our fflate writer produce.
 */

import { open } from "node:fs/promises";
import { inflateSync } from "fflate";
import { WtfBackupError } from "./errors";

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;
/** Guard for entries we inflate into memory (the metadata): 100k entries is ~20 MB. */
export const MAX_INFLATED_ENTRY_BYTES = 64 * 1024 * 1024;

export interface ZipEntryInfo {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

function bad(reason: string): never {
  console.error(`[wtf] not a valid backup zip (${reason})`);
  throw new WtfBackupError("backup_invalid", "Not a settings backup");
}

export async function listZipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const fh = await open(zipPath, "r");
  try {
    const { size } = await fh.stat();
    if (size < 22) {
      return bad("too small");
    }
    const tailLen = Math.min(size, MAX_EOCD_SEARCH);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      return bad("no central directory");
    }
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return bad("zip64 is not supported");
    }
    if (cdOffset + cdSize > size) {
      return bad("central directory out of range");
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntryInfo[] = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDFH_SIG) {
        return bad("corrupt central directory");
      }
      const method = cd.readUInt16LE(p + 10);
      const compressedSize = cd.readUInt32LE(p + 20);
      const uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        isDirectory: name.endsWith("/"),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Read one entry fully into memory (only for small entries such as the metadata). */
export async function readZipEntryText(zipPath: string, entry: ZipEntryInfo): Promise<string> {
  if (entry.uncompressedSize > MAX_INFLATED_ENTRY_BYTES) {
    return bad("entry too large");
  }
  const fh = await open(zipPath, "r");
  try {
    const header = Buffer.alloc(30);
    await fh.read(header, 0, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LFH_SIG) {
      return bad("corrupt local header");
    }
    const dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const raw = Buffer.alloc(entry.compressedSize);
    await fh.read(raw, 0, entry.compressedSize, dataStart);
    if (entry.method === 0) {
      return raw.toString("utf8");
    }
    if (entry.method === 8) {
      const out = inflateSync(new Uint8Array(raw));
      if (out.length > MAX_INFLATED_ENTRY_BYTES) {
        return bad("entry too large");
      }
      return Buffer.from(out).toString("utf8");
    }
    return bad("unsupported compression");
  } finally {
    await fh.close();
  }
}
