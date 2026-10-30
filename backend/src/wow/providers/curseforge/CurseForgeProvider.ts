/**
 * CurseForge provider, ported from WowUp's curse-addon-provider.ts
 * (GPL-3.0, commit 89a0981a). See docs/wowup-provenance.md.
 *
 * Upstream parity:
 * - GAME_TYPE_LISTS client-type → gameVersionTypeId mapping (verbatim).
 * - File compatibility: file.sortableGameVersions must contain the
 *   client's gameVersionTypeId; files with exposeAsAlternative are
 *   excluded; latest = highest file id (upstream getLatestFiles).
 * - Search: GET /v1/mods/search with sortField=1 (Featured), scoped by
 *   the installation's gameVersionTypeId (upstream getSearchResults).
 * - getAll: POST /v1/mods with modIds (upstream getAllIds); missing ids
 *   are reported as errors (SourceRemovedAddonError semantics).
 * - Downloads carry the X-Api-Key header (upstream getDownloadAuth).
 *
 * Deviations (documented):
 * - The API key is user-supplied at runtime (upstream embeds it at build
 *   time in the WowUp.CF flavor); the key is never logged.
 * - Fingerprints scan (murmur2, /v1/fingerprints/432) is not ported yet;
 *   scan() matches TOC X-Curse-Project-ID instead (the toc-id half of
 *   upstream's matching strategy).
 * - files[] is ordered stable-first (channel asc, then file id desc) so
 *   the engine's files[0] convention equals upstream's
 *   getLatestFile(Stable).
 */

import type { NetworkClient } from "../../net/network";
import { NetworkError } from "../../net/network";
import { curseForgeFileVersion } from "./fileVersion";
import type {
  AddonFolder,
  AddonSearchResult,
  AddonSearchResultFile,
  ProviderCategory,
  WowInstallation,
} from "../../models";
import type { Toc } from "../../toc/toc";
import { AddonProvider } from "../addon-provider";
import type {
  ApiKeyTestResult,
  DiscoverList,
  DiscoverPage,
  DownloadAuth,
  GetAllResult,
  ScanMatch,
} from "../addon-provider";
import { AddonChannelType, AddonDependencyType, WowClientType } from "../../types";
import { ProviderError } from "../../errors";
import { CHANGELOG_ENTRY_COUNT, composeChangelog } from "../changelog";
import { classifyCurseForgeError } from "./CurseForgeKeyAuth";
import type {
  CfAddon,
  CfCategoriesResponse,
  CfChangelogResponse,
  CfDescriptionResponse,
  CfFile,
  CfGetFilesResponse,
  CfGetModResponse,
  CfGetModsResponse,
  CfPagination,
  CfSearchModsResponse,
} from "./curseforge-models";
import { PROVIDER_ID } from "../../../api/providers";

const CF_API_BASE_DEFAULT = "https://api.curseforge.com/v1";
/** CurseForge's WoW "Addons" content class (gameId=1's only class, confirmed live via classesOnly=true). */
const WOW_ADDONS_CLASS_ID = 1;
/**
 * The only hosts `X-Api-Key` may ever be sent to,
 * including across a redirect — the API host itself, CurseForge's own
 * CDN domain (`forgecdn.net`; file.downloadUrl values live under
 * subdomains like `edge.forgecdn.net`/`mediafilez.forgecdn.net`,
 * confirmed live to be real, currently-serving hosts under that
 * domain), and `curseforge.com` itself (covers `www.curseforge.com`,
 * used by `websiteDownloadUrl` below). See network.ts's
 * `trustedHostsForHeaders` for why this is necessary at all: a custom
 * header like this one is not part of the Fetch spec's own
 * cross-origin-redirect header-stripping set.
 */
const CURSEFORGE_TRUSTED_HOSTS = ["api.curseforge.com", "forgecdn.net", "curseforge.com"];

/**
 * CurseForge's own website calls this unauthenticated endpoint to
 * trigger a file download for a logged-out visitor — confirmed live to
 * return the real file with no `X-Api-Key` at all. Used as a fallback
 * when the official API's `file.downloadUrl` is null, which happens
 * when the *API key* (not necessarily the mod) isn't granted
 * third-party distribution access: this path isn't gated by that grant
 * at all, since it's the same one a browser uses. Same approach as
 * github.com/julius-retzer/forever-addons's no-key CurseForge fallback.
 * Unofficial and could change without notice — if it ever breaks, the
 * official API's `downloadUrl` (when present) is still tried first.
 */
function websiteDownloadUrl(modId: number, fileId: number): string {
  return `https://www.curseforge.com/api/v1/mods/${modId}/files/${fileId}/download`;
}

/**
 * Upstream GAME_TYPE_LISTS (curse-addon-provider.ts L58-99, v2.24.1),
 * verbatim. Forever (`_forever_`) and Forever Beta (`_classic_beta_`) share
 * CurseForge's "WoW Forever" category (88568, slug "wow-forever"); the beta
 * slot was Mists until WowUp v2.24.0. Blizzard reuses that slot for whatever
 * Classic-flavor beta is currently running, so the beta's row can go stale
 * again: docs/wow-client-identity.md has the trace and the re-verification
 * steps (`GET /v1/games/1/version-types`).
 */
const GAME_TYPE_LISTS: Array<{ flavor: string; typeId: number; matches: WowClientType[] }> = [
  {
    flavor: "wow_classic",
    typeId: 67408,
    matches: [WowClientType.ClassicEra, WowClientType.ClassicEraPtr],
  },
  { flavor: "wow-wrath-classic", typeId: 73713, matches: [] },
  {
    flavor: "wow_retail",
    typeId: 517,
    matches: [WowClientType.Retail, WowClientType.RetailPtr, WowClientType.Beta, WowClientType.RetailXPtr],
  },
  {
    flavor: "wow-burning-crusade-classic",
    typeId: 73246,
    matches: [WowClientType.Anniversary],
  },
  { flavor: "wow-cataclysm-classic", typeId: 77522, matches: [] },
  {
    flavor: "wow-mists-of-pandaria-classic",
    typeId: 79434,
    matches: [WowClientType.Classic, WowClientType.ClassicPtr],
  },
  { flavor: "wow-wrath-titan", typeId: 81212, matches: [] },
  { flavor: "wow-forever", typeId: 88568, matches: [WowClientType.Forever, WowClientType.ClassicBeta] },
];

/** CurseForge FileRelationType → the dependency kinds we keep. */
const CF_RELATION: Record<number, AddonDependencyType | undefined> = {
  1: AddonDependencyType.Embedded,
  2: AddonDependencyType.Optional,
  3: AddonDependencyType.Required,
};

/** Upstream CF2FileReleaseType → channel. */
function channelForReleaseType(releaseType: number): AddonChannelType {
  switch (releaseType) {
    case 3:
      return AddonChannelType.Alpha;
    case 2:
      return AddonChannelType.Beta;
    default:
      return AddonChannelType.Stable;
  }
}

export function gameVersionTypeIdFor(clientType: WowClientType): number {
  const entry = GAME_TYPE_LISTS.find((gtl) => gtl.matches.includes(clientType));
  if (!entry) {
    throw new ProviderError(PROVIDER_ID.Curse, "CurseForge doesn't support this WoW version");
  }
  return entry.typeId;
}

export class CurseForgeProvider extends AddonProvider {
  override name = PROVIDER_ID.Curse;
  override enabled = false;
  override allowReinstall = true;
  override allowChannelChange = true;
  override allowEdit = true;
  override authRequired = true;

  /** Per-instance cache — see getCategories' doc comment for scope reasoning. */
  private categoriesCache: ProviderCategory[] | null = null;

  constructor(
    private network: NetworkClient,
    /**
     * Returns the currently *active* CurseForge API key (never
     * logged) — bundled or user, per CurseForgeAuthService's own
     * priority rules. A plain `() => key` closure (as every existing
     * test in curseforge-provider.test.ts already passes) still works
     * unchanged; this provider has no concept of "bundled vs user"
     * itself, only "whatever key I was handed."
     */
    private keyProvider: () => string | undefined,
    /** Overridable for tests. */
    private baseUrl: string = CF_API_BASE_DEFAULT,
    /**
     * Called after every real (non-health-check)
     * request this provider makes, success (`null`) or failure —
     * feeds CurseForgeAuthService.recordNormalOutcome so a definitive
     * auth failure can trigger the bundled→user fallback. Optional and
     * defaulting to a no-op so this stays a purely additive,
     * non-breaking constructor param: every existing 2-arg test call
     * keeps working exactly as before, since nothing here changes the
     * actual request behavior, only this side-channel reporting.
     */
    private reportOutcome: (err: unknown | null) => void = () => {},
  ) {
    super();
  }

  /** Usable only with a configured key. */
  isConfigured(): boolean {
    return !!this.keyProvider();
  }

  private requireHeaders(): Record<string, string> {
    const key = this.keyProvider();
    if (!key) {
      throw new ProviderError(PROVIDER_ID.Curse, "CurseForge isn't available. Check Options › CurseForge", "curse_no_api_key");
    }
    return { "X-Api-Key": key };
  }

  /**
   * Wraps one authenticated request so its outcome always reaches
   * `reportOutcome`, regardless of which of this provider's methods
   * made it. Deliberately NOT woven into `requireHeaders()` itself
   * (which only builds headers, it doesn't know if the request that
   * follows ever actually completes) — every method below wraps its
   * own network call(s) in this instead of changing what each
   * individual call looks like.
   */
  private async withAuthReporting<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.reportOutcome(null);
      return result;
    } catch (err) {
      this.reportOutcome(err);
      throw err;
    }
  }

  // ---- file selection (upstream getLatestFiles/isCfFileCompatible) ----

  isCfFileCompatible(file: CfFile, clientType: WowClientType): boolean {
    if (Array.isArray(file.sortableGameVersions) && file.sortableGameVersions.length > 0) {
      const gameVersionTypeId = gameVersionTypeIdFor(clientType);
      return file.sortableGameVersions.some((sgv) => sgv.gameVersionTypeId === gameVersionTypeId);
    }
    return false;
  }

  getLatestFiles(addon: CfAddon, clientType: WowClientType): CfFile[] {
    const filtered = addon.latestFiles.filter(
      (f) => f.exposeAsAlternative !== true && this.isCfFileCompatible(f, clientType),
    );
    return filtered.sort((a, b) => b.id - a.id);
  }

  /**
   * `mod.latestFiles` is a denormalized snapshot CurseForge computes
   * and caches on the mod object. For an addon that publishes many
   * times a day (e.g. "Controller Forever", which has been observed to
   * publish 2-4 releases/day), this is exactly the kind of field most
   * exposed to server-side propagation lag. `/v1/mods/{id}/files` is
   * the dedicated, paginated file list, which returns the true newest
   * file immediately. Used for getById only (the path behind
   * both install and updateAddon's freshness check — the two places
   * accuracy matters most); search/getAll keep using the snapshot to
   * avoid an extra request per result. Falls back to the snapshot if
   * this call fails, so a transient error here doesn't break getById().
   */
  private async getLatestFilesAuthoritative(
    addon: CfAddon,
    addonId: string,
    clientType: WowClientType,
  ): Promise<CfFile[]> {
    try {
      const response = await this.network.getJson<CfGetFilesResponse>(`${this.baseUrl}/mods/${addonId}/files`, {
        headers: this.requireHeaders(),
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
        query: {
          gameVersionTypeId: String(gameVersionTypeIdFor(clientType)),
          pageSize: "50",
        },
      });
      const files = (response?.data ?? []).filter(
        (f) => f.exposeAsAlternative !== true && this.isCfFileCompatible(f, clientType),
      );
      if (files.length) {
        return files.sort((a, b) => b.id - a.id);
      }
    } catch {
      // fall through to the snapshot below
    }
    return this.getLatestFiles(addon, clientType);
  }

  // ---- Discover/Browse (CurseForge-specific, not part of the generic
  // AddonProvider surface: WowUpHub/TukUI have no equivalent, so these
  // live here rather than forcing meaningless stubs on every provider) ----

  /**
   * Shared GET /v1/mods/search request for Discover/Browse, differing
   * from searchByQuery only by sortField and real pagination params.
   * sortField semantics: 2 = Popularity (a CurseForge-internal,
   * not-purely-download-count metric), 3 = LastUpdated.
   * CurseForge's own `pagination.totalCount` is capped at 10000 for
   * broad queries — not treated as an exact total; callers should cap
   * displayed page counts against their own configured maximum too.
   */
  private async searchSorted(
    sortField: "2" | "3",
    installation: WowInstallation,
    index: number,
    pageSize: number,
    categoryId?: string,
  ): Promise<{ results: AddonSearchResult[]; pagination: CfPagination }> {
    return this.withAuthReporting(async () => {
      const query: Record<string, string> = {
        gameId: "1",
        sortField,
        sortOrder: "desc",
        index: String(index),
        pageSize: String(pageSize),
        gameVersionTypeId: String(gameVersionTypeIdFor(installation.clientType)),
      };
      if (categoryId) {
        query.categoryId = categoryId;
      }
      const response = await this.network.getJson<CfSearchModsResponse & { pagination: CfPagination }>(
        `${this.baseUrl}/mods/search`,
        { headers: this.requireHeaders(), trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS, query },
      );
      const results: AddonSearchResult[] = [];
      for (const addon of response?.data ?? []) {
        const files = this.getLatestFiles(addon, installation.clientType);
        if (!files.length) {
          continue;
        }
        const searchResult = this.toSearchResult(addon, files);
        if (searchResult) {
          results.push(searchResult);
        }
      }
      return {
        results,
        pagination: response?.pagination ?? { index, pageSize, resultCount: results.length, totalCount: results.length },
      };
    });
  }

  /** Discover / Latest Addons: sortField=3 (LastUpdated). */
  async getLatestAddons(
    installation: WowInstallation,
    index: number,
    pageSize: number,
  ): Promise<{ results: AddonSearchResult[]; pagination: CfPagination }> {
    return this.searchSorted("3", installation, index, pageSize);
  }

  /**
   * Browse / Popular: sortField=2 (Popularity — CurseForge's "current
   * popularity", not raw lifetime downloads). `categoryId` is
   * CurseForge's own numeric category id as a
   * string — passed straight through to /v1/mods/search's `categoryId`
   * param, the exact mechanism WowUp's curse-addon-provider.ts uses
   * (getCategoryAddons) alongside the same sortField/sortOrder, just via
   * a hardcoded category enum rather than the live endpoint below.
   */
  /** Latest is sorted by last update, Popular by CurseForge's popularity (see below). */
  override async getDiscoverPage(
    list: DiscoverList,
    installation: WowInstallation,
    offset: number,
    count: number,
    categoryId?: string,
  ): Promise<DiscoverPage> {
    const { results, pagination } =
      list === "latest"
        ? await this.getLatestAddons(installation, offset, count)
        : await this.getPopularAddons(installation, offset, count, categoryId);
    return { results, totalCount: pagination.totalCount };
  }

  async getPopularAddons(
    installation: WowInstallation,
    index: number,
    pageSize: number,
    categoryId?: string,
  ): Promise<{ results: AddonSearchResult[]; pagination: CfPagination }> {
    return this.searchSorted("2", installation, index, pageSize, categoryId);
  }

  /**
   * Addon categories for Browse/Popular filtering: GET
   * /v1/categories?gameId=1&classId=1 — classId=1 ("Addons") is WoW's
   * only content class, so this needs no other scoping; category lists
   * aren't gameVersionTypeId-scoped either (the same 31 top-level
   * categories apply regardless of selected flavor), so a single
   * per-provider-instance cache is the correct scope — not
   * per-installation.
   *
   * Only top-level categories are surfaced (parentCategoryId === the
   * classId): CurseForge's 72 categories include subcategories (e.g.
   * "Warrior" under "Class") that would make the filter list unusably
   * long for this panel's width; WowUp's own hardcoded AddonCategory
   * enum is similarly flat/top-level only, not a deep tree.
   *
   * Sorted alphabetically for scannability in a narrow, non-searchable
   * list — CurseForge's own `displayIndex` ordering is preserved
   * nowhere else in this plugin's UI, so there's no consistency
   * argument for keeping it.
   */
  override async getCategories(_installation: WowInstallation): Promise<ProviderCategory[]> {
    if (this.categoriesCache) {
      return this.categoriesCache;
    }
    return this.withAuthReporting(async () => {
      const response = await this.network.getJson<CfCategoriesResponse>(`${this.baseUrl}/categories`, {
        headers: this.requireHeaders(),
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
        query: { gameId: "1", classId: String(WOW_ADDONS_CLASS_ID) },
      });
      const categories = (response?.data ?? [])
        .filter((c) => c.parentCategoryId === WOW_ADDONS_CLASS_ID)
        .map((c) => ({ id: String(c.id), name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.categoriesCache = categories;
      return categories;
    });
  }

  // ---- AddonProvider surface ----

  override async searchByQuery(query: string, installation: WowInstallation): Promise<AddonSearchResult[]> {
    return this.withAuthReporting(async () => {
      const response = await this.network.getJson<CfSearchModsResponse>(`${this.baseUrl}/mods/search`, {
        headers: this.requireHeaders(),
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
        query: {
          gameId: "1",
          searchFilter: query,
          sortField: "1", // Featured (upstream default)
          sortOrder: "desc",
          index: "0",
          gameVersionTypeId: String(gameVersionTypeIdFor(installation.clientType)),
        },
      });
      const results: AddonSearchResult[] = [];
      for (const addon of response?.data ?? []) {
        const files = this.getLatestFiles(addon, installation.clientType);
        if (!files.length) {
          continue;
        }
        const searchResult = this.toSearchResult(addon, files);
        if (searchResult) {
          results.push(searchResult);
        }
      }
      return results;
    });
  }

  override async getById(addonId: string, installation: WowInstallation): Promise<AddonSearchResult | undefined> {
    return this.withAuthReporting(async () => {
      const response = await this.network.getJson<CfGetModResponse>(`${this.baseUrl}/mods/${addonId}`, {
        headers: this.requireHeaders(),
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
      });
      const addon = response?.data;
      if (!addon) {
        return undefined;
      }
      const files = await this.getLatestFilesAuthoritative(addon, addonId, installation.clientType);
      if (!files.length) {
        return undefined;
      }
      return this.toSearchResult(addon, files);
    });
  }

  override async getAll(_installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    if (!addonIds.length) {
      return { searchResults: [], errors: [] };
    }
    return this.withAuthReporting(() => this.getAllInner(_installation, addonIds));
  }

  private async getAllInner(_installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    const response = await this.network.postJson<CfGetModsResponse>(`${this.baseUrl}/mods`, {
      headers: this.requireHeaders(),
      trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
      body: { modIds: addonIds.map((id) => parseInt(id, 10)) },
    });
    const searchResults: AddonSearchResult[] = [];
    const errors: Error[] = [];
    for (const addon of response?.data ?? []) {
      const installation = _installation;
      const files = this.getLatestFiles(addon, installation.clientType);
      if (files.length) {
        const sr = this.toSearchResult(addon, files);
        if (sr) {
          searchResults.push(sr);
        }
      }
    }
    for (const id of addonIds) {
      if (!(response?.data ?? []).some((a) => String(a.id) === id)) {
        errors.push(new ProviderError(PROVIDER_ID.Curse, "This addon is no longer available from its source", "source_removed"));
      }
    }
    return { searchResults, errors };
  }

  override async scan(installation: WowInstallation, addonFolders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    if (!this.isConfigured()) {
      return new Map();
    }
    // A TOC project id says which addon, not which release. Best-effort
    // recover the release: if the TOC's version string is one of the addon's
    // known files, that file's id IS solid evidence of what's installed.
    // Without it installedExternalReleaseId stays unset forever and
    // needsUpdate() falls back to comparing the TOC's version string with
    // files[0]'s provider-formatted one, which routinely disagree even for
    // the same release: a permanent false update. See
    // docs/wow-client-identity.md and AddonInstaller's needsUpdate note.
    return this.scanByTocId(installation, addonFolders, (addon, toc) =>
      addon.files?.find((f) => f.version === toc.version),
    );
  }

  override tocId(toc: Toc): string | undefined {
    return toc.curseProjectId;
  }

  override isValidAddonId(addonId: string): boolean {
    return /^\d+$/.test(addonId);
  }

  /**
   * Validate an API key against the CurseForge API (cheap endpoint;
   * the dedicated health-check — `isKeyCheckEndpoint: true` below is
   * what makes this specific 403 trustworthy, see
   * classifyCurseForgeError's own doc comment). Distinguishes
   * confirmed edge rejections from merely-inconclusive failures
   * (network/rate-limit/server issues) via the same classifier
   * CurseForgeAuthService uses, and gives an actionable hint — users
   * frequently paste the key *id* (a UUID) instead of the key itself.
   */
  override async testApiKey(apiKey: string): Promise<ApiKeyTestResult> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidHint = UUID_RE.test(apiKey.trim())
      ? " UUID-shaped values are unusual for API keys — make sure you copied the key value itself."
      : "";
    try {
      await this.network.getJson(`${this.baseUrl}/games`, {
        headers: { "X-Api-Key": apiKey.trim() },
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
        query: { pageSize: "1" },
      });
    } catch (err) {
      const code = err instanceof NetworkError ? err.status ?? null : null;
      const evidence = classifyCurseForgeError(err, true);
      if (evidence === "invalid_key") {
        return {
          ok: false,
          httpStatus: code,
          message: `CurseForge rejected this key (${code}).${uuidHint} Verified on-device: even real browsers get 403 for keys CurseForge's edge does not accept, so this is a key problem, not a network one.`,
          confirmed: true,
        };
      }
      return {
        ok: false,
        httpStatus: code,
        message: `Could not verify this key right now: ${err instanceof Error ? err.message : String(err)}. This may be a temporary network or CurseForge issue rather than an invalid key.`,
        confirmed: false,
      };
    }

    // Authenticating is not enough: CurseForge can accept a key yet withhold
    // downloads (`downloadUrl: null` on every file). A key that can download
    // nothing, officially or through websiteDownloadUrl(), counts as invalid,
    // so the UI offers the other key source.
    const downloadCapability = await this.testDownloadCapability(apiKey);
    if (downloadCapability === "failed") {
      return {
        ok: false,
        httpStatus: null,
        message:
          "This key is accepted by CurseForge, but neither the official download link nor the public-website fallback works for a real addon file right now — installs will fail. This usually means the key hasn't been granted (or has lost) third-party distribution access.",
        confirmed: true,
      };
    }
    return { ok: true, httpStatus: 200, message: "Key accepted by CurseForge." };
  }

  /**
   * Picks the single most popular WoW addon right now (self-selecting,
   * not a hardcoded id, so this never depends on one specific addon
   * staying available forever) and verifies a real download URL for it
   * resolves to something actually reachable — the official
   * `downloadUrl` if present, otherwise the `websiteDownloadUrl()`
   * fallback. A HEAD probe only, never downloads the actual file.
   */
  private async testDownloadCapability(apiKey: string): Promise<"ok" | "failed" | "inconclusive"> {
    try {
      const search = await this.network.getJson<CfSearchModsResponse>(`${this.baseUrl}/mods/search`, {
        headers: { "X-Api-Key": apiKey.trim() },
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
        query: {
          gameId: "1",
          classId: String(WOW_ADDONS_CLASS_ID),
          sortField: "2",
          sortOrder: "desc",
          pageSize: "1",
        },
      });
      const addon = search?.data?.[0];
      const file = addon?.latestFiles?.[0];
      if (!addon || !file) {
        return "inconclusive";
      }
      if (file.downloadUrl) {
        return "ok";
      }
      return await this.network.headOk(websiteDownloadUrl(addon.id, file.id), {
        trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
      });
    } catch (err) {
      return classifyCurseForgeError(err, false) === "invalid_key" ? "failed" : "inconclusive";
    }
  }

  /**
   * Details modal Description: GET /v1/mods/{id}/description — the
   * real client's own data source, not guessed from the public docs
   * alone. Returns the full HTML
   * description (richer than `summary`, which is the short plain-text
   * blurb already used elsewhere). An empty string is a genuine "no
   * description" — distinct from a thrown NetworkError, which the
   * caller must not collapse into the same state (CurseForge's Featured
   * endpoint returning 403 for an otherwise-valid key is the same class
   * of pitfall: a failure response must never be read as "no content").
   *
   * Returned raw, not flattened through richTextToPlain: the frontend
   * only used to render this as a plain React string child, so there
   * was nowhere for real markup to go, but it's since gained a real
   * Markdown/HTML renderer (src/markdown.ts, DOMPurify-sanitized) that
   * `marked` passes raw HTML blocks straight through to (`marked.parse
   * ("<p>x</p>")` returns `<p>x</p>` unchanged), so returning the real
   * HTML here now renders correctly instead of needing to be thrown
   * away first.
   */
  override async getDescription(addonId: string): Promise<string | undefined> {
    return this.withAuthReporting(async () => {
      const response = await this.network.getJson<CfDescriptionResponse>(
        `${this.baseUrl}/mods/${addonId}/description`,
        { headers: this.requireHeaders(), trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS },
      );
      return response?.data ?? "";
    });
  }

  /**
   * Details modal Changelog: GET /v1/mods/{id}/files/{fileId}/changelog,
   * same source as Description, for the CHANGELOG_ENTRY_COUNT most recent
   * compatible files. File ids aren't known to callers (SearchResult only
   * carries the addon id) — resolve the installation's compatible files
   * (newest first) via the same authoritative path getById already uses,
   * rather than duplicating that resolution logic here. See
   * getDescription's comment on returning raw HTML.
   */
  override async getChangelog(addonId: string, installation: WowInstallation): Promise<string | undefined> {
    const result = await this.getById(addonId, installation); // reports its own outcome already
    // files[] is stable-first, not newest-first (see toSearchResult), so
    // order by file id here to get the genuinely most recent releases.
    const files = (result?.files ?? [])
      .filter((f) => f.externalId)
      .sort((a, b) => parseInt(b.externalId!, 10) - parseInt(a.externalId!, 10))
      .slice(0, CHANGELOG_ENTRY_COUNT);
    if (!files.length) {
      return "";
    }
    return this.withAuthReporting(async () => {
      const bodies = await Promise.all(
        files.map(async (file) => {
          const response = await this.network.getJson<CfChangelogResponse>(
            `${this.baseUrl}/mods/${addonId}/files/${file.externalId}/changelog`,
            { headers: this.requireHeaders(), trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS },
          );
          return response?.data ?? "";
        }),
      );
      return composeChangelog(
        files.map((file, i) => ({
          title: file.version,
          channelType: file.channelType,
          releaseDate: file.releaseDate,
          body: bodies[i],
        })),
      );
    });
  }

  /**
   * Uses the same `keyProvider()` every other method here reads from,
   * plus the same `trustedHostsForHeaders` allowlist, so a redirect
   * during the actual file download can never carry this key to an
   * untrusted host either. Download success/failure is deliberately
   * NOT fed back into auth-state reporting — a failed download is far
   * more likely a CDN/network issue, unrelated to API authentication,
   * than proof the key itself is bad, and DownloadService/
   * AddonInstaller have no hook back into this provider's outcome
   * reporting to begin with.
   */
  override getDownloadAuth(): Promise<DownloadAuth | undefined> {
    if (!this.isConfigured()) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      headers: { "X-Api-Key": this.keyProvider()! },
      trustedHostsForHeaders: CURSEFORGE_TRUSTED_HOSTS,
    });
  }

  // ---- mapping ----

  private toSearchResult(addon: CfAddon, files: CfFile[]): AddonSearchResult | undefined {
    try {
      const searchResultFiles: AddonSearchResultFile[] = files.map((f) => ({
        channelType: channelForReleaseType(f.releaseType),
        version: curseForgeFileVersion(f.displayName, f.fileDate),
        downloadUrl: f.downloadUrl ?? websiteDownloadUrl(addon.id, f.id),
        folders: f.modules.map((m) => m.name),
        gameVersion: f.gameVersions[0] ?? "",
        releaseDate: f.fileDate,
        // CurseForge relationType: 1 embedded library, 2 optional, 3
        // required (4 tool, 5 incompatible, 6 include are not kept). Only
        // required ones are installed along (AddonService); the others are
        // shown on the Details Relationships page (WF-11).
        dependencies: (f.dependencies ?? []).flatMap((d) => {
          const type = CF_RELATION[d.relationType];
          return type ? [{ externalAddonId: String(d.modId), type }] : [];
        }),
        externalId: String(f.id),
      }));
      // stable first, then newest file id — so files[0] equals upstream's
      // getLatestFile(Stable) which the engine's update flow expects
      searchResultFiles.sort(
        (a, b) =>
          a.channelType - b.channelType ||
          parseInt(b.externalId ?? "0", 10) - parseInt(a.externalId ?? "0", 10),
      );
      return {
        author: addon.authors
          .map((a) => a.name)
          .filter((n) => !n.toLowerCase().startsWith("_forgeuser"))
          .join(", "),
        externalId: String(addon.id),
        name: addon.name,
        thumbnailUrl: addon.logo?.thumbnailUrl ?? "",
        externalUrl: addon.links?.websiteUrl ?? "",
        providerName: this.name,
        files: searchResultFiles,
        downloadCount: addon.downloadCount,
        favoriteCount: addon.favoriteCount,
        summary: addon.summary,
        screenshots: (addon.screenshots ?? []).map((s) => ({
          url: s.url,
          thumbnailUrl: s.thumbnailUrl,
          title: s.title,
        })),
      };
    } catch (err) {
      console.error(`[curseforge] failed to map addon ${addon.id}: ${String(err)}`);
      return undefined;
    }
  }
}
