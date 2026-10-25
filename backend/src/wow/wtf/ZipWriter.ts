/**
 * Streaming zip writer for WTF backups (project-owned).
 *
 * Replaces desktop WowUp's AdmZip `addLocalFolder` (whole archive in RAM)
 * with fflate's streaming `Zip`. Memory is bounded by one read chunk plus
 * fflate's internal buffers regardless of WTF size (spike S1: ~35 MB RSS
 * growth for a 409 MB tree, inside the compiled binary).
 *
 * The SOURCE TREE IS ONLY EVER READ. (Upstream writes its metadata file
 * into the live WTF folder during the backup; we build it in memory and
 * append it as the last zip entry.)
 */

import { createHash } from "node:crypto";
import { once } from "node:events";
import { closeSync, createReadStream, fsyncSync, openSync, unlinkSync, writeSync } from "node:fs";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { BackupMeta, BackupMetaEntry } from "./BackupMeta";
import { WtfBackupError } from "./errors";
import { BACKUP_META_NAME } from "./WtfPaths";
import type { WalkEntry } from "./WtfWalker";

/** fflate writes classic (non-zip64) archives. */
export const MAX_ZIP_ENTRIES = 65000;
const MAX_ZIP_FILE_BYTES = 0xfffffff0;
const YIELD_EVERY_FILES = 20;
const CHUNK_BYTES = 64 * 1024;

export interface WriteZipOptions {
  outPath: string;
  entries: WalkEntry[];
  /** Total bytes of all files, for progress. */
  totalBytes: number;
  /** Creates the metadata once every file's size and hash are known. */
  buildMeta: (contents: BackupMetaEntry[]) => BackupMeta;
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  signal?: AbortSignal;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
}

export interface WriteZipResult {
  contents: BackupMetaEntry[];
  fileCount: number;
  dirCount: number;
  /** Files that vanished between the walk and the read (WoW running). They are in neither the zip nor the metadata. */
  skippedFiles: number;
}

export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WtfBackupError("cancelled", "cancelled");
  }
}

/** DOS time can't represent < 1980; fflate throws on those. */
function safeMtime(ms: number): Date | undefined {
  return ms >= 315532800000 && ms < 4102444800000 ? new Date(ms) : undefined;
}

export async function writeBackupZip(options: WriteZipOptions): Promise<WriteZipResult> {
  const { outPath, entries, totalBytes, signal, onProgress } = options;
  const level = options.level ?? 1;
  if (entries.length + 2 > MAX_ZIP_ENTRIES) {
    throw new WtfBackupError("wtf_too_large", "Too many settings files to back up in one zip");
  }

  const fd = openSync(outPath, "w");
  let closed = false;
  let zipError: unknown;
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err;
      return;
    }
    writeSync(fd, chunk);
  });
  const check = () => {
    if (zipError) {
      throw zipError instanceof Error ? zipError : new Error(String(zipError));
    }
    throwIfAborted(signal);
  };

  const contents: BackupMetaEntry[] = [{ path: "", isDirectory: true, size: 0 }];
  let fileCount = 0;
  let dirCount = 0;
  let skippedFiles = 0;
  let doneBytes = 0;
  let filesSinceYield = 0;

  try {
    for (const e of entries) {
      check();
      if (e.isDirectory) {
        const dir = new ZipPassThrough(`${e.rel.slice(1)}/`);
        const mtime = safeMtime(e.mtimeMs);
        if (mtime) {
          dir.mtime = mtime;
        }
        zip.add(dir);
        dir.push(new Uint8Array(0), true);
        contents.push({ path: e.rel, isDirectory: true, size: 0 });
        dirCount += 1;
        continue;
      }
      if (e.size >= MAX_ZIP_FILE_BYTES) {
        throw new WtfBackupError("wtf_too_large", "One settings file is too large to back up");
      }
      const rs = createReadStream(e.abs, { highWaterMark: CHUNK_BYTES });
      try {
        await once(rs, "open");
      } catch {
        rs.destroy();
        skippedFiles += 1;
        continue;
      }
      const entry = new ZipDeflate(e.rel.slice(1), { level });
      const fileMtime = safeMtime(e.mtimeMs);
      if (fileMtime) {
        entry.mtime = fileMtime;
      }
      zip.add(entry);
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of rs) {
        const bytes = new Uint8Array(chunk as Buffer);
        hash.update(bytes);
        size += bytes.length;
        entry.push(bytes, false);
        doneBytes += bytes.length;
        check();
        onProgress?.(doneBytes, totalBytes);
      }
      entry.push(new Uint8Array(0), true);
      // `size`/`hash` describe what is actually in the zip, even if the file changed since the walk.
      contents.push({ path: e.rel, isDirectory: false, size, hash: hash.digest("hex") });
      fileCount += 1;
      filesSinceYield += 1;
      if (filesSinceYield >= YIELD_EVERY_FILES) {
        filesSinceYield = 0;
        await yieldToEventLoop();
      }
    }

    const meta = options.buildMeta(contents);
    const metaEntry = new ZipDeflate(BACKUP_META_NAME, { level });
    zip.add(metaEntry);
    metaEntry.push(new TextEncoder().encode(JSON.stringify(meta)), true);
    zip.end();
    check();
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    return { contents, fileCount, dirCount, skippedFiles };
  } catch (err) {
    if (!closed) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      closed = true;
    }
    try {
      unlinkSync(outPath);
    } catch {
      /* partial may not exist */
    }
    throw err;
  }
}
