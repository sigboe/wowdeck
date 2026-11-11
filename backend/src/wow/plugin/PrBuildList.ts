/**
 * The PR builds published right now (GLOSSARY: PR build), read from the
 * `index.json` CI publishes on GitHub Pages beside each `pr/<n>/WoWDeck.zip`
 * (ADR 0010; the shape is documented in the header of tools/pr-build.ts,
 * which the engine never imports). Asked only when the PR builds modal
 * opens: no cache, no polling.
 */

import type { PrBuild } from "../../api/contracts";
import type { NetworkClient } from "../net/network";
import { normalizeVersion, prNumber } from "./PluginVersion";

/** A listed PR build with what installing it needs: the zip and its checksum. */
export interface PublishedPrBuild extends PrBuild {
  /** The zip's sha256, 64 lowercase hex. */
  sha256: string;
  /** Where the zip is served. */
  zipUrl: string;
}

export class PrBuildList {
  constructor(
    private net: Pick<NetworkClient, "getJson">,
    private indexUrl: string,
  ) {}

  /**
   * The listed builds in published order, or null when the list could not
   * be fetched or is not a list (offline, Pages down, garbage). Never throws.
   */
  async list(): Promise<PublishedPrBuild[] | null> {
    let index: unknown;
    try {
      index = await this.net.getJson<unknown>(this.indexUrl);
    } catch (err) {
      // An expected state (offline, Pages down). The message is the network
      // layer's own, already redacted; the list URL carries no key anyway.
      console.error(`[pr-builds] list unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const builds = isRecord(index) ? index.builds : undefined;
    if (!Array.isArray(builds)) {
      console.error("[pr-builds] list unavailable: not a PR builds list");
      return null;
    }
    const origin = new URL(this.indexUrl).origin;
    const seen = new Set<number>();
    return builds.flatMap((raw) => {
      const build = publishedBuildOf(raw, origin);
      if (build === null || seen.has(build.number)) return [];
      seen.add(build.number);
      return [build];
    });
  }
}

/** A GitHub login: alphanumerics and single inner hyphens, at most 39; bots end in [bot]. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const SHA1_HEX = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/**
 * What a title must not carry into the list: control characters (a bell, a
 * newline) and the invisible formatting ones that reorder or hide text (a
 * right-to-left override turns "gnp.exe" around).
 */
const UNSHOWN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/**
 * One list entry, when it has the published shape: only the defined fields,
 * the version a build of this PR, the zip on the list's own host over https.
 * Null otherwise; the entry is untrusted data.
 */
function publishedBuildOf(raw: unknown, origin: string): PublishedPrBuild | null {
  if (!isRecord(raw)) return null;
  const { number, title, author, version, headSha, builtAt, zipSize, sha256, zipUrl } = raw;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
  if (typeof title !== "string") return null;
  if (typeof author !== "string" || !GITHUB_LOGIN.test(author)) return null;
  if (typeof version !== "string" || normalizeVersion(version) !== version || prNumber(version) !== number) {
    return null;
  }
  if (typeof headSha !== "string" || !SHA1_HEX.test(headSha)) return null;
  if (typeof builtAt !== "string" || !ISO_UTC.test(builtAt) || Number.isNaN(Date.parse(builtAt))) return null;
  if (typeof zipSize !== "number" || !Number.isSafeInteger(zipSize) || zipSize < 0) return null;
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return null;
  if (typeof zipUrl !== "string" || !isZipOn(zipUrl, origin)) return null;
  return {
    number,
    title: title.replace(UNSHOWN, "").trim(),
    author,
    version,
    headSha,
    builtAt,
    zipSize,
    sha256,
    zipUrl,
  };
}

/** Whether the zip is served over https from the list's own host. */
function isZipOn(zipUrl: string, origin: string): boolean {
  try {
    const url = new URL(zipUrl);
    return url.protocol === "https:" && url.origin === origin;
  } catch {
    return false;
  }
}

/** A listed build as the RPC sends it: the zip's URL and checksum stay engine-side. */
export function publicFields({ number, title, author, version, headSha, builtAt, zipSize }: PrBuild): PrBuild {
  return { number, title, author, version, headSha, builtAt, zipSize };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
