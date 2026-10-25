/**
 * GitHub Releases addon provider (project-owned — not ported
 * from WowUp's github-addon-provider.ts). Written clean-room after
 * investigating upstream's behavior: the real REST calls, the
 * release.json convention, and the flavor vocabulary are the same real
 * addon-ecosystem conventions upstream also follows, but the selection
 * algorithm and error handling deliberately diverge from upstream in
 * three ways upstream's own open issues identify as bugs:
 *
 *  - no silent flavor-agnostic fallback when nothing compatible is found
 *    (upstream issue #1283 — wrong-flavor installs happen silently there)
 *  - `browser_download_url` used consistently for install AND update
 *    (upstream issues #107/#103 — its authenticated-endpoint update path
 *    returns JSON instead of the zip body, corrupting installs)
 *  - `installedExternalReleaseId`/`externalLatestReleaseId` are actually
 *    populated, so AddonService.needsUpdate()'s id-pair comparison works
 *    (upstream never sets these for GitHub, falling back to a fragile
 *    filename-string comparison instead)
 *
 * Public repos only — no PAT/token UI, no private-repo support. See §3
 * of the investigation doc for the generic-Git/GitLab scope decision.
 */

import type { AddonSearchResult, AddonSearchResultFile, WowInstallation } from "../../models";
import { AddonChannelType, WowClientType } from "../../types";
import type { NetworkClient } from "../../net/network";
import { NetworkError } from "../../net/network";
import { AddonProvider, type GetAllResult } from "../addon-provider";
import { ProviderError } from "../../errors";
import { getClientTypeLabel } from "../../utils/gametype";
import { CHANGELOG_ENTRY_COUNT, composeChangelog } from "../changelog";
import { parseUrlAllowingMissingScheme } from "../url-parsing";
import type { GhRelease, GhReleaseAsset, GhReleaseJson, GhRepo } from "./github-models";
import { PROVIDER_ID } from "../../../api/providers";

const API_BASE = "https://api.github.com";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/** Upstream checks only its top 5 most-recently-published releases; replicated here (see investigation finding #3). */
const RELEASE_LOOKBACK = 5;

// GitHub owner names are letters, digits and hyphens: never a dot, so a
// host name ("example.org/Addon.zip", a direct link without https://) is no owner.
const OWNER_REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The Nix flake-ref shorthand: `github:<owner>/<repo>`, optionally with a
 * rev-or-ref segment and `?params` (grammar from Nix's src/nix/flake.md:
 * `github:<owner>/<repo>(/<rev-or-ref>)?(\?<params>)?`). Reimplemented
 * here from that documentation, not from Nix's parser (Nix is LGPL-2.1;
 * only the grammar is taken). A rev-or-ref or params name a branch, tag
 * or commit — a pin an addon installer can't honor, since addons come
 * from releases — so the whole reference identifies the repository and
 * nothing more, exactly like a pasted releases-page URL. The scheme
 * matches any casing, like a URL scheme; no other scheme's owner/repo
 * form (gitlab:, gist:, …) ever matches.
 */
const GITHUB_SHORTHAND_RE = /^github:([^?#]+)/i;

/**
 * Filename-suffix heuristic, used only when a release has no release.json
 * (or it's unreadable). Same suffix family addon authors actually use
 * (and the one upstream's filename fallback uses) — anchored, case-
 * insensitive. Order doesn't matter: each releases' assets are tested
 * against every entry.
 */
const CLASSIC_FLAVOR_SUFFIXES: Array<{ flavor: string; re: RegExp }> = [
  { flavor: "classic", re: /[-_](vanilla|classic)\.zip$/i },
  { flavor: "bcc", re: /[-_](bc|bcc|tbc)\.zip$/i },
  { flavor: "wrath", re: /[-_](wrath|wotlkc)\.zip$/i },
  { flavor: "cata", re: /[-_]cata\.zip$/i },
  { flavor: "mists", re: /[-_]mists\.zip$/i },
];

/** Which known classic-flavor suffix (if any) a filename carries. `null` = no classic suffix matched (mainline candidate). */
function flavorForFilename(filename: string): string | null {
  for (const { flavor, re } of CLASSIC_FLAVOR_SUFFIXES) {
    if (re.test(filename)) {
      return flavor;
    }
  }
  return null;
}

/**
 * release.json / filename flavor strings this client type accepts.
 *
 * Deliberately diverges from upstream's own mapping (which puts
 * ClassicBeta under "mists") — reuses this project's own already-
 * corrected CurseForgeProvider.GAME_TYPE_LISTS mapping instead: the
 * ClassicBeta slot is a rotating "whatever's currently testing" slot with
 * no stable release.json flavor of its own, and "wrath"/"cata" currently
 * match no installable client type at all. See investigation finding #5.
 */
function flavorsForClientType(clientType: WowClientType): string[] {
  switch (clientType) {
    case WowClientType.ClassicEra:
    case WowClientType.ClassicEraPtr:
      return ["classic"];
    case WowClientType.Anniversary:
      return ["bcc"];
    case WowClientType.Classic:
    case WowClientType.ClassicPtr:
      return ["mists"];
    case WowClientType.Retail:
    case WowClientType.RetailPtr:
    case WowClientType.Beta:
    case WowClientType.RetailXPtr:
      return ["mainline"];
    default:
      return [];
  }
}

function byPublishedDesc(a: GhRelease, b: GhRelease): number {
  return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
}

/**
 * Pick the best asset in one release for this client type, or `undefined`
 * if nothing in this release is compatible. release.json, when present
 * and parseable, is authoritative for that release — a release with a
 * release.json that doesn't list a compatible flavor is NOT retried with
 * the filename heuristic (that heuristic exists for addons that never
 * adopted release.json at all, not as a second guess against one that
 * disagrees with the filenames).
 */
export function pickAssetForRelease(
  release: GhRelease,
  releaseJson: GhReleaseJson | undefined,
  clientType: WowClientType,
): GhReleaseAsset | undefined {
  const acceptedFlavors = flavorsForClientType(clientType);
  if (acceptedFlavors.length === 0) {
    return undefined;
  }
  const zipAssets = release.assets.filter((a) => a.name.toLowerCase().endsWith(".zip"));

  if (releaseJson) {
    for (const entry of releaseJson.releases) {
      if (entry.nolib) {
        continue;
      }
      const entryFlavors = (entry.metadata ?? []).map((m) => m.flavor);
      if (!entryFlavors.some((f) => acceptedFlavors.includes(f))) {
        continue;
      }
      const asset = zipAssets.find((a) => a.name === entry.filename);
      if (asset) {
        return asset;
      }
    }
    return undefined;
  }

  const nonNolib = zipAssets.filter((a) => !/nolib/i.test(a.name));
  const wantsMainline = acceptedFlavors.includes("mainline");
  for (const asset of nonNolib) {
    const filenameFlavor = flavorForFilename(asset.name);
    if (filenameFlavor === null) {
      if (wantsMainline) {
        return asset;
      }
    } else if (acceptedFlavors.includes(filenameFlavor)) {
      return asset;
    }
  }
  return undefined;
}

/**
 * Parse a pasted GitHub repo URL, a bare "owner/repo" string, or the
 * Nix-style "github:owner/repo" shorthand. Strict host check
 * (`=== "github.com"`), unlike upstream's loose `.endsWith("com")`
 * (investigation finding #1) — anything else returns `null` rather
 * than guessing. A URL with extra path segments (e.g. a releases-page
 * link) still resolves to just owner/repo.
 */
export function parseGitHubRepoQuery(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  const shorthand = GITHUB_SHORTHAND_RE.exec(trimmed);
  if (shorthand) {
    const segments = shorthand[1]!.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    return { owner: segments[0]!, repo: segments[1]!.replace(/\.git$/i, "") };
  }
  if (OWNER_REPO_RE.test(trimmed)) {
    const [owner, repo] = trimmed.split("/");
    return { owner: owner!, repo: repo!.replace(/\.git$/i, "") };
  }
  // "github.com/owner/repo" with no scheme (most people don't type
  // https:// when pasting a site's own address) still resolves — see
  // parseUrlAllowingMissingScheme's own doc comment.
  const url = parseUrlAllowingMissingScheme(trimmed);
  if (!url) {
    return null;
  }
  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return { owner: segments[0]!, repo: segments[1]!.replace(/\.git$/i, "") };
}

export class GitHubProvider extends AddonProvider {
  override name = PROVIDER_ID.GitHub;
  override enabled = true;
  // URL import is a dedicated Install from URL section — never
  // dispatched from the generic name-search box, and never a
  // settings toggle (see allowEdit below), and never a scan participant
  // (AddonService's SCAN_ORDER). URL import calls this provider directly
  // (see AddonService.resolveUrlImport).
  override allowReinstall = true;
  override allowChannelChange = false;
  // Matches upstream exactly (github-addon-provider.ts: allowEdit = false)
  // — GitHub is always available and is never shown in the Settings
  // provider-toggle list. Enforced defensively in ProviderRegistry too,
  // not just hidden in the UI.
  override allowEdit = false;
  // No meaningful searchByQuery for catalog text search — only URL
  // resolution, used by the Install from URL dispatcher directly.
  override catalogSearch = false;
  override authRequired = false;

  constructor(
    private network: NetworkClient,
    /** Optional GitHub personal access token (never logged). */
    private tokenProvider: () => string | undefined = () => undefined,
  ) {
    super();
  }

  isValidAddonId(addonId: string): boolean {
    return OWNER_REPO_RE.test(addonId);
  }

  /**
   * Raises the unauthenticated rate limit (60/hr -> 5000/hr)
   * and incidentally exposes metadata for private repos the token can
   * see. Deliberately NOT used for asset downloads — upstream
   * does extend its token to downloads via the authenticated asset API
   * endpoint, which is exactly the endpoint whose Accept-header handling
   * caused its still-open JSON-as-zip corruption bugs. getDownloadAuth()
   * stays unconditionally undefined regardless of token state, so a
   * private repo's metadata may resolve while its actual download still
   * fails with a plain, honest error — never a silently wrong/corrupt one.
   */
  private authHeaders(): Record<string, string> {
    const token = this.tokenProvider();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Validate a candidate token against a cheap, scope-free endpoint.
   * `rate_limit` works for any token (or none) and never
   * requires repo access, so a 401 here unambiguously means "this token
   * itself is rejected", not "this token lacks access to some repo".
   */
  override async testApiKey(apiKey: string): Promise<{ ok: boolean; httpStatus: number | null; message: string }> {
    try {
      await this.network.getJson(`${API_BASE}/rate_limit`, {
        headers: { ...GH_HEADERS, Authorization: `Bearer ${apiKey.trim()}` },
      });
      return { ok: true, httpStatus: 200, message: "Token accepted by GitHub." };
    } catch (err) {
      const status = err instanceof NetworkError ? err.status ?? null : null;
      if (status === 401) {
        return { ok: false, httpStatus: 401, message: "GitHub rejected this token (401) — it may be invalid, expired, or revoked." };
      }
      return {
        ok: false,
        httpStatus: status,
        message: `Could not verify token: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  override async searchByQuery(query: string, installation: WowInstallation): Promise<AddonSearchResult[]> {
    const parsed = parseGitHubRepoQuery(query);
    if (!parsed) {
      return [];
    }
    const result = await this.getById(`${parsed.owner}/${parsed.repo}`, installation);
    return result ? [result] : [];
  }

  override async getById(addonId: string, installation: WowInstallation): Promise<AddonSearchResult | undefined> {
    const resolved = await this.resolveCompatible(addonId, installation);
    return resolved ? this.toSearchResult(resolved.repo, resolved.release, resolved.asset) : undefined;
  }

  /**
   * Full-text README: GitHub has no addon
   * description/changelog concept of its own, and WowUp's real GitHub
   * provider implements neither (confirmed by reading
   * github-addon-provider.ts directly — only TukUI, WowInterface, and
   * WowUpHub override these upstream) — there is no upstream mechanism
   * to copy. The repo's README is the closest honest substitute: fetched
   * via the dedicated README endpoint (not guessed filenames/branches),
   * using the `raw` media type so the response body IS the markdown
   * text directly, no base64 decoding needed. A repo with no README
   * returns "" (a genuine absence, not an error).
   */
  override async getDescription(addonId: string): Promise<string | undefined> {
    const parsed = this.splitAddonId(addonId);
    if (!parsed) {
      return undefined;
    }
    try {
      return await this.network.getText(`${API_BASE}/repos/${parsed.owner}/${parsed.repo}/readme`, {
        headers: { Accept: "application/vnd.github.raw+json", ...this.authHeaders() },
      });
    } catch (err) {
      if (err instanceof NetworkError && err.status === 404) {
        return "";
      }
      throw this.mapRateLimit(err, addonId);
    }
  }

  /**
   * The matched release's own notes, followed by the releases just before
   * it (up to CHANGELOG_ENTRY_COUNT in total). The first entry is the exact
   * same release `getById` would resolve to for the active client, so its
   * body describes precisely what would be installed, not some unrelated
   * "latest release overall"; newer releases without a compatible asset are
   * deliberately left out, as before.
   */
  override async getChangelog(addonId: string, installation: WowInstallation): Promise<string | undefined> {
    const resolved = await this.resolveCompatible(addonId, installation);
    if (!resolved) {
      return "";
    }
    const matchedIndex = resolved.candidates.findIndex((r) => r.id === resolved.release.id);
    const releases = resolved.candidates.slice(Math.max(0, matchedIndex), Math.max(0, matchedIndex) + CHANGELOG_ENTRY_COUNT);
    return composeChangelog(
      releases.map((r) => ({
        title: r.tag_name || r.name || "Release",
        channelType: r.prerelease ? AddonChannelType.Beta : AddonChannelType.Stable,
        releaseDate: r.published_at ?? undefined,
        body: r.body,
      })),
    );
  }

  private async resolveCompatible(
    addonId: string,
    installation: WowInstallation,
  ): Promise<{ repo: GhRepo; release: GhRelease; asset: GhReleaseAsset; candidates: GhRelease[] } | undefined> {
    const parsed = this.splitAddonId(addonId);
    if (!parsed) {
      return undefined;
    }
    const repo = await this.fetchRepo(parsed.owner, parsed.repo);
    if (!repo) {
      return undefined;
    }
    const releases = await this.fetchReleases(repo.owner.login, repo.name);
    const nonDraft = releases.filter((r) => !r.draft);
    if (nonDraft.length === 0) {
      return undefined;
    }
    const stable = nonDraft.filter((r) => !r.prerelease).sort(byPublishedDesc);
    const prerelease = nonDraft.filter((r) => r.prerelease).sort(byPublishedDesc);
    const candidates = (stable.length > 0 ? stable : prerelease).slice(0, RELEASE_LOOKBACK);

    for (const release of candidates) {
      const releaseJson = await this.fetchReleaseJson(release);
      const asset = pickAssetForRelease(release, releaseJson, installation.clientType);
      if (asset) {
        return { repo, release, asset, candidates };
      }
    }

    throw new ProviderError(
      PROVIDER_ID.GitHub,
      `no release compatible with ${getClientTypeLabel(installation.clientType)} found in the ${candidates.length} most recent release(s) of ${repo.full_name}`,
      "github_no_compatible_release",
    );
  }

  override async getAll(installation: WowInstallation, addonIds: string[]): Promise<GetAllResult> {
    const searchResults: AddonSearchResult[] = [];
    const errors: Error[] = [];
    for (const id of addonIds) {
      try {
        const result = await this.getById(id, installation);
        if (result) {
          searchResults.push(result);
        } else {
          errors.push(new ProviderError(PROVIDER_ID.GitHub, "This addon is no longer available from its source", "source_removed"));
        }
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    return { searchResults, errors };
  }

  // ---- internals ----

  private splitAddonId(addonId: string): { owner: string; repo: string } | undefined {
    if (!this.isValidAddonId(addonId)) {
      return undefined;
    }
    const [owner, repo] = addonId.split("/");
    return { owner: owner!, repo: repo! };
  }

  private async fetchRepo(owner: string, repo: string): Promise<GhRepo | undefined> {
    try {
      return await this.network.getJson<GhRepo>(`${API_BASE}/repos/${owner}/${repo}`, {
        headers: { ...GH_HEADERS, ...this.authHeaders() },
      });
    } catch (err) {
      if (err instanceof NetworkError && err.status === 404) {
        return undefined;
      }
      throw this.mapRateLimit(err, `${owner}/${repo}`);
    }
  }

  private async fetchReleases(owner: string, repo: string): Promise<GhRelease[]> {
    try {
      return await this.network.getJson<GhRelease[]>(`${API_BASE}/repos/${owner}/${repo}/releases`, {
        headers: { ...GH_HEADERS, ...this.authHeaders() },
        query: { per_page: "30" },
      });
    } catch (err) {
      if (err instanceof NetworkError && err.status === 404) {
        return [];
      }
      throw this.mapRateLimit(err, `${owner}/${repo}`);
    }
  }

  /**
   * release.json is an uploaded release ASSET (not a repo file) — fetched
   * via its own `browser_download_url`, same as any other asset, never
   * the authenticated API asset endpoint (investigation finding #9: that
   * endpoint is the root cause of upstream's JSON-as-zip corruption bug;
   * since this provider never uses it at all, that bug class doesn't
   * apply here regardless of which path reads it). A missing or
   * malformed release.json just means "fall back to the filename
   * heuristic for this release" — not an error.
   */
  private async fetchReleaseJson(release: GhRelease): Promise<GhReleaseJson | undefined> {
    const asset = release.assets.find((a) => a.name === "release.json");
    if (!asset) {
      return undefined;
    }
    try {
      const text = await this.network.getText(asset.browser_download_url);
      const parsed = JSON.parse(text) as GhReleaseJson;
      return Array.isArray(parsed?.releases) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 403-with-zero-remaining and 429 are GitHub's two rate-limit signals
   * (investigation finding #11 — upstream only checks the first). A plain
   * 403 with quota remaining means the repo itself is inaccessible
   * (private); since this provider never authenticates, that's reported
   * as "not supported" rather than retried.
   */
  private mapRateLimit(err: unknown, context: string): Error {
    if (err instanceof NetworkError) {
      if (err.status === 403 && err.headers?.["x-ratelimit-remaining"] === "0") {
        // When it resets (x-ratelimit-reset) goes to the log, not the UI (C06).
        console.error(`[github] rate limited until ${err.headers["x-ratelimit-reset"] ?? "unknown"}`);
        return new ProviderError(PROVIDER_ID.GitHub, "GitHub is limiting requests right now. Try again later", "github_rate_limited");
      }
      if (err.status === 429) {
        return new ProviderError(PROVIDER_ID.GitHub, "GitHub is limiting requests right now. Try again later", "github_rate_limited");
      }
      if (err.status === 403) {
        return new ProviderError(
          PROVIDER_ID.GitHub,
          `repository not accessible: ${context} (private repositories are not supported)`,
          "github_forbidden",
        );
      }
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private toSearchResult(repo: GhRepo, release: GhRelease, asset: GhReleaseAsset): AddonSearchResult {
    // Both GitHub-assigned and immutable regardless of what the author
    // names the tag/file (investigation finding #8/#7 in the design doc):
    // makes needsUpdate()'s release-id comparison correct for GitHub,
    // which upstream's own provider never enables.
    const file: AddonSearchResultFile = {
      externalId: `${release.id}:${asset.id}`,
      channelType: release.prerelease ? AddonChannelType.Beta : AddonChannelType.Stable,
      version: release.tag_name || release.name || asset.name,
      folders: [],
      gameVersion: "",
      downloadUrl: asset.browser_download_url,
      releaseDate: release.published_at ?? new Date(0).toISOString(),
    };
    return {
      author: repo.owner.login,
      externalId: repo.full_name,
      externalUrl: repo.html_url,
      name: repo.name,
      providerName: this.name,
      summary: repo.description ?? "",
      thumbnailUrl: repo.owner.avatar_url ?? "",
      files: [file],
      screenshots: [],
    };
  }
}
