/**
 * Wire protocol contracts shared by the engine, the Python bridge and the
 * frontend. This is the single source of truth for the RPC surface.
 *
 * Transport: newline-delimited JSON over the engine process stdin/stdout.
 */

export const PROTOCOL_VERSION = 1;

/** Request sent by the Python bridge to the engine. */
export interface RpcRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** Successful response. */
export interface RpcResult {
  id: number;
  result: unknown;
}

/** Error response. */
export interface RpcError {
  id: number;
  error: { code: string; message: string };
}

/** Engine-initiated event, relayed to the frontend by the bridge. */
export interface RpcEvent {
  event: string;
  params: Record<string, unknown>;
}

export type RpcMessage = RpcRequest | RpcResult | RpcError | RpcEvent;

export function isRpcRequest(msg: RpcMessage): msg is RpcRequest {
  return (msg as RpcRequest).method !== undefined;
}

export function isRpcEvent(msg: RpcMessage): msg is RpcEvent {
  return (msg as RpcEvent).event !== undefined && !isRpcRequest(msg);
}

// ---------------------------------------------------------------------------
// Domain types (grows during extraction; keep backend-only types in the wow/
// subtree, only wire-visible shapes here)
// ---------------------------------------------------------------------------

export type GameType = "retail" | "classic" | "classic_era" | "classic_beta" | "ptr" | "beta";

/** How an installation entered the installation list. */
export type InstallationSource = "detected" | "manual";

/** A World of Warcraft installation (one per game flavor). */
export interface Installation {
  id: string;
  gameType: GameType;
  /** Absolute path of the flavor root, e.g. .../World of Warcraft/_retail_ */
  path: string;
  /** Absolute path of the Interface/AddOns directory. */
  addonsPath: string;
  displayName: string;
  /** Short client name, e.g. "Forever" (CLIENT_DISPLAY_NAMES). */
  clientName: string;
  /** WowUp's full client name, e.g. "World of Warcraft: Forever". */
  clientFullName: string;
  /** "manual" when the user added/confirmed this installation, "detected" otherwise. */
  source: InstallationSource;
  /** True when this is the engine's canonical active installation. */
  selected: boolean;
  /** Product version string when discoverable, else null. */
  version: string | null;
}

/** An installed addon as reported by scanning the AddOns directory. */
export interface Addon {
  id: string;
  installationId: string;
  folderName: string;
  name: string;
  version: string | null;
  author: string | null;
  notes: string | null;
  interfaceVersion: string | null;
  /** Required dependencies from the TOC (`## Dependencies` / `## RequiredDeps`): folder names. */
  dependencies: string[];
  optionalDependencies: string[];
  /**
   * Required dependencies whose folder is not in AddOns (WF-11): the addon
   * will not load. Blizzard's own (Blizzard_*) ship with the game and are
   * never missing.
   */
  missingDependencies: string[];
  /** Installed automatically as another addon's required dependency (WF-22): a library; removed with its last dependant. */
  installedAsDependency: boolean;
  /** Names of installed addons (same installation) that require this one. */
  neededBy: string[];
  /** Version kept from before the last update, for addons.rollback (BEYOND-02); null when none. */
  previousVersion: string | null;
  /** Automatic updates paused for this addon (WF-02): after a rollback to an older version, or by hand. */
  autoUpdatePaused: boolean;
  /**
   * Updated within the last `newlyUpdatedHours` (PC-07; any successful
   * update: manual, Update all, auto-update). My Addons tags and sorts it.
   */
  newlyUpdated: boolean;
  loadOnDemand: boolean;
  /** Provider that manages this addon, null when unmanaged. */
  providerId: string | null;
  externalId: string | null;
  externalUrl: string | null;
  gameVersion: string | null;
  /** Present when an update is available. */
  availableVersion: string | null;
  updateAvailable: boolean;
  ignored: boolean;
  /**
   * Why `ignored` is true: "user" = ignored from the menu; "git_repo" = a
   * git checkout, never matched or updated (listed unmanaged);
   * "raiderio_client" = a folder Raider.IO's own client keeps up to date,
   * never matched or updated (listed unmanaged). Null when not ignored.
   */
  ignoreReason: "user" | "git_repo" | "raiderio_client" | null;
  /** True when `problem` is set; kept for older readers. */
  broken: boolean;
  /**
   * "folders_missing": one or more of the addon's folders are gone from
   * AddOns (deleted outside the plugin). "not_on_provider": the provider no
   * longer returns the addon (removed there, or no file for this game
   * version). Null when fine.
   */
  problem: "folders_missing" | "not_on_provider" | null;
  /**
   * Managed by a source that is turned off or not set up (ProviderInfo.available
   * false): it is neither checked nor updated until the source is back. The
   * "Source off" tag.
   */
  sourceOff: boolean;
  /** Managed by a provider that allows installing the same release again (addons.reinstall). */
  canReinstall: boolean;
  /** Release channel the addon follows (WF-03). */
  channel: ReleaseChannel;
  /**
   * addons.setChannel is allowed: a provider with release channels
   * (CurseForge, WowUp Hub), and either a pre-release newer than stable or
   * the addon already follows Beta/Alpha.
   */
  canChangeChannel: boolean;
  /** For the My Addons Details action's result header — the backend's own WowAddon model already carries this. */
  thumbnailUrl: string | null;
}

/** An addon release channel (WowUp's Stable / Beta / Alpha). */
export type ReleaseChannel = "stable" | "beta" | "alpha";

export interface SearchResultScreenshot {
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
}

export interface SearchResult {
  providerId: string;
  externalId: string;
  name: string;
  author: string | null;
  downloadCount: number | null;
  /** Plain-text summary (HTML/markdown stripped), user-presentable. */
  summary: string | null;
  thumbnailUrl: string | null;
  websiteUrl: string | null;
  latestVersion: string | null;
  /** WoW client the latest file targets (e.g. "11.0.2"), when known. */
  gameVersion: string | null;
  /** Release day (YYYY-MM-DD) of the latest file, when the provider reports a real date. */
  releasedAt: string | null;
  /** Release channel of the latest file, when known. */
  channel: ReleaseChannel | null;
  /**
   * What each channel would install, when the provider has release
   * channels and some pre-release is newer than stable; null otherwise (no
   * real choice). `fileChannel` is the file's own channel: Beta may
   * resolve to a newer Stable file, and a channel with no file of its own
   * falls back to the newest file of any channel (upstream getLatestFile).
   */
  channelReleases: Array<{ channel: ReleaseChannel; version: string; fileChannel: ReleaseChannel }> | null;
  /** Required dependencies of the file that would be installed (WF-11); installed with it. The provider gives ids, not names. */
  requiredDependencies: number;
  /**
   * Every dependency of the file that would be installed, for the Details
   * Relationships page (WF-11): provider ids; names via addons.lookup.
   * Embedded libraries ship inside the addon. CurseForge has no API for
   * dependants (the addons that need this one).
   */
  relationships: Array<{ externalId: string; relation: "required" | "optional" | "embedded" }>;
  /** CurseForge favorites; null for other providers. */
  favoriteCount: number | null;
  /** Details modal Gallery — already on the provider's own response. */
  screenshots: SearchResultScreenshot[];
}

/**
 * The providers that failed in a lookup across several (a search, finding
 * sources), so the UI can tell a failure from an empty result.
 */
export type ProviderErrors = Array<{ providerId: string; error: string }>;

export interface ProviderInfo {
  id: string;
  name: string;
  enabled: boolean;
  /** Enabled and configured: usable for search, install and updates (ProviderRegistry.usable). */
  available: boolean;
  requiresApiKey: boolean;
  /** False when the provider needs configuration (e.g. API key) that is missing. */
  configured: boolean;
  /** False means this provider can never be toggled (e.g. GitHub) — the Settings UI must not render a toggle for it. */
  allowEdit: boolean;
  /** False means this provider has no catalog name-search (e.g. GitHub/WowInterface) — never list it in the Search box's helper text. */
  catalogSearch: boolean;
  /** Has Get Addons' Latest and Popular lists (discover.latest/popular): CurseForge, WowUp Hub. */
  discovers: boolean;
}

/**
 * A provider-scoped addon category. `id` is only meaningful to the
 * provider that returned it — never a universal id.
 */
export interface ProviderCategory {
  id: string;
  name: string;
}

export interface OperationProgress {
  operationId: string;
  addonId: string | null;
  phase: "resolve" | "download" | "extract" | "validate" | "install" | "rescan";
  /** 0..1, or null when indeterminate. */
  progress: number | null;
  message: string | null;
}

export interface OperationResult {
  operationId: string;
  addonId: string | null;
  status: "updated" | "installed" | "removed" | "current" | "failed" | "skipped";
  error: string | null;
  /** The addon's name, set where the caller has no addon record to look it up (import results). */
  addonName?: string;
  /** Provider external ids of required dependencies not currently installed for this installation. Informational only — never auto-installed, matching upstream WowUp. */
  missingRequiredDependencies?: string[];
}

/** One row of an import preview — see `addons.previewImport`. */
export type ImportState = "new" | "no_change" | "conflict" | "unresolved";

export interface ImportComparison {
  name: string;
  providerId: string;
  externalId: string;
  versionId: string | null;
  state: ImportState;
  /** Human-readable reason, set for every state except "new". */
  reason: string | null;
  /** The list marks it a library (installed only as a dependency); imported as one (WF-21). */
  dependency: boolean;
}

export interface ImportSummary {
  addedCt: number;
  noChangeCt: number;
  conflictCt: number;
  unresolvedCt: number;
  comparisons: ImportComparison[];
}

/**
 * What `addons.inspectArchive` found in a local addon archive (Manual
 * Install's From a file): the preview card shown before anything is
 * installed.
 */
export interface ArchivePreview {
  /** The archive's own file name, e.g. Foo-1.2.zip. */
  fileName: string;
  /** The addon's TOC title, falling back to the file name. */
  name: string;
  /** From the addon's TOC, when it states one. */
  author: string | null;
  /** The addon's own version from its TOC, when it states one. */
  version: string | null;
  /** The addon folders the archive installs; a bundle ships several. */
  folders: string[];
  /** The `addons.install` pair for this archive: always "File" here. */
  providerId: string;
  /** The `addons.install` external id: the archive's canonical path. */
  externalId: string;
}

/** Who/what created a WTF backup. "unknown" = made by desktop WowUp or something else. */
export type WtfBackupKind = "manual" | "pre-restore" | "auto" | "unknown";

/**
 * The desktop's file manager on the user's D-Bus session bus
 * (org.freedesktop.FileManager1), as found when asked.
 */
export interface FileManagerState {
  running: boolean;
  /** Program name of the running file manager ("Dolphin"); null when not running or unknown. */
  name: string | null;
  /**
   * Steam app it runs under (SteamAppId: Dolphin added as a non-Steam game, or
   * the nested desktop session's shortcut), for switching to it after Show;
   * null when not started by Steam or unknown.
   */
  steamAppId: number | null;
}

/** One WTF backup zip in the backup folder — see docs/wtf-backup.md. */
export interface WtfBackupInfo {
  /** Bare file name, e.g. wtf_1700000000000.zip — the only identifier ever accepted back. */
  fileName: string;
  sizeBytes: number;
  /** Epoch ms from the backup's own metadata, else the file's mtime. */
  createdAt: number;
  kind: WtfBackupKind;
  /** Files (not directories) in the backup, from its metadata. */
  fileCount: number | null;
  /** Flavor folder the backup was made for (`_retail_`, `_classic_ptr_`, …); null for backups made by desktop WowUp (which doesn't record it). */
  flavor: string | null;
  /** The backup contains a Config.wtf (graphics/display settings, specific to the machine it came from). */
  hasConfig: boolean;
  /** Made by this plugin install (its device id matches). False for another computer's backups and for desktop WowUp's. */
  fromThisDevice: boolean;
  /** Restoring should default to keeping this device's Config.wtf (the backup came from another computer). */
  keepConfigSuggested: boolean;
  valid: boolean;
  /** Short plain-language reason when `valid` is false. */
  invalidReason: string | null;
}

export type WtfJobKind = "create" | "restore";
export type WtfPhase = "scan" | "compress" | "snapshot" | "extract" | "verify" | "swap" | "cleanup";
/** "unknown" = /proc couldn't be read; never treated as "not running". */
export type GameRunning = "running" | "not_running" | "unknown";

/** The WTF job currently running in the engine (one at a time). */
export interface WtfJobSnapshot {
  jobId: string;
  kind: WtfJobKind;
  installationId: string;
  phase: WtfPhase;
  /** Bytes processed in the current phase. */
  done: number;
  /** Bytes expected in the current phase, or null when unknown. */
  total: number | null;
}

// ---------------------------------------------------------------------------
// Method parameter/result contracts
// ---------------------------------------------------------------------------

export interface MethodMap {
  "system.getStatus": {
    params: Record<string, never>;
    result: { backendVersion: string; protocolVersion: number; pid: number };
  };
  "system.diagnostics": {
    params: Record<string, never>;
    result: Diagnostics;
  };
  "system.updateCheck": {
    /**
     * Whether a newer WoWDeck release exists on GitHub — the plugin's own
     * update notice, on the owner's update channel (Stable: GitHub's
     * releases/latest; Beta: the releases list, newest stable or beta). At
     * most one call to GitHub per 24 hours, following the same cadence
     * rule as the addon check behind the SteamOS toast (CheckCadence):
     * each check keeps its own stored timestamp, so a sleeping Deck re-checks on wake instead of trusting a
     * session that may be weeks old. Inside the interval the stored answer
     * is returned (recomputed against the running version) and `checked` is
     * false. A failed check never advances the interval — instead it backs
     * off: consecutive failures space the next network attempt 1h, 2h, then
     * 4h (capped), and any success clears the backoff and re-arms the daily
     * cadence; within a backoff window the stored answer serves without a
     * request, exactly like the daily cap. Authenticated with the optional
     * GitHub token when GitHub accepts it, so a still-private repo answers
     * too. "unknown" — never an RPC error, never a toast — when the check
     * cannot run (offline, rate limited, nothing reachable); background
     * failures are visible only in the engine's structured stderr log.
     * "available" carries the release page and the packaged WoWDeck.zip
     * asset URL (what system.updateStage downloads); null when the release
     * has no such asset.
     */
    params: {
      /**
       * A toast trigger (plugin load, wake from suspend): only such a call
       * may report — and so spend — the version's once-only toast. Options
       * and staging leave it unset; they show the update panel instead.
       */
      notify?: boolean;
    };
    result: {
      status: "current" | "available" | "unknown";
      currentVersion: string;
      latestVersion: string | null;
      releaseUrl: string | null;
      downloadUrl: string | null;
      /**
       * True when the offered `latestVersion` is a stable release older than
       * the running beta build: an owner who left the Beta channel is
       * offered the latest stable ("Switch to stable X"). Only ever true on
       * "available".
       */
      switchToStable: boolean;
      /**
       * The offered build's release notes (its GitHub release body,
       * Markdown, untrusted text: shown as plain text, never as HTML). On
       * "available" only, and null when the release has no body.
       */
      releaseNotes: string | null;
      /**
       * True when a network attempt just ran (a failed one still serves the
       * stored answer); false when the interval or a failure-backoff window
       * served it without one. No surface keys on it: it makes the cadence
       * observable over the RPC.
       */
      checked: boolean;
      /**
       * Whether the update toast should fire now: computed engine-side,
       * true only for a `notify` call's first answer that finds
       * `latestVersion` newer than the running version, with its
       * WoWDeck.zip attached, *and* not already toast-shown. At-most-once
       * per release version: the engine marks the version shown
       * (PluginSettings.pluginUpdateToastShownFor) the moment it reports
       * pending, so re-checks, plugin reloads, QAM churn and engine
       * restarts can never re-toast it; a genuinely newer version is a new
       * key and earns its own single toast. A cached answer (no network
       * run) recomputes this without touching the network.
       */
      toastPending: boolean;
    };
  };
  "system.getUpdateChannel": {
    /** Which WoWDeck builds the update check offers (GLOSSARY: Update channel). Stable until the owner picks another. */
    params: Record<string, never>;
    result: { channel: UpdateChannel };
  };
  "system.setUpdateChannel": {
    /**
     * Store the update channel and check it at once: this check ignores the
     * daily interval and any failure-backoff window, so the owner sees what
     * the new channel offers right away. Answers like system.updateCheck
     * (never spending the toast); "unknown" when the channel's source could
     * not be asked. The channel is stored even then.
     */
    params: { channel: UpdateChannel };
    result: MethodMap["system.updateCheck"]["result"];
  };
  "system.updateStage": {
    /**
     * Stage the newer WoWDeck release for Decky's own installer: download
     * the release's WoWDeck.zip (with the optional GitHub token, so a
     * private pre-release repo works), verify its SHA-256 and package
     * structure (the plugin's name and the release's version), and leave
     * it as a 0600 file in the OS temp dir. The caller hands the returned
     * file:// artifact, version and sha256 to Decky's
     * utilities/install_plugin, whose native prompt installs and reloads
     * the plugin. This engine never extracts or replaces its own
     * installed files, and nothing is staged on any failure.
     */
    params: Record<string, never>;
    result: {
      result: { artifact: string; version: string; sha256: string } | null;
      error: { code: string; message: string } | null;
    };
  };
  "installations.list": {
    params: Record<string, never>;
    result: { installations: Installation[] };
  };
  "installations.detect": {
    params: Record<string, never>;
    result: { installations: Installation[] };
  };
  "installations.select": {
    params: { installationId: string };
    result: { installation: Installation | null };
  };
  "installations.add": {
    params: {
      /** WoW root, flavor dir, or prefix root (same rules as custom scan paths). */
      path: string;
      /** Optional user-facing label. */
      displayName?: string;
      /** Force the client type when the path is not a recognized flavor dir. */
      clientType?: GameType;
    };
    result: { installations: Installation[] };
  };
  /**
   * What a folder holds, without adding it: one entry per WoW version folder
   * found there (the folder itself or flavors below a game root). Fills in
   * Add installation's display name and game version as soon as a folder is
   * picked. Empty when nothing is recognised.
   */
  "installations.inspect": {
    params: { path: string };
    result: { found: Array<{ gameType: GameType; displayName: string }> };
  };
  "installations.remove": {
    params: { installationId: string };
    result: { installationId: string };
  };
  "addons.list": {
    params: Record<string, never>;
    result: { addons: Addon[] };
  };
  "addons.refresh": {
    params: { installationId?: string };
    result: { addons: Addon[]; updated: number; failed: number };
  };
  "addons.search": {
    params: { query: string; providerId?: string };
    result: { results: SearchResult[]; providerErrors: ProviderErrors };
  };
  "addons.resolveUrlImport": {
    /**
     * Install from URL — a GitHub/WowInterface URL, GitHub owner/repository
     * shorthand or Nix-style github:owner/repository reference, or an
     * https link to a .zip/.rar/.7z file (provider "Zip").
     */
    params: { url: string };
    /**
     * Never a thrown RPC error: a failure (no compatible release, rate
     * limited, not found, bad input) is an expected outcome and comes back
     * in `error`. `code` is a ProviderError code (e.g.
     * "github_no_compatible_release", "github_rate_limited",
     * "source_removed") or the bridge's "invalid_request" / "not_found"
     * (errorCodeFor); the UI maps known codes to a sentence and otherwise
     * shows `message`.
     */
    result: { result: SearchResult | null; error: { code: string; message: string } | null };
  };
  /**
   * Install from file (Manual Install's From a file): inspect an archive
   * already on this Deck — a .zip, .rar or .7z picked with Steam's file
   * picker — without installing anything. The returned preview carries the
   * `addons.install` pair (provider "File", the archive's canonical path).
   *
   * Never a thrown RPC error, like `addons.resolveUrlImport`: `error.code`
   * is one of "archive_not_supported" (wrong extension or not an archive
   * by its bytes), "archive_no_addons" (nothing installable: no folder
   * with a .toc inside, or a top-level folder without one),
   * "archive_unreadable" (missing, moved, not a regular file), or
   * "archive_extraction_failed" (damaged, password-protected, or a host
   * tool the Deck lacks); the UI maps known codes to a sentence and
   * otherwise shows `message`.
   */
  "addons.inspectArchive": {
    params: { path: string };
    result: { result: ArchivePreview | null; error: { code: string; message: string } | null };
  };
  "discover.latest": {
    /** providerId: a source with `ProviderInfo.discovers` (the list's Source menu). */
    params: { providerId: string; index: number; pageSize: number };
    result: { results: SearchResult[]; totalCount: number };
  };
  "discover.popular": {
    /**
     * providerId: as for discover.latest. categoryId: an id from
     * addons.getCategories for that source, or omitted for "All Categories".
     */
    params: { providerId: string; index: number; pageSize: number; categoryId?: string };
    result: { results: SearchResult[]; totalCount: number };
  };
  "addons.getDescription": {
    params: { providerId: string; externalId: string };
    result: { description: string | null };
  };
  "addons.getChangelog": {
    params: { providerId: string; externalId: string };
    result: { changelog: string | null };
  };
  "addons.getCategories": {
    params: { providerId: string };
    /** null means the provider doesn't support category retrieval — distinct from a genuinely empty list. */
    result: { categories: ProviderCategory[] | null };
  };
  "addons.install": {
    /** `channel`: install from that release channel and follow it (providers with channels only). */
    params: { providerId: string; externalId: string; channel?: ReleaseChannel };
    result: { addon: Addon; operation: OperationResult };
  };
  /**
   * Put the kept previous version back (BEYOND-02); the current one becomes
   * the kept one, so this can be undone. Status "installed". Auto-update
   * leaves the release rolled back from alone.
   */
  "addons.rollback": {
    params: { addonId: string };
    result: { addon: Addon; operation: OperationResult };
  };
  /** Pause or resume automatic updates for one addon (WF-02). */
  "addons.setAutoUpdatePaused": {
    params: { addonId: string; paused: boolean };
    result: { addon: Addon };
  };
  /** Disk space the kept previous versions use, over every installation. */
  "rollback.status": {
    params: Record<string, never>;
    result: { bytes: number; count: number };
  };
  /** Delete every kept previous version. */
  "rollback.clear": {
    params: Record<string, never>;
    result: { bytes: number; count: number };
  };
  /**
   * Names for provider ids (the Relationships page, WF-11), and whether each
   * is installed in the selected installation. Ids the provider does not
   * return for this game version are left out.
   */
  "addons.lookup": {
    params: { providerId: string; externalIds: string[] };
    result: { addons: Array<{ externalId: string; name: string; thumbnailUrl: string | null; installed: boolean }> };
  };
  /**
   * Follow another release channel and install its latest release now
   * (WF-03), also when that is older (back to Stable). Status "installed";
   * on "failed" the addon keeps its old channel.
   */
  "addons.setChannel": {
    params: { addonId: string; channel: ReleaseChannel };
    result: { addon: Addon; operation: OperationResult };
  };
  /**
   * An addon's folders in the selected installation's AddOns (WF-20, the
   * Details Folders page): a managed addon's recorded folders, main folder
   * first, or an unmanaged addon's one folder; `present` false when it is
   * gone from disk. With the file manager addons.showFolders would use.
   */
  "addons.folders": {
    params: { addonId: string };
    result: { addonsPath: string; folders: Array<{ name: string; path: string; present: boolean }>; fileManager: FileManagerState };
  };
  /**
   * Shows the addon's folders (those on disk) in the file manager that is
   * already running (WF-20). `shown` false when none is: nothing is started.
   * `steamAppId` is the Steam app it runs under, to switch to (see
   * FileManagerState).
   */
  "addons.showFolders": {
    params: { addonId: string };
    result: { shown: boolean; steamAppId: number | null };
  };
  "addons.remove": {
    params: { addonId: string };
    result: { addonId: string; operation: OperationResult };
  };
  "addons.removeUnmanaged": {
    params: { folderName: string; installationId?: string };
    result: { operation: OperationResult };
  };
  /**
   * Online sources for an unmanaged folder (WF-23), or a managed addon's
   * copies on other providers (WF-12; its own provider is left out): addons named by the TOC's
   * project ids (X-Curse-Project-ID, X-WoWI-ID, X-Tukui-ProjectID) and
   * addons on the catalog providers found by the TOC title and folder name,
   * whose release installs that folder (a managed addon's main one). TOC-named
   * first, then exact name, then by downloads.
   */
  "addons.findSources": {
    params: { folderName: string } | { addonId: string };
    result: { results: SearchResult[]; providerErrors: ProviderErrors };
  };
  /**
   * Make an unmanaged folder managed (WF-23): installs the chosen source's
   * release over it. The files there before are kept as the previous version
   * (addons.rollback returns to them). Status "installed", or "failed".
   */
  "addons.adopt": {
    params: { folderName: string; providerId: string; externalId: string };
    result: { addon: Addon; operation: OperationResult };
  };
  /**
   * Switch a managed addon to another source (WF-12; upstream's "Provider"
   * menu): installs that source's release over the addon, which from then
   * on updates from there. The same addon (id, ignore and pause flags, kept
   * previous version), as a channel switch. Refused when that source is
   * already installed as another addon, or its release lacks the addon's
   * main folder. Status "installed", or "failed" (the addon is unchanged).
   */
  "addons.changeSource": {
    params: { addonId: string; providerId: string; externalId: string };
    result: { addon: Addon; operation: OperationResult };
  };
  "addons.setIgnored": {
    params: { addonId: string; ignored: boolean };
    result: { addon: Addon };
  };
  "addons.update": {
    params: { addonId: string };
    result: { addon: Addon; operation: OperationResult };
  };
  /** Install the addon's current release again (repair). Status "installed" on success. */
  "addons.reinstall": {
    params: { addonId: string };
    result: { addon: Addon; operation: OperationResult };
  };
  "addons.updateAll": {
    /**
     * allInstallations (WF-13): every installation, each first checked for
     * updates (its metadata may be old), failures isolated per installation
     * and per addon. Omitted: the selected installation, as before.
     */
    params: { allInstallations?: boolean };
    result: { operations: OperationResult[] };
  };
  "addons.export": {
    /** WowUp-compatible addon-list export, scoped to one installation. */
    params: { installationId?: string };
    result: {
      /** Base64 — paste/save this, exactly WowUp's own export string format. */
      payload: string;
      collectionName: string;
      exportedCount: number;
      ignoredCount: number;
      /** Addons that could not be represented in the export (truthfully reported, never silently dropped). */
      unsupported: { name: string; reason: string }[];
    };
  };
  "addons.previewImport": {
    /** Decode + compare only — never installs anything. */
    params: { importString: string; installationId?: string };
    result: {
      summary: ImportSummary | null;
      /** Set only for a whole-import failure (malformed string, empty list, incompatible client) — per-entry issues show up as "unresolved"/"conflict" rows in `summary` instead. */
      error: { code: string; message: string } | null;
    };
  };
  "addons.importAddonList": {
    /** Installs every "new" row from the same import string's preview, through the normal install pipeline. */
    params: { importString: string; installationId?: string };
    result: {
      operations: OperationResult[];
      error: { code: string; message: string } | null;
    };
  };
  "providers.list": {
    params: Record<string, never>;
    result: { providers: ProviderInfo[] };
  };
  "providers.setEnabled": {
    params: { providerId: string; enabled: boolean };
    result: { providers: ProviderInfo[] };
  };
  "providers.testApiKey": {
    params: { providerId: string; apiKey?: string };
    result: {
      ok: boolean;
      httpStatus: number | null;
      message: string;
      /** False means this result is inconclusive (network/rate-limit/server issue) — never treat it as proof the key is bad. Omitted/true means a confirmed verdict. */
      confirmed?: boolean;
    };
  };
  "curseforge.authStatus": {
    /** The live bundled-vs-user key selection state, for Options' conditional UI and Diagnostics. */
    params: Record<string, never>;
    result: CurseForgeAuthStatus;
  };
  "curseforge.recheckBundledKey": {
    /**
     * The one supported way to return to a bundled key after it was
     * confirmed invalid and has since become usable again, without
     * waiting for an engine restart. Never auto-retried on a schedule —
     * no retry loop against a known-invalid key.
     */
    params: Record<string, never>;
    result: CurseForgeAuthStatus;
  };
  "settings.get": {
    params: Record<string, never>;
    result: { settings: PluginSettings };
  };
  /**
   * Addon updates per installation, for the Steam game-page section
   * (BEYOND-05). `refresh` first asks the providers for every installation
   * (like updateAll {allInstallations}); without it, the last known state.
   */
  "addons.updateSummary": {
    params: { refresh?: boolean };
    result: { installations: Array<{ installationId: string; displayName: string; updates: number }> };
  };
  "settings.set": {
    params: { settings: Partial<PluginSettings> };
    result: { settings: PluginSettings };
  };
  "wtf.list": {
    params: { installationId?: string };
    result: {
      wtfExists: boolean;
      backupDir: string;
      /** False when a user-chosen backup folder isn't there (e.g. SD card removed) — distinct from "no backups". */
      dirAvailable: boolean;
      backups: WtfBackupInfo[];
      totalBackupBytes: number;
      gameRunning: GameRunning;
      /** The running WTF job, if any, so a reopened UI can re-attach. */
      job: WtfJobSnapshot | null;
    };
  };
  "wtf.measure": {
    params: { installationId?: string };
    result: { exists: boolean; fileCount: number; totalBytes: number; freeBytes: number | null };
  };
  "wtf.create": {
    /** Returns at once; progress arrives as `wtf.progress`, the outcome as `wtf.completed`. */
    params: { installationId?: string };
    result: { jobId: string };
  };
  "wtf.restore": {
    /** Returns at once (see wtf.create). Always takes an automatic "pre-restore" safety backup first. */
    params: {
      installationId?: string;
      fileName: string;
      /** Required for backups that don't record their game flavor (made by desktop WowUp). */
      acceptUnknownFlavor?: boolean;
      /** Keep this device's Config.wtf (graphics/display settings). */
      keepCurrentConfig?: boolean;
    };
    result: { jobId: string };
  };
  "wtf.delete": {
    params: { installationId?: string; fileName: string };
    result: { fileName: string };
  };
  "wtf.import": {
    /** Add a backup zip from anywhere (copied into this flavor's backup folder after validation). */
    params: { installationId?: string; path: string };
    result: { fileName: string; alreadyPresent: boolean };
  };
  "wtf.cancel": {
    /** Create can be cancelled any time; a restore only until it starts swapping folders (`too_late_to_cancel`). */
    params: { jobId: string };
    result: { cancelled: boolean };
  };
  "notifications.checkUpdateToast": {
    /**
     * Called once when the plugin loads and once each time the Deck
     * wakes from sleep (src/index.tsx). Internally
     * rate-limited to at most once per real day and gated by
     * `updateToastEnabled` — most calls return `shouldToast: false`
     * immediately without doing any provider/network work at all. When
     * it does run, it refreshes every known installation (not just the
     * selected one) via the normal update-check pipeline.
     */
    params: Record<string, never>;
    result: { shouldToast: boolean; updateCount: number; installationCount: number };
  };
}

export type MethodName = keyof MethodMap & string;

/**
 * Wire mirror of CurseForgeAuthService's own snapshot — the single
 * source of truth both Options' conditional key-entry UI and
 * Diagnostics read, rather than each reimplementing the bundled-vs-user
 * priority logic. Never carries a key value.
 */
export interface CurseForgeAuthStatus {
  activeSource: "bundled" | "user" | "none";
  bundledPresent: boolean;
  bundledStatus: "unvalidated" | "valid" | "invalid" | "unknown";
  userConfigured: boolean;
  userStatus: "unvalidated" | "valid" | "invalid" | "unknown";
}

export interface PluginSettings {
  selectedInstallationId: string | null;
  enabledProviders: string[] | null;
  customWowPaths: string[];
  /** User-supplied CurseForge API key (never logged, never echoed in full). */
  curseApiKey: string | null;
  /** Optional GitHub personal access token — raises the unauthenticated rate limit; never logged, never echoed in full, never attached to downloads. */
  githubAccessToken: string | null;
  /**
   * Whether the SteamOS update-available toast
   * (checked on plugin load and on waking from sleep, at most once a
   * day — see notifications.checkUpdateToast / UpdateToastGate) is
   * allowed to fire at all. Independent of the WowUp companion-data
   * bridge, which has no setting and always runs when the companion
   * addon is detected. Default true (see updateToastEnabled in
   * wow/storage/settings.ts for the rationale).
   */
  updateToastEnabled: boolean;
  /**
   * Epoch ms of the last time the toast gate actually ran its
   * all-installations check (regardless of whether it found anything
   * to show) — not a user-facing preference, but persisted alongside
   * settings like `selectedInstallationId` already is. `null` before
   * the first check ever runs.
   */
  lastUpdateCheckAt: number | null;
  /**
   * The last completed look for a newer WoWDeck release (system.updateCheck):
   * what it answered and when it ran. Persisted like `lastUpdateCheckAt`, for
   * the at-most-daily cap — inside the interval this answers without a
   * network call. Null before the first successful check.
   */
  lastPluginUpdate: PluginUpdateSnapshot | null;
  /**
   * The WoWDeck release version the update toast was already shown for
   * (system.updateCheck's toastPending): exactly one toast per release
   * version, surviving restarts. Engine-written only — the engine marks
   * the version the moment it reports the toast pending; never a user
   * preference. Null before any toast fired.
   */
  pluginUpdateToastShownFor: string | null;
  /**
   * The failure backoff for system.updateCheck: how many consecutive
   * checks failed and when the last one ran. After a failure the next
   * network attempt waits 1h, 2h, then 4h (capped); any success clears
   * this and restores the daily cadence. Engine-written only, never a
   * user preference. Null while the last check succeeded (or none failed
   * yet).
   */
  pluginUpdateBackoff: PluginUpdateBackoff | null;
  /**
   * Which WoWDeck builds the update check offers, set through
   * system.setUpdateChannel (never settings.set, so a switch always runs its
   * check). Missing or unknown in the stored file means Stable.
   */
  pluginUpdateChannel: UpdateChannel;
  /** User-chosen folder for WTF backups (e.g. on an SD card); null = the plugin's own data folder. */
  wtfBackupDir: string | null;
  /** How many automatic pre-restore safety backups to keep per game version (1-10). */
  wtfKeepSnapshots: number;
  /**
   * The Steam library entry (usually a non-Steam shortcut) that launches WoW,
   * picked in Options (BEYOND-05). Its game page shows the addon-updates
   * section. Null = no Steam integration.
   */
  steamGame: { appId: number; name: string } | null;
  /** Check for addon updates in the background when the linked game's page or tile appears (at most every 15 min). */
  steamAutoCheck: boolean;
  /** Badge on the linked game's tile on Steam's home screen; off = a kill switch if a Steam update breaks it. */
  steamBadge: boolean;
  /** My Addons hides libraries (addons installed only as another's dependency, WF-22). */
  hideLibraries: boolean;
  /** My Addons hides unmanaged addons (installed manually, never updated). */
  hideUnmanaged: boolean;
  /** Keep each addon's previous version after an update, for rollback (BEYOND-02). */
  keepPreviousVersions: boolean;
  /**
   * Update addons automatically when a check finds updates (WF-02; default
   * off): after the daily check (plugin load, wake) and the Steam page/tile
   * background check. Never while WoW is running.
   */
  autoUpdate: boolean;
  /** The last automatic update run, for Options; null before the first. */
  lastAutoUpdate: AutoUpdateResult | null;
  /**
   * How long an updated addon counts as newly updated (PC-07), in hours.
   * Not user-facing: no Options row, only the engine settings file;
   * settings.set ignores it.
   */
  newlyUpdatedHours: number;
}

export interface Diagnostics {
  backendVersion: string;
  protocolVersion: number;
  platform: string;
  /** decky-loader's own version, when the host environment exposes it. */
  deckyVersion: string | null;
  /** This plugin's version, from package.json, as reported by decky-loader's environment. */
  pluginVersion: string | null;
  installations: {
    id: string;
    clientLabel: string;
    path: string;
    /** Whether the real WowUp companion addon was found for this installation (not a secret, safe alongside clientLabel). */
    companionAddonDetected: boolean;
  }[];
  providers: ProviderInfo[];
  recentErrors: { time: string; method: string; message: string }[];
  /**
   * The actual active CurseForge key source/status — never the key
   * value, never a prefix/suffix/hash of it. Mirrors CurseForgeAuthStatus
   * so Diagnostics and Options' UI agree.
   */
  curseForgeAuth: CurseForgeAuthStatus;
  /**
   * Whether a GitHub personal access token is configured — GitHub has
   * no validity concept of its own (the token
   * is optional and, when present, always in effect), so "configured"
   * and "active" are the same thing here, unlike CurseForge's
   * bundled/user distinction. Never the token value itself.
   */
  githubTokenConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Events emitted by the engine
// ---------------------------------------------------------------------------

/**
 * The WoWDeck update channels (GLOSSARY): which builds the owner is offered.
 * String ids, so a later build source (PR builds, say) is one more id here —
 * no other contract or stored-setting change.
 */
export const UPDATE_CHANNELS = ["stable", "beta"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** The last completed WoWDeck release check, as persisted (see PluginSettings.lastPluginUpdate). */
export interface PluginUpdateSnapshot {
  /** Epoch ms of the check that produced this answer. */
  checkedAt: number;
  /** The update channel that answered; absent in answers stored before channels, which were Stable's. */
  channel?: UpdateChannel;
  /** The offered build's version (X.Y.Z or X.Y.Z-beta.N), without a leading v. */
  latestVersion: string;
  /** The release page to point the user at. */
  releaseUrl: string | null;
  /** The release's WoWDeck.zip asset, when the release published one. */
  downloadUrl: string | null;
  /** The release notes (the GitHub release body, Markdown); absent when it has none. */
  releaseNotes?: string;
}

/**
 * The WoWDeck release check's failure backoff, as persisted (see
 * PluginSettings.pluginUpdateBackoff): after consecutive failures, the
 * spacing the next network attempt waits out.
 */
export interface PluginUpdateBackoff {
  /** Epoch ms of the most recent failed attempt. */
  failedAt: number;
  /** How many consecutive attempts have failed (1 = the first backoff step). */
  failures: number;
}

/** One automatic update run (WF-02). */
export interface AutoUpdateResult {
  /** Epoch ms. */
  at: number;
  /** Names of addons updated. */
  updated: string[];
  /** Names of addons whose update failed. */
  failed: string[];
  /** Why nothing was updated although updates were waiting ("WoW was running"); null when it ran. */
  skipped: string | null;
}

export interface EventMap {
  /** An automatic update ran and updated or failed something (WF-02). */
  "addons.autoUpdated": { result: AutoUpdateResult };
  "operation.progress": { progress: OperationProgress };
  "operation.completed": { result: OperationResult };
  "operation.failed": { result: OperationResult };
  "addons.changed": { addonIds: string[] };
  "wtf.progress": { job: WtfJobSnapshot };
  "wtf.completed": {
    jobId: string;
    kind: WtfJobKind;
    installationId: string;
    /** create: the new backup; restore: the backup that was restored. */
    fileName: string | null;
    /** restore only: the automatic safety backup of the settings that were replaced. */
    snapshotFileName: string | null;
    error: { code: string; message: string } | null;
  };
}

export type EventName = keyof EventMap & string;
