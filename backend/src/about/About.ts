/**
 * Options › About, engine side (about.get). Answers from local files only,
 * so opening About never waits on the network: the third-party notices come
 * from the installed plugin, and the Funding links and Supporters from
 * FUNDING.yml's and SUPPORTERS.md's last good copies or the zip's snapshots
 * (FetchedFile, ADR-0005).
 *
 * refresh() downloads the fetched files again. Only the WoWDeck update check
 * calls it, when it asks GitHub (main.ts wires it to PluginUpdateCheck's
 * onGitHubAsk), so About makes no network calls of its own.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AboutInfo } from "../api/contracts";
import { FetchedFile, type FetchedFileOptions } from "./FetchedFile";
import { FUNDING_FILE, parseFunding } from "./Funding";
import { parseSupporters, SUPPORTERS_FILE } from "./Supporters";

/** Shipped next to LICENSE in the plugin zip (tools/package.py). */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.md";

/** What both fetched files share; pluginDir also holds the notices. */
export type AboutOptions = Omit<FetchedFileOptions, "repoPath">;

export class About {
  readonly #funding: FetchedFile;
  readonly #supporters: FetchedFile;

  constructor(private readonly options: AboutOptions) {
    this.#funding = this.#fetched(FUNDING_FILE);
    this.#supporters = this.#fetched(SUPPORTERS_FILE);
  }

  async get(): Promise<AboutInfo> {
    const [notices, funding, supporters] = await Promise.all([
      this.#notices(),
      this.#funding.read(),
      this.#supporters.read(),
    ]);
    return {
      notices,
      funding: funding === null ? [] : parseFunding(funding),
      supporters: supporters === null ? [] : parseSupporters(supporters),
    };
  }

  /** Download every fetched file once. Never throws; a failure keeps the last good copy. */
  async refresh(): Promise<void> {
    await Promise.all([this.#funding.refresh(), this.#supporters.refresh()]);
  }

  #fetched(repoPath: string): FetchedFile {
    return new FetchedFile({ ...this.options, repoPath });
  }

  async #notices(): Promise<string | null> {
    const { pluginDir } = this.options;
    if (!pluginDir) return null;
    try {
      return await readFile(join(pluginDir, NOTICES_FILE), "utf-8");
    } catch (err) {
      console.error(`[about] couldn't read ${NOTICES_FILE}: ${String(err)}`);
      return null;
    }
  }
}
