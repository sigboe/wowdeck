/**
 * A release archive's whole lifetime (project-owned): acquired (downloaded,
 * or a picked file copied in), read (hash, inspection, where it installs),
 * then disposed. The preview (`addons.inspectArchive`), the archive match
 * before an install and the install itself all hold one of these, so each
 * reads the same bytes the same way, and each `acquire` has one `dispose`.
 *
 * Each archive lives in its own folder (DownloadService), so archives held
 * at once never touch each other's files.
 */

import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PROVIDER_ID } from "../../api/providers";
import type { AddonRecord } from "../addons/AddonRecords";
import { archiveHash, archiveTarget, sameArchive, type ArchiveTarget } from "../addons/archiveMatch";
import type { DownloadHandle, DownloadService } from "../downloads/DownloadService";
import type { AddonProvider } from "../providers/addon-provider";
import type { WowClientType } from "../types";
import { inspectAddonArchive, type ArchiveInspection } from "./ArchiveInspector";

export class ReleaseArchives {
  constructor(
    private downloads: DownloadService,
    /**
     * Scratch root for inspections: on the engine's data filesystem, never
     * inside an installation; each inspection removes its own directory.
     */
    private inspectRoot: string = join(tmpdir(), "wowdeck-inspect"),
  ) {}

  /**
   * Download the release's archive — or, for the File provider, copy the
   * picked archive in: its downloadUrl is a path on this Deck, never a
   * network address. Keyed on the provider (which owns that meaning), not
   * on the URL's shape; copyLocal re-validates the path itself. A failure
   * leaves nothing behind.
   */
  async acquire(provider: AddonProvider, downloadUrl: string): Promise<ReleaseArchive> {
    if (provider.name === PROVIDER_ID.File) {
      return this.local(downloadUrl);
    }
    const auth = await provider.getDownloadAuth().catch(() => undefined);
    return this.#held(await this.downloads.download(downloadUrl, "release.archive", { auth }));
  }

  /** A picked local archive, copied in under its own name (the preview shows it). */
  async local(path: string): Promise<ReleaseArchive> {
    return this.#held(await this.downloads.copyLocal(path, basename(path)));
  }

  #held(handle: DownloadHandle): ReleaseArchive {
    return new ReleaseArchive(handle, this.downloads, this.inspectRoot);
  }
}

export class ReleaseArchive {
  #hash?: Promise<string>;
  readonly #inspections = new Map<WowClientType, Promise<ArchiveInspection>>();
  #disposed = false;

  constructor(
    private handle: DownloadHandle,
    private downloads: DownloadService,
    private inspectRoot: string,
  ) {}

  /** The archive file, valid until `dispose`. */
  get path(): string {
    return this.handle.filePath;
  }

  /** Its content identity (installedArchiveHash); read once. */
  hash(): Promise<string> {
    this.#hash ??= archiveHash(this.path);
    return this.#hash;
  }

  /** What it holds, as the preview card shows it (ArchiveInspector); read once per game version. */
  inspect(clientType: WowClientType): Promise<ArchiveInspection> {
    let inspection = this.#inspections.get(clientType);
    if (!inspection) {
      inspection = inspectAddonArchive(this.path, clientType, this.inspectRoot);
      this.#inspections.set(clientType, inspection);
    }
    return inspection;
  }

  /**
   * Where it installs among one installation's records (archiveTarget):
   * the one decision both the preview and the install read. An archive
   * that cannot be inspected installs no known folders, so only its id
   * can match; the install then fails with its own error.
   */
  async target(
    records: readonly AddonRecord[],
    providerId: string,
    externalId: string,
    clientType: WowClientType,
  ): Promise<ArchiveTarget> {
    const folders = await this.inspect(clientType).then(
      (inspection) => inspection.folders,
      () => [],
    );
    return archiveTarget(records, providerId, externalId, folders, await this.hash().catch(() => undefined));
  }

  /** Whether `record`'s installed archive has this content: a reinstall, not an update. */
  async isInstalledIn(record: AddonRecord): Promise<boolean> {
    return sameArchive(record, await this.hash().catch(() => undefined));
  }

  /** Remove the file and anything read from it. Idempotent; never throws. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    // An inspection still running removes its own directory when it ends.
    await Promise.allSettled([this.#hash, ...this.#inspections.values()]);
    await this.downloads.release(this.handle);
  }
}
