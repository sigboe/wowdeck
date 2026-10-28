/**
 * Wire types come from backend/src/api/contracts.ts (the single source of
 * truth). Type-only imports: nothing from the engine ends up in the bundle.
 */

import type { EventMap, EventName, MethodMap, SearchResult } from "../backend/src/api/contracts";

export type {
  Addon,
  ArchivePreview,
  AutoUpdateResult,
  CurseForgeAuthStatus,
  Diagnostics,
  GameRunning,
  GameType,
  ImportComparison,
  ImportState,
  ImportSummary,
  Installation,
  InstallationSource,
  OperationProgress,
  OperationResult,
  PluginSettings,
  ProviderCategory,
  ProviderErrors,
  ProviderInfo,
  ReleaseChannel,
  SearchResult,
  SearchResultScreenshot,
  UpdateChannel,
  WtfBackupInfo,
  WtfCopySource,
  WtfBackupKind,
  WtfJobKind,
  WtfJobSnapshot,
  WtfPhase,
} from "../backend/src/api/contracts";

export type WtfListResult = MethodMap["wtf.list"]["result"];

/** An addon's folders and the running file manager (addons.folders, WF-20). */
export type AddonFolders = MethodMap["addons.folders"]["result"];

/** Payload of the `wtf.completed` event. */
export type WtfCompleted = EventMap["wtf.completed"];

/** An engine event as main.py relays it (`backend_event`). */
export type BackendEvent = { [K in EventName]: { event: K; params: EventMap[K] } }[EventName];

/**
 * What the Details modal shows: a search result, or one built from an
 * installed addon (My Addons), which has none of the search-only fields.
 */
export type DetailsResult = Omit<
  SearchResult,
  "channelReleases" | "requiredDependencies" | "relationships" | "favoriteCount"
>;

/** `get_status` from main.py: the bridge's own health probe, not an engine method. */
export interface StatusInfo {
  ok: boolean;
  backendVersion?: string;
  protocolVersion?: number;
  code?: string;
  message?: string;
}
