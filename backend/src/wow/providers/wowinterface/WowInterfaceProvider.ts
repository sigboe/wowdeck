/**
 * WowInterface addon provider (project-owned — clean-room,
 * not ported). Written after investigating WowUp's
 * wow-interface-addon-provider.ts and live-confirming the real mmoui.com
 * API during development (both a single-id and a mixed valid/invalid
 * batch request).
 *
 * Unlike GitHub, this provider has no catalog search (upstream never
 * implements it either) and no per-flavor compatibility signal from its
 * own API at all — compatibility comes entirely from the generic
 * post-install TOC re-read every provider already goes through
 * (AddonInstaller.readInstalledToc / getTocForGameType2), so there is no
 * flavor-mapping logic to write here, unlike GitHub's release.json
 * system.
 *
 * Improvement over upstream: the API's MD5 `checksum`/`UIMD5` field is
 * used as this provider's release-identity (AddonSearchResultFile.externalId),
 * so a same-version re-upload is still detected as a real update — the
 * same category of fix already made for GitHub's provider, since
 * upstream never sets a release-id-equivalent field for this provider at
 * all (it falls back entirely to a fragile plain version-string compare).
 */

import type { AddonFolder, AddonSearchResult, AddonSearchResultFile, WowInstallation } from "../../models";
import type { Toc } from "../../toc/toc";
import { AddonChannelType } from "../../types";
import type { NetworkClient } from "../../net/network";
import { NetworkError } from "../../net/network";
import { AddonProvider, type GetAllResult, type ScanMatch } from "../addon-provider";
import { ProviderError } from "../../errors";
import { parseUrlAllowingMissingScheme } from "../url-parsing";
import type { WowiFileDetailsV3, WowiFileDetailsV4 } from "./wowinterface-models";
import { PROVIDER_ID } from "../../../api/providers";

const API_V4 = "https://api.mmoui.com/v4/game/WOW/filedetails";
const API_V3 = "https://api.mmoui.com/v3/game/WOW/filedetails";
const ID_RE = /^\d+$/;
const WOWI_HOST_RE = /^(www\.)?wowinterface\.com$/i;

function v3ToV4(v3: WowiFileDetailsV3): WowiFileDetailsV4 {
  return {
    id: parseInt(v3.UID, 10),
    categoryId: parseInt(v3.UICATID, 10),
    version: v3.UIVersion,
    lastUpdate: v3.UIDate,
    checksum: v3.UIMD5,
    fileName: v3.UIFileName,
    downloadUri: v3.UIDownload,
    title: v3.UIName,
    author: v3.UIAuthorName,
    description: v3.UIDescription,
    changeLog: v3.UIChangeLog,
    downloads: parseInt(v3.UIHitCount, 10) || 0,
    downloadsMonthly: parseInt(v3.UIHitCountMonthly, 10) || 0,
    favorites: parseInt(v3.UIFavoriteTotal, 10) || 0,
    images: [],
  };
}

/**
 * Parse a WowInterface addon-page or download URL. Checked in the same
 * order as upstream (`/download(\d+)/` before `/info(\d+)/`), though the
 * two path shapes are mutually exclusive in practice. Host check is
 * exact (`wowinterface.com`/`www.wowinterface.com`), unlike upstream's
 * loose `host.endsWith(...)`.
 */
export function parseWowInterfaceQuery(input: string): { id: string } | null {
  const trimmed = input.trim();
  // Tolerate a missing https:// the same way the GitHub parser does —
  // see parseUrlAllowingMissingScheme's doc comment.
  const url = parseUrlAllowingMissingScheme(trimmed);
  if (!url) {
    return null;
  }
  if (!WOWI_HOST_RE.test(url.hostname)) {
    return null;
  }
  const downloadMatch = /\/download(\d+)/i.exec(url.pathname);
  if (downloadMatch) {
    return { id: downloadMatch[1]! };
  }
  const infoMatch = /\/info(\d+)/i.exec(url.pathname);
  if (infoMatch) {
    return { id: infoMatch[1]! };
  }
  return null;
}

export class WowInterfaceProvider extends AddonProvider {
  override name = PROVIDER_ID.WowInterface;
  override enabled = true;
  override allowReinstall = true;
  override allowChannelChange = false;
  override allowEdit = true;
  override authRequired = false;

  constructor(private network: NetworkClient) {
    super();
  }

  isValidAddonId(addonId: string): boolean {
    return ID_RE.test(addonId);
  }

  override async resolveUrl(url: string, installation: WowInstallation): Promise<AddonSearchResult | undefined> {
    const parsed = parseWowInterfaceQuery(url);
    return parsed ? this.getById(parsed.id, installation) : undefined;
  }

  override async getById(addonId: string, _installation: WowInstallation): Promise<AddonSearchResult | undefined> {
    if (!this.isValidAddonId(addonId)) {
      return undefined;
    }
    const [details] = await this.fetchDetails([addonId]);
    return details ? this.toSearchResult(details) : undefined;
  }

  override async getAll(_installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    const validIds = addonIds.filter((id) => this.isValidAddonId(id));
    const detailsList = await this.fetchDetails(validIds);
    const searchResults = detailsList.map((d) => this.toSearchResult(d));
    const foundIds = new Set(detailsList.map((d) => String(d.id)));
    const errors: Error[] = addonIds
      .filter((id) => !foundIds.has(id))
      .map(() => new ProviderError(PROVIDER_ID.WowInterface, "This addon is no longer available from its source", "source_removed"));
    return { searchResults, errors };
  }

  override tocId(toc: Toc): string | undefined {
    return toc.wowInterfaceId;
  }

  /**
   * TOC-based matching (X-WoWI-ID), same as CurseForge's.
   * WowInterface serves one file, taken to be the one installed.
   */
  override scan(installation: WowInstallation, addonFolders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    return this.scanByTocId(installation, addonFolders, (addon) => addon.files?.[0]);
  }

  override async getDescription(addonId: string): Promise<string | undefined> {
    const [details] = await this.fetchDetails([addonId]);
    return details?.description ?? "";
  }

  override async getChangelog(addonId: string, _installation: WowInstallation): Promise<string | undefined> {
    const [details] = await this.fetchDetails([addonId]);
    return details?.changeLog ?? "";
  }

  // ---- internals ----

  /**
   * v4 primary, v3 fallback, matching upstream exactly. Missing ids are
   * simply absent from the returned array (live-confirmed: a mixed
   * valid+invalid batch returns HTTP 200 with only the valid entries) —
   * never a partial-failure exception, so callers just check array
   * membership rather than catching per-id errors.
   */
  private async fetchDetails(ids: string[]): Promise<WowiFileDetailsV4[]> {
    if (ids.length === 0) {
      return [];
    }
    const joined = ids.join(",");
    try {
      const v4 = await this.network.getJson<WowiFileDetailsV4[]>(`${API_V4}/${joined}.json`);
      if (Array.isArray(v4)) {
        return v4;
      }
    } catch (err) {
      if (!(err instanceof NetworkError)) {
        throw err;
      }
      // fall through to the v3 fallback
    }
    try {
      const v3 = await this.network.getJson<WowiFileDetailsV3[]>(`${API_V3}/${joined}.json`);
      return Array.isArray(v3) ? v3.map(v3ToV4) : [];
    } catch (err) {
      if (err instanceof NetworkError && err.status === 404) {
        return [];
      }
      throw err;
    }
  }

  private toSearchResult(details: WowiFileDetailsV4): AddonSearchResult {
    const file: AddonSearchResultFile = {
      externalId: details.checksum || undefined,
      channelType: AddonChannelType.Stable,
      version: details.version,
      folders: [],
      gameVersion: "",
      downloadUrl: details.downloadUri,
      releaseDate: new Date(details.lastUpdate).toISOString(),
    };
    return {
      author: details.author,
      externalId: String(details.id),
      externalUrl: `https://www.wowinterface.com/downloads/info${details.id}.html`,
      name: details.title,
      providerName: this.name,
      summary: details.description,
      thumbnailUrl: details.images?.[0]?.thumbUrl ?? "",
      downloadCount: details.downloads,
      files: [file],
      screenshots: (details.images ?? []).map((img) => ({ url: img.imageUrl, thumbnailUrl: img.thumbUrl })),
    };
  }
}
