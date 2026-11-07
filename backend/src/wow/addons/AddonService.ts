/**
 * Addon orchestration service (project-owned).
 *
 * Follows WowUp's AddonService/AddonInstallService flows (GPL-3.0, commit
 * 4fdae600) adapted to this engine: no Angular/rxjs, serialized mutations,
 * events via callback, persistence via StateStore. needsUpdate semantics
 * are verbatim from wowup-electron addon.controller.ts.
 * See docs/wowup-provenance.md.
 */

import type { Addon, AddonOperation, AutoUpdateResult, OperationResult } from "../../api/contracts";
import type { ArchiveMatch, ArchivePreview, RecoveryRetryResult, RecoveryVerifyResult } from "../../api/contracts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGameRunning } from "../wtf/GameProcessGuard";
import type { GameRunning } from "../wtf/GameProcessGuard";
import type { AddonFolder, AddonSearchResult, AddonSearchResultFile, WowAddon, WowInstallation } from "../models";
import { newAddonRecord } from "../models";
import { AddonChannelType, AddonDependencyType, type AddonProviderType } from "../types";
import type { Toc } from "../toc/toc";
import type { AddonProvider, ScanMatch } from "../providers/addon-provider";
import type { SourceRequest } from "../catalogue/Catalogue";
import { InstallError, NotFoundError, RecoveryRequiredError, ValidationError } from "../errors";
import type { ProviderRegistry } from "../providers/provider-registry";
import type { StateStore } from "../storage/StateStore";
import { recordFolders, type AddonPatch, type AddonRecord, type AddonRecordReader, type AddonRecords } from "./AddonRecords";
import { isDirectory, joinWithin } from "../fs/safe-fs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { InstallationService } from "../installation/InstallationService";
import { scanAddons } from "./AddonScanner";
import { computeWowUpFingerprints } from "./FingerprintScanner";
import { AddonInstaller, AddonRemover } from "./AddonInstaller";
import { AddonTransactions, TransactionFailure } from "./AddonTransaction";
import { InstallationRecovery } from "./InstallationRecovery";
import { RecoveryActions } from "./RecoveryActions";
import { hasNewerPrerelease, installsFolder, latestFile, updateCandidate } from "./releaseChannel";
import { cacheUsage, clearAll, dropPrevious, keptRelease, readPrevious, restoredSource } from "./RollbackCache";
import { repairSharedFolders } from "./SharedFolderRepair";
import { AddonListPortability } from "./AddonPortability";
import { libraryFlagsAfterImport, libraryNeeds, type LibraryNeeds } from "./libraries";
import type { DownloadHandle, DownloadService } from "../downloads/DownloadService";
import { canonicalLocalArchive } from "../archives/localArchive";
import { inspectAddonArchive } from "../archives/ArchiveInspector";
import { archiveHash, archiveTarget, conflictMessage, installsByArchive, type ArchiveTarget } from "./archiveMatch";
import { getTocForGameType2 } from "../utils/toc";
import { getClientTypeLabel } from "../utils/gametype";
import { gameVersionForInstallation } from "../utils/gameversion";
import { WOWUP_DATA_ADDON_FOLDER_NAME } from "../notifications/constants";
import { PROVIDER_ID } from "../../api/providers";
import { needsUpdate, updateStatus } from "./addonStatus";
import {
  WARNING_FOLDERS_MISSING,
  WARNING_NOT_ON_PROVIDER,
  folderStatePatch,
  missingDependencies,
  listedIgnoreReason,
  toWireAddon,
  toWireUnmanaged,
} from "./wire";

export interface ServiceEvents {
  addonsChanged: (addonIds: string[]) => void;
  operationResult: (result: OperationResult) => void;
  /** An automatic update ran (WF-02). */
  autoUpdated?: (result: AutoUpdateResult) => void;
}


/**
 * Serialized mutation queue (replaces WowUp's rxjs install queue), and the
 * only holder of the writable records: a change gets them by running a
 * turn, so no record changes outside one.
 */
class Gate {
  #chain: Promise<unknown> = Promise.resolve();

  constructor(private records: AddonRecords) {}

  run<T>(fn: (records: AddonRecords) => T | Promise<T>): Promise<T> {
    const turn = () => fn(this.records);
    const next = this.#chain.then(turn, turn);
    this.#chain = next.catch(() => {});
    return next;
  }
}


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

/** The preview's answer (ArchivePreview.match) for where an archive installs. */
function archiveMatchOf(target: ArchiveTarget): ArchiveMatch {
  if (target.kind === "new") {
    return { kind: "new" };
  }
  if (target.kind === "conflict") {
    return {
      kind: "conflict",
      records: target.owners.map(({ record, folders }) => ({ addonId: record.id, name: record.name, folders })),
    };
  }
  const { id: addonId, name, providerName } = target.record;
  // Updating a catalogue record from an archive is a source change: the
  // card warns that it stops updating from there.
  if (target.kind === "update" && providerName && !installsByArchive(providerName)) {
    return { kind: "takeover", addonId, name, providerId: providerName };
  }
  return { kind: target.kind, addonId, name };
}

/** A failed operation's result (not broadcast; see AddonService#fail). */
function failedOperation(operationId: string, addonId: string | null, err: unknown): OperationResult {
  return {
    operationId,
    addonId,
    status: "failed",
    error: err instanceof Error ? err.message : String(err),
    // An undo that stopped, or a refusal because one did (InstallationRecovery).
    ...((err instanceof TransactionFailure && !err.restored) || err instanceof RecoveryRequiredError
      ? { recoveryRequired: true as const }
      : {}),
  };
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

/** A managed addon's wire shape with who needs it and what its Remove would leave unneeded. */
function withNeeds(wire: Addon, record: AddonRecord, needs: LibraryNeeds): Addon {
  return {
    ...wire,
    neededBy: needs.neededBy(record),
    leavesUnneeded: needs.leftUnneeded([record.id]).map((l) => l.name),
  };
}

export class AddonService {
  #installer: AddonInstaller;
  /** The engine's one addon transaction runner: installs, updates, removals and Roll back commit through it. */
  readonly #transactions: AddonTransactions;
  /** Retry recovery and Verify recovery, carried out in the gate. */
  readonly #recoveryActions: RecoveryActions;
  #remover: AddonRemover;
  /** Record changes run here, one at a time (Gate). */
  readonly #gate: Gate;
  /** Record lookups; writes go through the gate. */
  readonly #records: AddonRecordReader;
  /** Settings and installations; the records are not reachable from here. */
  private store: Omit<StateStore, "addons">;
  #opCounter = 0;
  /**
   * Scratch root for archive previews (addons.inspectArchive): on the
   * engine's data filesystem, never inside an installation, emptied by
   * each inspection itself.
   */
  readonly #inspectRoot: string;

  /** The installation recovery guard (ADR 0006): refuses changes where an undo stopped. */
  readonly recovery: InstallationRecovery;

  /** The installation list and the active installation (InstallationService). */
  readonly installations: InstallationService;
  /** Addon list export and import, WowUp-compatible (AddonListPortability). */
  readonly portability: AddonListPortability;

  constructor(
    store: StateStore,
    private registry: ProviderRegistry,
    downloads: DownloadService,
    private events: ServiceEvents,
    installations?: InstallationService,
    inspectRoot: string = join(tmpdir(), "wowdeck-inspect"),
  ) {
    this.store = store;
    this.#records = store.addons;
    this.#gate = new Gate(store.addons);
    const transactions = new AddonTransactions(store.fs);
    this.#transactions = transactions;
    this.#recoveryActions = new RecoveryActions(store.fs, transactions);
    this.#installer = new AddonInstaller(downloads, store.fs, transactions);
    this.#remover = new AddonRemover(transactions);
    this.recovery = new InstallationRecovery(store.addons, transactions);
    this.#inspectRoot = inspectRoot;
    this.installations =
      installations ??
      new InstallationService(
        store,
        // One turn: a running or queued transaction finishes first, and none
        // can stop in the installation between the check and the removal.
        (installationId, removeEntry) =>
          this.#gate.run((records) => {
            this.recovery.require(this.installations.require(installationId));
            removeEntry();
            records.removeForInstallation(installationId);
          }),
        () => events.addonsChanged([]),
      );
    this.portability = new AddonListPortability((installationId) => this.addonsFor(installationId), registry);
  }

  // ---- scanning ----

  /** Full scan: folders, fingerprints, provider matching; reconciles records. */
  async scanInstallation(installation: WowInstallation): Promise<AddonRecord[]> {
    return this.#gate.run(async (records) => {
      this.recovery.require(installation);
      await repairSharedFolders(records, installation);
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

      this.reconcileRecords(records, installation, folders, matches);
      return this.addonsFor(installation.id);
    });
  }

  /** Merge provider matches into persisted records. */
  private reconcileRecords(
    records: AddonRecords,
    installation: WowInstallation,
    folders: AddonFolder[],
    matches: Map<string, ScanMatch>,
  ): void {
    const installed = records.forInstallation(installation.id);
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
        const ownedByOther = installed.some(
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
        installed.find((r) => `${r.providerName}:${r.externalId}` === key) ??
        installed.find((r) => current(r).installedFolderList?.some((f) => folderNames.includes(f)));

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
    for (const record of installed) {
      const patch = folderStatePatch(current(record), present);
      if (patch) {
        change(record.id, patch);
      }
    }
    records.patchMany([...pending].map(([id, patch]) => ({ id, patch })));
    records.createMany(created);
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
    return this.#gate.run((records) => this.#listAddons(records, installation));
  }

  /**
   * What `addons.list` answers. A recovery-required installation's list is
   * read-only (ADR 0006): its stored records as they are, `unverified`,
   * with no folder scan or reconciliation (unmanaged folders aren't listed).
   */
  addonList(installation: WowInstallation): Promise<{ addons: Addon[]; unverified?: true }> {
    return this.#gate.run(async (records) => {
      if (this.recovery.required(installation.id)) {
        const stored = records.forInstallation(installation.id);
        // No folder scan here, so only the source lists say who needs whom.
        const needs = libraryNeeds(stored, [], installation.clientType);
        return { addons: stored.map((record) => withNeeds(this.#wire(record), record, needs)), unverified: true };
      }
      return { addons: await this.#listAddons(records, installation) };
    });
  }

  async #listAddons(records: AddonRecords, installation: WowInstallation): Promise<Addon[]> {
    // Listing reconciles folder state into the records: refused (addonList answers the read-only list).
    this.recovery.require(installation);
    await repairSharedFolders(records, installation);
    const folders = await scanAddons(installation);
    const present = new Set(folders.map((f) => f.name));
    records.patchMany([
      ...records.forInstallation(installation.id).flatMap((record) => {
        const patch = folderStatePatch(record, present);
        return patch ? [{ id: record.id, patch }] : [];
      }),
      ...await this.#staleRollbackPatches(records, installation),
    ]);
    const listed = records.forInstallation(installation.id);
    const unmanaged = unmanagedFolders(folders, listed).map((f) => toWireUnmanaged(f, installation, present));

    const folderByName = new Map(folders.map((f) => [f.name, f]));
    // WF-22: who needs whom, from the source lists and the TOCs (ADR 0008).
    const needs = libraryNeeds(listed, folders, installation.clientType);
    const managed = listed.map((record) => {
      const wire = withNeeds(this.#wire(record), record, needs);
      // The record does not keep the TOC; read the main folder's, as for
      // unmanaged rows (WF-11). Dependencies on the addon's own folders
      // (a suite's libraries) are not worth showing.
      const main = folderByName.get(record.installedFolderList?.[0] ?? "");
      const toc = main ? getTocForGameType2(main, installation.clientType) : undefined;
      if (toc) {
        const own = new Set(record.installedFolderList ?? []);
        wire.dependencies = toc.dependencyList.filter((d) => !own.has(d));
        wire.optionalDependencies = toc.optionalDependencyList.filter((d) => !own.has(d));
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

  /**
   * Rollback labels with no kept copy behind them (#33): the label lives
   * on the record, but the cache decides whether Roll back can work.
   * Anything that loses the kept folders without clearing the label (the
   * cache folder moved, the dot folder deleted by hand, a keep that
   * failed after removing the old copy) leaves an offer that cannot
   * work; the list drops it instead of showing it — the same
   * reconciliation folderStatePatch runs for folder warnings. Costs one
   * small meta.json read per labelled record; records without a label
   * (most of them) read nothing.
   */
  async #staleRollbackPatches(
    records: AddonRecordReader,
    installation: WowInstallation,
  ): Promise<{ id: string; patch: AddonPatch }[]> {
    const labeled = records.forInstallation(installation.id).filter((record) => record.rollbackVersion);
    const checked = await Promise.all(
      labeled.map(
        async (record): Promise<{ id: string; patch: AddonPatch } | null> =>
          (await readPrevious(installation, record.id))
            ? null
            : { id: record.id, patch: { rollbackVersion: undefined } },
      ),
    );
    return checked.filter((entry): entry is { id: string; patch: AddonPatch } => entry !== null);
  }

  /** A failed operation, broadcast like every finished one, and returned. */
  #fail(operationId: string, addonId: string | null, err: unknown): OperationResult {
    const operation = failedOperation(operationId, addonId, err);
    this.events.operationResult(operation);
    return operation;
  }

  /** Refuses a change to an addon of a recovery-required installation. */
  #requireReady(addon: AddonRecord): void {
    this.recovery.require(this.installations.require(addon.installationId));
  }

  addonsFor(installationId: string): AddonRecord[] {
    return this.#records.forInstallation(installationId);
  }

  /**
   * The updates on offer in an installation (updateStatus): what Update
   * all updates and what the toast, the update summary and the in-game
   * bridge count.
   */
  eligibleUpdatesFor(installation: WowInstallation): AddonRecord[] {
    return this.addonsFor(installation.id).filter((addon) => updateStatus(addon, this.registry).canUpdate);
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
      match: archiveMatchOf(
        archiveTarget(
          this.addonsFor(installation.id),
          PROVIDER_ID.File,
          canonical,
          inspection.folders,
          await archiveHash(canonical),
        ),
      ),
    };
  }

  // ---- unmanaged folders: find an online source (WF-23) ----

  /**
   * What finding online sources for an unmanaged folder searches with
   * (Catalogue.findSources): its TOC title, its folder name and the addons
   * its TOC requires (a sub-folder such as OmniCC_Config names its main
   * addon only there; DEVICE 2026-10-21).
   */
  async sourceRequestForFolder(installation: WowInstallation, folderName: string): Promise<SourceRequest> {
    const folder = await this.#requireUnmanagedFolder(installation, folderName);
    const toc = getTocForGameType2(folder, installation.clientType);
    const required = (toc?.dependencyList ?? []).filter((d) => !/^blizzard_/i.test(d));
    return { installation, folderName, toc, queries: [toc?.title, folderName, ...required] };
  }

  /**
   * What finding a managed addon's copies on other providers searches with
   * (WF-12): its main folder, searched by its TOC title, its name and the
   * folder name; its own provider left out. A missing folder leaves only
   * the names.
   */
  async sourceRequestForAddon(addonId: string): Promise<SourceRequest> {
    const addon = this.#records.require(addonId);
    const installation = this.installations.require(addon.installationId);
    const folderName = recordFolders(addon)[0];
    if (!folderName) {
      throw new ValidationError(`${addon.name} has no folders`);
    }
    const folder = (await scanAddons(installation)).find((f) => f.name === folderName);
    const toc = folder && getTocForGameType2(folder, installation.clientType);
    return { installation, folderName, toc, queries: [toc?.title, addon.name, folderName], ownProvider: addon.providerName };
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
  ): Promise<AddonOperation> {
    return this.#wired(this.#gate.run(async (records) => {
      const folder = await this.#requireUnmanagedFolder(installation, folderName);
      const version = getTocForGameType2(folder, installation.clientType)?.version;
      return this.#installUnlocked(records, {
        intent: "adopt",
        providerId,
        externalId,
        installation,
        adopt: { folder: folderName, version },
      });
    }));
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
  ): Promise<AddonOperation> {
    return this.#wired(this.#gate.run(async (records) => {
      const addon = records.require(addonId);
      this.#requireReady(addon);
      const installation = this.installations.require(addon.installationId);
      const other = records.find(installation.id, providerId, externalId);
      if (other) {
        throw new ValidationError(
          other.id === addon.id ? `${addon.name} already updates from there` : `${other.name} from there is already installed`,
        );
      }
      return this.#installUnlocked(records, { intent: "source", providerId, externalId, installation, replaces: addon });
    }));
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

  // ---- Details Relationships page ----

  /** Names for provider ids (Details Relationships page), and whether each is installed here. */
  async lookup(
    providerId: string,
    externalIds: string[],
    installation: WowInstallation,
  ): Promise<{ externalId: string; name: string; thumbnailUrl: string | null; installed: boolean }[]> {
    const provider = this.registry.usable(providerId);
    if (!provider?.getAll || externalIds.length === 0) {
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

  // ---- provider metadata sync (update checks) ----

  async refresh(installation: WowInstallation): Promise<{ updated: number; failed: number }> {
    return this.#gate.run(async (records) => {
      this.recovery.require(installation);
      const managed = records.forInstallation(installation.id).filter((a) => !!a.providerName && !a.isIgnored);
      let failed = 0;

      const byProvider = new Map<string, AddonRecord[]>();
      for (const addon of managed) {
        const list = byProvider.get(addon.providerName!) ?? [];
        list.push(addon);
        byProvider.set(addon.providerName!, list);
      }

      for (const [providerName, addons] of byProvider) {
        const provider = this.registry.usable(providerName);
        if (!provider?.getAll) {
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
          records.patchMany(patches);
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
  async install(request: InstallRequest): Promise<AddonOperation> {
    return this.#wired(this.#gate.run((records) => this.#installUnlocked(records, request)));
  }

  /** The install itself; callers hold the gate (`Gate.run` is not reentrant). */
  async #installUnlocked(
    records: AddonRecords,
    request: InstallRequest,
    /** The provider's answer for `externalId`, when the caller has already read it (a dependency). */
    prefetched?: AddonSearchResult,
  ): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const { providerId, externalId, installation } = request;
    const intent = INSTALL_INTENTS[request.intent];
    // Refused before anything is read or written (a dependency or import
    // entry included), and for an installation removed since the request
    // was made: its change would stop where nothing shows it.
    this.recovery.require(this.installations.require(installation.id));
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
    const searchResult = prefetched ?? (await this.#readAddon(provider, externalId, installation));

    if (request.channel !== undefined && !provider.allowChannelChange) {
      throw new ValidationError(`${provider.name} has no release channels`);
    }
    const { matched, fetched } = await this.#archiveMatch(records, request, provider, searchResult);
    const existing = request.replaces ?? matched ?? records.find(installation.id, providerId, externalId);
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
      // One way an addon needs a library (libraries.ts).
      dependencies: (latestFile(searchResult.files, channelType)?.dependencies ?? []).filter(
        (d) => d.type === AddonDependencyType.Required,
      ),
      // Installing directly an addon that was first pulled in as a
      // dependency makes it the user's choice (apt marks it "manual"), so
      // Remove no longer offers it with its dependant.
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
    // The installer commits the record with the files (the addon
    // transaction): these are the changes it writes on top of its own.
    const recordChange = (patch: AddonPatch) => {
      const changes: AddonPatch = {
        ...decided,
        ...patch,
        // Installing (update, reinstall, channel switch) is choosing the new
        // version: automatic updates resume for it.
        autoUpdatePaused: undefined,
        skipReleaseId: undefined,
        // Every update path (manual, Update all, auto-update) ends here (PC-07).
        ...(intent.stampUpdate ? { lastUpdatedAt: Date.now() } : {}),
        // An archive matched into a record keeps that record's name: a
        // clean catalogue name is not replaced by a colour-coded TOC title.
        ...(matched ? { name: matched.name } : {}),
      };
      return existing ? { patch: [{ id: existing.id, patch: changes }] } : { create: [{ ...addon, ...changes }] };
    };
    let cleanupWarning: string | undefined;
    try {
      ({ cleanupWarning } = await this.#installer.install({
        installation,
        addon,
        existing,
        searchResult,
        provider,
        operationId,
        // An install over files on disk keeps the previous version
        // (BEYOND-02); the installer leaves the kept one alone for a
        // reinstall of the same release.
        keepPreviousVersion:
          intent.keepPrevious === "always" || (!!existing && this.store.settings.keepPreviousVersions),
        requiredFolder: mustInstall,
        fetched,
        records,
        recordChange,
      }));
    } catch (err) {
      const operation = intent.broadcast ? this.#fail(operationId, addon.id, err) : failedOperation(operationId, addon.id, err);
      return { addon: existing ?? addon, operation };
    }
    const installed = records.require(addon.id);

    // Required dependencies install with it (apt/pacman-style: marked as
    // automatically installed: a library, see libraries.ts), one level
    // deep only, so this stays bounded however the real graph looks.
    // Each dependency commits on its own (#110): one that fails leaves the
    // addon and the others installed; once one leaves the installation
    // recovery required, the guard refuses the rest.
    const missingRequiredDependencies: string[] = [];
    const followUps: OperationResult[] = [];
    if (intent.withDependencies) {
      for (const dep of addon.dependencies ?? []) {
        if (records.find(installation.id, providerId, dep.externalAddonId)) {
          continue;
        }
        const result = await this.#installDependency(records, provider, dep.externalAddonId, installation);
        if (!result) {
          continue;
        }
        if (result.status === "failed") {
          missingRequiredDependencies.push(dep.externalAddonId);
        }
        followUps.push(result);
        // A dependency's leftover is the operation's too: shown with it.
        cleanupWarning ??= result.cleanupWarning;
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
      ...(cleanupWarning && { cleanupWarning }),
      ...(followUps.length ? { followUps } : {}),
    };
    if (intent.broadcast) {
      this.events.operationResult(operation);
    }
    this.events.addonsChanged([addon.id]);
    return { addon: installed, operation };
  }

  /**
   * One required dependency, read from its provider: skipped (null) when
   * any folder its latest release installs is already present (a library
   * from another source, or copied by hand, is never replaced, and its
   * record stays as it is: ADR 0009), installed as a library otherwise.
   * A read or install that fails is a failed result.
   */
  async #installDependency(
    records: AddonRecords,
    provider: AddonProvider,
    externalId: string,
    installation: WowInstallation,
  ): Promise<OperationResult | null> {
    try {
      const dependency = await this.#readAddon(provider, externalId, installation);
      const folders = latestFile(dependency.files, installation.defaultAddonChannelType)?.folders ?? [];
      const present = await this.#presentFolders(records, installation);
      if (folders.some((folder) => present.has(folder))) {
        return null;
      }
      const { addon, operation } = await this.#installUnlocked(
        records,
        { intent: "dependency", providerId: provider.name, externalId, installation },
        dependency,
      );
      return { ...operation, addonName: addon.name };
    } catch (err) {
      return failedOperation(this.nextOperationId(), null, err);
    }
  }

  /** An addon as its provider lists it now; one with no files is not there. */
  async #readAddon(provider: AddonProvider, externalId: string, installation: WowInstallation): Promise<AddonSearchResult> {
    const searchResult = await provider.getById(externalId, installation);
    if (!searchResult?.files?.length) {
      throw new NotFoundError("addon on provider", externalId);
    }
    return searchResult;
  }

  /** The installation's addon folders: every record's, from any source, and the unmanaged ones on disk. */
  async #presentFolders(records: AddonRecords, installation: WowInstallation): Promise<Set<string>> {
    const folders = new Set(records.forInstallation(installation.id).flatMap((record) => recordFolders(record)));
    for (const folder of await scanAddons(installation)) {
      folders.add(folder.name);
    }
    return folders;
  }

  /**
   * The archive match rule at install time (archiveMatch.ts): a new
   * install from a file or a direct link that installs a folder exactly
   * one record owns goes into that record; one whose folders two or more
   * records own is refused (ValidationError naming them) before anything
   * is written. Its folders are only known
   * from the archive itself, so it is fetched here once and handed to the
   * installer (`fetched`); an archive that cannot be read matches nothing
   * and fails in the installer with the install's own error.
   */
  async #archiveMatch(
    records: AddonRecords,
    request: InstallRequest,
    provider: AddonProvider,
    searchResult: AddonSearchResult,
  ): Promise<{ matched?: AddonRecord; fetched?: Promise<DownloadHandle> }> {
    const { installation, providerId, externalId } = request;
    const archiveUrl = searchResult.files?.[0]?.downloadUrl;
    if (
      request.intent !== "install" ||
      !installsByArchive(providerId) ||
      !archiveUrl
    ) {
      return {};
    }
    const fetched = this.#installer.fetchArchive(provider, archiveUrl, "match");
    const folders = await fetched
      .then((handle) => inspectAddonArchive(handle.filePath, installation.clientType, this.#inspectRoot))
      .then(
        (inspection) => inspection.folders,
        () => [],
      );
    // Which record it goes into is all that matters here; whether its
    // content is new (the kept previous version) the installer decides.
    const target = archiveTarget(records.forInstallation(installation.id), providerId, externalId, folders, undefined);
    if (target.kind === "conflict") {
      // Refused before anything is written: merging records is guesswork.
      await this.#installer.discardFetched();
      throw new ValidationError(conflictMessage(target.owners));
    }
    return { fetched, ...((target.kind === "update" || target.kind === "reinstall") && { matched: target.record }) };
  }

  /**
   * Update one addon to its latest release. The provider read and the
   * install are one gate turn, so nothing changes the record between them.
   */
  async updateAddon(addonId: string): Promise<AddonOperation> {
    return this.#wired(this.#gate.run((records) => this.#updateUnlocked(records, addonId)));
  }

  /**
   * Update one addon of a list picked before its turn (Update all,
   * automatic updates), if it still qualifies when the turn comes: one
   * ignored or paused meanwhile is left alone (null).
   */
  #updateIfStill(
    addonId: string,
    qualifies: (addon: AddonRecord) => boolean,
  ): Promise<{ addon: AddonRecord; operation: OperationResult } | null> {
    return this.#gate.run((records) => {
      const addon = records.get(addonId);
      return addon && qualifies(addon) ? this.#updateUnlocked(records, addonId) : null;
    });
  }

  async #updateUnlocked(records: AddonRecords, addonId: string): Promise<{ addon: AddonRecord; operation: OperationResult }> {
    const addon = records.require(addonId);
    const installation = this.installations.require(addon.installationId);
    this.recovery.require(installation);
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
          : records.patch(addonId, { warningType: WARNING_NOT_ON_PROVIDER });
      const operation = this.#fail(this.nextOperationId(), addonId, `addon no longer available on ${provider.name}`);
      return { addon: flagged, operation };
    }
    const metadata = releaseMetadata(addon, searchResult.files, updateCandidate(searchResult.files, addon));
    const latest: AddonRecord = { ...addon, ...metadata };

    if (!needsUpdate(latest)) {
      // Nothing to install, but what the provider said is kept, as a
      // refresh keeps it. An update writes it with the install, or not at
      // all when the install fails.
      const current = records.patch(addonId, metadata);
      const operation: OperationResult = {
        operationId: this.nextOperationId(),
        addonId,
        status: "current",
        error: null,
      };
      this.events.operationResult(operation);
      return { addon: current, operation };
    }

    return this.#installUnlocked(records, {
      intent: "update",
      providerId: provider.name,
      externalId: addon.externalId!,
      installation,
    });
  }

  /** A change's answer in wire form, read once the change's turn is over. */
  async #wired(change: Promise<{ addon: AddonRecord; operation: OperationResult }>): Promise<AddonOperation> {
    const { addon, operation } = await change;
    return { addon: this.#wire(addon), operation };
  }

  /** The wire form of a record, with what only the service knows (provider capabilities). */
  #wire(addon: AddonRecord): Addon {
    return toWireAddon(addon, {
      canReinstall: this.canReinstall(addon),
      canChangeChannel: this.canChangeChannel(addon),
      sourceOff: !!addon.providerName && !this.registry.usable(addon.providerName),
      canUpdate: updateStatus(addon, this.registry).canUpdate,
      newlyUpdatedMs: this.store.settings.newlyUpdatedHours * 3_600_000,
    });
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
  async setChannel(addonId: string, channel: AddonChannelType): Promise<AddonOperation> {
    return this.#wired(this.#gate.run((records) => {
      const addon = records.require(addonId);
      this.#requireReady(addon);
      if (!this.canChangeChannel(addon)) {
        throw new ValidationError(`${addon.name} has no release channels`);
      }
      const installation = this.installations.require(addon.installationId);
      return this.#installUnlocked(records, {
        intent: "channel",
        providerId: addon.providerName!,
        externalId: addon.externalId!,
        installation,
        channel,
      });
    }));
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
  async reinstall(addonId: string): Promise<AddonOperation> {
    return this.#wired(this.#gate.run((records) => {
      const addon = records.require(addonId);
      this.#requireReady(addon);
      if (!this.canReinstall(addon)) {
        throw new ValidationError(`${addon.name} can't be reinstalled`);
      }
      const installation = this.installations.require(addon.installationId);
      return this.#installUnlocked(records, {
        intent: "reinstall",
        providerId: addon.providerName!,
        externalId: addon.externalId!,
        installation,
      });
    }));
  }

  async updateAll(installation: WowInstallation): Promise<OperationResult[]> {
    const candidates = this.eligibleUpdatesFor(installation);
    const operations: OperationResult[] = [];
    for (const candidate of candidates) {
      try {
        const updated = await this.#updateIfStill(candidate.id, (a) => updateStatus(a, this.registry).canUpdate);
        if (updated) {
          operations.push({ ...updated.operation, addonName: candidate.name });
        }
      } catch (err) {
        operations.push({ ...failedOperation(this.nextOperationId(), candidate.id, err), addonName: candidate.name });
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
  async rollback(addonId: string): Promise<AddonOperation> {
    return this.#wired(this.#gate.run(async (records) => {
      const addon = records.require(addonId);
      const installation = this.installations.require(addon.installationId);
      this.recovery.require(installation);
      const operationId = this.nextOperationId();
      try {
        const previous = await readPrevious(installation, addon.id);
        if (!previous) {
          throw new InstallError("No previous version is kept for this addon", addonId);
        }
        // The exchange, the record and the new previous version commit
        // together (AddonTransactions); a failure restores the start.
        const { cleanupWarning } = await this.#transactions.run(records, {
          installation,
          operation: "rollback",
          addonId,
          originalRecord: addon,
          previous,
          current: recordFolders(addon),
          outgoing: keptRelease(addon),
          change: async ({ previous: kept }) => {
            const installedExternalReleaseId = previous.releaseId ?? undefined;
            // The record goes back to where the kept version came from:
            // its source, and a file's path and content (RollbackCache).
            const source = restoredSource(addon, previous);
            const latestReleaseId = "externalLatestReleaseId" in source ? source.externalLatestReleaseId : addon.externalLatestReleaseId;
            const patch: AddonPatch = {
              ...source,
              rollbackVersion: kept === "kept" ? (addon.installedVersion ?? "previous version") : undefined,
              installedVersion: previous.version ?? addon.installedVersion,
              installedExternalReleaseId,
              installedFolderList: previous.folders,
              installedFolders: previous.folders.join(", "),
              // Rolled back to an older version: automatic updates pause for this
              // addon until it is updated by hand or resumed (owner, 2026-10-16).
              // Rolled forward to the latest: they resume.
              autoUpdatePaused: installedExternalReleaseId !== latestReleaseId || undefined,
              skipReleaseId: undefined,
              warningType: undefined,
              updatedAt: Date.now(),
            };
            return { change: { patch: [{ id: addonId, patch }] }, result: undefined };
          },
        });
        const operation: OperationResult = {
          operationId,
          addonId,
          status: "installed",
          error: null,
          ...(cleanupWarning && { cleanupWarning }),
        };
        this.events.operationResult(operation);
        this.events.addonsChanged([addonId]);
        return { addon: records.require(addonId), operation };
      } catch (err) {
        return { addon, operation: this.#fail(operationId, addonId, err) };
      }
    }));
  }

  async rollbackStatus(): Promise<{ bytes: number; count: number }> {
    return cacheUsage(this.installations.list());
  }

  /**
   * Pause or resume automatic updates for one addon (WF-02). Waits for a
   * running install: one that cleared the pause after it would lose it.
   */
  async setAutoUpdatePaused(addonId: string, paused: boolean): Promise<Addon> {
    const addon = await this.#gate.run((records) => {
      this.#requireReady(records.require(addonId));
      const addon = records.patch(addonId, { autoUpdatePaused: paused || undefined, skipReleaseId: undefined });
      this.events.addonsChanged([addonId]);
      return addon;
    });
    return this.#wire(addon);
  }

  /**
   * Delete every kept previous version (Options). A recovery-required
   * installation's are left alone, labels included: its Roll back cache
   * may hold recovery copies (clearAll would delete them).
   */
  async clearRollback(): Promise<{ bytes: number; count: number }> {
    return this.#gate.run(async (records) => {
      const ready = this.installations.list().filter((i) => !this.recovery.required(i.id));
      const cleared = new Set(ready.map((i) => i.id));
      await clearAll(ready);
      const changed = records
        .all()
        .filter((a) => a.rollbackVersion && cleared.has(a.installationId))
        .map((a) => a.id);
      records.patchMany(changed.map((id) => ({ id, patch: { rollbackVersion: undefined } })));
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
    // A recovery-required installation is refused (its addons are not candidates).
    const candidates = this.installations.list().filter((i) => !this.recovery.required(i.id)).flatMap((installation) =>
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
          const updated = await this.#updateIfStill(addon.id, (a) => updateStatus(a, this.registry).canAutoUpdate);
          const operation = updated?.operation;
          if (operation?.status === "updated") {
            result.updated.push(addon.name);
          } else if (operation?.status === "failed") {
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
      const pulledIn = this.#records.find(installation.id, c.providerId, c.externalId);
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
    await this.#gate.run(async (records) => {
      // An entry that left the installation recovery required stops the follow-up write.
      if (this.recovery.required(installation.id)) {
        return;
      }
      const installed = records.forInstallation(installation.id);
      const needs = libraryNeeds(installed, await scanAddons(installation), installation.clientType);
      const changes = libraryFlagsAfterImport(installed, needs, imported);
      records.patchMany(changes.map(({ id, isDependency }) => ({ id, patch: { isDependency } })));
      if (changes.length) {
        this.events.addonsChanged(changes.map((c) => c.id));
      }
    });
    return { operations, error: null };
  }

  /**
   * Remove a managed addon and, when the user chose `removeLibraries`, the
   * libraries this removal leaves unneeded (ADR 0008), each in an addon
   * transaction of its own (AddonRemover). A failure that changed nothing,
   * or whose undo stopped (recovery required), is a failed result. A
   * library whose removal fails stays installed; the removal stands.
   */
  async removeAddon(addonId: string, { removeLibraries = false }: { removeLibraries?: boolean } = {}): Promise<OperationResult> {
    return this.#gate.run(async (records) => {
      const addon = records.require(addonId);
      const installation = this.installations.require(addon.installationId);
      this.recovery.require(installation);
      // Who needs whom before anything goes: the removed addon's TOC still counts.
      const needs = removeLibraries
        ? libraryNeeds(records.forInstallation(installation.id), await scanAddons(installation), installation.clientType)
        : undefined;
      const operationId = this.nextOperationId();
      let cleanupWarning: string | undefined;
      try {
        ({ cleanupWarning } = await this.#remover.remove(records, installation, { record: addon }));
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        return this.#fail(operationId, addonId, err);
      }
      await dropPrevious(installation, addonId);
      const followUps = needs ? await this.#removeLeftUnneeded(records, installation, needs, addonId) : [];
      const removedIds = [addonId, ...followUps.flatMap((f) => (f.status === "removed" && f.addonId ? [f.addonId] : []))];

      const operation: OperationResult = {
        operationId,
        addonId,
        status: "removed",
        error: null,
        ...(cleanupWarning && { cleanupWarning }),
        ...(followUps.length ? { followUps } : {}),
      };
      this.events.operationResult(operation);
      this.events.addonsChanged(removedIds);
      return operation;
    });
  }

  /**
   * The libraries removing `addonId` left unneeded, one at a time, each
   * committing on its own (#110). One that fails stays installed, so a
   * library only it needed stays needed and is not tried; the others still
   * go. Once one leaves the installation recovery required, the rest are
   * refused. Callers hold the gate.
   */
  async #removeLeftUnneeded(
    records: AddonRecords,
    installation: WowInstallation,
    needs: LibraryNeeds,
    addonId: string,
  ): Promise<OperationResult[]> {
    const removed = [addonId];
    const failed: string[] = [];
    const followUps: OperationResult[] = [];
    // Ends: each round removes or fails one library, and neither comes back.
    for (let library = needs.leftUnneeded(removed)[0]; library; library = needs.leftUnneeded(removed, failed)[0]) {
      const result = await this.#removeLibrary(records, installation, library);
      followUps.push({ ...result, addonName: library.name });
      (result.status === "removed" ? removed : failed).push(library.id);
    }
    return followUps;
  }

  /** One library's removal in its own transaction; never throws. Callers hold the gate. */
  async #removeLibrary(records: AddonRecords, installation: WowInstallation, library: AddonRecord): Promise<OperationResult> {
    const operationId = this.nextOperationId();
    let cleanupWarning: string | undefined;
    try {
      this.recovery.require(installation);
      ({ cleanupWarning } = await this.#remover.remove(records, installation, { record: library }));
    } catch (err) {
      console.error(`[addons] library ${library.id} not removed: ${err instanceof Error ? err.message : String(err)}`);
      return failedOperation(operationId, library.id, err);
    }
    // Committed: its kept previous version goes as with any removal.
    await dropPrevious(installation, library.id);
    return { operationId, addonId: library.id, status: "removed", error: null, ...(cleanupWarning && { cleanupWarning }) };
  }

  /**
   * Remove an unmanaged addon folder from disk. Unmanaged folders have no
   * WowAddon record, so no record changes and the folder never becomes a
   * managed addon; the removal still commits through an addon transaction
   * (AddonRemover), whose commit evidence names the folder. Two safety
   * checks beyond the transaction's own containment: the name must be a
   * bare folder name (no path separators), and it must be an unmanaged
   * folder the user may act on (#requireUnmanagedFolder: not managed, not
   * ignored).
   */
  async removeUnmanagedFolder(installation: WowInstallation, folderName: string): Promise<OperationResult> {
    return this.#gate.run(async (records) => {
      this.recovery.require(installation);
      if (!folderName || folderName.includes("/") || folderName.includes("\\") || folderName === "." || folderName === "..") {
        throw new ValidationError(`invalid addon folder name: ${folderName}`);
      }
      await this.#requireUnmanagedFolder(installation, folderName);
      const operationId = this.nextOperationId();
      const addonId = `unmanaged:${folderName}`;
      let cleanupWarning: string | undefined;
      try {
        ({ cleanupWarning } = await this.#remover.remove(records, installation, { unmanagedFolder: folderName }));
      } catch (err) {
        return this.#fail(operationId, addonId, err);
      }
      const operation: OperationResult = {
        operationId,
        addonId,
        status: "removed",
        error: null,
        ...(cleanupWarning && { cleanupWarning }),
      };
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
    const record = this.#records.get(addonId);
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

  /** Ignore or stop ignoring one addon (WF-04); waits for a running install, like every record change. */
  async setIgnored(addonId: string, ignored: boolean): Promise<Addon> {
    const addon = await this.#gate.run((records) => {
      this.#requireReady(records.require(addonId));
      const addon = records.patch(addonId, { isIgnored: ignored });
      this.events.addonsChanged([addonId]);
      return addon;
    });
    return this.#wire(addon);
  }

  private nextOperationId(): string {
    this.#opCounter += 1;
    return `op-${Date.now().toString(36)}-${this.#opCounter}`;
  }

  // ---- recovery ----

  /**
   * Retry recovery (ADR 0006, #108): only on the player's request, in a
   * turn of the addon change queue, so no other change runs meanwhile. The
   * evidence is checked again before anything is touched; a refusal is a
   * result, never a throw. Unknown installation: NotFoundError.
   */
  async retryRecovery(installationId: string): Promise<RecoveryRetryResult> {
    const result = await this.#gate.run((records) =>
      this.#recoveryActions.retry(records, this.installations.require(installationId)),
    );
    if (result.restored.length > 0) {
      this.events.addonsChanged([]);
    }
    return result;
  }

  /**
   * Verify recovery (ADR 0006, #109): only on the player's request, in a
   * turn of the addon change queue, after a manual repair. Changes no
   * files; a confirmed repair saves the original record and lifts the
   * block. A refusal is a result, never a throw. Unknown installation:
   * NotFoundError.
   */
  async verifyRecovery(installationId: string): Promise<RecoveryVerifyResult> {
    const result = await this.#gate.run((records) =>
      this.#recoveryActions.verify(records, this.installations.require(installationId)),
    );
    if (result.verified.length > 0) {
      this.events.addonsChanged([]);
    }
    return result;
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
