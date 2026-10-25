/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup-electron/app/wowup-folder-scanner.ts
 *          wowup-electron/app/file.utils.ts (hashFile/hashString, md5)
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — lodash/rxjs/electron-log removed (native equivalents,
 *   bounded concurrency); hashes via Bun.CryptoHasher; paths relative to
 *   the scanned folder.
 * See docs/wowup-provenance.md.
 */

import { basename, dirname, extname, join } from "node:path";
import type { AddonFolder, AddonScanResult } from "../models";
import { listDirectory } from "../fs/safe-fs";

const INVALID_PATH_CHARS = [
  "|",
  "\0",
  "\u0001",
  "\u0002",
  "\u0003",
  "\u0004",
  "\u0005",
  "\u0006",
  "\b",
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
  "\u000e",
  "\u000f",
  "\u0010",
  "\u0011",
  "\u0012",
  "\u0013",
  "\u0014",
  "\u0015",
  "\u0016",
  "\u0017",
  "\u0018",
  "\u0019",
  "\u001a",
  "\u001b",
  "\u001c",
  "\u001d",
  "\u001e",
  "\u001f",
];

const tocFileCommentsRegex = /\s*#.*$/gim;
const tocFileIncludesRegex = /^\s*((?:(?<!\.\.).)+\.(?:xml|lua))\s*$/gim;
const tocFileRegex = /^([^/]+)[\\/]\1([-_](mainline|bcc|tbc|classic|vanilla|wrath|wotlkc|cata|mists))?\.toc$/i;
const bindingsXmlRegex = /^[^/\\]+[/\\]Bindings\.xml$/i;
const bindingsXmlIncludesRegex = /<(?:Include|Script)\s+file=["']((?:(?<!\.\.).)+)["']\s*\/>/gi;
const bindingsXmlCommentsRegex = /<!--.*?-->/gis;

async function md5File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()));
  return hasher.digest("hex");
}

function md5String(text: string): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(text);
  return hasher.digest("hex");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) {
        break;
      }
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readDirRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await listDirectory(current)) {
      if (entry.isDirectory) {
        await walk(entry.path);
      } else {
        files.push(entry.path);
      }
    }
  };
  await walk(dir);
  return files;
}

/** Compute the WowUp md5 fingerprint for one addon folder. */
export async function scanWowUpFolder(folderPath: string): Promise<AddonScanResult> {
  // Map lowercased -> real path to solve case mismatches by addon authors on Linux
  const files = await readDirRecursive(folderPath);
  const fileMap = new Map<string, string>();
  for (const fp of files) {
    fileMap.set(fp.toLowerCase(), fp);
  }

  const matchingFiles = await getMatchingFiles(folderPath, files, fileMap);
  matchingFiles.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const hashes = await mapLimit(matchingFiles, 8, (file) => md5File(file));

  const fingerprint = md5String([...hashes].sort().join(""));

  return {
    source: "wowup",
    fileCount: matchingFiles.length,
    fingerprint,
    fingerprintNum: 0,
    folderName: basename(folderPath),
  };
}

/** Attach wowup fingerprints to scanned addon folders. */
export async function computeWowUpFingerprints(folders: AddonFolder[]): Promise<void> {
  for (const folder of folders) {
    if (folder.ignoreReason !== undefined) {
      continue;
    }
    try {
      const result = await scanWowUpFolder(folder.path);
      folder.scanResults = { ...folder.scanResults, wowup: result };
    } catch (err) {
      console.error(`[fingerprint] wowup scan failed for ${folder.name}: ${String(err)}`);
    }
  }
}

function getRealPath(fileMap: Map<string, string>, filePath: string): string {
  const matched = fileMap.get(filePath.toLowerCase());
  if (!matched) {
    throw new Error(`Path not found: ${filePath}`);
  }
  return matched;
}

async function getMatchingFiles(
  folderPath: string,
  filePaths: string[],
  fileMap: Map<string, string>,
): Promise<string[]> {
  const parentDir = (dirname(folderPath) + "/").toLowerCase();
  const matchingFileList: string[] = [];
  const fileInfoList: string[] = [];

  for (const filePath of filePaths) {
    const input = filePath.toLowerCase().replace(parentDir, "");
    if (tocFileRegex.test(input)) {
      fileInfoList.push(filePath);
    } else if (bindingsXmlRegex.test(input)) {
      matchingFileList.push(filePath);
    }
  }

  for (const fileInfo of fileInfoList) {
    await processIncludeFile(fileMap, matchingFileList, fileInfo);
  }

  return matchingFileList;
}

async function processIncludeFile(fileMap: Map<string, string>, matchingFileList: string[], fileInfo: string): Promise<void> {
  let nativePath: string;
  try {
    nativePath = getRealPath(fileMap, fileInfo);
  } catch {
    return;
  }

  if (matchingFileList.includes(nativePath)) {
    return;
  }
  matchingFileList.push(nativePath);

  let input = await Bun.file(nativePath).text();
  input = removeComments(nativePath, input);

  const inclusions = getFileInclusionMatches(nativePath, input);
  if (!inclusions || !inclusions.length) {
    return;
  }

  const dir = dirname(nativePath);
  for (const include of inclusions) {
    if (INVALID_PATH_CHARS.some((c) => include.includes(c))) {
      console.error(`[fingerprint] invalid include file ${nativePath}`);
      break;
    }
    const fileName = join(dir, include.replace(/\\/g, "/"));
    await processIncludeFile(fileMap, matchingFileList, fileName);
  }
}

function removeComments(fileInfo: string, fileContent: string): string {
  switch (extname(fileInfo)) {
    case ".xml":
      return fileContent.replace(bindingsXmlCommentsRegex, "");
    case ".toc":
      return fileContent.replace(tocFileCommentsRegex, "");
    default:
      return fileContent;
  }
}

function getFileInclusionMatches(fileInfo: string, fileContent: string): string[] | null {
  switch (extname(fileInfo)) {
    case ".xml":
      return matchAll(fileContent, bindingsXmlIncludesRegex);
    case ".toc":
      return matchAll(fileContent, tocFileIncludesRegex);
    default:
      return null;
  }
}

function matchAll(str: string, regex: RegExp): string[] {
  const matches: string[] = [];
  let currentMatch: RegExpExecArray | null;
  do {
    currentMatch = regex.exec(str);
    if (currentMatch) {
      matches.push(currentMatch[1]!);
    }
  } while (currentMatch);
  return matches;
}
