/**
 * Where an update channel's WoWDeck builds come from. The plugin update
 * check (PluginUpdateCheck) asks the selected channel's source for its
 * candidate builds and offers the newest; the cadence, backoff and toast
 * gate stay in the check, so a source is only "one network answer".
 *
 * Stable is the only source for now: GitHub's `releases/latest`, which
 * never returns drafts or prereleases, so its one candidate is the newest
 * stable release.
 *
 * The optional GitHub token setting (owned by the addon source,
 * GitHubProvider) is reused opportunistically: when GitHub accepts it — the
 * owner's own token while the repo is still private, say — the call answers
 * through it; when it is unset or rejected, the same call goes out
 * unauthenticated, so a configured token can never make the answer worse than
 * none.
 */

import type { NetworkClient } from "../net/network";
import { normalizeVersion } from "./PluginVersion";

/** An update channel's id. Stored as a string so later sources need no migration. */
export type UpdateChannel = "stable";

/** One build a channel offers. */
export interface CandidateBuild {
  /** X.Y.Z or X.Y.Z-beta.N, without a leading v. */
  version: string;
  /** The build's WoWDeck.zip asset (what updateStage downloads), when attached. */
  downloadUrl: string | null;
  /** The release page to point the user at. */
  releaseUrl: string;
  /** The release body (Markdown), when it has one. */
  releaseNotes: string | null;
}

export interface BuildSource {
  /**
   * The channel's candidate builds, or null when the source could not be
   * asked (offline, HTTP 404, rate limited, a rejected token). Never throws;
   * builds without a parseable version are left out.
   */
  candidates(): Promise<CandidateBuild[] | null>;
}

export const RELEASES_PAGE = "https://github.com/sigboe/wowdeck/releases";
/** tools/package.py names the zip after plugin.json's name, never a version. */
const ZIP_ASSET_NAME = "WoWDeck.zip";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  assets?: { name?: string; url?: string; browser_download_url?: string }[];
}

/** Stable: the newest release from `releases/latest`. */
export class GithubLatestReleaseSource implements BuildSource {
  constructor(
    private net: Pick<NetworkClient, "getJson">,
    private releasesUrl: string,
    private tokenProvider: () => string | undefined,
  ) {}

  async candidates(): Promise<CandidateBuild[] | null> {
    const release = await getGithubJson<GithubRelease>(this.net, this.releasesUrl, this.tokenProvider);
    if (release === null) return null;
    const build = candidateOf(release);
    return build ? [build] : [];
  }
}

/**
 * One GitHub API call, plus one unauthenticated retry when a configured
 * token is rejected (it may be expired, or have no read access to this
 * repo). Without a token, a single attempt. Null when every attempt failed.
 */
async function getGithubJson<T>(
  net: Pick<NetworkClient, "getJson">,
  url: string,
  tokenProvider: () => string | undefined,
): Promise<T | null> {
  const token = tokenProvider()?.trim();
  let failure: unknown;
  for (const headers of token ? [{ ...GH_HEADERS, Authorization: `Bearer ${token}` }, GH_HEADERS] : [GH_HEADERS]) {
    try {
      return await net.getJson<T>(url, { headers });
    } catch (err) {
      failure = err;
    }
  }
  // Expected states, not failures (private repo 404, offline, rate
  // limited, a rejected token). The message is the network layer's own,
  // already redacted; the token itself is never logged.
  console.error(`[plugin-update] check unavailable: ${failure instanceof Error ? failure.message : String(failure)}`);
  return null;
}

function candidateOf(release: GithubRelease): CandidateBuild | null {
  const version = release.tag_name ? normalizeVersion(release.tag_name) : null;
  if (version === null) return null;
  return {
    version,
    downloadUrl: zipAssetUrl(release),
    releaseUrl: release.html_url ?? RELEASES_PAGE,
    releaseNotes: release.body?.trim() ? release.body : null,
  };
}

/**
 * The zip's API asset URL (fetched with Accept: application/octet-stream),
 * else its browser_download_url. Only the API URL serves a private repo's
 * asset to a token; github.com/…/releases/download answers 404 to one.
 */
function zipAssetUrl(release: GithubRelease): string | null {
  const asset = release.assets?.find((a) => a.name === ZIP_ASSET_NAME);
  return asset?.url ?? asset?.browser_download_url ?? null;
}
