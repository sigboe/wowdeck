/**
 * Download service: fetch an addon archive to a temporary file with
 * progress reporting. Replaces WowUp's Electron net.request download path.
 *
 * Every file gets a folder of its own under the managed download dir, so
 * two archives held at once (a preview beside an install) never clobber
 * each other. Its owner removes it (`release`); the archive module
 * (ReleaseArchive) does that on every path.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DownloadAuth } from "../providers/addon-provider";
import { NetworkClient, NetworkError } from "../net/network";
import { removeDirectory, createDirectory } from "../fs/safe-fs";
import { canonicalLocalArchive } from "../archives/localArchive";

export interface DownloadHandle {
  filePath: string;
  bytes: number;
  /** The file's own folder; `release` removes it. */
  dir: string;
}

export class DownloadService {
  constructor(
    private network: NetworkClient,
    private downloadDir: string,
  ) {
    // What an engine that stopped mid-install left: nothing holds it now.
    rmSync(downloadDir, { recursive: true, force: true });
  }

  /** Download a url into a fresh folder of the managed download dir. */
  async download(
    url: string,
    fileName: string,
    options: { auth?: DownloadAuth } = {},
  ): Promise<DownloadHandle> {
    return this.#into(fileName, async (target) => {
      const bytes = await this.network.downloadToFile(url, target, {
        headers: options.auth?.headers,
        query: options.auth?.queryParams,
        trustedHostsForHeaders: options.auth?.trustedHostsForHeaders,
        timeoutMs: 120_000,
      });
      if (bytes === 0) {
        throw new NetworkError("downloaded file is empty", undefined, url);
      }
      return bytes;
    });
  }

  /**
   * The File provider's "download" (Manual Install, From a file): copy a
   * picked local archive into the managed download dir instead of
   * fetching it — a local file never touches the network. The source is
   * validated again here (still there, still a readable archive file),
   * so an archive deleted or moved between the preview and the Install
   * press fails before anything is staged. The copy is also a snapshot:
   * nothing can change the archive under a running install.
   */
  async copyLocal(source: string, fileName: string): Promise<DownloadHandle> {
    const canonical = await canonicalLocalArchive(source);
    return this.#into(fileName, (target) => Bun.write(target, Bun.file(canonical)));
  }

  /** Remove a handle's file and folder; never throws. */
  async release(handle: DownloadHandle): Promise<void> {
    await removeDirectory(handle.dir).catch(() => {});
  }

  async #into(fileName: string, write: (target: string) => Promise<number>): Promise<DownloadHandle> {
    const dir = join(this.downloadDir, crypto.randomUUID());
    await createDirectory(dir);
    const target = join(dir, fileName.replace(/[/\\]/g, "_"));
    try {
      return { filePath: target, bytes: await write(target), dir };
    } catch (err) {
      await removeDirectory(dir).catch(() => {});
      throw err;
    }
  }
}
