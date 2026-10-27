/**
 * Addon orchestration service (project-owned).
 *
 * Follows WowUp's AddonService/AddonInstallService flows (GPL-3.0, commit
 * 4fdae600) adapted to this engine: no Angular/rxjs, serialized mutations,
 * events via callback, persistence via StateStore. needsUpdate semantics
 * are verbatim from wowup-electron addon.controller.ts.
 * See docs/wowup-provenance.md.
 */

import type { Addon, AutoUpdateResult, OperationResult, SearchResult } from "../../api/contracts";
import type { ArchivePreview } from "../../api/contracts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGameRunning } from "../wtf/GameProcessGuard";
import type { GameRunning } from "../wtf/GameProcessGuard";
import type { AddonFolder, AddonSearchResult, AddonSearchResultFile, ProviderCategory, WowAddon, WowInstallation } from "../models";
import { newAddonRecord } from "../models";
import { AddonChannelType, AddonDependencyType, type AddonProviderType } from "../types";
import type { Toc } from "../toc/toc";
import type { AddonProvider, DiscoverList, ScanMatch } from "../providers/addon-provider";
import { NotFoundError, ProviderError, ValidationError } from "../errors";
import type { ProviderRegistry } from "../providers/provider-registry";
import type { StateStore } from "../storage/StateStore";
import { recordFolders, type AddonPatch, type AddonRecord } from "./AddonRecords";
import { isDirectory, joinWithin } from "../fs/safe-fs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { InstallationService } from "../installation/InstallationService";
import { scanAddons } from "./AddonScanner";
import { computeWowUpFingerprints } from "./FingerprintScanner";
import { AddonInstaller, AddonRemover } from "./AddonInstaller";
import { hasNewerPrerelease, latestFile, updateCandidate } from "./releaseChannel";
import { cacheUsage, clearAll, dropPrevious, swapWithPrevious } from "./RollbackCache";
import { AddonListPortability } from "./AddonPortability";
import { dependantsIndex, libraryFlagsAfterImport, orphanedLibraries } from "./libraries";
import type { DownloadService } from "../downloads/DownloadService";
import { identifyUrlImportProvider } from "../providers/url-import";
import { canonicalLocalArchive } from "../archives/localArchive";
import { inspectAddonArchive } from "../archives/ArchiveInspector";
import { getTocForGameType2 } from "../utils/toc";
import { getClientTypeLabel } from "../utils/gametype";
import { gameVersionForInstallation } from "../utils/gameversion";
import { WOWUP_DATA_ADDON_FOLDER_NAME } from "../notifications/constants";
import { PROVIDER_ID, providerDisplayName } from "../../api/providers";
import { needsUpdate, updateStatus } from "./addonStatus";
import {
  WARNING_FOLDERS_MISSING,
  WARNING_NOT_ON_PROVIDER,
  folderStatePatch,
  missingDependencies,
  listedIgnoreReason,
  toWireAddon,
  toWireSearchResult,
  toWireUnmanaged,
} from "./wire";

export interface ServiceEvents {
  addonsChanged: (addonIds: string[]) => void;
  operationProgress: (progress: import("../../api/contracts").OperationProgress) => void;
  operationResult: (result: OperationResult) => void;
  /** An automatic update ran (WF-02). */
  autoUpdated?: (result: AutoUpdateResult) => void;
}


/** Serialized mutation queue (replaces WowUp's rxjs install queue). */
class Gate {
  #chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => {});
    return next;
  }
}


/** Results kept from each provider for one search. */
const SEARCH_RESULTS_PER_PROVIDER = 10;
/** Ids looked up in one addons.lookup call (a dependency list, the Relationships page). */
const LOOKUP_MAX_IDS = 50;

/** Why an addon is being installed; decides the rules in INSTALL_INTENTS. */
export type InstallIntent = "install" | "import" | "update" | "reinstall" | "channel" | "dependency" | "adopt" | "source";

export interface InstallRequest {
  intent: InstallIntent;
  providerId: string;
  externalId: string;
  installation: WowInstallation;
  /** Release channel chosen for this install; omitted keeps the addon's own (or the installation default). */
  channel?: AddonChannelType;
  /**
   * Intent "adopt" (WF-23): the unmanaged folder the release is installed
   * over, which the release must contain, and the version its TOC says.
   */
  adopt?: { folder: string; version?: string };
  /**
   * Intent "source" (WF-12): the addon whose source this release replaces.
   * The install goes into its record, and the release must contain its
   * main folder.
   */
  replaces?: AddonRecord;
}

/**
 * Each install intent's rules in one place:
 * - status: the result reported for it;
 * - dependencyFlag: "clear" makes an addon first pulled in as a dependency
 *   the user's own choice, "keep" leaves the flag, "set" marks a new record
 *   as installed automatically (autoremove takes it away with its dependent);
 * - stampUpdate: counts as an update for "newly updated" (PC-07);
 * - broadcast: progress and result events (a dependency only reports
 *   through its dependent's result);
 * - withDependencies: installs missing required dependencies (one level);
 * - keepPrevious: "existing" keeps the folders an install replaces when it
 *   replaces a record's own (if the setting is on); "always" keeps them
 *   whatever the setting, for an adopt: hand-copied files may exist nowhere
 *   else, and Roll back returns to them.
 */
const INSTALL_INTENTS: Record<
  InstallIntent,
  {
    status: "installed" | "updated";
    dependencyFlag: "clear" | "keep" | "set";
    stampUpdate: boolean;
    broadcast: boolean;
    withDependencies: boolean;
    keepPrevious: "existing" | "always";
  }
> = {
  install: { status: "installed", dependencyFlag: "clear", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "existing" },
  import: { status: "installed", dependencyFlag: "clear", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "existing" },
  update: { status: "updated", dependencyFlag: "keep", stampUpdate: true, broadcast: true, withDependencies: true, keepPrevious: "existing" },
  reinstall: { status: "installed", dependencyFlag: "keep", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "existing" },
  channel: { status: "installed", dependencyFlag: "keep", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "existing" },
  dependency: { status: "installed", dependencyFlag: "set", stampUpdate: false, broadcast: false, withDependencies: false, keepPrevious: "existing" },
  adopt: { status: "installed", dependencyFlag: "clear", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "always" },
  source: { status: "installed", dependencyFlag: "keep", stampUpdate: false, broadcast: true, withDependencies: true, keepPrevious: "existing" },
};

/**
 * Whether a release installs the folder, as far as its listing tells: a
 * release that lists no folders (WoWInterface's) may, and the installer
 * checks its archive (InstallOptions.requiredFolder).
 */
function installsFolder(file: AddonSearchResultFile | undefined, folder: string): boolean {
  return !!file && (file.folders.length === 0 || file.folders.includes(folder));
}

/** A failed operation's result (not broadcast; see AddonService#fail). */
function failedOperation(operationId: string, addonId: string | null, err: unknown): OperationResult {
  return { operationId, addonId, status: "failed", error: err instanceof Error ? err.message : String(err) };
}

/** The release fields a provider's answer refreshes on a record (update checks). */
function releaseMetadata(
  addon: AddonRecord,
  files: AddonSearchResultFile[] | undefined,
  file: AddonSearchResultFile | undefined,
): AddonPatch {
  return {
    hasNewerPrerelease: hasNewerPrerelease(files),
    latestVersion: file?.version ?? addon.latestVersion,
    externalLatestReleaseId: file?.externalId ?? addon.externalLatestReleaseId,
  };
}

/**
 * Providers that match unmanaged folders, in precedence order (upstream's):
 * an exact fingerprint, then TOC project ids, with TukUI's name guess after
 * CurseForge's id. GitHub only installs by URL.
 */
const SCAN_ORDER: readonly AddonProviderType[] = [
  PROVIDER_ID.WowUpHub,
  PROVIDER_ID.Curse,
  PROVIDER_ID.TukUI,
  PROVIDER_ID.WowInterface,
];

/** A new record for an unmanaged addon a provider matched (folders: its matched folders). */
export function scannedAddonRecord(
  match: ScanMatch,
  installation: WowInstallation,
  folders: AddonFolder[],
  toc: Toc | undefined,
): WowAddon {
  const { addon, latestFile, installedFile } = match;
  const folderNames = folders.map((f) => f.name);
  return newAddonRecord({
    channelType: AddonChannelType.Stable,
    installationId: installation.id,
    providerName: addon.providerName,
    externalId: addon.externalId,
    externalUrl: addon.externalUrl,
    name: addon.name,
    author: addon.author,
    thumbnailUrl: addon.thumbnailUrl,
    summary: addon.summary,
    downloadCount: addon.downloadCount,
    gameVersion: toc?.interface.join(", "),
    installedAt: folders[0]?.fileStats?.birthtimeMs,
    installedFolderList: folderNames,
    installedFolders: folderNames.join(", "),
    installedVersion: toc?.version ?? installedFile?.version ?? "",
    installedExternalReleaseId: installedFile?.externalId,
    downloadUrl: latestFile.downloadUrl,
    latestVersion: latestFile.version,
    externalLatestReleaseId: latestFile.externalId,
    releasedAt: latestFile.releaseDate ? new Date(latestFile.releaseDate).getTime() : undefined,
    updatedAt: Date.now(),
  });
}

/**
 * The AddOns folders My Addons lists as unmanaged: no record owns them, and
 * not the companion bridge's generated folder (wowup_data_addon has a real
 * .toc; see backend/src/wow/notifications/CompanionWriter.ts). A git checkout
 * or a Raider.IO client folder is listed too (as ignored, with its reason) so
 * the user can see why it is never matched or updated; other ignored folders
 * stay hidden.
 */
export function unmanagedFolders(folders: AddonFolder[], records: AddonRecord[]): AddonFolder[] {
  const managed = new Set(records.flatMap((r) => r.installedFolderList ?? []));
  return folders.filter(
    (f) =>
      !managed.has(f.name) &&
      f.name !== WOWUP_DATA_ADDON_FOLDER_NAME &&
      (f.ignoreReason === undefined || listedIgnoreReason(f) !== null),
  );
}

export class AddonService {
  #installer: AddonInstaller;
  #remover = new AddonRemover();
  #gate = new Gate();
  #opCounter = 0;
  /**
   * Scratch root for archive previews (addons.inspectArchive): on the
   * engine's data filesystem, never inside an installation, emptied by
   * each inspection itself.
   */
  readonly #inspectRoot: string;

  /** The installation list and the active installation (InstallationService). */
  readonly installations: InstallationService;
  /** Addon list export and import, WowUp-compatible (AddonListPortability). */
  readonly portability: AddonListPortability;

  constructor(
    private store: StateStore,
    private registry: ProviderRegistry,
    downloads: DownloadService,
    private events: ServiceEvents,
    installations?: InstallationService,
    inspectRoot: string = join(tmpdir(), "wowdeck-inspect"),
  ) {
    this.#installer = new AddonInstaller(downloads);
    this.#inspectRoot = inspectRoot;
    this.installations = installations ?? new InstallationService(store, () => events.addonsChanged([]));
    this.portability = new AddonListPortability((installationId) => this.addonsFor(installationId), registry);
  }

  // ---- scanning ----

  /** Full scan: folders, fingerprints, provider matching; reconciles records. */
  async scanInstallation(installation: WowInstallation): Promise<AddonRecord[]> {
    return this.#gate.run(async () => {
      const folders = await scanAddons(installation);
      await computeWowUpFingerprints(folders);

      // The first provider in SCAN_ORDER to match a folder claims it.
      const matches = new Map<string, ScanMatch>();
      const available = this.registry.available();
      for (const provider of SCAN_ORDER.flatMap((name) => available.filter((p) => p.name === name))) {
        const unmatched = folders.filter((f) => !matches.has(f.name) && f.ignoreReason === undefined);
        try {
          for (const [folderName, match] of await provider.scan(installation, unmatched)) {
            if (!matches.has(folderName)) {
              matches.set(folderName, match);
            }
          }
        } catch (err) {
          // one provider failing must not abort the scan for the others
          console.error(`[service] provider scan failed for ${provider.name}: ${String(err)}`);
        }
      }

      this.reconcileRecords(installation, folders, matches);
      return this.addonsFor(installation.id);
    });
  }

  /** Merge provider matches into persisted records. */
  private reconcileRecords(installation: WowInstallation, folders: AddonFolder[], matches: Map<string, ScanMatch>): void {
    const records = this.store.addons.forInstallation(installation.id);
    // Two groups can land on the same record (folder overlap): each sees the
    // other's changes, and all of them are written once at the end.
    const pending = new Map<string, AddonPatch>();
    const current = (record: AddonRecord): AddonRecord => ({ ...record, ...pending.get(record.id) });
    const change = (id: string, patch: AddonPatch) => pending.set(id, { ...pending.get(id), ...patch });
    const created: WowAddon[] = [];

    // group matched folders by provider+externalId
    const groups = new Map<string, { folders: AddonFolder[]; match: ScanMatch }>();
    for (const folder of folders) {
      const match = matches.get(folder.name);
      if (!match) {
        continue;
      }
      const key = `${match.addon.providerName}:${match.addon.externalId}`;
      const group = groups.get(key);
      if (group) {
        group.folders.push(folder);
      } else {
        groups.set(key, { folders: [folder], match });
      }
    }
    // A provider may match only the folder carrying its id (a TOC project id
    // sits in the main folder alone), while the release installs more: claim
    // the other folders it lists that are on disk and matched by no one else
    // (DEVICE 2026-10-21: Raider.IO's 15 RaiderIO_DB_* folders were listed as
    // unmanaged). Ignored folders (git checkouts, Raider.IO client) and
    // folders another addon's record owns stay out.
    const folderByName = new Map(folders.map((f) => [f.name, f]));
    const claimed = new Set(matches.keys());
    for (const [key, group] of groups) {
      const release = group.match.installedFile ?? group.match.latestFile;
      for (const name of release.folders) {
        const folder = folderByName.get(name);
        const ownedByOther = records.some(
          (r) => `${r.providerName}:${r.externalId}` !== key && r.installedFolderList?.includes(name),
        );
        if (folder && !claimed.has(name) && !ownedByOther && folder.ignoreReason === undefined) {
          claimed.add(name);
          group.folders.push(folder);
        }
      }
    }

    for (const [key, { folders: groupFolders, match }] of groups) {
      const folderNames = groupFolders.map((f) => f.name);
      const found =
        records.find((r) => `${r.providerName}:${r.externalId}` === key) ??
        records.find((r) => current(r).installedFolderList?.some((f) => folderNames.includes(f)));

      const toc = this.pickToc(installation, groupFolders);

      if (found) {
        const existing = current(found);
        const installedFolderList = [...new Set([...folderNames, ...(existing.installedFolderList ?? [])])];
        change(existing.id, {
          installedFolderList,
          installedFolders: installedFolderList.join(", "),
          installedVersion: toc?.version ?? existing.installedVersion,
          name: match.addon.name || existing.name,
          author: match.addon.author ?? existing.author,
          thumbnailUrl: match.addon.thumbnailUrl ?? existing.thumbnailUrl,
          externalUrl: match.addon.externalUrl ?? existing.externalUrl,
          updatedAt: Date.now(),
        });
      } else {
        created.push(scannedAddonRecord(match, installation, groupFolders, toc));
      }
    }

    const present = new Set(folders.map((f) => f.name));
    for (const record of records) {
      const patch = folderStatePatch(current(record), present);
      if (patch) {
        change(record.id, patch);
      }
    }
    this.store.addons.patchMany([...pending].map(([id, patch]) => ({ id, patch })));
    this.store.addons.createMany(created);
  }

  private pickToc(installation: WowInstallation, folders: AddonFolder[]) {
    for (const folder of folders) {
      const toc = getTocForGameType2(folder, installation.clientType);
      if (toc) {
        return toc;
      }
    }
    return undefined;
  }

  // ---- listing ----

  /**
   * Persisted records plus unmanaged on-disk folders, as wire addons. Runs
   * through the gate: it reads the AddOns folder and records folder state,
   * so it must not see an install halfway through swapping folders (requests
   * are handled concurrently, see JsonlServer.run).
   */
  listAddons(installation: WowInstallation): Promise<Addon[]> {
    return this.#gate.run(() => this.#listAddons(installation));
  }

  async #listAddons(installation: WowInstallation): Promise<Addon[]> {
    const folders = await scanAddons(installation);
    const present = new Set(folders.map((f) => f.name));
    this.store.addons.patchMany(
      this.addonsFor(installation.id).flatMap((record) => {
        const patch = folderStatePatch(record, present);
        return patch ? [{ id: record.id, patch }] : [];
      }),
    );
    const records = this.addonsFor(installation.id);
    const unmanaged = unmanagedFolders(folders, records).map((f) => toWireUnmanaged(f, installation, present));

    const folderByName = new Map(folders.map((f) => [f.name, f]));
    // WF-22: who requires whom, from the dependencies recorded at install.
    const dependants = dependantsIndex(records);
    const managed = records.map((record) => {
      const wire = this.wire(record);
      wire.neededBy = dependants(record).map((r) => r.name);
      // The record does not keep the TOC; read the main folder's, as for
      // unmanaged rows (WF-11). Dependencies on the addon's own folders
      // (a suite's libraries) are not worth showing.
      const main = folderByName.get(record.installedFolderList?.[0] ?? "");
      const toc = main ? getTocForGameType2(main, installation.clientType) : undefined;
      if (toc) {
        const own = new Set(record.installedFolderList ?? []);
        wire.dependencies = toc.dependencyList.filter((d) => !own.has(d));
        wire.missingDependencies = missingDependencies(wire.dependencies, present);
        wire.interfaceVersion = toc.interface?.[0] ?? null;
      }
      // The one version this installation runs, not the TOC's whole list
      // (the installer stores it joined: "16001, 16002, …").
      wire.gameVersion = gameVersionForInstallation(
        toc?.interface ?? record.gameVersion?.split(",") ?? [],
        installation.version,
      );
      return wire;
    });
    return [...managed, ...unmanaged];
  }

  /** A failed operation, broadcast like every finished one, and returned. */
  #fail(operationId: string, addonId: string | null, err: unknown): OperationResult {
    const operation = failedOperation(operationId, addonId, err);
    this.events.operationResult(operation);
    return operation;
  }

  addonsFor(installationId: string): AddonRecord[] {
    return this.store.addons.forInstallation(installationId);
  }

  /**
   * The updates on offer in an installation (updateStatus): what Update
   * all updates and what the toast, the update summary and the in-game
   * bridge count.
   */
  eligibleUpdatesFor(installation: WowInstallation): AddonRecord[] {
    return this.addonsFor(installation.id).filter((addon) => updateStatus(addon, this.registry).canUpdate);
  }

  // ---- search ----

  async search(
    query: string,
    installation: WowInstallation,
    providerId?: string,
  ): Promise<{ results: SearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    if (!query.trim()) {
      return { results: [], providerErrors: [] };
    }
    const providers = providerId
      ? [this.registry.usable(providerId)].filter((p): p is NonNullable<typeof p> => !!p)
      : this.#catalogProviders();
    const { results, providerErrors } = await this.#searchProviders(
      providers,
      [query],
      installation,
      SEARCH_RESULTS_PER_PROVIDER,
    );
    return {
      results: results
        .map((r) => this.wireResult(r, installation))
        .sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0)),
      providerErrors,
    };
  }

  /** Providers in the name search (GitHub and WoWInterface only resolve URLs). */
  #catalogProviders(): AddonProvider[] {
    return this.registry.available().filter((p) => p.catalogSearch);
  }

  /**
   * Every provider searched for every query, in parallel, keeping the first
   * `perProvider` results of each answer, each addon once. A provider that
   * fails never stops the others; it is reported in providerErrors so the UI
   * can tell a failure from an empty result.
   */
  async #searchProviders(
    providers: AddonProvider[],
    queries: string[],
    installation: WowInstallation,
    perProvider = Infinity,
  ): Promise<{ results: AddonSearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    const found = new Map<string, AddonSearchResult>();
    const providerErrors: Array<{ providerId: string; error: string }> = [];
    await Promise.all(
      providers.map(async (provider) => {
        try {
          for (const query of queries) {
            for (const r of (await provider.searchByQuery(query, installation)).slice(0, perProvider)) {
              found.set(`${r.providerName}:${r.externalId}`, r);
            }
          }
        } catch (err) {
          console.error(`[service] search failed for ${provider.name}: ${String(err)}`);
          providerErrors.push({ providerId: provider.name, error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
    return { results: [...found.values()], providerErrors };
  }

  /**
   * Install from URL: resolves a pasted GitHub/WowInterface URL,
   * GitHub owner/repo shorthand, Nix-style github:owner/repo reference,
   * or a direct https link to an addon archive (WF-09), directly,
   * independent of the normal catalog search dispatch above, through
   * the provider's own
   * searchByQuery. Works while the provider is turned off in Options, as
   * upstream's dispatcher does (owner, 2026-10-21): the install goes
   * through too (see install), and My Addons tags the addon "Source off".
   */
  async resolveUrlImport(url: string, installation: WowInstallation): Promise<SearchResult> {
    const trimmed = url.trim();
    if (!trimmed) {
      throw new ValidationError("Enter a URL or owner/repository first");
    }
    const providerId = identifyUrlImportProvider(trimmed);
    if (!providerId) {
      throw new ValidationError("That isn't a GitHub or WoWInterface address, or an https link to a .zip, .rar or .7z file");
    }
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new NotFoundError("provider", providerId);
    }
    const results = await provider.searchByQuery(trimmed, installation);
    const result = results[0];
    if (!result) {
      throw new NotFoundError("addon for url", trimmed);
    }
    return this.wireResult(result, installation);
  }

  // ---- install from a local file (Manual Install, From a file) ----

  /**
   * Preview a local archive without installing anything
   * (addons.inspectArchive): what the pane shows between the pick and the
   * Install press. Validation is the same one the install itself will
   * run (canonicalLocalArchive), so what the preview promised is what
   * the install still finds — a file gone in between fails the install
   * with its own clear error.
   */
  async inspectArchive(path: string, installation: WowInstallation): Promise<ArchivePreview> {
    const trimmed = path.trim();
    if (!trimmed) {
      throw new ValidationError("Pick an archive file first");
    }
    const canonical = await canonicalLocalArchive(trimmed);
    const inspection = await inspectAddonArchive(canonical, installation.clientType, this.#inspectRoot);
    return {
      fileName: inspection.fileName,
      name: inspection.name,
      author: inspection.author,
      version: inspection.version,
      folders: inspection.folders,
      // The install call the pane makes after the user confirms: the
      // same provider/path pair a direct link's URL is for the Zip
      // provider.
      providerId: PROVIDER_ID.File,
      externalId: canonical,
    };
  }

  // ---- unmanaged folders: find an online source (WF-23) ----

  /**
   * Online sources for an unmanaged folder: the catalog providers searched
   * by its TOC title, its folder name and the addons its TOC requires (a
   * sub-folder such as OmniCC_Config names its main addon only there; DEVICE
   * 2026-10-21), keeping only addons whose
   * release (on the installation's default channel) installs that folder,
   * so adopting one replaces it. An exact name first, then by downloads.
   */
  async findSources(
    installation: WowInstallation,
    folderName: string,
  ): Promise<{ results: SearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    const folder = await this.#requireUnmanagedFolder(installation, folderName);
    const toc = getTocForGameType2(folder, installation.clientType);
    const required = (toc?.dependencyList ?? []).filter((d) => !/^blizzard_/i.test(d));
    return this.#sources(installation, folderName, toc, [toc?.title, folderName, ...required]);
  }

  /**
   * The other providers' copies of a managed addon (WF-12): as findSources,
   * for its main folder, searched by its TOC title, its name and the folder
   * name; its own provider left out. A missing folder leaves only the names.
   */
  async findOtherSources(
    addonId: string,
  ): Promise<{ results: SearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    const addon = this.store.addons.require(addonId);
    const installation = this.installations.require(addon.installationId);
    const folderName = recordFolders(addon)[0];
    if (!folderName) {
      throw new ValidationError(`${addon.name} has no folders`);
    }
    const folder = (await scanAddons(installation)).find((f) => f.name === folderName);
    const toc = folder && getTocForGameType2(folder, installation.clientType);
    return this.#sources(installation, folderName, toc, [toc?.title, addon.name, folderName], addon);
  }

  /**
   * Sources whose release (on the installation's default channel) installs
   * `folderName`, so using one replaces it: the addons the TOC's project ids
   * name (tocSources) and the catalog search for `queries`. TOC-named
   * first, then exactly named, then by downloads. `own`: the addon whose provider
   * is left out.
   */
  async #sources(
    installation: WowInstallation,
    folderName: string,
    toc: Toc | undefined,
    queries: (string | undefined)[],
    own?: AddonRecord,
  ): Promise<{ results: SearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    const terms = [...new Set(queries.filter((q): q is string => !!q?.trim()))];
    const [searched, named] = await Promise.all([
      this.#searchProviders(this.#catalogProviders(), terms, installation),
      this.#tocSources(installation, toc),
    ]);
    const key = (r: { providerName?: string; externalId?: string }) => `${r.providerName}:${r.externalId}`;
    const byKey = new Map(
      [...searched.results, ...named.results]
        // A switch is to another provider's copy: on its own one, other
        // entries are forks or other editions (DEVICE 2026-10-22: Details!'s
        // were its Burning Crusade and Shadowlands beta projects).
        .filter((r) => r.providerName !== own?.providerName)
        .map((r) => [key(r), r]),
    );
    const names = new Set(terms.map((q) => q.toLowerCase()));
    const tocNamed = new Set(named.results.map(key));
    // The TOC's id is the author's own word on which addon it is; a name can be shared.
    const first = (r: AddonSearchResult) => 2 * Number(tocNamed.has(key(r))) + Number(names.has(r.name.toLowerCase()));
    const results = [...byKey.values()]
      .filter((r) => installsFolder(latestFile(r.files, installation.defaultAddonChannelType), folderName))
      .sort(
        (a, b) =>
          first(b) - first(a) || (b.downloadCount ?? 0) - (a.downloadCount ?? 0) || a.name.localeCompare(b.name),
      );
    return {
      results: results.map((r) => this.wireResult(r, installation)),
      providerErrors: [...searched.providerErrors, ...named.providerErrors],
    };
  }

  /**
   * The addons a TOC names by project id (AddonProvider.tocId), one per
   * provider that is on, each asked by id. A provider that fails is
   * reported, like a failed search.
   */
  async #tocSources(
    installation: WowInstallation,
    toc: Toc | undefined,
  ): Promise<{ results: AddonSearchResult[]; providerErrors: Array<{ providerId: string; error: string }> }> {
    const results: AddonSearchResult[] = [];
    const providerErrors: Array<{ providerId: string; error: string }> = [];
    await Promise.all(
      this.registry.available().map(async (provider) => {
        const id = toc && provider.tocId(toc);
        if (!id || !provider.isValidAddonId(id)) {
          return;
        }
        try {
          const result = await provider.getById(id, installation);
          if (result) {
            results.push(result);
          }
        } catch (err) {
          console.error(`[service] lookup by TOC id failed for ${provider.name}: ${String(err)}`);
          providerErrors.push({ providerId: provider.name, error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
    return { results, providerErrors };
  }

  /**
   * Make an unmanaged folder a managed addon (WF-23): installs the chosen
   * release over it (it must contain the folder). The files there now are
   * kept as the previous version (intent "adopt"), so Roll back returns to
   * them; addon settings live in WTF and are untouched.
   */
  async adopt(
    installation: WowInstallation,
    folderName: string,
    providerId: string,
    externalId: string,
  ): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    return this.#gate.run(async () => {
      const folder = await this.#requireUnmanagedFolder(installation, folderName);
      const version = getTocForGameType2(folder, installation.clientType)?.version;
      return this.#installUnlocked({
        intent: "adopt",
        providerId,
        externalId,
        installation,
        adopt: { folder: folderName, version },
      });
    });
  }

  /**
   * Switch a managed addon to another source (WF-12; upstream's setProvider):
   * that source's release is installed into the addon's record (intent
   * "source"), so the addon keeps its id, flags and kept previous version.
   * Refused when that source is the addon's own or already installed as
   * another addon (upstream: ERROR_ADDON_ALREADY_INSTALLED).
   */
  async changeSource(
    addonId: string,
    providerId: string,
    externalId: string,
  ): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    return this.#gate.run(async () => {
      const addon = this.store.addons.require(addonId);
      const installation = this.installations.require(addon.installationId);
      const other = this.store.addons.find(installation.id, providerId, externalId);
      if (other) {
        throw new ValidationError(
          other.id === addon.id ? `${addon.name} already updates from there` : `${other.name} from there is already installed`,
        );
      }
      return this.#installUnlocked({ intent: "source", providerId, externalId, installation, replaces: addon });
    });
  }

  /**
   * An unmanaged folder the user may act on (remove, find a source, adopt):
   * listed as unmanaged (unmanagedFolders) and not ignored. A git checkout
   * may hold unpushed work and the Raider.IO client would only download its
   * folders again, so the engine never touches them, whatever a caller sends.
   * A managed folder means the caller's list is stale: refuse rather than
   * guess.
   */
  async #requireUnmanagedFolder(installation: WowInstallation, folderName: string): Promise<AddonFolder> {
    const records = this.addonsFor(installation.id);
    if (records.some((a) => a.installedFolderList?.includes(folderName))) {
      throw new ValidationError(`${folderName} is a managed addon folder, not unmanaged`);
    }
    const folder = unmanagedFolders(await scanAddons(installation), records).find((f) => f.name === folderName);
    if (!folder || folder.ignoreReason !== undefined) {
      throw new ValidationError(`${folderName} isn't an unmanaged addon folder`);
    }
    return folder;
  }

  // ---- Discover/Browse ----

  /**
   * One page of a source's Latest or Popular list (Get Addons). One source
   * at a time, picked in the list's Source menu: upstream joins every
   * source into one list and shows an addon two sources host twice.
   */
  async discover(
    list: DiscoverList,
    providerId: string,
    installation: WowInstallation,
    index: number,
    pageSize: number,
    categoryId?: string,
  ): Promise<{ results: SearchResult[]; totalCount: number }> {
    const provider = this.registry.usable(providerId);
    if (!provider?.discovers) {
      throw new ProviderError(
        providerId,
        `${providerDisplayName(providerId)} isn't available. Turn it on in Options › Addon sources`,
        "provider_unavailable",
      );
    }
    const { results, totalCount } = await provider.getDiscoverPage(list, installation, index, pageSize, categoryId);
    return { results: results.map((r) => this.wireResult(r, installation)), totalCount };
  }

  /** Names for provider ids (Details Relationships page), and whether each is installed here. */
  async lookup(
    providerId: string,
    externalIds: string[],
    installation: WowInstallation,
  ): Promise<{ externalId: string; name: string; thumbnailUrl: string | null; installed: boolean }[]> {
    const provider = this.registry.usable(providerId);
    if (!provider || externalIds.length === 0) {
      return [];
    }
    const ids = externalIds.slice(0, LOOKUP_MAX_IDS).filter((id) => provider.isValidAddonId(id));
    const { searchResults } = await provider.getAll(installation, ids);
    const installed = new Set(
      this.addonsFor(installation.id)
        .filter((a) => a.providerName === providerId)
        .map((a) => a.externalId),
    );
    return searchResults.map((r) => ({
      externalId: r.externalId,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl || null,
      installed: installed.has(r.externalId),
    }));
  }

  // ---- Addon Details modal ----
  // Generic across providers (unlike Discover/Browse): every AddonProvider
  // has a getDescription/getChangelog, defaulting to "unsupported"
  // (undefined) on the base class, so this doesn't need a Curse-specific
  // guard the way discoverLatest/Popular do.

  async getAddonDescription(providerId: string, externalId: string): Promise<string | null> {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new NotFoundError("provider", providerId);
    }
    const description = await provider.getDescription(externalId);
    return description || null;
  }

  async getAddonChangelog(
    providerId: string,
    externalId: string,
    installation: WowInstallation,
  ): Promise<string | null> {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new NotFoundError("provider", providerId);
    }
    const changelog = await provider.getChangelog(externalId, installation);
    return changelog || null;
  }

  // ---- Category filtering ----
  // Generic across providers, same reasoning as Description/Changelog
  // above: every AddonProvider has getCategories, defaulting to
  // "unsupported" (undefined) on the base class.

  async getCategories(providerId: string, installation: WowInstallation): Promise<ProviderCategory[] | null> {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new NotFoundError("provider", providerId);
    }
    const categories = await provider.getCategories(installation);
    return categories ?? null;
  }

  // ---- provider metadata sync (update checks) ----

  async refresh(installation: WowInstallation): Promise<{ updated: number; failed: number }> {
    return this.#gate.run(async () => {
      const managed = this.addonsFor(installation.id).filter((a) => !!a.providerName && !a.isIgnored);
      let failed = 0;

      const byProvider = new Map<string, AddonRecord[]>();
      for (const addon of managed) {
        const list = byProvider.get(addon.providerName!) ?? [];
        list.push(addon);
        byProvider.set(addon.providerName!, list);
      }

      for (const [providerName, addons] of byProvider) {
        const provider = this.registry.usable(providerName);
        if (!provider?.checksForUpdates) {
          continue;
        }
        try {
          const { searchResults, errors } = await provider.getAll(installation, addons.map((a) => a.externalId!));
          const patches: { id: string; patch: AddonPatch }[] = [];
          // Only a clean answer can say an addon is gone; a partial
          // failure leaves every warning as it was.
          if (errors.length === 0) {
            const returned = new Set(searchResults.map((r) => r.externalId));
            for (const addon of addons) {
              if (!returned.has(addon.externalId!) && addon.warningType !== WARNING_FOLDERS_MISSING) {
                patches.push({ id: addon.id, patch: { warningType: WARNING_NOT_ON_PROVIDER } });
              }
            }
          }
          for (const result of searchResults) {
            const addon = addons.find((a) => a.externalId === result.externalId);
            if (!addon) {
              continue;
            }
            const file = updateCandidate(result.files, addon);
            patches.push({
              id: addon.id,
              patch: {
                ...releaseMetadata(addon, result.files, file),
                downloadUrl: file?.downloadUrl ?? addon.downloadUrl,
                releasedAt: file?.releaseDate ? new Date(file.releaseDate).getTime() : addon.releasedAt,
                summary: result.summary ?? addon.summary,
                thumbnailUrl: result.thumbnailUrl ?? addon.thumbnailUrl,
                ...(addon.warningType === WARNING_NOT_ON_PROVIDER ? { warningType: undefined } : {}),
              },
            });
          }
          this.store.addons.patchMany(patches);
        } catch (err) {
          failed += addons.length;
          console.error(`[service] refresh failed for ${providerName}: ${String(err)}`);
        }
      }

      return { updated: managed.length - failed, failed };
    });
  }

  // ---- install / update / remove ----

  /**
   * Install an addon from a provider, the way `request.intent` says (see
   * INSTALL_INTENTS). One install at a time (the gate); a required
   * dependency is installed inside the same turn.
   */
  async install(request: InstallRequest): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    return this.#gate.run(() => this.#installUnlocked(request));
  }

  /** The install itself; callers hold the gate (`Gate.run` is not reentrant). */
  async #installUnlocked(request: InstallRequest): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const { providerId, externalId, installation } = request;
    const intent = INSTALL_INTENTS[request.intent];
    // Configured is enough here: a source turned off still installs what the
    // user picked by hand (Install from URL, as upstream); off stops searching,
    // scanning and update checks. Updates, reinstalls and channel switches are
    // gated on usable() before they get here.
    const provider = this.registry.get(providerId);
    if (!provider?.isConfigured()) {
      throw new NotFoundError("provider", providerId);
    }
    if (!provider.isValidAddonId(externalId)) {
      throw new ValidationError("That addon id isn't valid");
    }
    const searchResult = await provider.getById(externalId, installation);
    if (!searchResult?.files?.length) {
      throw new NotFoundError("addon on provider", externalId);
    }

    const existing = request.replaces ?? this.store.addons.find(installation.id, providerId, externalId);
    if (request.channel !== undefined && !provider.allowChannelChange) {
      throw new ValidationError(`${provider.name} has no release channels`);
    }
    // A new source without release channels starts like a fresh install.
    const keptChannel = request.replaces && !provider.allowChannelChange ? undefined : existing?.channelType;
    const channelType = request.channel ?? keptChannel ?? installation.defaultAddonChannelType;
    // An adopt or source change that would not replace the folder would
    // leave it next to a second copy of the addon. A release that lists no
    // folders (WoWInterface) is checked on its archive (requiredFolder).
    const mustInstall = request.adopt?.folder ?? (request.replaces && recordFolders(request.replaces)[0]);
    if (mustInstall && !installsFolder(latestFile(searchResult.files, channelType), mustInstall)) {
      throw new ValidationError(`${searchResult.name} doesn't install the folder ${mustInstall}`);
    }
    // What the install itself decides about the record, kept with the
    // installer's changes and written only when the install succeeds: a
    // failed one leaves the stored record as it was.
    const decided: AddonPatch = {
      channelType,
      hasNewerPrerelease: hasNewerPrerelease(searchResult.files),
      // removeAddon()'s autoremove sweep needs to know what's required.
      dependencies: (latestFile(searchResult.files, channelType)?.dependencies ?? []).filter(
        (d) => d.type === AddonDependencyType.Required,
      ),
      // Installing directly an addon that was first pulled in as a
      // dependency makes it the user's choice (apt marks it "manual"), so
      // autoremove no longer takes it away with its dependent.
      ...(existing?.isDependency && intent.dependencyFlag === "clear" ? { isDependency: false } : {}),
    };
    const addon: AddonRecord = {
      ...(existing ??
        newAddonRecord({
          name: searchResult.name,
          installationId: installation.id,
          channelType,
          isDependency: intent.dependencyFlag === "set",
          // What is on disk now: the version Roll back offers after an adopt.
          installedVersion: request.adopt?.version,
        })),
      ...decided,
    };

    const operationId = this.nextOperationId();
    // Download/extract/install failures are expected, routine outcomes (a
    // flaky network, a provider-side download restriction, a full disk) —
    // never let one escape as a thrown RPC error: main.py's bridge turns an
    // uncaught exception into Decky's message-less "Python Exception".
    let outcome: Awaited<ReturnType<AddonInstaller["install"]>>;
    try {
      outcome = await this.#installer.install({
        installation,
        addon,
        searchResult,
        provider,
        operationId,
        onProgress: intent.broadcast ? (progress) => this.events.operationProgress(progress) : () => {},
        // An install over files on disk keeps the previous version
        // (BEYOND-02); the installer leaves the kept one alone for a
        // reinstall of the same release.
        keepPreviousVersion:
          intent.keepPrevious === "always" || (!!existing && this.store.settings.keepPreviousVersions),
        requiredFolder: mustInstall,
      });
    } catch (err) {
      const operation = intent.broadcast ? this.#fail(operationId, addon.id, err) : failedOperation(operationId, addon.id, err);
      return { addon: existing ?? addon, operation };
    }

    const changes: AddonPatch = {
      ...decided,
      ...outcome.patch,
      // Installing (update, reinstall, channel switch) is choosing the new
      // version: automatic updates resume for it.
      autoUpdatePaused: undefined,
      skipReleaseId: undefined,
      // Every update path (manual, Update all, auto-update) ends here (PC-07).
      ...(intent.stampUpdate ? { lastUpdatedAt: Date.now() } : {}),
    };
    const installed = existing
      ? this.store.addons.patch(existing.id, changes)
      : this.store.addons.create({ ...addon, ...changes });

    // Required dependencies install with it (apt/pacman-style: marked as
    // automatically installed, see removeAddon()'s autoremove), one level
    // deep only, so this stays bounded however the real graph looks.
    const missingRequiredDependencies: string[] = [];
    if (intent.withDependencies) {
      for (const dep of addon.dependencies ?? []) {
        if (this.store.addons.find(installation.id, providerId, dep.externalAddonId)) {
          continue;
        }
        const installed = await this.#installUnlocked({
          intent: "dependency",
          providerId,
          externalId: dep.externalAddonId,
          installation,
        }).catch(() => null);
        if (!installed || installed.operation.status === "failed") {
          missingRequiredDependencies.push(dep.externalAddonId);
        }
      }
    }
    const operation: OperationResult = {
      operationId,
      addonId: addon.id,
      // Set on the broadcast result itself, not only on the returned one:
      // every subscriber must see an update reported as "updated".
      status: intent.status,
      error: null,
      ...(missingRequiredDependencies.length ? { missingRequiredDependencies } : {}),
    };
    if (intent.broadcast) {
      this.events.operationResult(operation);
    }
    this.events.addonsChanged([addon.id]);
    return { addon: installed, operation };
  }

  async updateAddon(addonId: string): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const addon = this.store.addons.require(addonId);
    const installation = this.installations.require(addon.installationId);
    const provider = this.registry.usable(addon.providerName);
    if (!provider) {
      throw new NotFoundError("provider for addon", addon.providerName ?? "none");
    }

    // Fetching latest metadata is a real network call and can fail for
    // the same routine reasons an install can — same "never throw a raw
    // RPC error for an expected failure" rule as install() above.
    let searchResult: AddonSearchResult | undefined;
    try {
      searchResult = await provider.getById(addon.externalId!, installation);
    } catch (err) {
      return { addon, operation: this.#fail(this.nextOperationId(), addonId, err) };
    }
    if (!searchResult?.files?.length) {
      const flagged =
        addon.warningType === WARNING_FOLDERS_MISSING
          ? addon
          : this.store.addons.patch(addonId, { warningType: WARNING_NOT_ON_PROVIDER });
      const operation = this.#fail(this.nextOperationId(), addonId, `addon no longer available on ${provider.name}`);
      return { addon: flagged, operation };
    }
    const metadata = releaseMetadata(addon, searchResult.files, updateCandidate(searchResult.files, addon));
    const latest: AddonRecord = { ...addon, ...metadata };

    if (!needsUpdate(latest)) {
      // Nothing to install, but what the provider said is kept, as a
      // refresh keeps it. An update writes it with the install, or not at
      // all when the install fails.
      const current = this.store.addons.patch(addonId, metadata);
      const operation: OperationResult = {
        operationId: this.nextOperationId(),
        addonId,
        status: "current",
        error: null,
      };
      this.events.operationResult(operation);
      return { addon: current, operation };
    }

    const { addon: updated, operation } = await this.install({
      intent: "update",
      providerId: provider.name,
      externalId: addon.externalId!,
      installation,
    });
    return { addon: updated, operation };
  }

  /** The wire form of a record, with what only the service knows (provider capabilities). */
  wire(addon: AddonRecord): Addon {
    return toWireAddon(addon, {
      canReinstall: this.canReinstall(addon),
      canChangeChannel: this.canChangeChannel(addon),
      sourceOff: !!addon.providerName && !this.registry.usable(addon.providerName),
      canUpdate: updateStatus(addon, this.registry).canUpdate,
      newlyUpdatedMs: this.store.settings.newlyUpdatedHours * 3_600_000,
    });
  }

  /** A provider result in wire form, its versions picked for the installation's default channel. */
  wireResult(result: AddonSearchResult, installation: WowInstallation): SearchResult {
    const provider = this.registry.get(result.providerName);
    return toWireSearchResult(result, installation.defaultAddonChannelType, !!provider?.allowChannelChange);
  }

  /**
   * Managed by a usable provider with release channels (upstream's
   * allowChannelChange), and there is a choice to make: a pre-release newer
   * than stable, or the addon already follows Beta/Alpha (so it can always
   * go back to Stable).
   */
  canChangeChannel(addon: AddonRecord): boolean {
    if (!addon.providerName || !addon.externalId) {
      return false;
    }
    const provider = this.registry.usable(addon.providerName);
    const choice = addon.channelType !== AddonChannelType.Stable || !!addon.hasNewerPrerelease;
    return !!provider?.allowChannelChange && choice;
  }

  /**
   * Moves an addon to another release channel and installs that channel's
   * latest release at once (WF-03, owner 2026-10-16), also when it is older
   * than what is installed: going back to Stable means the stable release.
   * Keeps the dependency flag, like a reinstall. When the install fails the
   * addon stays on its old channel (a failed install writes nothing), so the
   * record never claims a channel whose files are not on disk.
   */
  async setChannel(addonId: string, channel: AddonChannelType): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const addon = this.store.addons.require(addonId);
    if (!this.canChangeChannel(addon)) {
      throw new ValidationError(`${addon.name} has no release channels`);
    }
    const installation = this.installations.require(addon.installationId);
    return this.install({
      intent: "channel",
      providerId: addon.providerName!,
      externalId: addon.externalId!,
      installation,
      channel,
    });
  }

  /** Managed by a usable provider that allows reinstalling (upstream's canReInstall). */
  canReinstall(addon: AddonRecord): boolean {
    if (!addon.providerName || !addon.externalId) {
      return false;
    }
    return !!this.registry.usable(addon.providerName)?.allowReinstall;
  }

  /**
   * Installs the addon's current release again over what is on disk, to
   * repair deleted or edited files (WF-05). Unlike upstream it is allowed
   * when folders are missing: that is the main repair case. Keeps the
   * dependency flag, so autoremove still treats a dependency as one.
   */
  async reinstall(addonId: string): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const addon = this.store.addons.require(addonId);
    if (!this.canReinstall(addon)) {
      throw new ValidationError(`${addon.name} can't be reinstalled`);
    }
    const installation = this.installations.require(addon.installationId);
    return this.install({ intent: "reinstall", providerId: addon.providerName!, externalId: addon.externalId!, installation });
  }

  async updateAll(installation: WowInstallation): Promise<OperationResult[]> {
    const candidates = this.eligibleUpdatesFor(installation);
    const operations: OperationResult[] = [];
    for (const candidate of candidates) {
      try {
        const { operation } = await this.updateAddon(candidate.id);
        operations.push(operation);
      } catch (err) {
        operations.push(failedOperation(this.nextOperationId(), candidate.id, err));
      }
    }
    return operations;
  }

  /**
   * Update all, across every installation (WF-13; upstream's "Update All
   * Clients"). Run it after an update check of every installation
   * (UpdateCheck): only the selected one is refreshed when its list is
   * shown, so another one's metadata may be days old. A failed update never
   * stops the others (updateAll).
   */
  async updateAllInstallations(): Promise<OperationResult[]> {
    const operations: OperationResult[] = [];
    for (const installation of this.installations.list()) {
      operations.push(...(await this.updateAll(installation)));
    }
    return operations;
  }

  /**
   * Updates waiting per installation (Steam game-page section, BEYOND-05),
   * counted like the toast and Update all (eligibleUpdatesFor), from what the
   * last check found (UpdateCheck runs the check).
   */
  updateSummary(): { installationId: string; displayName: string; updates: number }[] {
    const out: { installationId: string; displayName: string; updates: number }[] = [];
    for (const installation of this.installations.list()) {
      out.push({
        installationId: installation.id,
        displayName: installation.displayName,
        updates: this.eligibleUpdatesFor(installation).length,
      });
    }
    return out;
  }

  /**
   * Swap an addon with its kept previous version (BEYOND-02). The record
   * follows the files; going back to an older version pauses automatic
   * updates for the addon, going forward to the latest resumes them.
   */
  async rollback(addonId: string): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    return this.#gate.run(async () => {
      const addon = this.store.addons.require(addonId);
      const installation = this.installations.require(addon.installationId);
      const operationId = this.nextOperationId();
      try {
        const rolledFrom = addon.installedExternalReleaseId;
        const previous = await swapWithPrevious(installation, addon.id, {
          version: addon.installedVersion ?? null,
          releaseId: rolledFrom ?? null,
          folders: [...(addon.installedFolderList ?? [])],
        });
        const installedExternalReleaseId = previous.releaseId ?? undefined;
        const rolled = this.store.addons.patch(addonId, {
          rollbackVersion: addon.installedVersion ?? "previous version",
          installedVersion: previous.version ?? addon.installedVersion,
          installedExternalReleaseId,
          installedFolderList: previous.folders,
          installedFolders: previous.folders.join(", "),
          // Rolled back to an older version: automatic updates pause for this
          // addon until it is updated by hand or resumed (owner, 2026-10-16).
          // Rolled forward to the latest: they resume.
          autoUpdatePaused: installedExternalReleaseId !== addon.externalLatestReleaseId || undefined,
          skipReleaseId: undefined,
          warningType: undefined,
          updatedAt: Date.now(),
        });
        const operation: OperationResult = { operationId, addonId, status: "installed", error: null };
        this.events.operationResult(operation);
        this.events.addonsChanged([addonId]);
        return { addon: rolled, operation };
      } catch (err) {
        return { addon, operation: this.#fail(operationId, addonId, err) };
      }
    });
  }

  async rollbackStatus(): Promise<{ bytes: number; count: number }> {
    return cacheUsage(this.installations.list());
  }

  /** Pause or resume automatic updates for one addon (WF-02). */
  setAutoUpdatePaused(addonId: string, paused: boolean): AddonRecord {
    const addon = this.store.addons.patch(addonId, { autoUpdatePaused: paused || undefined, skipReleaseId: undefined });
    this.events.addonsChanged([addonId]);
    return addon;
  }

  /** Delete every kept previous version (Options). */
  async clearRollback(): Promise<{ bytes: number; count: number }> {
    return this.#gate.run(async () => {
      await clearAll(this.installations.list());
      const changed = this.store.addons
        .all()
        .filter((a) => a.rollbackVersion)
        .map((a) => a.id);
      this.store.addons.patchMany(changed.map((id) => ({ id, patch: { rollbackVersion: undefined } })));
      if (changed.length) {
        this.events.addonsChanged(changed);
      }
      return cacheUsage(this.installations.list());
    });
  }

  /**
   * Automatic update (WF-02): with the option on, update every candidate
   * (updateStatus.canAutoUpdate) in every installation, one failure never stopping
   * the rest. Runs after a check, never on its own timer. Not while WoW is
   * running (same /proc check as the WTF restore): the files would change
   * under a running client. Records the outcome for Options and emits it
   * for a toast. Concurrent callers share one run. Null when off or when
   * nothing was waiting.
   */
  autoUpdate(detect: () => Promise<GameRunning> = detectGameRunning): Promise<AutoUpdateResult | null> {
    if (!this.store.settings.autoUpdate) {
      return Promise.resolve(null);
    }
    this.#autoRun ??= this.#runAutoUpdate(detect).finally(() => {
      this.#autoRun = null;
    });
    return this.#autoRun;
  }

  #autoRun: Promise<AutoUpdateResult | null> | null = null;

  async #runAutoUpdate(detect: () => Promise<GameRunning>): Promise<AutoUpdateResult | null> {
    const candidates = this.installations.list().flatMap((installation) =>
      this.addonsFor(installation.id).filter((a) => updateStatus(a, this.registry).canAutoUpdate),
    );
    if (candidates.length === 0) {
      return null;
    }
    const result: AutoUpdateResult = { at: Date.now(), updated: [], failed: [], skipped: null };
    if ((await detect().catch(() => "unknown" as const)) === "running") {
      result.skipped = "WoW was running";
    } else {
      for (const addon of candidates) {
        try {
          const { operation } = await this.updateAddon(addon.id);
          if (operation.status === "updated") {
            result.updated.push(addon.name);
          } else if (operation.status === "failed") {
            result.failed.push(addon.name);
          }
        } catch {
          result.failed.push(addon.name);
        }
      }
    }
    this.store.updateSettings({ lastAutoUpdate: result });
    this.events.autoUpdated?.(result);
    return result;
  }

  /**
   * Installs every "new" entry of an addon list (see
   * AddonListPortability.preview); "no_change", "conflict" and "unresolved"
   * entries are never touched. Library flags are settled once every entry is
   * in (libraryFlagsAfterImport), so the list's order does not matter.
   */
  async importAddonList(
    importString: string,
    installation: WowInstallation,
  ): Promise<{ operations: OperationResult[]; error: { code: string; message: string } | null }> {
    const preview = this.portability.preview(importString, installation);
    if (preview.error) {
      return { operations: [], error: preview.error };
    }
    const operations: OperationResult[] = [];
    const imported = new Map<string, boolean>();
    for (const c of preview.summary!.comparisons.filter((c) => c.state === "new")) {
      // An earlier entry's install may already have pulled this one in as its
      // dependency (the preview said "new"): it is installed, no second download.
      const pulledIn = this.store.addons.find(installation.id, c.providerId, c.externalId);
      const operation: OperationResult = pulledIn
        ? { operationId: this.nextOperationId(), addonId: pulledIn.id, status: "installed", error: null }
        : await this.install({ intent: "import", providerId: c.providerId, externalId: c.externalId, installation }).then(
            ({ operation }) => operation,
            (err: unknown) => failedOperation(this.nextOperationId(), null, err),
          );
      if (operation.status !== "failed" && operation.addonId) {
        imported.set(operation.addonId, c.dependency);
      }
      operations.push({ ...operation, addonName: c.name });
    }
    const changes = libraryFlagsAfterImport(this.addonsFor(installation.id), imported);
    this.store.addons.patchMany(changes.map(({ id, isDependency }) => ({ id, patch: { isDependency } })));
    if (changes.length) {
      this.events.addonsChanged(changes.map((c) => c.id));
    }
    return { operations, error: null };
  }

  async removeAddon(addonId: string): Promise<OperationResult> {
    return this.#gate.run(async () => {
      const addon = this.store.addons.require(addonId);
      const installation = this.installations.require(addon.installationId);
      const operationId = this.nextOperationId();
      await this.#remover.remove(installation, addon, operationId);
      this.store.addons.remove(addonId);
      await dropPrevious(installation, addonId);
      const removedIds = [addonId];

      // apt/pacman-style autoremove: a library (isDependency) goes too once
      // nothing installed requires it, repeated until none is left, so a
      // library only another library needed goes with it. Ends: every round
      // removes at least one record.
      for (let orphans = orphanedLibraries(this.addonsFor(installation.id)); orphans.length; ) {
        for (const orphan of orphans) {
          await this.#remover.remove(installation, orphan, this.nextOperationId());
          this.store.addons.remove(orphan.id);
          await dropPrevious(installation, orphan.id);
          removedIds.push(orphan.id);
        }
        orphans = orphanedLibraries(this.addonsFor(installation.id));
      }

      const operation: OperationResult = { operationId, addonId, status: "removed", error: null };
      this.events.operationResult(operation);
      this.events.addonsChanged(removedIds);
      return operation;
    });
  }

  /**
   * Remove an unmanaged addon folder directly from disk. Unmanaged
   * folders have no WowAddon record to look up, so
   * this is a pure filesystem operation — it never touches store.addons
   * and never converts the folder into a managed addon. Two safety
   * checks beyond AddonRemover's own atomic trash-then-delete and
   * joinWithin path confinement: the name must be a bare folder name
   * (no path separators), and it must be an unmanaged folder the user may
   * act on (#requireUnmanagedFolder: not managed, not ignored).
   */
  async removeUnmanagedFolder(installation: WowInstallation, folderName: string): Promise<OperationResult> {
    return this.#gate.run(async () => {
      if (!folderName || folderName.includes("/") || folderName.includes("\\") || folderName === "." || folderName === "..") {
        throw new ValidationError(`invalid addon folder name: ${folderName}`);
      }
      await this.#requireUnmanagedFolder(installation, folderName);
      const operationId = this.nextOperationId();
      const addonId = `unmanaged:${folderName}`;
      await this.#remover.remove(installation, { id: addonId, installedFolderList: [folderName] }, operationId);
      const operation: OperationResult = { operationId, addonId, status: "removed", error: null };
      this.events.operationResult(operation);
      this.events.addonsChanged([addonId]);
      return operation;
    });
  }

  /**
   * An addon's folders in this installation's AddOns (WF-20), main folder
   * first, each with its path and whether it is on disk: a managed record's
   * recorded folders, or an unmanaged addon's (`unmanaged:<folder>`) one
   * folder, which must be an on-disk folder no record owns.
   */
  async addonFolders(
    installation: WowInstallation,
    addonId: string,
  ): Promise<{ addonsPath: string; folders: Array<{ name: string; path: string; present: boolean }> }> {
    const addonsPath = getAddonsPath(installation);
    const record = this.store.addons.get(addonId);
    let names: string[];
    if (record && record.installationId === installation.id) {
      names = recordFolders(record);
    } else if (addonId.startsWith("unmanaged:")) {
      const folderName = addonId.slice("unmanaged:".length);
      const unmanaged = unmanagedFolders(await scanAddons(installation), this.addonsFor(installation.id));
      if (!unmanaged.some((f) => f.name === folderName)) {
        throw new NotFoundError("addon", addonId);
      }
      names = [folderName];
    } else {
      throw new NotFoundError("addon", addonId);
    }
    const folders = await Promise.all(
      names.map(async (name) => {
        const path = joinWithin(addonsPath, name);
        return { name, path, present: await isDirectory(path) };
      }),
    );
    return { addonsPath, folders };
  }

  setIgnored(addonId: string, ignored: boolean): AddonRecord {
    const addon = this.store.addons.patch(addonId, { isIgnored: ignored });
    this.events.addonsChanged([addonId]);
    return addon;
  }

  private nextOperationId(): string {
    this.#opCounter += 1;
    return `op-${Date.now().toString(36)}-${this.#opCounter}`;
  }

  // ---- diagnostics helpers ----

  addonsPathFor(installation: WowInstallation): string {
    return getAddonsPath(installation);
  }

  /** Human-readable diagnostics only — `clientLabel` is a display string, never an identity. */
  installationSummary(): { id: string; clientLabel: string; path: string }[] {
    return this.store.installations.map((i) => ({
      id: i.id,
      clientLabel: getClientTypeLabel(i.clientType),
      path: i.location,
    }));
  }
}
