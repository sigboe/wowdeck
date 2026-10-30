/**
 * One repo file Options › About reads live from the `next` branch
 * (ADR-0005): SUPPORTERS.md, and .github/FUNDING.yml. The text is untrusted
 * data, only ever parsed, never executed.
 *
 * - read() answers from disk only: the last good copy in the plugin's data
 *   directory, else the snapshot the zip carries, else null.
 * - refresh() downloads the raw file once and, when that works, replaces the
 *   cached copy atomically (temp file, then rename), so a failed or
 *   interrupted refresh keeps the last good copy. It never throws; a failure
 *   is one structured stderr line, as the update check logs its own.
 *
 * Nothing here decides *when* to refresh: About.refresh() runs only when the
 * WoWDeck update check asks GitHub (PluginUpdateCheck's onGitHubAsk).
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeFileAtomic } from "../wow/fs/safe-fs";
import { isHostTrusted, type NetworkClient, ResponseTooLargeError } from "../wow/net/network";
import { SingleFlight } from "../wow/notifications/CheckCadence";

/** The raw files' base: the `next` branch of sigboe/wowdeck. ADR-0005: these paths must never move. */
export const RAW_BASE_URL = "https://raw.githubusercontent.com/sigboe/wowdeck/next";

/** The plugin folder's subfolder holding the zip's snapshots (tools/package.py). */
export const SNAPSHOT_DIR = "about-snapshot";

/** The data directory's subfolder holding the last good copies. */
export const CACHE_DIR = "about";

/**
 * Anything bigger is not a file the project wrote; it's dropped like a
 * failed fetch. The network client stops downloading past it (maxBytes).
 */
export const MAX_FETCHED_BYTES = 64 * 1024;

/**
 * The hosts the GitHub token may go to (dot-suffix match): GitHub's own,
 * whatever WOWDECK_ABOUT_URL points at. Any other base URL is fetched
 * without the token.
 */
const TOKEN_HOSTS = ["github.com", "githubusercontent.com"];

/** Whether `url` is https on one of TOKEN_HOSTS. */
export function isGitHubUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && isHostTrusted(parsed.hostname, TOKEN_HOSTS);
}

export interface FetchedFileOptions {
  /** The file's path in the repo, e.g. "SUPPORTERS.md" or ".github/FUNDING.yml". */
  repoPath: string;
  /** The installed plugin's folder (its SNAPSHOT_DIR); null outside Decky. */
  pluginDir: string | null;
  /** The plugin's data directory (its CACHE_DIR); null (the default) keeps nothing. */
  dataDir?: string | null;
  /** Null (the default) never fetches: the snapshot or cache answers. */
  net?: Pick<NetworkClient, "getText"> | null;
  /**
   * The raw files' base URL; RAW_BASE_URL by default. Overridable like
   * WOWDECK_RELEASES_URL, so the integration test points it at its mock.
   */
  rawBaseUrl?: string;
  /** The optional GitHub token, sent to GitHub hosts only (isGitHubUrl). */
  tokenProvider?: () => string | undefined;
}

export class FetchedFile {
  readonly #refreshing = new SingleFlight<void>();

  constructor(private readonly options: FetchedFileOptions) {}

  /** The file's name in the snapshot and cache folders. */
  get #name(): string {
    return basename(this.options.repoPath);
  }

  /** The last good copy, else the bundled snapshot, else null. Never throws. */
  async read(): Promise<string | null> {
    const { dataDir, pluginDir } = this.options;
    for (const dir of [
      dataDir && join(dataDir, CACHE_DIR),
      pluginDir && join(pluginDir, SNAPSHOT_DIR),
    ]) {
      if (!dir) continue;
      try {
        return await readFile(join(dir, this.#name), "utf-8");
      } catch {
        // not there yet: the next source answers
      }
    }
    return null;
  }

  /** One download; concurrent callers share it. Never throws. */
  refresh(): Promise<void> {
    return this.#refreshing.run(() => this.#refresh());
  }

  async #refresh(): Promise<void> {
    const { net, dataDir } = this.options;
    if (!net || !dataDir) return;
    const text = await this.#download(net);
    if (text === null) return;
    try {
      await writeFileAtomic(join(dataDir, CACHE_DIR, this.#name), text);
    } catch (err) {
      console.error(`[about] couldn't cache ${this.options.repoPath}: ${String(err)}`);
    }
  }

  /**
   * The raw file, or null. On a GitHub host a configured token goes first
   * and an unauthenticated retry follows when it fails, like the update
   * check's (BuildSource), so a token can never make the answer worse than
   * none. The token never follows a redirect off that host.
   */
  async #download(net: Pick<NetworkClient, "getText">): Promise<string | null> {
    const url = `${this.options.rawBaseUrl ?? RAW_BASE_URL}/${this.options.repoPath}`;
    const token = isGitHubUrl(url) ? this.options.tokenProvider?.()?.trim() : undefined;
    const trustedHostsForHeaders = [new URL(url).hostname];
    let failure: unknown;
    const attempts: Record<string, string>[] = token ? [{ Authorization: `Bearer ${token}` }, {}] : [{}];
    for (const headers of attempts) {
      try {
        return await net.getText(url, {
          headers,
          trustedHostsForHeaders,
          maxBytes: MAX_FETCHED_BYTES,
        });
      } catch (err) {
        failure = err;
        // The file itself is too large: a retry without the token gets the same.
        if (err instanceof ResponseTooLargeError) break;
      }
    }
    // The message is the network layer's own, already redacted; the token
    // itself is never logged.
    console.error(
      `[about] ${this.options.repoPath} not refreshed: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
    return null;
  }
}
