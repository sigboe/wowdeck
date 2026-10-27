/**
 * The catalogue (project-owned): read-only questions to the addon sources —
 * search, Latest and Popular, an addon's details, categories, Install from
 * URL and finding sources for a folder. Changes to installed addons are
 * AddonService's.
 *
 * Search and the Latest/Popular lists follow WowUp's AddonService
 * search/getFeaturedAddons flows (GPL-3.0, commit 4fdae600), one source per
 * list instead of joined. See docs/wowup-provenance.md.
 */

import type { ProviderErrors, SearchResult } from "../../api/contracts";
import { providerDisplayName } from "../../api/providers";
import { NotFoundError, ProviderError, ValidationError } from "../errors";
import type { AddonSearchResult, ProviderCategory, WowInstallation } from "../models";
import type { AddonProvider, DiscoverList } from "../providers/addon-provider";
import type { ProviderRegistry } from "../providers/provider-registry";
import { identifyUrlImportProvider } from "../providers/url-import";
import type { Toc } from "../toc/toc";
import { toWireSearchResult } from "../addons/wire";
import { installsFolder, latestFile } from "../addons/releaseChannel";

/** One addon's identity across providers: its provider and its id there. */
function addonKey(r: Pick<AddonSearchResult, "providerName" | "externalId">): string {
  return `${r.providerName}:${r.externalId}`;
}

/** A provider in the name search: one with a catalog to search. */
type SearchableProvider = AddonProvider & Required<Pick<AddonProvider, "searchByQuery">>;

/** Results kept from each provider for one search. */
const SEARCH_RESULTS_PER_PROVIDER = 10;

/**
 * What finding sources for a folder searches with (AddonService builds it
 * from the folder on disk): the folder a source's release must install,
 * the folder's TOC (its project ids name sources directly), the names to
 * search for, and the provider left out (a managed addon's own).
 */
export interface SourceRequest {
  installation: WowInstallation;
  folderName: string;
  toc: Toc | undefined;
  queries: (string | undefined)[];
  ownProvider?: string;
}

/**
 * Asks every provider at once. A provider that fails never stops the
 * others: it is logged and reported in the returned providerErrors, so the
 * UI can tell a failure from an empty answer. What it answered before
 * failing is kept by `ask`.
 */
async function fanOut<P extends AddonProvider>(
  providers: P[],
  what: string,
  ask: (provider: P) => Promise<void>,
): Promise<ProviderErrors> {
  const providerErrors: ProviderErrors = [];
  await Promise.all(
    providers.map(async (provider) => {
      try {
        await ask(provider);
      } catch (err) {
        console.error(`[catalogue] ${what} failed for ${provider.name}: ${String(err)}`);
        providerErrors.push({ providerId: provider.name, error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
  return providerErrors;
}

export class Catalogue {
  constructor(private registry: ProviderRegistry) {}

  /** A name search of one provider, or of every searchable one (#searchableProviders); most downloaded first. */
  async search(
    query: string,
    installation: WowInstallation,
    providerId?: string,
  ): Promise<{ results: SearchResult[]; providerErrors: ProviderErrors }> {
    if (!query.trim()) {
      return { results: [], providerErrors: [] };
    }
    const providers = this.#searchableProviders().filter((p) => !providerId || p.name === providerId);
    const { results, providerErrors } = await this.#searchProviders(
      providers,
      [query],
      installation,
      SEARCH_RESULTS_PER_PROVIDER,
    );
    return {
      results: results
        .map((r) => this.#wire(r, installation))
        .sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0)),
      providerErrors,
    };
  }

  /**
   * Install from URL: resolves a pasted GitHub/WowInterface URL,
   * GitHub owner/repo shorthand, Nix-style github:owner/repo reference,
   * or a direct https link to an addon archive (WF-09), through the
   * provider's own resolveUrl, outside the name search. Works while the
   * provider is turned off in Options, as upstream's dispatcher does (owner,
   * 2026-10-21): the install goes through too (see AddonService.install),
   * and My Addons tags the addon "Source off".
   */
  async resolveUrlImport(url: string, installation: WowInstallation): Promise<SearchResult> {
    const trimmed = url.trim();
    if (!trimmed) {
      throw new ValidationError("Enter a URL or owner/repository first");
    }
    const providerId = identifyUrlImportProvider(trimmed);
    if (!providerId) {
      throw new ValidationError("That isn't a GitHub or WoWInterface address, or an https link to a .zip, .rar or .7z file");
    }
    const result = await this.#require(providerId).resolveUrl?.(trimmed, installation);
    if (!result) {
      throw new NotFoundError("addon for url", trimmed);
    }
    return this.#wire(result, installation);
  }

  /**
   * One page of a source's Latest or Popular list (Get Addons). One source
   * at a time, picked in the list's Source menu: upstream joins every
   * source into one list and shows an addon two sources host twice.
   */
  async discover(
    list: DiscoverList,
    providerId: string,
    installation: WowInstallation,
    index: number,
    pageSize: number,
    categoryId?: string,
  ): Promise<{ results: SearchResult[]; totalCount: number }> {
    const provider = this.registry.usable(providerId);
    if (!provider?.getDiscoverPage) {
      throw new ProviderError(
        providerId,
        `${providerDisplayName(providerId)} isn't available. Turn it on in Options › Addon sources`,
        "provider_unavailable",
      );
    }
    const { results, totalCount } = await provider.getDiscoverPage(list, installation, index, pageSize, categoryId);
    return { results: results.map((r) => this.#wire(r, installation)), totalCount };
  }

  // Details: every AddonProvider answers, undefined (on the base class)
  // meaning "unsupported", which the wire carries as null; categories are
  // null for a provider without getCategories.

  async getDescription(providerId: string, externalId: string): Promise<string | null> {
    return (await this.#require(providerId).getDescription(externalId)) || null;
  }

  async getChangelog(providerId: string, externalId: string, installation: WowInstallation): Promise<string | null> {
    return (await this.#require(providerId).getChangelog(externalId, installation)) || null;
  }

  async getCategories(providerId: string, installation: WowInstallation): Promise<ProviderCategory[] | null> {
    return (await this.#require(providerId).getCategories?.(installation)) ?? null;
  }

  /** A registered provider, on or off: details of an installed addon stay readable with its source off. */
  #require(providerId: string): AddonProvider {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new NotFoundError("provider", providerId);
    }
    return provider;
  }

  /** Providers in the name search: those with a catalog (GitHub, WoWInterface and direct links only resolve URLs). */
  #searchableProviders(): SearchableProvider[] {
    return this.registry.available().filter((p): p is SearchableProvider => !!p.searchByQuery);
  }

  /**
   * Every provider searched for every query, keeping the first
   * `perProvider` results of each answer, each addon once.
   */
  async #searchProviders(
    providers: SearchableProvider[],
    queries: string[],
    installation: WowInstallation,
    perProvider = Infinity,
  ): Promise<{ results: AddonSearchResult[]; providerErrors: ProviderErrors }> {
    const found = new Map<string, AddonSearchResult>();
    const providerErrors = await fanOut(providers, "search", async (provider) => {
      for (const query of queries) {
        for (const r of (await provider.searchByQuery(query, installation)).slice(0, perProvider)) {
          found.set(addonKey(r), r);
        }
      }
    });
    return { results: [...found.values()], providerErrors };
  }

  /**
   * Sources whose release (on the installation's default channel) installs
   * `request.folderName`, so using one replaces it (WF-12, WF-23): the
   * addons the TOC's project ids name (#tocSources) and the name search
   * for `request.queries`. TOC-named first, then exactly named, then by
   * downloads.
   */
  async findSources(request: SourceRequest): Promise<{ results: SearchResult[]; providerErrors: ProviderErrors }> {
    const { installation, folderName, toc, ownProvider } = request;
    const terms = [...new Set(request.queries.filter((q): q is string => !!q?.trim()))];
    const [searched, named] = await Promise.all([
      this.#searchProviders(this.#searchableProviders(), terms, installation),
      this.#tocSources(installation, toc),
    ]);
    const byKey = new Map(
      [...searched.results, ...named.results]
        // A switch is to another provider's copy: on its own one, other
        // entries are forks or other editions (DEVICE 2026-10-22: Details!'s
        // were its Burning Crusade and Shadowlands beta projects).
        .filter((r) => r.providerName !== ownProvider)
        .map((r) => [addonKey(r), r]),
    );
    const names = new Set(terms.map((q) => q.toLowerCase()));
    const tocNamed = new Set(named.results.map(addonKey));
    // The TOC's id is the author's own word on which addon it is; a name can be shared.
    const first = (r: AddonSearchResult) => 2 * Number(tocNamed.has(addonKey(r))) + Number(names.has(r.name.toLowerCase()));
    const results = [...byKey.values()]
      .filter((r) => installsFolder(latestFile(r.files, installation.defaultAddonChannelType), folderName))
      .sort(
        (a, b) =>
          first(b) - first(a) || (b.downloadCount ?? 0) - (a.downloadCount ?? 0) || a.name.localeCompare(b.name),
      );
    return {
      results: results.map((r) => this.#wire(r, installation)),
      providerErrors: [...searched.providerErrors, ...named.providerErrors],
    };
  }

  /** The addons a TOC names by project id (AddonProvider.tocId), one per usable provider, each asked by id. */
  async #tocSources(
    installation: WowInstallation,
    toc: Toc | undefined,
  ): Promise<{ results: AddonSearchResult[]; providerErrors: ProviderErrors }> {
    const results: AddonSearchResult[] = [];
    const providerErrors = await fanOut(this.registry.available(), "lookup by TOC id", async (provider) => {
      const id = toc && provider.tocId(toc);
      const result = id && provider.isValidAddonId(id) ? await provider.getById(id, installation) : undefined;
      if (result) {
        results.push(result);
      }
    });
    return { results, providerErrors };
  }

  /** A provider result in wire form, its versions picked for the installation's default channel. */
  #wire(result: AddonSearchResult, installation: WowInstallation): SearchResult {
    const provider = this.registry.get(result.providerName);
    return toWireSearchResult(result, installation.defaultAddonChannelType, !!provider?.allowChannelChange);
  }
}
