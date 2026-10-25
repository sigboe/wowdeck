/**
 * Transactional addon installation pipeline (project-owned).
 *
 * Follows the WowUp install flow (addon-install.service.ts, GPL-3.0,
 * commit 4fdae600) but hardened per AGENTS.md rule 8:
 *
 *   download -> temp file
 *   extract  -> staging dir on the SAME filesystem as AddOns
 *   validate -> every planned folder must exist; at least one .toc overall
 *   install  -> rename-based swap with rollback-on-error backups
 *
 * A failed install at ANY point leaves the previous state intact. The
 * record is not written here: a successful install returns its changes.
 */

import { join } from "node:path";
import type { AddonSearchResult, WowInstallation } from "../models";
import { recordFolders, type AddonPatch, type AddonRecord } from "./AddonRecords";
import type { AddonProvider } from "../providers/addon-provider";
import { InstallError, NotFoundError, ProviderError, plainSystemError, providerDisplayName } from "../errors";
import { createDirectory, isDirectory, joinWithin, listDirectory, pathExists, removeDirectory, renameSafe } from "../fs/safe-fs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { parseTocFile } from "../toc/TocParser";
import { getTocForGameType2 } from "../utils/toc";
import { extractArchive } from "../archives/ArchiveExtractor";
import { PROVIDER_ID } from "../../api/providers";
import type { DownloadService } from "../downloads/DownloadService";
import type { OperationProgress } from "../../api/contracts";
import { latestFile } from "./releaseChannel";
import { STAGING_DIR_NAME, keepPrevious } from "./RollbackCache";


export interface InstallOptions {
  installation: WowInstallation;
  /** The record as it is to be installed (channel included); never changed here. */
  addon: AddonRecord;
  /** Provider search result; the file installed is the newest on `addon.channelType`. */
  searchResult: AddonSearchResult;
  provider: AddonProvider;
  operationId: string;
  onProgress?: (progress: OperationProgress) => void;
  /** Keep the replaced folders as the addon's previous version (BEYOND-02). */
  keepPreviousVersion?: boolean;
  /**
   * A folder the download must install (an adopt or a source change),
   * checked on the archive itself: a provider may not list its folders.
   */
  requiredFolder?: string;
}

export interface InstallOutcome {
  /** What the install changed on the record; the caller writes it. */
  patch: AddonPatch;
}

function progress(
  opts: InstallOptions,
  phase: OperationProgress["phase"],
  value: number | null,
  message: string | null,
): void {
  opts.onProgress?.({
    operationId: opts.operationId,
    addonId: opts.addon.id,
    phase,
    progress: value,
    message,
  });
}

export class AddonInstaller {
  constructor(private downloads: DownloadService) {}

  async install(opts: InstallOptions): Promise<InstallOutcome> {
    const { installation, addon, searchResult, provider } = opts;
    const addonsPath = getAddonsPath(installation);
    const stagingRoot = join(addonsPath, STAGING_DIR_NAME);
    const stagingDir = join(stagingRoot, `stage-${crypto.randomUUID()}`);
    const backupDir = join(stagingRoot, `backup-${crypto.randomUUID()}`);

    // The installation's own game folder (e.g. _retail_) must exist; only
    // Interface/AddOns below it may be created. Otherwise an installation on
    // a removed SD card would be recreated on internal storage, under the
    // card's mount path.
    if (!(await isDirectory(installation.location))) {
      throw new InstallError(
        `${installation.displayName} isn't available. Is the SD card inserted?`,
        addon.id,
      );
    }

    const file = latestFile(searchResult.files, addon.channelType);
    // What is installed now, for the previous-version cache (BEYOND-02).
    const previous = { version: addon.installedVersion ?? null, releaseId: addon.installedExternalReleaseId ?? null };
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

    try {
      // 1. resolve (metadata already known here — kept as its own phase for UX)
      progress(opts, "resolve", 0, "resolving release");

      // 2. download — or, for the File provider, copy the picked archive
      //    in: its downloadUrl is a path on this Deck, never a network
      //    address. Keyed on the provider (which owns that meaning), not
      //    on the URL's shape; copyLocal re-validates the path itself.
      progress(opts, "download", 0, "downloading");
      const auth = await opts.provider.getDownloadAuth().catch(() => undefined);
      const handle =
        provider.name === PROVIDER_ID.File
          ? await this.downloads.copyLocal(downloadUrl, `${addon.id}.archive`)
          : await this.downloads.download(downloadUrl, `${addon.id}.archive`, {
              auth,
              onProgress: (received, total) => {
                progress(opts, "download", total ? Math.min(received / total, 1) : null, "downloading");
              },
            });

      // 3. extract to staging (same fs as AddOns -> atomic renames possible)
      progress(opts, "extract", null, "extracting");
      await createDirectory(stagingRoot);
      await removeDirectory(stagingDir);
      const extracted = await extractArchive(handle.filePath, stagingDir);

      // 4. validate structure
      progress(opts, "validate", null, "validating structure");
      // The required folder is the addon's main one: it stays first
      // (recordFolders), whatever order the archive has.
      const plannedFolders = this.planFolders(extracted.topLevelDirs, file?.folders ?? []).sort(
        (a, b) => Number(b === opts.requiredFolder) - Number(a === opts.requiredFolder),
      );
      if (plannedFolders.length === 0) {
        throw new InstallError("The archive doesn't contain an addon", addon.id);
      }
      if (opts.requiredFolder && !plannedFolders.includes(opts.requiredFolder)) {
        throw new InstallError(`${searchResult.name} doesn't install the folder ${opts.requiredFolder}`, addon.id);
      }
      for (const folder of plannedFolders) {
        if (!(await this.folderHasToc(stagingDir, folder))) {
          console.error(`[installer] planned addon folder has no .toc: ${folder}`);
          throw new InstallError("The archive doesn't contain a valid addon", addon.id);
        }
      }

      // 5. install with backups + rollback
      progress(opts, "install", 0, "installing");
      const { installed, backedUp } = await this.swapFolders(
        addonsPath,
        stagingDir,
        backupDir,
        plannedFolders,
        (done, total) => progress(opts, "install", done / total, "installing"),
      );

      // 6. the record's changes, from the installed TOC
      const toc = await this.readInstalledToc(addonsPath, installed, installation);
      const patch: AddonPatch = {
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

      if (opts.keepPreviousVersion && backedUp.length > 0) {
        // A reinstall of the SAME release is a repair, not an update: it
        // must not replace the kept older version (BEYOND-02), or "Roll
        // back" would offer the version already running. Only a changed
        // release puts its previous version in the cache.
        const sameRelease = previous.releaseId != null && previous.releaseId === file?.externalId;
        if (!sameRelease) {
          // Keeping it is a nicety: a failure here never fails the install.
          try {
            await keepPrevious(installation, addon.id, backupDir, {
              ...previous,
              folders: backedUp,
              savedAt: Date.now(),
            });
            patch.rollbackVersion = previous.version ?? "previous version";
          } catch (err) {
            console.error(`[installer] could not keep the previous version: ${String(err)}`);
          }
        }
      }

      progress(opts, "install", 1, "installed");
      return { patch };
    } finally {
      await removeDirectory(stagingDir).catch(() => {});
      await removeDirectory(backupDir).catch(() => {});
      // remove the staging root when no other operation is using it
      const remaining = await listDirectory(stagingRoot).catch(() => []);
      if (remaining.length === 0) {
        await removeDirectory(stagingRoot).catch(() => {});
      }
      await this.downloads.cleanup().catch(() => {});
    }
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

  private async folderHasToc(stagingDir: string, folder: string): Promise<boolean> {
    const folderPath = joinWithin(stagingDir, folder);
    const entries = await listDirectory(folderPath);
    return entries.some((e) => !e.isDirectory && e.name.toLowerCase().endsWith(".toc"));
  }

  /**
   * Rename-based swap with full rollback. All operations are same-filesystem
   * renames, so a crash mid-way leaves either old or (partially) hidden
   * staging folders — never a half-written addon.
   */
  private async swapFolders(
    addonsPath: string,
    stagingDir: string,
    backupDir: string,
    folders: string[],
    onProgress: (done: number, total: number) => void,
  ): Promise<{ installed: string[]; backedUp: string[] }> {
    const backups: { name: string; from: string }[] = [];
    const installed: string[] = [];

    try {
      await createDirectory(backupDir);

      // backup existing target folders
      let done = 0;
      for (const folder of folders) {
        const target = joinWithin(addonsPath, folder);
        if (await pathExists(target)) {
          const backupPath = joinWithin(backupDir, folder);
          await renameSafe(target, backupPath);
          backups.push({ name: folder, from: backupPath });
        }
        done += 1;
        onProgress(done, folders.length * 2);
      }

      // move staged folders into place
      for (const folder of folders) {
        const source = joinWithin(stagingDir, folder);
        const target = joinWithin(addonsPath, folder);
        await renameSafe(source, target);
        installed.push(folder);
        done += 1;
        onProgress(done, folders.length * 2);
      }

      return { installed, backedUp: backups.map((b) => b.name) };
    } catch (err) {
      // rollback: remove newly installed, restore backups
      for (const folder of installed) {
        await removeDirectory(joinWithin(addonsPath, folder)).catch(() => {});
      }
      for (const backup of backups) {
        await renameSafe(backup.from, joinWithin(addonsPath, backup.name)).catch(() => {});
      }
      throw err instanceof InstallError
        ? err
        : new InstallError(
            plainSystemError(err, "Couldn't put the addon's files in place. Nothing was changed", "installer"),
          );
    }
  }

  private async readInstalledToc(
    addonsPath: string,
    folders: string[],
    installation: WowInstallation,
  ) {
    try {
      const tocs = [];
      for (const folder of folders) {
        const folderPath = joinWithin(addonsPath, folder);
        for (const entry of await listDirectory(folderPath)) {
          if (!entry.isDirectory && entry.name.toLowerCase().endsWith(".toc")) {
            tocs.push(await parseTocFile(entry.path));
          }
        }
      }
      const folderStub = { name: folders[0] ?? "", path: "", status: "", tocs };
      return getTocForGameType2(folderStub, installation.clientType) ?? tocs[0];
    } catch (err) {
      console.error(`[installer] toc reparse failed: ${String(err)}`);
      return undefined;
    }
  }
}

/** Remove an addon's folders and record. Transactional: rename-then-delete. */
export class AddonRemover {
  async remove(
    installation: WowInstallation,
    addon: Pick<AddonRecord, "id" | "installedFolderList" | "installedFolders">,
    operationId: string,
  ): Promise<string[]> {
    const addonsPath = getAddonsPath(installation);
    const trashDir = join(addonsPath, STAGING_DIR_NAME, `trash-${operationId}`);
    const folders = recordFolders(addon);

    if (folders.length === 0) {
      throw new NotFoundError("addon folders for", addon.id);
    }

    await createDirectory(trashDir);
    const removed: string[] = [];
    try {
      for (const folder of folders) {
        if (!folder) {
          continue;
        }
        const target = joinWithin(addonsPath, folder);
        if (!(await pathExists(target))) {
          removed.push(folder); // already gone; treat as removed
          continue;
        }
        await renameSafe(target, joinWithin(trashDir, folder));
        removed.push(folder);
      }
    } catch (err) {
      // restore anything already trashed
      for (const folder of removed) {
        const trashed = joinWithin(trashDir, folder);
        if (await pathExists(trashed)) {
          await renameSafe(trashed, joinWithin(addonsPath, folder)).catch(() => {});
        }
      }
      await removeDirectory(trashDir).catch(() => {});
      throw err instanceof ProviderError
        ? err
        : new InstallError(plainSystemError(err, "Couldn't remove the addon's folders. Nothing was changed", "remover"), addon.id);
    }
    await removeDirectory(trashDir).catch(() => {});
    const stagingRoot = join(addonsPath, STAGING_DIR_NAME);
    const remaining = await listDirectory(stagingRoot).catch(() => []);
    if (remaining.length === 0) {
      await removeDirectory(stagingRoot).catch(() => {});
    }
    return removed;
  }
}
