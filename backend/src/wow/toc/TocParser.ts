/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup-electron/src/app/services/toc/toc.service.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — converted Angular service to pure functions on Bun.file;
 *   FileService dependency removed; behavior identical.
 * See docs/wowup-provenance.md.
 */

import { basename } from "node:path";
import type { Toc } from "./toc";
import {
  TOC_AUTHOR,
  TOC_DEPENDENCIES,
  TOC_INTERFACE,
  TOC_NOTES,
  TOC_REQUIRED_DEPS,
  TOC_TITLE,
  TOC_VERSION,
  TOC_WEBSITE,
  TOC_X_ADDON_PROVIDER,
  TOC_X_CURSE_PROJECT_ID,
  TOC_X_LOADONDEMAND,
  TOC_X_PART_OF,
  TOC_X_TUKUI_PROJECTID,
  TOC_X_TUKUI_PROJECTFOLDERS,
  TOC_X_WAGO_ID,
  TOC_X_WEBSITE,
  TOC_X_WOWI_ID,
} from "./toc";

export function stripColorCode(str: string): string {
  if (!str.includes("|c")) {
    return str;
  }
  return str.replace(/(\|c[a-z0-9]{8})|(\|r)/gi, "").trim();
}

export function stripTextureCode(str: string): string {
  if (!str.includes("|T")) {
    return str;
  }
  return str.replace(/(\|T.*\|t)/g, "").trim();
}

function stripEncodedChars(value: string): string {
  return stripNewLineChars(stripTextureCode(stripColorCode(value)));
}

function stripNewLineChars(value: string): string {
  return value.replace(/\|r/g, "");
}

function getValue(key: string, tocText: string): string {
  const match = new RegExp(`^## ${key}:(.*?)$`, "m").exec(tocText);
  if (!match || match.length !== 2) {
    return "";
  }
  return stripEncodedChars(match[1]!.trim());
}

function getValueArray(key: string, tocText: string): string[] {
  const value = getValue(key, tocText);
  return [...new Set(value.split(",").map((x) => x.trim()))].filter((x) => x !== "");
}

function getWebsite(tocText: string): string {
  return getValue(TOC_WEBSITE, tocText) || getValue(TOC_X_WEBSITE, tocText);
}

function getDependencyList(tocText: string): string[] {
  const dependencies = getValue(TOC_DEPENDENCIES, tocText);
  const requiredDeps = getValue(TOC_REQUIRED_DEPS, tocText);
  return [...dependencies.split(","), ...requiredDeps.split(",")]
    .map((dep) => dep.trim())
    .filter((dep) => !!dep);
}

/** Normalize missing tags (empty string) to undefined. */
function maybe(value: string): string | undefined {
  const stripped = stripEncodedChars(value);
  return stripped === "" ? undefined : stripped;
}

/** Parse the `## Key: value` metadata of a TOC file from raw text. */
export function parseTocText(tocPath: string, tocTextRaw: string): Toc {
  const tocText = tocTextRaw.trim();
  const dependencies =
    getValue(TOC_DEPENDENCIES, tocText) || getValue(TOC_REQUIRED_DEPS, tocText);

  return {
    fileName: basename(tocPath),
    filePath: tocPath,
    author: maybe(getValue(TOC_AUTHOR, tocText)),
    curseProjectId: maybe(getValue(TOC_X_CURSE_PROJECT_ID, tocText)),
    interface: getValueArray(TOC_INTERFACE, tocText),
    title: maybe(getValue(TOC_TITLE, tocText)),
    website: maybe(getWebsite(tocText)),
    version: maybe(getValue(TOC_VERSION, tocText)),
    partOf: maybe(getValue(TOC_X_PART_OF, tocText)),
    wowInterfaceId: maybe(getValue(TOC_X_WOWI_ID, tocText)),
    wagoAddonId: maybe(getValue(TOC_X_WAGO_ID, tocText)),
    dependencies: maybe(dependencies),
    dependencyList: getDependencyList(tocText),
    tukUiProjectId: maybe(getValue(TOC_X_TUKUI_PROJECTID, tocText)),
    tukUiProjectFolders: maybe(getValue(TOC_X_TUKUI_PROJECTFOLDERS, tocText)),
    loadOnDemand: maybe(getValue(TOC_X_LOADONDEMAND, tocText)),
    addonProvider: maybe(getValue(TOC_X_ADDON_PROVIDER, tocText)),
    notes: maybe(getValue(TOC_NOTES, tocText)),
  };
}

/** Read and parse a .toc file from disk. */
export async function parseTocFile(tocPath: string): Promise<Toc> {
  const text = await Bun.file(tocPath).text();
  return parseTocText(tocPath, text);
}
