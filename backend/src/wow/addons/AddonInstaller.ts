/**
 * Transactional addon installation pipeline (project-owned).
 *
 * Follows the WowUp install flow (addon-install.service.ts, GPL-3.0,
 * commit 4fdae600) but hardened per AGENTS.md rule 8:
 *
 *   download -> temp file
 *   extract  -> staging dir on the SAME filesystem as AddOns
 *   validate -> every planned folder must exist; at least one .toc overall
 *   install  -> the addon transaction (AddonTransaction.ts): rename-based
 *               moves and the record commit together
 *
 * A failed install at ANY point leaves the previous folders and record
 * intact (or, when even the undo fails, keeps every copy: ADR 0006).
 */

import type { AddonSearchResult, AddonSearchResultFile, WowInstallation } from "../models";
import { recordFolders, type AddonPatch, type AddonRecord, type AddonRecordChange, type AddonRecords } from "./AddonRecords";
import type { AddonProvider } from "../providers/addon-provider";
import { InstallError, NotFoundError, providerDisplayName } from "../errors";
import { isDirectory } from "../fs/safe-fs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { extractArchive } from "../archives/ArchiveExtractor";
import { checkAddonFolders, readAddonToc } from "../archives/addonFolders";
import { PROVIDER_ID } from "../../api/providers";
import type { DownloadHandle, DownloadService } from "../downloads/DownloadService";
import { latestFile } from "./releaseChannel";
import { archiveHash, installsByArchive } from "./archiveMatch";
import { keptRelease } from "./RollbackCache";
import { AddonTransactions } from "./AddonTransaction";
import { realStageFs, type StageFs } from "../fs/StageFs";


export interface InstallOptions {
  installation: WowInstallation;
  /** The record as it is to be installed (channel included); never changed here. */
  addon: AddonRecord;
  /** The stored record the install replaces; absent for a new one. */
  existing?: AddonRecord;
  /** Provider search result; the file installed is the newest on `addon.channelType`. */
  searchResult: AddonSearchResult;
  provider: AddonProvider;
  operationId: string;
  /** Keep the replaced folders as the addon's previous version (BEYOND-02). */
  keepPreviousVersion?: boolean;
  /**
   * A folder the download must install (an adopt or a source change),
   * checked on the archive itself: a provider may not list its folders.
   */
  requiredFolder?: string;
  /**
   * The release's archive, already fetched (fetchArchive) when the caller
   * had to look inside it first (the archive match rule); a rejection fails
   * the install as a failed download would.
   */
  fetched?: Promise<DownloadHandle>;
  /** The records the install commits through (the caller's gate turn). */
  records: AddonRecords;
  /** The record change the installed files make, given the installer's patch. */
  recordChange: (patch: AddonPatch) => AddonRecordChange;
}

export interface InstallOutcome {
  /** What the install changed on the record, as committed. */
  patch: AddonPatch;
  transactionId: string;
  /** The install committed but its cleanup didn't finish (AddonTransactions). */
  cleanupWarning?: string;
}

export class AddonInstaller {
  #transactions: AddonTransactions;

  constructor(
    private downloads: DownloadService,
    fs: StageFs = realStageFs,
    /** The engine's one transaction runner (its recovery guard reads it); a fresh one by default. */
    transactions: AddonTransactions = new AddonTransactions(fs),
  ) {
    this.#transactions = transactions;
  }

  /**
   * Download, stage and install the release, committing the record with it
   * (AddonTransactions). Throws an InstallError, a TransactionFailure once
   * the transaction has begun, when nothing was committed.
   */
  async install(opts: InstallOptions): Promise<InstallOutcome> {
    const { installation, addon, searchResult, provider } = opts;

    // The installation's own game folder (e.g. _retail_) must exist; only
    // Interface/AddOns below it may be created. Otherwise an installation on
    // a removed SD card would be recreated on internal storage, under the
    // card's mount path. Checked before downloading; the transaction checks
    // again before it touches anything.
    if (!(await isDirectory(installation.location))) {
      throw new InstallError(
        `${installation.displayName} isn't available. Is the SD card inserted?`,
        addon.id,
      );
    }

    const file = latestFile(searchResult.files, addon.channelType);
    // What is installed now, for the previous-version cache (BEYOND-02).
    const previous = keptRelease(addon);
    const downloadUrl = file?.downloadUrl ?? addon.downloadUrl;
    if (!downloadUrl) {
      // A provider can legitimately return a file with no download URL —
      // e.g. CurseForge omits it (and 403s its dedicated download-url
      // lookup) for an API key/application that hasn't been granted
      // distribution access, independent of whether the addon itself is
      // available. Not something this project can work around client-side.
      throw new InstallError(
        `${providerDisplayName(provider.name)} doesn't allow this addon to be downloaded here. Get it from the ${providerDisplayName(provider.name)} website instead.`,
        addon.id,
      );
    }
    // A reinstall of the SAME release is a repair, not an update: it must
    // not replace the kept older version (BEYOND-02), or "Roll back" would
    // offer the version already running. Only a changed release puts its
    // previous version in the cache. A file's or link's release id is only
    // its path or link, so for those the same release is the same content:
    // the archive is fetched first and hashed (archiveMatch.ts). A fetch
    // that fails hashes nothing and fails the install in staging.
    const fetched = installsByArchive(provider.name)
      ? (opts.fetched ?? this.fetchArchive(provider, downloadUrl, addon.id))
      : opts.fetched;
    const hash = fetched && (await fetched.then((handle) => archiveHash(handle.filePath)).catch(() => undefined));
    const sameRelease = installsByArchive(provider.name)
      ? hash !== undefined && addon.installedArchiveHash === hash
      : previous.releaseId != null && previous.releaseId === file?.externalId;
    const addonsPath = getAddonsPath(installation);

    try {
      const { transactionId, result: patch, cleanupWarning } = await this.#transactions.run(opts.records, {
        installation,
        operation: opts.existing ? "update" : "install",
        addonId: addon.id,
        originalRecord: opts.existing ?? null,
        ...(opts.keepPreviousVersion && !sameRelease && { keepPrevious: previous }),
        stage: (stagingDir) => this.#stage({ ...opts, fetched }, downloadUrl, file?.folders ?? [], stagingDir),
        change: async ({ installed, previous: kept }) => {
          const patch = await this.#patch(opts, addonsPath, installed, file, downloadUrl);
          patch.installedArchiveHash = hash;
          if (kept === "kept") {
            patch.rollbackVersion = previous.version ?? "previous version";
          } else if (kept === "gone") {
            patch.rollbackVersion = undefined;
          }
          return { change: opts.recordChange(patch), result: patch };
        },
      });
      return { patch, transactionId, ...(cleanupWarning && { cleanupWarning }) };
    } finally {
      await this.downloads.cleanup().catch(() => {});
    }
  }

  /**
   * Download the release's archive — or, for the File provider, copy the
   * picked archive in: its downloadUrl is a path on this Deck, never a
   * network address. Keyed on the provider (which owns that meaning), not
   * on the URL's shape; copyLocal re-validates the path itself. The file
   * lives until the next fetch or the install's cleanup.
   */
  async fetchArchive(provider: AddonProvider, downloadUrl: string, name: string): Promise<DownloadHandle> {
    const auth = await provider.getDownloadAuth().catch(() => undefined);
    return provider.name === PROVIDER_ID.File
      ? this.downloads.copyLocal(downloadUrl, `${name}.archive`)
      : this.downloads.download(downloadUrl, `${name}.archive`, { auth });
  }

  /** Remove what fetchArchive left, for a caller that ends before install(). */
  async discardFetched(): Promise<void> {
    await this.downloads.cleanup().catch(() => {});
  }

  /** Download (or copy in) the archive, extract it to `stagingDir` and check it; returns the folders to install. */
  async #stage(opts: InstallOptions, downloadUrl: string, releaseFolders: string[], stagingDir: string): Promise<string[]> {
    const { addon, searchResult, provider } = opts;
    // 1. download (or take the archive the caller already fetched)
    const handle = await (opts.fetched ?? this.fetchArchive(provider, downloadUrl, addon.id));

    // 2. extract to staging (same fs as AddOns -> atomic renames possible)
    const extracted = await extractArchive(handle.filePath, stagingDir);

    // 3. validate structure
    // The required folder is the addon's main one: it stays first
    // (recordFolders), whatever order the archive has.
    const plannedFolders = this.planFolders(extracted.topLevelDirs, releaseFolders).sort(
      (a, b) => Number(b === opts.requiredFolder) - Number(a === opts.requiredFolder),
    );
    if (plannedFolders.length === 0) {
      throw new InstallError("The archive doesn't contain an addon", addon.id);
    }
    if (opts.requiredFolder && !plannedFolders.includes(opts.requiredFolder)) {
      throw new InstallError(`${searchResult.name} doesn't install the folder ${opts.requiredFolder}`, addon.id);
    }
    const { notAddonFolders } = await checkAddonFolders(stagingDir, plannedFolders);
    if (notAddonFolders.length > 0) {
      console.error(`[installer] planned addon folder has no .toc: ${notAddonFolders[0]}`);
      throw new InstallError("The archive doesn't contain a valid addon", addon.id);
    }
    return plannedFolders;
  }

  /** The record's changes, from the installed TOC; a TOC that can't be read leaves the provider's and record's values. */
  async #patch(
    opts: InstallOptions,
    addonsPath: string,
    installed: string[],
    file: AddonSearchResultFile | undefined,
    downloadUrl: string,
  ): Promise<AddonPatch> {
    const { addon, searchResult, installation } = opts;
    const toc = await this.readInstalledToc(addonsPath, installed, installation);
    return {
      installedFolderList: installed,
      installedFolders: installed.join(", "),
      installedVersion: toc?.version ?? file?.version ?? addon.installedVersion,
      // The just-installed file is, by definition, the latest known
      // release — set both sides of the release-id pair from the same file
      // so needsUpdate()'s release-id check (which takes priority over the
      // version-string fallback) agrees immediately. Mirrors upstream's
      // addon-install.service.ts, which does the equivalent assignment in
      // the other direction (installedExternalReleaseId = externalLatestReleaseId,
      // relying on it having already been set at search/match time). Without
      // this, any addon whose TOC version string doesn't match the
      // provider's reported version (common — "authors push out new builds
      // without changing the toc version", per upstream's own comment on
      // needsUpdate) would show a false "update available" forever: nothing
      // ever updates installedExternalReleaseId to catch up because installs
      // short-circuit back to the same mismatched version strings.
      externalLatestReleaseId: file?.externalId ?? addon.externalLatestReleaseId,
      installedExternalReleaseId: file?.externalId ?? addon.installedExternalReleaseId,
      latestVersion: file?.version ?? addon.latestVersion,
      downloadUrl,
      gameVersion: toc?.interface?.join(", ") ?? addon.gameVersion,
      author: toc?.author ?? addon.author,
      // The provider's name, as a scan match keeps it; the TOC title (often
      // a colour-coded or internal one) only when the provider gives none,
      // like upstream's zip installs (PC-14); a direct link has neither,
      // so its folder name is the last resort.
      name: searchResult.name || toc?.title || addon.name || installed[0]!,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      providerName: searchResult.providerName,
      externalId: searchResult.externalId,
      externalUrl: searchResult.externalUrl,
      // What the provider says about the addon now: after a source change
      // (WF-12) the old source's picture and summary are not this one's.
      thumbnailUrl: searchResult.thumbnailUrl,
      summary: searchResult.summary,
      warningType: undefined,
    };
  }

  /** Folder names to install: release metadata wins; fallback = all extracted top-level dirs. */
  private planFolders(extractedDirs: string[], releaseFolders: string[]): string[] {
    const existing = new Set(extractedDirs);
    if (releaseFolders.length > 0) {
      const planned = releaseFolders.filter((f) => existing.has(f));
      if (planned.length > 0) {
        return planned;
      }
    }
    return [...existing];
  }

  private async readInstalledToc(
    addonsPath: string,
    folders: string[],
    installation: WowInstallation,
  ) {
    try {
      return await readAddonToc(addonsPath, folders, installation.clientType);
    } catch (err) {
      console.error(`[installer] toc reparse failed: ${String(err)}`);
      return undefined;
    }
  }
}

/** What a committed removal returns. */
export interface RemovalOutcome {
  /** The folders removed (a folder already missing counts). */
  folders: string[];
  transactionId: string;
  /** The removal committed but its cleanup didn't finish (AddonTransactions). */
  cleanupWarning?: string;
}

/**
 * Remove an addon's folders and its record, or an unmanaged folder, through
 * the engine's addon transaction: the folders and the record go in one
 * commit, a failure before it puts both back, and an undo that stops keeps
 * every copy (ADR 0006).
 */
export class AddonRemover {
  constructor(private transactions: AddonTransactions) {}

  /**
   * Throws a NotFoundError for a record naming no folders, an InstallError
   * (a TransactionFailure once the transaction has begun) when nothing was
   * committed.
   */
  async remove(
    records: AddonRecords,
    installation: WowInstallation,
    target: { record: AddonRecord } | { unmanagedFolder: string },
  ): Promise<RemovalOutcome> {
    const record = "record" in target ? target.record : null;
    const folders = "record" in target ? recordFolders(target.record).filter(Boolean) : [target.unmanagedFolder];
    const addonId = record ? record.id : `unmanaged:${folders[0]}`;
    if (folders.length === 0) {
      throw new NotFoundError("addon folders for", addonId);
    }
    const { transactionId, cleanupWarning } = await this.transactions.run(records, {
      installation,
      operation: "remove",
      addonId,
      originalRecord: record,
      folders,
      change: async () => ({ change: record ? { remove: [record.id] } : {}, result: undefined }),
    });
    return { folders, transactionId, ...(cleanupWarning && { cleanupWarning }) };
  }
}
