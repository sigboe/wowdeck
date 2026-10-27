/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/addon-provider.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — trimmed to the capability surface this plugin uses
 *   (removed batch fetch, protocol/url search, ads); changelogs and
 *   categories kept as optional overrides (getChangelog, getCategories);
 *   DownloadAuth retained for authenticated downloads. Capabilities are
 *   optional methods, their flags derived from them; URL import is its own
 *   method (resolveUrl) instead of a mode of searchByQuery.
 * See docs/wowup-provenance.md.
 */

import type { AddonFolder, AddonSearchResult, AddonSearchResultFile, ProviderCategory, WowInstallation } from "../models";
import type { Toc } from "../toc/toc";
import type { AddonProviderType } from "../types";
import { getTocForGameType2 } from "../utils/toc";

export interface GetAllResult {
  searchResults: AddonSearchResult[];
  errors: Error[];
}

/**
 * What a provider knows about one scanned folder. AddonService turns it into
 * an addon record (scannedAddonRecord); providers never build records.
 */
export interface ScanMatch {
  addon: AddonSearchResult;
  /** The provider's newest release for the installation: the record's update baseline. */
  latestFile: AddonSearchResultFile;
  /** The release on disk, when the provider can tell which one it is. */
  installedFile?: AddonSearchResultFile;
}

/** Get Addons' browse lists (Catalogue.discover). */
export type DiscoverList = "latest" | "popular";

export interface DiscoverPage {
  results: AddonSearchResult[];
  /** Length of this provider's whole list. */
  totalCount: number;
}

export interface ApiKeyTestResult {
  ok: boolean;
  httpStatus: number | null;
  message: string;
  /**
   * Whether `ok: false` is a *confirmed*
   * rejection (bad/revoked credential — safe to refuse saving it,
   * mark it invalid) versus merely inconclusive (network error, rate
   * limit, server hiccup — must NOT be treated as proof the key is
   * bad). Omitted (or `true`) for a confirmed result either way;
   * `false` only when the provider genuinely couldn't tell. Providers
   * that have no such distinction (e.g. GitHub, whose only non-200
   * outcome it specifically checks for is already an unambiguous 401)
   * simply never set this field — a missing field reads as confirmed,
   * preserving every existing caller's current behavior unchanged.
   */
  confirmed?: boolean;
}

export interface DownloadAuth {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  /**
   * Hosts `headers` may be sent to, including across a redirect —
   * forwarded straight through to
   * NetworkClient's `trustedHostsForHeaders` (see its own doc comment
   * for why a plain `redirect: "follow"` isn't safe for a credential-
   * bearing header). Omit for a provider whose download headers carry
   * nothing worth protecting.
   */
  trustedHostsForHeaders?: string[];
}

export abstract class AddonProvider {
  public name: AddonProviderType = "Unknown";
  public enabled = false;
  public allowReinstall = false;
  public allowChannelChange = false;
  /**
   * Whether this provider's `enabled` flag can be toggled by the user
   * at all — ported from upstream. Upstream's Options UI filters its provider
   * list on exactly this flag (`allowEdit`/`canEdit`), and
   * `setProviderEnabled()` refuses to flip a provider where this is
   * false. GitHub sets this to `false` (always available, never a
   * settings toggle); every other provider keeps the default `true`.
   */
  public allowEdit = true;
  public authRequired = false;

  /*
   * Capabilities: a provider has one when it implements the method behind
   * it. The flags below are read from the methods, never set, so a
   * provider cannot advertise a list or a search it does not have
   * (ADR-0002: Get Addons builds its browse bar from them).
   */

  /**
   * Fetch current metadata for a set of managed addons (update checks, scan
   * by TOC id). A direct link or a local file has nothing to ask: update
   * checks skip it rather than flag every such addon as gone from its
   * source. Upstream forced those addons to ignored instead (`forceIgnore`),
   * which here would hide them from My Addons.
   */
  public getAll?(installation: WowInstallation, addonIds: string[]): Promise<GetAllResult>;

  /**
   * Search the catalog by name (Get Addons' Search, finding sources).
   * GitHub, WowInterface and direct links have no catalog to search: a URL
   * is their only way in (resolveUrl). Upstream's WowInterface is likewise
   * toggleable and scanned but never searched.
   */
  public searchByQuery?(query: string, installation: WowInstallation): Promise<AddonSearchResult[]>;

  /** The addon a pasted URL names (Install from URL), or undefined when it names none of this provider's. */
  public resolveUrl?(url: string, installation: WowInstallation): Promise<AddonSearchResult | undefined>;

  /**
   * `count` items of this provider's Latest or Popular list from `offset`,
   * in its own order; upstream's getFeaturedAddons. Addons without a
   * release for the installation's game version are left out, so a page
   * can come back short. `categoryId` is a CurseForge category
   * (addons.getCategories): a provider without that category has nothing
   * in it.
   */
  public getDiscoverPage?(
    list: DiscoverList,
    installation: WowInstallation,
    offset: number,
    count: number,
    categoryId?: string,
  ): Promise<DiscoverPage>;

  /**
   * Addon categories this provider's catalog can be filtered by, never
   * invented for a provider without a category system of its own. An empty
   * list is a valid answer.
   */
  public getCategories?(installation: WowInstallation): Promise<ProviderCategory[]>;

  /** In the generic name search (ProviderInfo.catalogSearch). */
  public get catalogSearch(): boolean {
    return !!this.searchByQuery;
  }

  /** Has Get Addons' Latest and Popular lists (ProviderInfo.discovers). */
  public get discovers(): boolean {
    return !!this.getDiscoverPage;
  }

  /** Fetch one addon by its provider id. */
  public getById(
    _addonId: string,
    _installation: WowInstallation,
  ): Promise<AddonSearchResult | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * Match scanned addon folders against the provider catalog (by
   * fingerprint or TOC ids), keyed by folder name. The folders are the ones
   * no provider earlier in the scan order has matched.
   */
  public scan(_installation: WowInstallation, _addonFolders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    return Promise.resolve(new Map());
  }

  /**
   * This provider's id for the addon, from the TOC tag its authors set
   * (X-Curse-Project-ID, X-WoWI-ID, X-Tukui-ProjectID); upstream's
   * ADDON_PROVIDER_TOC_EXTERNAL_ID_MAP, kept with each provider. Undefined
   * when the TOC names none or the provider has no tag.
   */
  public tocId(_toc: Toc): string | undefined {
    return undefined;
  }

  /**
   * scan() by the project id in the folder's TOC (tocId): one getAll for
   * every id found. Load-on-demand TOCs don't count, as upstream.
   * `installedFile` picks the release on disk, if it can.
   */
  protected async scanByTocId(
    installation: WowInstallation,
    addonFolders: AddonFolder[],
    installedFile: (addon: AddonSearchResult, toc: Toc) => AddonSearchResultFile | undefined,
  ): Promise<Map<string, ScanMatch>> {
    const found = addonFolders.flatMap((folder) => {
      if (!folder.tocs.some((toc) => !!this.tocId(toc) && toc.loadOnDemand !== "1")) {
        return [];
      }
      const toc = getTocForGameType2(folder, installation.clientType);
      const id = toc && this.tocId(toc);
      return toc && id ? [{ folder, toc, id }] : [];
    });
    const matches = new Map<string, ScanMatch>();
    if (!found.length || !this.getAll) {
      return matches;
    }
    const { searchResults } = await this.getAll(installation, [...new Set(found.map((f) => f.id))]);
    for (const { folder, toc, id } of found) {
      const addon = searchResults.find((sr) => sr.externalId === id);
      const latestFile = addon?.files?.[0];
      if (addon && latestFile) {
        matches.set(folder.name, { addon, latestFile, installedFile: installedFile(addon, toc) });
      }
    }
    return matches;
  }

  /** Whether this provider can manage the given scanned addon. */
  public isValidAddonId(_addonId: string): boolean {
    return false;
  }

  /** Extra auth applied to the download request for this provider. */
  public getDownloadAuth(): Promise<DownloadAuth | undefined> {
    return Promise.resolve(undefined);
  }

  /** True when required configuration (API key, token) is present. */
  public isConfigured(): boolean {
    return true;
  }

  /** Validate a candidate API key/token against the provider (optional). */
  public testApiKey(_apiKey: string): Promise<ApiKeyTestResult> {
    return Promise.resolve({ ok: false, httpStatus: null, message: "provider does not use API keys" });
  }

  /**
   * Full rich-text description for the Details modal.
   * `undefined` means "this provider doesn't support it" — a distinct,
   * non-error state from "supported but empty" (`null`/`""`).
   */
  public getDescription(_addonId: string): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * Most recent release's changelog for the Details modal. Same
   * `undefined`-means-unsupported convention as above.
   */
  public getChangelog(_addonId: string, _installation: WowInstallation): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}
