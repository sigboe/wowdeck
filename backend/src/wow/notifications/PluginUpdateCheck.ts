/**
 * Whether a newer WoWDeck release exists on GitHub — for the plugin
 * itself, not addons: the plugin is not in the official Decky store, so
 * nothing else tells the user an update exists. The check surfaces the
 * release page and the packaged zip; staging that zip for Decky's own
 * installer is system.updateStage's job (UpdateStager).
 *
 * Asks GitHub's `releases/latest` REST API once per engine session — far
 * below the 60 req/h unauthenticated per-IP limit, so this works with zero
 * configuration. The optional GitHub token setting (owned by the addon
 * source, GitHubProvider) is reused opportunistically: when GitHub accepts
 * it — the owner's own token while the repo is still private, say — the
 * check answers through it; when it is unset or rejected, the same call
 * goes out unauthenticated, so a configured token can never make the
 * answer worse than none. `releases/latest` never returns drafts or
 * prereleases, so its tag is the newest stable release.
 *
 * "unknown", never an error: the repo can be private beyond the token's
 * reach (the API answers 404), the Deck can be offline, GitHub can
 * rate-limit, the configured token can be rejected — none of that may
 * surface as a user-facing failure. A session whose check failed stays
 * silent; the next engine session tries again.
 */

import type { NetworkClient } from "../net/network";

const RELEASES_PAGE = "https://github.com/sigboe/wowdeck/releases";
/** tools/package.py names the zip after plugin.json's name, never a version. */
const ZIP_ASSET_NAME = "WoWDeck.zip";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

export interface PluginUpdateStatus {
  status: "current" | "available" | "unknown";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  /** The release's WoWDeck.zip asset (what updateStage downloads), on "available" only. */
  downloadUrl: string | null;
}

/**
 * Compare dotted numeric versions ("1.2.3", "v0.1", "0.1.1"); null when
 * either side is not one ("banana", "1.2.3.4") — the caller treats
 * "can't tell" as unknown rather than guessing an order.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseDotted(a);
  const pb = parseDotted(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

function parseDotted(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){0,2})$/.exec(v.trim());
  return m ? m[1]!.split(".").map(Number) : null;
}

interface GithubLatestRelease {
  tag_name?: string;
  html_url?: string;
  assets?: { name?: string; url?: string; browser_download_url?: string }[];
}

export class PluginUpdateCheck {
  #done: Promise<PluginUpdateStatus> | null = null;

  constructor(
    private net: Pick<NetworkClient, "getJson">,
    private currentVersion: string,
    /** Overridable like HUB_URL, so the integration test points it at its mock. */
    private releasesUrl = "https://api.github.com/repos/sigboe/wowdeck/releases/latest",
    /** The addon source's optional GitHub token, reused when it can read this repo. */
    private tokenProvider: () => string | undefined = () => undefined,
  ) {}

  /** At most once per engine session: every caller shares the first result. */
  checkOnce(): Promise<PluginUpdateStatus> {
    this.#done ??= this.#run();
    return this.#done;
  }

  async #run(): Promise<PluginUpdateStatus> {
    const unknown: PluginUpdateStatus = {
      status: "unknown",
      currentVersion: this.currentVersion,
      latestVersion: null,
      releaseUrl: null,
      downloadUrl: null,
    };
    const token = this.tokenProvider()?.trim();
    // With a token configured, one authenticated attempt and — only if it
    // fails — one unauthenticated retry (the token may be expired, or have
    // no read access to this repo). Without a token, a single attempt.
    let release: GithubLatestRelease | null = null;
    let failure: unknown;
    for (const headers of token
      ? [{ ...GH_HEADERS, Authorization: `Bearer ${token}` }, GH_HEADERS]
      : [GH_HEADERS]) {
      try {
        release = await this.net.getJson<GithubLatestRelease>(this.releasesUrl, { headers });
        break;
      } catch (err) {
        failure = err;
      }
    }
    if (release === null) {
      // Expected states, not failures (private repo 404, offline, rate
      // limited, a rejected token). The message is the network layer's own,
      // already redacted; the token itself is never logged.
      console.error(
        `[plugin-update] check unavailable: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      return unknown;
    }
    const tag = release.tag_name?.trim();
    if (!tag) return unknown;
    const latest = tag.replace(/^v/, "");
    const cmp = compareVersions(latest, this.currentVersion);
    if (cmp === null) return unknown;
    return {
      status: cmp > 0 ? "available" : "current",
      currentVersion: this.currentVersion,
      latestVersion: latest,
      releaseUrl: release.html_url ?? RELEASES_PAGE,
      downloadUrl: cmp > 0 ? zipAssetUrl(release) : null,
    };
  }
}

/**
 * The zip's API asset URL (fetched with Accept: application/octet-stream),
 * else its browser_download_url. Only the API URL serves a private repo's
 * asset to a token; github.com/…/releases/download answers 404 to one.
 */
function zipAssetUrl(release: GithubLatestRelease): string | null {
  const asset = release.assets?.find((a) => a.name === ZIP_ASSET_NAME);
  return asset?.url ?? asset?.browser_download_url ?? null;
}
