/**
 * Project-owned domain model. Semantics adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/addons.ts
 *          wowup/wowup-lib/src/models/warcraft.ts
 *          wowup/wowup-lib/src/ipc.ts (FsStats)
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — trimmed unused fields (analytics, screenshots, funding,
 *   auto-update notifications); renamed Addon -> WowAddon for clarity;
 *   FsStats reduced to the fields the scanner needs.
 * See docs/wowup-provenance.md.
 */

import type { Toc } from "./toc/toc";
import { AddonChannelType, type AddonIgnoreReason, type AddonProviderType, AddonDependencyType, WowClientType } from "./types";

/** Serializable stand-in for fs.Stats. */
export interface FsStats {
  size: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  isDirectory: boolean;
}

/** A WoW installation flavor the user can manage. Persisted. */
export interface WowInstallation {
  id: string;
  clientType: WowClientType;
  /** Absolute path of the flavor root, e.g. .../World of Warcraft/_retail_ */
  location: string;
  label: string;
  displayName: string;
  selected: boolean;
  defaultAddonChannelType: AddonChannelType;
  /** Human readable game version, when discovered. */
  version?: string;
  /** How this installation entered the list (default: detected). */
  source: InstallationSource;
}

export type InstallationSource = "detected" | "manual";

export interface AddonExternalId {
  providerName: string;
  id: string;
}

export interface AddonDependency {
  externalAddonId: string;
  type: AddonDependencyType;
}

/**
 * A managed addon. Persisted as JSON. Field semantics follow WowUp so
 * provider logic can be ported without surprises — notably the update pair
 * installedExternalReleaseId / externalLatestReleaseId.
 */
export interface WowAddon {
  id: string;
  name: string;
  installationId: string;
  providerName?: string;
  externalId?: string;
  externalUrl?: string;
  thumbnailUrl?: string;
  author?: string;
  summary?: string;
  downloadCount?: number;
  downloadUrl?: string;
  installedVersion?: string;
  installedAt?: number;
  installedExternalReleaseId?: string;
  installedFolders?: string;
  installedFolderList?: string[];
  gameVersion?: string;
  channelType: AddonChannelType;
  /** Last seen provider files had a pre-release newer than stable (`hasNewerPrerelease`); gates the channel choice. */
  hasNewerPrerelease?: boolean;
  latestVersion?: string;
  externalLatestReleaseId?: string;
  releasedAt?: number;
  isIgnored: boolean;
  isLoadOnDemand: boolean;
  warningType?: string;
  ignoreReason?: AddonIgnoreReason;
  externalIds?: AddonExternalId[];
  dependencies?: AddonDependency[];
  /** Version kept for rollback (BEYOND-02), when a previous version is in the cache. */
  rollbackVersion?: string;
  /**
   * Automatic updates paused for this addon (WF-02): set by a rollback to an
   * older version or by hand, cleared by an install or by hand.
   */
  autoUpdatePaused?: boolean;
  /**
   * Older builds (2026-10-16 only) skipped just the release rolled back
   * from; a record that still has it counts as paused (isAutoUpdatePaused).
   */
  skipReleaseId?: string;
  /** True when installed automatically to satisfy another addon's required dependency, never by direct user action — apt/pacman's "automatically installed" flag. Drives autoremove on removeAddon(). */
  isDependency?: boolean;
  updatedAt?: number;
  /**
   * Epoch ms of the last successful update (manual, Update all, auto-update;
   * PC-07). Not set by a plain install, reinstall or channel switch.
   * `updatedAt` is not usable for this: provider scans rewrite it.
   */
  lastUpdatedAt?: number;
}

/**
 * A new addon record: a fresh id and the flags every new record starts with
 * (not ignored, not load-on-demand), plus the caller's fields.
 */
export function newAddonRecord(
  fields: Pick<WowAddon, "name" | "installationId" | "channelType"> & Partial<Omit<WowAddon, "id">>,
): WowAddon {
  return { id: crypto.randomUUID(), isIgnored: false, isLoadOnDemand: false, ...fields };
}

export interface AddonSearchResultDependency {
  externalAddonId: string;
  type: AddonDependencyType;
}

export interface AddonSearchResultFile {
  externalId?: string;
  channelType: AddonChannelType;
  version: string;
  folders: string[];
  gameVersion: string;
  downloadUrl: string;
  releaseDate: string;
  dependencies?: AddonSearchResultDependency[];
  title?: string;
  authors?: string;
}

export interface AddonSearchResultScreenshot {
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

/**
 * A provider-scoped addon category. `id` is only meaningful to the
 * provider that returned it — never treat it as a universal/
 * cross-provider identifier (CurseForge's category ids are not shared
 * with any other provider's category system, if one exists).
 */
export interface ProviderCategory {
  id: string;
  name: string;
}

export interface AddonSearchResult {
  author: string;
  downloadCount?: number;
  favoriteCount?: number;
  externalId: string;
  externalUrl: string;
  files?: AddonSearchResultFile[];
  name: string;
  providerName: AddonProviderType;
  summary?: string;
  thumbnailUrl?: string;
  releasedAt?: string;
  /** Addon Details modal Gallery — already present on the provider's
   * own mod/search response, no extra request. */
  screenshots?: AddonSearchResultScreenshot[];
}

export interface AddonScanResult {
  source: "wowup" | "curseforge";
  fileCount: number;
  fingerprint: string;
  fingerprintNum: number;
  folderName: string;
}

/** Intermediate scanner record for one directory under Interface/AddOns. */
export interface AddonFolder {
  name: string;
  path: string;
  status: string;
  ignoreReason?: AddonIgnoreReason;
  tocs: Toc[];
  fileStats?: FsStats;
  scanResults?: Partial<Record<"wowup" | "curseforge", AddonScanResult>>;
}

export interface InstalledProduct {
  name: string;
  location: string;
  clientType: WowClientType;
}
