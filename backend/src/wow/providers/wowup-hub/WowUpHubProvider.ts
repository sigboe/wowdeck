/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup-lib/src/addon-providers/wowup-addon-provider.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes —
 *   - NetworkInterface -> project NetworkClient (fetch)
 *   - batch fetch/protocol/category/changelog dropped (not in plugin
 *     scope); getAll uses /addons/batch/<gameType> like upstream
 *   - featured (getFeaturedAddons) split into Get Addons' two lists:
 *     its popular list is Popular, its recent list is Latest (upstream
 *     shows both as one list), each kept for a few minutes to page in
 *   - lodash/uuid replaced with native equivalents
 *   - scan() consumes AddonFolder.scanResults.wowup fingerprints and
 *     returns matches; AddonService builds the records
 * See docs/wowup-provenance.md.
 */

import type { AddonFolder, AddonSearchResult, AddonSearchResultFile, WowInstallation } from "../../models";
import { AddonChannelType } from "../../types";
import type { NetworkClient } from "../../net/network";
import { getWowGameType } from "../../utils/gametype";
import { getGameVersion } from "../../utils/gameversion";
import {
  AddonProvider,
  type DiscoverList,
  type DiscoverPage,
  type GetAllResult,
  type ScanMatch,
} from "../addon-provider";
import type {
  GetAddonsByFingerprintResponse,
  GetAddonBatchResponse,
  WowUpAddonReleaseRepresentation,
  WowUpAddonRepresentation,
  WowUpGetAddonResponse,
  WowUpGetFeaturedAddonsResponse,
  WowUpSearchAddonsResponse,
} from "./wowup-hub-models";
import { PROVIDER_ID } from "../../../api/providers";

/** How long a featured list is reused while paging (upstream caches its own requests too). */
const FEATURED_KEEP_MS = 5 * 60_000;

export class WowUpHubProvider extends AddonProvider {
  public readonly name = PROVIDER_ID.WowUpHub;
  public readonly allowReinstall = true;
  public readonly allowChannelChange = true;
  public readonly allowEdit = true;
  public enabled = true;

  /** The featured lists per game type: Get Addons pages through them. */
  #featured = new Map<string, { at: number; lists: Promise<Record<DiscoverList, AddonSearchResult[]>> }>();

  constructor(
    private baseUrl: string,
    private websiteUrl: string,
    private network: NetworkClient,
  ) {
    super();
  }

  public override async scan(installation: WowInstallation, addonFolders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    const gameType = getWowGameType(installation.clientType);
    const matches = new Map<string, ScanMatch>();

    const foldersWithFingerprints = addonFolders.filter((af) => af.scanResults?.wowup !== undefined);

    const fingerprints = foldersWithFingerprints
      .map((af) => af.scanResults!.wowup!.fingerprint)
      .filter((fp): fp is string => typeof fp === "string");

    if (fingerprints.length === 0) {
      return matches;
    }

    const response = await this.getAddonsByFingerprints(fingerprints);

    for (const addonFolder of foldersWithFingerprints) {
      const fingerprint = addonFolder.scanResults!.wowup!.fingerprint;

      const fingerprintMatches = (response?.exactMatches ?? []).filter((exactMatch) =>
        this.hasMatchingFingerprint(fingerprint, exactMatch.matched_release),
      );

      let clientMatch = fingerprintMatches.find((exactMatch) =>
        this.hasGameType(exactMatch.matched_release, gameType),
      );

      if (!clientMatch && fingerprintMatches.length > 0) {
        console.error(`[Hub] no matching client type for ${addonFolder.name}, using fallback`);
        clientMatch = fingerprintMatches[0];
      }

      const match = clientMatch && this.scanMatch(clientMatch, gameType);
      if (match) {
        matches.set(addonFolder.name, match);
      } else if (clientMatch) {
        console.error(`[Hub] matched release of ${addonFolder.name} has no usable version data`);
      }
    }
    return matches;
  }

  public override async getAll(installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    const gameType = getWowGameType(installation.clientType);
    const url = `${this.baseUrl}/addons/batch/${gameType}`;
    const response = await this.network.postJson<GetAddonBatchResponse>(url, {
      body: { addonIds: addonIds.map((id) => parseInt(id, 10)) },
    });

    const searchResults = (response?.addons ?? [])
      .map((addon) => this.getSearchResult(addon, gameType))
      .filter((sr): sr is AddonSearchResult => sr !== undefined);

    const errors = addonIds
      .filter((addonId) => !searchResults.some((sr) => sr.externalId === addonId))
      .map((addonId) => new Error(`addon not found on hub: ${addonId}`));

    return { errors, searchResults };
  }

  public override async searchByQuery(query: string, installation: WowInstallation): Promise<AddonSearchResult[]> {
    const gameType = getWowGameType(installation.clientType);
    const url = new URL(`${this.baseUrl}/addons/search/${gameType}`);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "10");

    const response = await this.network.getJson<WowUpSearchAddonsResponse>(url.toString());

    return (response?.addons ?? [])
      .map((addon) => this.getSearchResult(addon, gameType))
      .filter((sr): sr is AddonSearchResult => sr !== undefined);
  }

  /**
   * Upstream's featured request (count 60, recent 30) as two lists. The Hub
   * has no categories of CurseForge's, so a category has nothing here.
   */
  public override async getDiscoverPage(
    list: DiscoverList,
    installation: WowInstallation,
    offset: number,
    count: number,
    categoryId?: string,
  ): Promise<DiscoverPage> {
    if (categoryId) {
      return { results: [], totalCount: 0 };
    }
    const all = (await this.featured(getWowGameType(installation.clientType)))[list];
    return { results: all.slice(offset, offset + count), totalCount: all.length };
  }

  public override async getById(
    addonId: string,
    installation: WowInstallation,
  ): Promise<AddonSearchResult | undefined> {
    const gameType = getWowGameType(installation.clientType);
    const url = `${this.baseUrl}/addons/${addonId}`;
    const result = await this.network.getJson<WowUpGetAddonResponse>(url);
    return this.getSearchResult(result.addon, gameType);
  }

  public isValidAddonId(addonId: string): boolean {
    const idNumber = parseInt(addonId, 10);
    return !isNaN(idNumber) && isFinite(idNumber) && idNumber > 0;
  }

  // ---- internals ----

  private featured(gameType: string): Promise<Record<DiscoverList, AddonSearchResult[]>> {
    const kept = this.#featured.get(gameType);
    if (kept && Date.now() - kept.at < FEATURED_KEEP_MS) {
      return kept.lists;
    }
    const url = new URL(`${this.baseUrl}/addons/featured/${gameType}`);
    url.searchParams.set("count", "60");
    url.searchParams.set("recent", "30");
    const lists = this.network.getJson<WowUpGetFeaturedAddonsResponse>(url.toString()).then((response) => {
      const toResults = (addons: WowUpAddonRepresentation[] | undefined) =>
        (addons ?? [])
          .map((addon) => this.getSearchResult(addon, gameType))
          .filter((sr): sr is AddonSearchResult => sr !== undefined);
      return { popular: toResults(response?.addons), latest: toResults(response?.recent) };
    });
    // A failed request is not kept: the next page (Retry) asks again.
    lists.catch(() => this.#featured.delete(gameType));
    this.#featured.set(gameType, { at: Date.now(), lists });
    return lists;
  }

  private getAddonsByFingerprints(fingerprints: string[]): Promise<GetAddonsByFingerprintResponse> {
    const url = `${this.baseUrl}/addons/fingerprint`;
    return this.network.postJson<GetAddonsByFingerprintResponse>(url, {
      body: { fingerprints },
    });
  }

  private getAddonReleaseChannel(release: WowUpAddonReleaseRepresentation): AddonChannelType {
    return release.prerelease ? AddonChannelType.Beta : AddonChannelType.Stable;
  }

  private getMatchingVersion(release: WowUpAddonReleaseRepresentation, gameType: string) {
    return release.game_versions.find((gv) => gv.game_type === gameType);
  }

  private filterReleases(representation: WowUpAddonRepresentation, gameType: string) {
    return (representation.releases ?? [])
      .filter((release) => release.game_versions.some((gv) => gv.game_type === gameType))
      .sort((a, b) => b.id - a.id); // newest first
  }

  private hasMatchingFingerprint(
    fingerprint: string,
    release: WowUpAddonReleaseRepresentation | undefined,
  ): boolean {
    if (!release?.addonFolders) {
      return false;
    }
    return release.addonFolders.some((addonFolder) => addonFolder.fingerprint === fingerprint);
  }

  private hasGameType(release: WowUpAddonReleaseRepresentation | undefined, gameType: string): boolean {
    if (!release) {
      return false;
    }
    return this.getMatchingVersion(release, gameType) !== undefined;
  }

  private getSearchResultFile(
    release: WowUpAddonReleaseRepresentation,
    gameType: string,
  ): AddonSearchResultFile | undefined {
    const matchingVersion = this.getMatchingVersion(release, gameType);
    if (!matchingVersion) {
      return undefined;
    }
    return {
      channelType: this.getAddonReleaseChannel(release),
      downloadUrl: release.download_url,
      folders: (release.addonFolders ?? []).map((af) => af.folder_name),
      gameVersion: getGameVersion(matchingVersion?.interface),
      releaseDate: release.published_at,
      version: matchingVersion?.version || release.tag_name || "",
      externalId: release.id.toString(),
      title: release.toc_title ?? matchingVersion?.title,
      authors: matchingVersion?.authors,
    };
  }

  private getSearchResult(
    representation: WowUpAddonRepresentation,
    gameType: string,
  ): AddonSearchResult | undefined {
    const searchResultFiles = this.filterReleases(representation, gameType)
      .map((release) => this.getSearchResultFile(release, gameType))
      .filter((sr): sr is AddonSearchResultFile => sr !== undefined);
    return searchResultFiles.length ? this.toSearchResult(representation, searchResultFiles) : undefined;
  }

  private toSearchResult(representation: WowUpAddonRepresentation, files: AddonSearchResultFile[]): AddonSearchResult {
    const name = files[0]?.title ?? representation.repository_name;
    const authors = files[0]?.authors ?? representation.owner_name ?? "";

    return {
      author: authors,
      externalId: representation.id.toString(),
      externalUrl: `${this.websiteUrl}/addons/${representation.id}`,
      name: name ?? representation.repository_name,
      providerName: this.name,
      thumbnailUrl: representation.image_url || representation.owner_image_url || "",
      downloadCount: representation.total_download_count,
      files,
      summary: representation.description,
    };
  }

  /**
   * A fingerprint names the exact release on disk; it stands as the latest
   * too until the next update check. A release built for another game type
   * is used as is (upstream's fallback).
   */
  private scanMatch(representation: WowUpAddonRepresentation, gameType: string): ScanMatch | undefined {
    const release = representation.matched_release;
    if (!release?.addonFolders) {
      return undefined;
    }
    const file =
      this.getSearchResultFile(release, gameType) ??
      this.getSearchResultFile(release, release.game_versions[0]?.game_type ?? "");
    const addon = file && this.toSearchResult(representation, [file]);
    if (!file || !file.version || !addon?.name) {
      return undefined;
    }
    return { addon, latestFile: file, installedFile: file };
  }
}
