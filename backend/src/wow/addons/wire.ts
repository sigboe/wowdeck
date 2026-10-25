/**
 * Engine records to wire shapes (contracts.ts): installed addons, unmanaged
 * folders and provider search results, plus the folder-state bookkeeping the
 * addon list keeps on each record.
 */

import type { Addon, SearchResult } from "../../api/contracts";
import type { AddonFolder, AddonSearchResult, WowInstallation } from "../models";
import { recordFolders, type AddonPatch, type AddonRecord } from "./AddonRecords";
import { AddonChannelType, AddonDependencyType } from "../types";
import { dateLabel } from "../providers/changelog";
import { getTocForGameType2 } from "../utils/toc";
import { plainTextSummary } from "../utils/string";
import { channelToWire, hasNewerPrerelease, latestFile } from "./releaseChannel";
import { isAutoUpdatePaused, needsUpdate } from "./addonStatus";

export function toWireAddon(
  addon: AddonRecord,
  {
    canReinstall = false,
    canChangeChannel = false,
    sourceOff = false,
    newlyUpdatedMs = 0,
    now = Date.now(),
  }: {
    canReinstall?: boolean;
    canChangeChannel?: boolean;
    sourceOff?: boolean;
    newlyUpdatedMs?: number;
    now?: number;
  } = {},
): Addon {
  // A source that is off can't update it: no stale "update available".
  const update = !sourceOff && needsUpdate(addon);
  return {
    id: addon.id,
    installationId: addon.installationId,
    folderName: recordFolders(addon)[0] ?? "",
    name: addon.name,
    version: addon.installedVersion ?? null,
    author: addon.author ?? null,
    notes: addon.summary ?? null,
    interfaceVersion: null,
    dependencies: [],
    optionalDependencies: [],
    missingDependencies: [],
    installedAsDependency: !!addon.isDependency,
    neededBy: [],
    previousVersion: addon.rollbackVersion ?? null,
    autoUpdatePaused: isAutoUpdatePaused(addon),
    newlyUpdated: addon.lastUpdatedAt !== undefined && now - addon.lastUpdatedAt < newlyUpdatedMs,
    loadOnDemand: addon.isLoadOnDemand,
    providerId: addon.providerName ?? null,
    externalId: addon.externalId ?? null,
    externalUrl: addon.externalUrl ?? null,
    gameVersion: addon.gameVersion ?? null,
    availableVersion: update ? (addon.latestVersion ?? null) : null,
    updateAvailable: update,
    ignored: addon.isIgnored,
    ignoreReason: addon.isIgnored ? "user" : null,
    broken: addon.warningType !== undefined,
    problem: wireProblem(addon.warningType),
    sourceOff,
    canReinstall,
    channel: channelToWire(addon.channelType),
    canChangeChannel,
    thumbnailUrl: addon.thumbnailUrl ?? null,
  };
}

/**
 * Folder ignore reasons that are listed (as ignored, with the reason) so
 * people see why the folder is never touched: a git checkout, or folders the
 * Raider.IO client keeps up to date. Other reasons stay hidden. Null when the
 * folder is not listed as ignored.
 */
export function listedIgnoreReason(folder: AddonFolder): "git_repo" | "raiderio_client" | null {
  return folder.ignoreReason === "git_repo" || folder.ignoreReason === "raiderio_client" ? folder.ignoreReason : null;
}

/**
 * A folder in AddOns that no provider manages (installed by hand, or listed
 * as ignored: `listedIgnoreReason`). Read from its TOC for this
 * installation's game version.
 */
export function toWireUnmanaged(folder: AddonFolder, installation: WowInstallation, presentFolders: Set<string>): Addon {
  const toc = getTocForGameType2(folder, installation.clientType);
  return {
    id: `unmanaged:${folder.name}`,
    installationId: installation.id,
    folderName: folder.name,
    name: toc?.title ?? folder.name,
    version: toc?.version ?? null,
    author: toc?.author ?? null,
    notes: toc?.notes ?? null,
    interfaceVersion: toc?.interface?.[0] ?? null,
    dependencies: toc?.dependencyList ?? [],
    optionalDependencies: [],
    missingDependencies: missingDependencies(toc?.dependencyList ?? [], presentFolders),
    installedAsDependency: false,
    neededBy: [],
    previousVersion: null,
    autoUpdatePaused: false,
    newlyUpdated: false,
    loadOnDemand: toc?.loadOnDemand === "1",
    providerId: null,
    externalId: null,
    externalUrl: null,
    gameVersion: null,
    availableVersion: null,
    updateAvailable: false,
    ignored: listedIgnoreReason(folder) !== null,
    ignoreReason: listedIgnoreReason(folder),
    broken: false,
    problem: null,
    sourceOff: false,
    canReinstall: false,
    channel: "stable",
    canChangeChannel: false,
    thumbnailUrl: null,
  };
}

/**
 * Persisted WowAddon.warningType values. "missing-on-provider" is what
 * older builds stored for the same folders-missing condition (the name
 * was wrong); it is read as folders-missing and replaced on the next list.
 */
export const WARNING_FOLDERS_MISSING = "folders-missing";
export const WARNING_NOT_ON_PROVIDER = "not-on-provider";
const LEGACY_WARNING_FOLDERS_MISSING = "missing-on-provider";

function wireProblem(warningType: string | undefined): Addon["problem"] {
  switch (warningType) {
    case undefined:
      return null;
    case WARNING_NOT_ON_PROVIDER:
      return "not_on_provider";
    case WARNING_FOLDERS_MISSING:
    case LEGACY_WARNING_FOLDERS_MISSING:
    default:
      return "folders_missing";
  }
}

/**
 * The folders-missing warning from what is on disk: any recorded folder
 * absent means the addon is incomplete (a suite with one library folder
 * deleted does not load either). The installer rewrites installedFolderList
 * on every install, so it holds no stale names. Returns the patch that sets
 * or clears it, or null when the record already agrees.
 */
export function folderStatePatch(record: AddonRecord, presentFolders: Set<string>): AddonPatch | null {
  const recorded = record.installedFolderList ?? [];
  const missing = recorded.length > 0 && recorded.some((f) => !presentFolders.has(f));
  const before = record.warningType;
  if (missing) {
    return before === WARNING_FOLDERS_MISSING ? null : { warningType: WARNING_FOLDERS_MISSING };
  }
  return before === WARNING_FOLDERS_MISSING || before === LEGACY_WARNING_FOLDERS_MISSING ? { warningType: undefined } : null;
}

/**
 * Required TOC dependencies with no folder in AddOns (WF-11). Folder names
 * compare without case (WoW loads them that way); Blizzard_* addons are part
 * of the game client, not folders in AddOns.
 */
export function missingDependencies(dependencies: string[], presentFolders: Set<string>): string[] {
  const present = new Set([...presentFolders].map((f) => f.toLowerCase()));
  return dependencies.filter((d) => !/^blizzard_/i.test(d) && !present.has(d.toLowerCase()));
}

const WIRE_RELATION: Partial<Record<AddonDependencyType, SearchResult["relationships"][number]["relation"]>> = {
  [AddonDependencyType.Required]: "required",
  [AddonDependencyType.Optional]: "optional",
  [AddonDependencyType.Embedded]: "embedded",
};

export function toWireSearchResult(
  result: AddonSearchResult,
  channel: AddonChannelType = AddonChannelType.Stable,
  canChangeChannel = false,
): SearchResult {
  const file = latestFile(result.files, channel);
  return {
    providerId: result.providerName,
    externalId: result.externalId,
    name: result.name,
    author: result.author || null,
    downloadCount: result.downloadCount ?? null,
    summary: plainTextSummary(result.summary) ?? null,
    thumbnailUrl: result.thumbnailUrl ?? null,
    websiteUrl: result.externalUrl || null,
    latestVersion: file?.version ?? null,
    gameVersion: file?.gameVersion || null,
    releasedAt: dateLabel(file?.releaseDate) ?? null,
    channel: file ? channelToWire(file.channelType) : null,
    channelReleases:
      canChangeChannel && hasNewerPrerelease(result.files)
        ? [AddonChannelType.Stable, AddonChannelType.Beta, AddonChannelType.Alpha].map((c) => {
            const f = latestFile(result.files, c)!;
            return { channel: channelToWire(c), version: f.version, fileChannel: channelToWire(f.channelType) };
          })
        : null,
    requiredDependencies: (file?.dependencies ?? []).filter((d) => d.type === AddonDependencyType.Required).length,
    relationships: (file?.dependencies ?? []).flatMap((d) => {
      const relation = WIRE_RELATION[d.type];
      return relation ? [{ externalId: d.externalAddonId, relation }] : [];
    }),
    favoriteCount: result.favoriteCount ?? null,
    screenshots: result.screenshots?.map((s) => ({
      url: s.url,
      thumbnailUrl: s.thumbnailUrl ?? null,
      title: s.title ?? null,
    })) ?? [],
  };
}
