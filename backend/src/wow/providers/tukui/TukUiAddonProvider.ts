/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup-lib/src/addon-providers/tukui-addon-provider.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes —
 *   - NetworkInterface -> project NetworkClient (fetch) with TTL cache
 *   - string-similarity dependency replaced by internal Dice implementation
 *   - window.URL -> URL; uuid -> crypto.randomUUID
 *   - changelog/description/category/featured dropped (not in plugin scope)
 *   - search filtered to the installation's flavor via patch tokens
 *   - dates as ISO strings (serializable domain model)
 *   - scan() returns matches; AddonService builds the records
 * See docs/wowup-provenance.md.
 */

import type { AddonFolder, AddonSearchResult, WowInstallation } from "../../models";
import type { Toc } from "../../toc/toc";
import { AddonChannelType, WowClientType } from "../../types";
import type { NetworkClient } from "../../net/network";
import { getTocForGameType2 } from "../../utils/toc";
import { compareTwoStrings, containsIgnoreCase } from "../../utils/string";
import { AddonProvider, type GetAllResult, type ScanMatch } from "../addon-provider";
import type { TukUiAddon } from "./tukui-model";
import { PROVIDER_ID } from "../../../api/providers";

const API_URL = "https://api.tukui.org/v1/addons";
const DOWNLOAD_CT = 2147483647;
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** A scan match and the folders its addon owns, for matching sub-addon folders. */
interface Claim {
  match: ScanMatch;
  folders: string[];
}

export class TukUiAddonProvider extends AddonProvider {
  public readonly name = PROVIDER_ID.TukUI;
  public readonly allowReinstall = true;
  public readonly allowChannelChange = false;
  public readonly allowEdit = true;

  public enabled = true;

  #catalog: { addons: TukUiAddon[]; fetchedAt: number } | null = null;

  constructor(private network: NetworkClient) {
    super();
  }

  public override async getAll(_installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    const validIds = addonIds.filter((aid) => this.isValidAddonId(aid));
    const errors: Error[] = addonIds
      .filter((aid) => !this.isValidAddonId(aid))
      .map((aid) => new Error(`invalid addon id found: ${aid}`));

    let results: AddonSearchResult[] = [];
    try {
      const addons = await this.getCatalog();
      const filtered = addons.filter((a) => validIds.some((id) => id === a.id.toString()));
      results = filtered.map((a) => this.toSearchResult(a)).filter((r): r is AddonSearchResult => !!r);
    } catch (err) {
      console.error(`[TukUI] getAll failed: ${String(err)}`);
    }

    if (results.length !== validIds.length) {
      for (const id of validIds) {
        if (!results.some((r) => r.externalId === id)) {
          errors.push(new Error(`addon not found on provider: ${id}`));
        }
      }
    }

    return { errors, searchResults: results };
  }

  public override async searchByQuery(query: string, _installation: WowInstallation): Promise<AddonSearchResult[]> {
    if (!query) {
      return [];
    }
    const all = await this.getCatalog();
    const flavorMatches = all.filter((a) => this.supportsClientType(a, _installation.clientType));

    const withSimilarity = flavorMatches
      .map((addon) => ({ addon, similarity: compareTwoStrings(query.toLowerCase(), addon.name.toLowerCase()) }))
      .filter((r) => r.similarity > 0.7)
      .sort((a, b) => b.similarity - a.similarity)
      .map((r) => r.addon);

    const matches =
      withSimilarity.length > 0 ? withSimilarity : flavorMatches.filter((a) => containsIgnoreCase(a.name, query));

    return matches.map((a) => this.toSearchResult(a)).filter((r): r is AddonSearchResult => !!r);
  }

  public override async getById(
    addonId: string,
    _installation: WowInstallation,
  ): Promise<AddonSearchResult | undefined> {
    const addons = await this.getCatalog();
    const match = addons.find((a) => a.id.toString() === addonId);
    return match ? this.toSearchResult(match) : undefined;
  }

  public isValidAddonId(addonId: string): boolean {
    return typeof addonId === "string" && !isNaN(parseInt(addonId, 10));
  }

  public override tocId(toc: Toc): string | undefined {
    return toc.tukUiProjectId || undefined;
  }

  public override async scan(installation: WowInstallation, addonFolders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    const allAddons = await this.getCatalog();
    const claims = new Map<string, Claim>();

    // Sort folders to prioritize ones with a toc id
    let tukProjectAddonFolders = [...addonFolders].sort((a, b) => {
      const score = (f: AddonFolder) => (f.tocs.some((toc) => !!this.tocId(toc) && toc.loadOnDemand !== "1") ? 1 : 0);
      return score(b) - score(a);
    });

    // Remove all folders that do not have a matching game type
    tukProjectAddonFolders = tukProjectAddonFolders.filter(
      (af) => getTocForGameType2(af, installation.clientType) !== undefined,
    );

    // Go through all the folders, see if they have an ID we can match.
    this.scanAddonsWithIds(tukProjectAddonFolders, allAddons, installation, claims);

    // See if the non-matched belong to the folder list of any matched ones
    this.matchAddonSubfolders(tukProjectAddonFolders, claims);

    // See if the names match anything that did not have a match
    await this.scanAddonsWithNames(tukProjectAddonFolders, installation, claims);

    // Repeat subfolder matching for remaining non-matched folders
    this.matchAddonSubfolders(tukProjectAddonFolders, claims);

    return new Map([...claims].map(([folderName, claim]) => [folderName, claim.match]));
  }

  // ---- internals ----

  private async getCatalog(): Promise<TukUiAddon[]> {
    if (this.#catalog && Date.now() - this.#catalog.fetchedAt < CATALOG_TTL_MS) {
      return this.#catalog.addons;
    }
    const addons = await this.network.getJson<TukUiAddon[]>(API_URL, { timeoutMs: 30_000 });
    this.#catalog = { addons, fetchedAt: Date.now() };
    return addons;
  }

  private toSearchResult(addon: TukUiAddon): AddonSearchResult | undefined {
    if (!addon) {
      return undefined;
    }
    return {
      author: addon.author,
      externalId: addon.id.toString(),
      name: addon.name,
      thumbnailUrl: addon.screenshot_url,
      externalUrl: addon.web_url,
      providerName: this.name,
      downloadCount: DOWNLOAD_CT,
      summary: addon.small_desc,
      releasedAt: new Date(`${addon.last_update} UTC`).toISOString(),
      files: [
        {
          channelType: AddonChannelType.Stable,
          folders: addon.directories,
          downloadUrl: addon.url,
          gameVersion: addon.patch[0] ?? "",
          version: addon.version,
          releaseDate: new Date(`${addon.last_update} UTC`).toISOString(),
        },
      ],
    };
  }

  /** Whether the catalog entry supports the installation flavor (patch tokens). */
  private supportsClientType(addon: TukUiAddon, clientType: WowClientType): boolean {
    const classicToken = "1.";
    const burningCrusadeToken = "2.";
    const wrathToken = "3.";
    const cataToken = "4.";
    const mistsToken = "5.";

    switch (clientType) {
      case WowClientType.Classic:
      case WowClientType.ClassicPtr:
      case WowClientType.ClassicBeta:
        return addon.patch.some((p) => p.startsWith(mistsToken));
      case WowClientType.ClassicEra:
      case WowClientType.ClassicEraPtr:
        return addon.patch.some((p) => p.startsWith(classicToken));
      case WowClientType.Anniversary:
        return addon.patch.some((p) => p.startsWith(burningCrusadeToken));
      default:
        return addon.patch.some(
          (p) =>
            !p.startsWith(classicToken) &&
            !p.startsWith(burningCrusadeToken) &&
            !p.startsWith(wrathToken) &&
            !p.startsWith(cataToken) &&
            !p.startsWith(mistsToken),
        );
    }
  }

  private scanAddonsWithIds(
    addonFolders: AddonFolder[],
    allAddons: TukUiAddon[],
    installation: WowInstallation,
    claims: Map<string, Claim>,
  ): void {
    for (const addonFolder of addonFolders) {
      const targetToc = getTocForGameType2(addonFolder, installation.clientType);
      if (targetToc === undefined) {
        continue;
      }
      const tocId = this.tocId(targetToc);
      if (tocId) {
        const match = allAddons.find((addon) => addon.id.toString() === tocId);
        if (match === undefined) {
          continue;
        }
        claims.set(addonFolder.name, this.claim(targetToc, addonFolder, match));
      }
    }
  }

  private async scanAddonsWithNames(
    addonFolders: AddonFolder[],
    installation: WowInstallation,
    claims: Map<string, Claim>,
  ): Promise<void> {
    const missingAddons = addonFolders.filter((af) => !claims.has(af.name));

    for (const addonFolder of missingAddons) {
      const targetToc = getTocForGameType2(addonFolder, installation.clientType);
      if (targetToc?.title === undefined) {
        continue;
      }
      const all = await this.getCatalog();
      const flavorMatches = all.filter((a) => this.supportsClientType(a, installation.clientType));
      let matches = flavorMatches
        .map((addon) => ({ addon, similarity: compareTwoStrings(targetToc.title!.toLowerCase(), addon.name.toLowerCase()) }))
        .filter((r) => r.similarity > 0.7)
        .sort((a, b) => b.similarity - a.similarity)
        .map((r) => r.addon);
      if (matches.length === 0) {
        matches = flavorMatches.filter((a) => containsIgnoreCase(a.name, targetToc.title!));
      }
      const first = matches[0];
      if (first === undefined) {
        continue;
      }
      claims.set(addonFolder.name, this.claim(targetToc, addonFolder, first));
    }
  }

  private matchAddonSubfolders(addonFolders: AddonFolder[], claims: Map<string, Claim>): void {
    const matched = [...claims.values()];
    for (const addonFolder of addonFolders) {
      if (claims.has(addonFolder.name)) {
        continue;
      }
      const parent = matched.find((claim) => claim.folders.includes(addonFolder.name));
      if (parent === undefined) {
        continue;
      }
      // this match is just a copy of the parent since its a sub-addon
      claims.set(addonFolder.name, parent);
    }
  }

  /** The folders a TukUI addon owns come from its TOC (X-Tukui-ProjectFolders). */
  private claim(targetToc: Toc, addonFolder: AddonFolder, tukUiAddon: TukUiAddon): Claim {
    const addon = this.toSearchResult(tukUiAddon)!;
    return {
      match: { addon, latestFile: addon.files![0]! },
      folders: targetToc.tukUiProjectFolders
        ? targetToc.tukUiProjectFolders.split(",").map((f) => f.trim())
        : [addonFolder.name],
    };
  }
}
