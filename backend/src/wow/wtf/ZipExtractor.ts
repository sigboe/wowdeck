/**
 * Streaming, verifying backup extractor (project-owned).
 *
 * Extracts a WTF backup into a STAGING directory only. Every entry is
 * checked against the backup's own metadata while it streams:
 *  - zip-slip: unsafe names are rejected before anything is written;
 *    regular files only (a symlink entry would just become a plain file);
 *    files are opened with `wx`, so nothing existing is followed/overwritten
 *  - zip bomb: a file may not inflate past the size its metadata declares
 *  - integrity: size and sha256 are compared as the bytes are written
 *    (single pass, no re-read) — unlike desktop WowUp, whose restore only
 *    logs hash mismatches and carries on
 *  - completeness: every entry the metadata lists must have been seen
 */

import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import type { BackupMetaEntry } from "./BackupMeta";
import { WtfBackupError } from "./errors";
import { isSafeArchiveEntryPath, joinWithin } from "../fs/safe-fs";
import { BACKUP_META_NAME } from "./WtfPaths";
import { throwIfAborted } from "./ZipWriter";

const READ_CHUNK = 256 * 1024;

export interface ExtractOptions {
  zipPath: string;
  stageDir: string;
  /** Metadata entries keyed by path ("/Account/…"); the root ("") is not expected as a zip entry. */
  expected: Map<string, BackupMetaEntry>;
  totalBytes: number;
  signal?: AbortSignal;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
}

function mismatch(what: string): never {
  throw new WtfBackupError("verify_failed", `The backup didn't match its own contents list (${what}). Nothing was changed.`);
}

export async function extractBackupZip(options: ExtractOptions): Promise<void> {
  const { zipPath, stageDir, expected, totalBytes, signal, onProgress } = options;
  mkdirSync(stageDir, { recursive: true });
  const seen = new Set<string>();
  const openFds = new Set<number>();
  let done = 0;
  // fflate's decoders catch exceptions thrown inside `ondata` and redeliver them as `err`, which would
  // mask the real reason — so record the first failure here and rethrow it from the read loop.
  let failure: unknown;
  const fail = (err: unknown): void => {
    failure ??= err;
  };

  const unzip = new Unzip((file) => {
    const name = file.name.replace(/\\/g, "/");
    if (name === BACKUP_META_NAME) {
      file.ondata = () => {};
      file.start();
      return;
    }
    const isDir = name.endsWith("/");
    const bare = isDir ? name.slice(0, -1) : name;
    if (!isSafeArchiveEntryPath(bare)) {
      throw new WtfBackupError("backup_invalid", "The backup contains an unsafe path and was rejected.");
    }
    const rel = `/${bare}`;
    const exp = expected.get(rel);
    if (!exp || exp.isDirectory !== isDir) {
      mismatch("unlisted entry");
    }
    if (seen.has(rel)) {
      mismatch("duplicate entry");
    }
    seen.add(rel);
    const abs = joinWithin(stageDir, ...rel.slice(1).split("/"));

    if (isDir) {
      mkdirSync(abs, { recursive: true });
      file.ondata = () => {};
      file.start();
      return;
    }

    mkdirSync(dirname(abs), { recursive: true });
    const fd = openSync(abs, "wx");
    openFds.add(fd);
    const hash = createHash("sha256");
    let written = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) {
        return;
      }
      if (err) {
        fail(new WtfBackupError("backup_invalid", "The backup is damaged or uses an unsupported format."));
        return;
      }
      try {
        written += chunk.length;
        if (written > exp.size) {
          mismatch("file larger than declared");
        }
        hash.update(chunk);
        writeSync(fd, chunk);
        done += chunk.length;
        if (final) {
          closeSync(fd);
          openFds.delete(fd);
          if (written !== exp.size) {
            mismatch("file smaller than declared");
          }
          if (exp.hash && hash.digest("hex") !== exp.hash) {
            mismatch("checksum differs");
          }
        }
      } catch (e) {
        fail(e);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  try {
    for await (const chunk of createReadStream(zipPath, { highWaterMark: READ_CHUNK })) {
      throwIfAborted(signal);
      unzip.push(new Uint8Array(chunk as Buffer));
      if (failure) {
        throw failure;
      }
      onProgress?.(done, totalBytes);
    }
    unzip.push(new Uint8Array(0), true);
    if (failure) {
      throw failure;
    }
  } catch (err) {
    if (err instanceof WtfBackupError) {
      throw err;
    }
    throw new WtfBackupError("backup_invalid", "The backup is damaged or uses an unsupported format.");
  } finally {
    for (const fd of openFds) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }

  for (const path of expected.keys()) {
    if (path !== "" && !seen.has(path)) {
      mismatch("missing entry");
    }
  }
}
