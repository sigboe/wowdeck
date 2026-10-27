/**
 * Adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-electron/src/app/addon-providers/zip-provider.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — https only; RAR and 7z links too (the archive format is
 *   checked on the downloaded bytes by ArchiveExtractor, so no HEAD
 *   content-type request); no website (upstream: the link's origin);
 *   installed addons stay visible instead of
 *   forced-ignored, and are never asked about updates (no getAll).
 * See docs/wowup-provenance.md.
 *
 * Install from URL for an addon archive at a direct link (WF-09): an
 * author's site, a Discord attachment. The link is the addon's id; there is
 * no catalog behind it, so the addon has no updates, no channels and no
 * reinstall, as upstream.
 */

import type { AddonSearchResult } from "../../models";
import { AddonChannelType } from "../../types";
import { AddonProvider } from "../addon-provider";
import { parseUrlAllowingMissingScheme } from "../url-parsing";
import { PROVIDER_ID } from "../../../api/providers";

const ARCHIVE_EXTENSION_RE = /\.(zip|rar|7z)$/i;

/** An https link whose path names a zip, RAR or 7z file, or null. */
export function parseArchiveUrl(input: string): URL | null {
  const url = parseUrlAllowingMissingScheme(input.trim());
  if (!url || url.protocol !== "https:" || !ARCHIVE_EXTENSION_RE.test(url.pathname)) {
    return null;
  }
  return url;
}

function fileName(url: URL): string {
  const last = url.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export class ZipProvider extends AddonProvider {
  override name = PROVIDER_ID.Zip;
  override enabled = true;
  // Never a settings toggle, never in the name search: a link is its only way in.
  override allowEdit = false;

  override isValidAddonId(addonId: string): boolean {
    return parseArchiveUrl(addonId)?.toString() === addonId;
  }

  /** The Install from URL card: the file name, and the host as author so people see where it comes from. */
  override async resolveUrl(url: string): Promise<AddonSearchResult | undefined> {
    const parsed = parseArchiveUrl(url);
    return parsed ? this.#result(parsed, fileName(parsed)) : undefined;
  }

  /**
   * No name: an archive has none of its own, so the installer names the
   * addon from its TOC title (upstream does the same for zip installs).
   */
  override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
    return this.isValidAddonId(addonId) ? this.#result(new URL(addonId), "") : undefined;
  }

  #result(url: URL, name: string): AddonSearchResult {
    const link = url.toString();
    return {
      author: url.hostname,
      externalId: link,
      // No addon page behind a link (upstream's origin is mostly an error page): no "View on".
      externalUrl: "",
      name,
      providerName: this.name,
      files: [
        {
          // The link is the release: installed and latest are the same
          // release id, so the addon never shows an update.
          externalId: link,
          channelType: AddonChannelType.Stable,
          version: "",
          folders: [],
          gameVersion: "",
          downloadUrl: link,
          releaseDate: "",
        },
      ],
    };
  }
}
