/**
 * Download service: fetch an addon archive to a temporary file with
 * progress reporting. Replaces WowUp's Electron net.request download path.
 */

import { join } from "node:path";
import type { DownloadAuth } from "../providers/addon-provider";
import { NetworkClient, NetworkError } from "../net/network";
import { removeDirectory, createDirectory } from "../fs/safe-fs";
import { canonicalLocalArchive } from "../archives/localArchive";

export interface DownloadHandle {
  filePath: string;
  bytes: number;
}

export class DownloadService {
  constructor(
    private network: NetworkClient,
    private downloadDir: string,
  ) {}

  /** Download a url into the managed download dir; cleans the dir first. */
  async download(
    url: string,
    fileName: string,
    options: { auth?: DownloadAuth; onProgress?: (received: number, total: number | null) => void } = {},
  ): Promise<DownloadHandle> {
    await removeDirectory(this.downloadDir);
    await createDirectory(this.downloadDir);

    const target = join(this.downloadDir, fileName.replace(/[/\\]/g, "_"));
    try {
      const bytes = await this.network.downloadToFile(url, target, {
        headers: options.auth?.headers,
        query: options.auth?.queryParams,
        trustedHostsForHeaders: options.auth?.trustedHostsForHeaders,
        onProgress: options.onProgress,
        timeoutMs: 120_000,
      });
      if (bytes === 0) {
        throw new NetworkError("downloaded file is empty", undefined, url);
      }
      return { filePath: target, bytes };
    } catch (err) {
      await removeDirectory(this.downloadDir).catch(() => {});
      throw err;
    }
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
    await removeDirectory(this.downloadDir);
    await createDirectory(this.downloadDir);
    const canonical = await canonicalLocalArchive(source);
    const target = join(this.downloadDir, fileName.replace(/[/\\]/g, "_"));
    try {
      const bytes = await Bun.write(target, Bun.file(canonical));
      return { filePath: target, bytes };
    } catch (err) {
      await removeDirectory(this.downloadDir).catch(() => {});
      throw err;
    }
  }

  async cleanup(): Promise<void> {
    await removeDirectory(this.downloadDir).catch(() => {});
  }
}
