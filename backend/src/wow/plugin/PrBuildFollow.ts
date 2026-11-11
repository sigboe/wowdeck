/**
 * The PR channel's source (GLOSSARY: PR channel): where a running PR
 * build's PR stands, for the plugin update check (PluginUpdateCheck), which
 * asks it under its own daily cadence and failure backoff. Listed: the PR's
 * build on the PR builds list. Otherwise GitHub's API is asked, without any
 * token, whether the PR was merged (and whether the newest beta contains
 * the merge commit), closed, or is open but unlisted.
 */

import type { NetworkClient } from "../net/network";
import { compareVersions, isBetaVersion, normalizeVersion } from "./PluginVersion";
import { isRecord, type PrBuildList, type PublishedPrBuild } from "./PrBuildList";

/**
 * Where a PR stands. "listed": still on the PR builds list, with its
 * listed build. "merged": `beta` is the newest beta when its commit
 * contains the PR's merge commit; null while no such beta exists or that
 * can't be told. "closed": closed without merging. "unlisted": still open,
 * but no longer on the list (the label was removed).
 */
export type PrStanding =
  | { state: "listed"; build: PublishedPrBuild }
  | { state: "merged"; beta: string | null }
  | { state: "closed" }
  | { state: "unlisted" };

export class PrBuildFollow {
  constructor(
    private prBuilds: Pick<PrBuildList, "list">,
    private net: Pick<NetworkClient, "getJson">,
    /** The repo's API root (https://api.github.com/repos/<owner>/<repo>). */
    private repoApiUrl: string,
  ) {}

  /** Where PR `number` stands, or null when that couldn't be read (offline, rate limited). Never throws. */
  async standing(number: number): Promise<PrStanding | null> {
    const builds = await this.prBuilds.list();
    if (builds === null) return null;
    const listed = builds.find((b) => b.number === number);
    if (listed !== undefined) return { state: "listed", build: listed };
    const pull = await this.#get<GithubPull>(`${this.repoApiUrl}/pulls/${number}`);
    if (!isRecord(pull)) return null;
    if (typeof pull.merged_at === "string") {
      const mergeSha = typeof pull.merge_commit_sha === "string" ? pull.merge_commit_sha : null;
      return { state: "merged", beta: await this.#betaWith(mergeSha) };
    }
    return pull.state === "closed" ? { state: "closed" } : { state: "unlisted" };
  }

  /**
   * The newest beta, when its commit contains the PR's merge commit (GitHub's
   * compare says the beta's tag is ahead of the merge or identical to it);
   * null otherwise, and whenever that can't be read, so Beta is never offered
   * before a beta with the merge exists. Publish times prove nothing: a beta
   * run that started before the merge can publish after it.
   */
  async #betaWith(mergeSha: string | null): Promise<string | null> {
    if (mergeSha === null || !SHA1_HEX.test(mergeSha)) return null;
    const releases = await this.#get<GithubRelease[]>(`${this.repoApiUrl}/releases?per_page=100`);
    if (!Array.isArray(releases)) return null;
    let newest: { version: string; tag: string } | null = null;
    for (const release of releases) {
      if (!isRecord(release) || release.draft === true || typeof release.tag_name !== "string") continue;
      const version = normalizeVersion(release.tag_name);
      if (version === null || !isBetaVersion(version)) continue;
      if (newest === null || (compareVersions(version, newest.version) ?? 0) > 0) {
        newest = { version, tag: release.tag_name };
      }
    }
    if (newest === null) return null;
    const comparison = await this.#get<GithubComparison>(
      `${this.repoApiUrl}/compare/${mergeSha}...${encodeURIComponent(newest.tag)}`,
    );
    const status = isRecord(comparison) ? comparison.status : undefined;
    return status === "ahead" || status === "identical" ? newest.version : null;
  }

  /** One unauthenticated GitHub API call; null when it failed. */
  async #get<T>(url: string): Promise<T | null> {
    try {
      return await this.net.getJson<T>(url, { headers: GH_HEADERS });
    } catch (err) {
      // An expected state (offline, rate limited). The message is the
      // network layer's own, already redacted; no token is ever sent here.
      console.error(`[pr-builds] PR state unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/** The fields read from GitHub's pull request answer. */
interface GithubPull {
  state?: unknown;
  merged_at?: unknown;
  merge_commit_sha?: unknown;
}

/** The fields read from GitHub's releases answer. */
interface GithubRelease {
  tag_name?: unknown;
  draft?: unknown;
}

/** The field read from GitHub's compare answer (base...head). */
interface GithubComparison {
  /** ahead, behind, diverged or identical: head relative to base. */
  status?: unknown;
}

const SHA1_HEX = /^[0-9a-f]{40}$/;
