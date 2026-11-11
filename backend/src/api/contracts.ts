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

/**
 * The answer of a method that never throws for an expected failure: the
 * result, or the error a thrown RPC would carry (code from errorCodeFor).
 */
export interface Settled<T> {
  result: T | null;
  error: { code: string; message: string } | null;
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

export type GameType =
  | "retail"
  | "classic"
  | "classic_era"
  | "forever"
  | "classic_beta"
  | "classic_titan"
  | "cn_beta"
  | "ptr"
  | "beta";

/** How an installation entered the installation list. */
export type InstallationSource = "detected" | "manual";

/** An installation a folder holds, before it is added (installations.inspect). */
export interface FoundInstallation {
  gameType: GameType;
  displayName: string;
}

/** A Steam library shortcut linked to a discovered installation. */
export interface SteamGameLink {
  appId: number;
  name: string;
}

export type InstallationPreferences = Partial<Pick<Installation, "autoUpdateEnabled" | "hidden">>;

/** A World of Warcraft installation (one per game flavor). */
export interface Installation {
  autoUpdateEnabled: boolean;
  hidden: boolean;
  id: string;
  gameType: GameType;
  /** Absolute path of the flavor root, e.g. .../World of Warcraft/_retail_ */
  path: string;
  /** Absolute path of the Interface/AddOns directory. */
  addonsPath: string;
  displayName: string;
  /** Short client name, e.g. "Forever Beta" (CLIENT_DISPLAY_NAMES). */
  clientName: string;
  /** WowUp's full client name, e.g. "World of Warcraft: Forever Beta". */
  clientFullName: string;
  /** "manual" when the user added/confirmed this installation, "detected" otherwise. */
  source: InstallationSource;
  /** True when this is the engine's canonical active installation. */
  selected: boolean;
  /** Product version string when discoverable, else null. */
  version: string | null;
  /** Steam shortcuts proven to launch this installation by registry or executable discovery. */
  steamGames?: SteamGameLink[];
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
  /** Optional dependencies from the TOC (`## OptionalDeps`): folder names. */
  optionalDependencies: string[];
  /**
   * Required dependencies whose folder is not in AddOns (WF-11): the addon
   * will not load. Blizzard's own (Blizzard_*) ship with the game and are
   * never missing.
   */
  missingDependencies: string[];
  /**
   * A library (WF-22): installed only because another addon needs it.
   * Stays one when nothing needs it any more; removed only when the user
   * chooses to (ADR 0008).
   */
  installedAsDependency: boolean;
  /**
   * Names of installed addons (same installation) that need this one: its
   * source lists it as required, or their TOC names one of its folders
   * (required or optional dependency).
   */
  neededBy: string[];
  /**
   * Names of the libraries removing this addon would leave unneeded, those
   * only they needed included: what Remove offers to remove too
   * (`addons.remove`'s `removeLibraries`). Empty for unmanaged folders.
   */
  leavesUnneeded: string[];
  /** Version kept from before the last update, for addons.rollback (BEYOND-02); null when none. */
  previousVersion: string | null;
  /** Automatic updates paused for this addon (WF-02): after a rollback to an older version, or by hand. */
  autoUpdatePaused: boolean;
  /**
   * Updated within the last `newlyUpdatedHours` (PC-07; any successful
   * update: manual, Update all, auto-update), unless a newer update has been
   * discovered since. Discovery clears this durably until another successful
   * update. Shared by status tags and My Addons sorting.
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
  /** When provided, only these account-permitted channels may be chosen. */
  allowedChannels?: ReleaseChannel[];
  /** For the My Addons Details action's result header — the backend's own WowAddon model already carries this. */
  thumbnailUrl: string | null;
}

/** An addon change's answer: the addon as it is now, and how the operation went. */
export interface AddonOperation {
  addon: Addon;
  operation: OperationResult;
}

/** An addon release channel (WowUp's Stable / Beta / Alpha). */
export type ReleaseChannel = "stable" | "beta" | "alpha";

export interface SearchResultScreenshot {
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
}

/**
 * The client/flavor a game version belongs to, as the provider identifies
 * it. CurseForge reports this per version (its own gameVersionTypeId), so a
 * version number never has to be guessed into a flavor: 3.80.x is Titan
 * Reforged because the provider says so, not because 3.80 means anything to
 * us. `retail` still spans expansions, which the version's major.minor
 * names (11.x = The War Within, 12.x = Midnight, …).
 */
export type GameVersionClient =
  | "retail"
  | "classic_era"
  | "anniversary"
  | "wrath"
  | "cataclysm"
  | "mists"
  | "titan_reforged"
  | "forever";

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
  /**
   * Every game version the latest file targets, when the provider lists
   * more than one (CurseForge's per-file list; TukUI's patch list); null
   * when unknown. `gameVersion` is its first entry.
   */
  gameVersions: string[] | null;
  /**
   * The client/flavor of the entries in `gameVersions` the provider
   * identifies, keyed by version (CurseForge's per-file type ids). Null
   * when the provider doesn't say, as with TukUI's patch list.
   */
  gameVersionClients: Record<string, GameVersionClient> | null;
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

export interface OperationResult {
  operationId: string;
  addonId: string | null;
  status: "updated" | "installed" | "removed" | "current" | "failed" | "skipped";
  error: string | null;
  /** The addon's name, set where the caller has no addon record to look it up (import results). */
  addonName?: string;
  /** Provider external ids of required dependencies not currently installed for this installation. Informational only — never auto-installed, matching upstream WowUp. */
  missingRequiredDependencies?: string[];
  /**
   * The operation succeeded, but its cleanup didn't finish: temporary files
   * or its transaction marker are left. Plain text to show with the success;
   * the leftovers stay known as committed (never restored or undone) and go
   * at the next addon change. Never set on a failed operation.
   */
  cleanupWarning?: string;
  /**
   * Set (always with status "failed") when the installation is recovery
   * required: this operation's undo stopped and left recovery copies, or
   * it was refused because an earlier one did. Unlike an ordinary
   * failure, trying again does not help until recovery.
   */
  recoveryRequired?: true;
  /**
   * The separate addon operations this one ran after its own addon
   * committed, in order, each with `addonName` when known: the required
   * dependencies installed with it, or the libraries its removal left
   * unneeded. Each committed or failed on its own and stays that way;
   * this operation's `status` is its own addon's. An ordinary failure lets
   * the next one run; after one sets `recoveryRequired`, the rest are
   * refused (failed, `recoveryRequired`) and nothing more changes in the
   * installation. Absent when there were none.
   */
  followUps?: OperationResult[];
}

/**
 * Whether an installation's addons can change (ADR 0006). "recoveryRequired":
 * an addon operation could not put its files back; addon changes, scans and
 * removing the installation are refused there until recovery.
 */
export interface InstallationRecoveryStatus {
  installationId: string;
  status: "ready" | "recoveryRequired";
}

/**
 * Whether the engine could read its saved state file (ADR 0006). One that
 * exists but can't be read may hold recovery information, so the engine
 * keeps it as it is: addon changes are paused in every installation and
 * nothing is saved (settings and installations included) until the player
 * repairs or restores it and restarts. The installation list is empty then,
 * so this is the only place the block shows; `reason` and `nextStep` word it.
 */
export type StateFileRecoveryStatus =
  | { status: "readable" }
  | { status: "unreadable"; reason: string; nextStep: string };

/**
 * What a recovery-required installation's recovery is about, pre-digested
 * for display (see `installations.recoveryDetails`). Locations are
 * AddOns-relative display text ("AddOns/Suite"), never paths to act on.
 */
export interface InstallationRecoveryDetails {
  installationId: string;
  installationName: string;
  status: InstallationRecoveryStatus["status"];
  /** One entry per addon operation whose undo stopped; empty when ready. */
  operations: RecoveryOperationDetails[];
  /**
   * Whether Retry recovery (`installations.retryRecovery`) can be offered:
   * every stopped operation left recovery information this build can read.
   * When it can't, `reason` says why and `nextStep` what to do instead.
   * Offered still runs every check again and may refuse.
   */
  retry: RecoveryActionAvailability;
  /**
   * Whether Verify recovery (`installations.verifyRecovery`) can be
   * offered, on the same terms: it needs readable recovery information to
   * know what the original arrangement was. Offered still checks every
   * byte and may refuse.
   */
  verify: RecoveryActionAvailability;
}

/** Whether a recovery action can be offered; when not, why and what to do instead. */
export type RecoveryActionAvailability = { available: true } | { available: false; reason: string; nextStep: string };

/**
 * What Retry recovery did. "recovered": the original files and records are
 * back and the installation's addons can change again (`cleanupWarning`
 * when temporary files are left). "refused": nothing was overwritten,
 * deleted or recreated, the installation stays recovery required, and
 * `reason`, `nextStep` and `conflicts` explain what is in the way.
 * `restored` names the addons put back either way (one refused operation
 * doesn't undo another that finished).
 */
export type RecoveryRetryResult =
  | { installationId: string; status: "recovered"; restored: string[]; cleanupWarning?: string }
  | {
      installationId: string;
      status: "refused";
      restored: string[];
      reason: string;
      nextStep: string;
      conflicts: { location: string; reason: string }[];
    };

/**
 * What Verify recovery found. "verified": the original folders are back
 * exactly as they were (every byte, and nothing where nothing was), the
 * original record is saved and the installation's addons can change again
 * (`cleanupWarning` when temporary files are left). "refused": nothing was
 * changed and the installation stays recovery required; `conflicts` lists
 * what still differs from the original. `verified` names the addons whose
 * repair was confirmed either way.
 */
export type RecoveryVerifyResult =
  | { installationId: string; status: "verified"; verified: string[]; cleanupWarning?: string }
  | {
      installationId: string;
      status: "refused";
      verified: string[];
      reason: string;
      nextStep: string;
      conflicts: { location: string; reason: string }[];
    };

/** The addon operations an addon transaction commits (ADR 0006). */
export const ADDON_OPERATIONS = ["install", "update", "remove", "rollback"] as const;
export type AddonOperationKind = (typeof ADDON_OPERATIONS)[number];

export interface RecoveryOperationDetails {
  transactionId: string;
  /** The addon's name from its original record, else its id. */
  addonName: string;
  /** The version the original record had; null for a new install or none known. */
  originalVersion: string | null;
  /** "unknown" when the recovery information can't be read. */
  operation: AddonOperationKind | "unknown";
  /** When the operation began (epoch ms); null when not recorded. */
  startedAt: number | null;
  /** Where the original files are kept now, and where each belongs. */
  preserved: { location: string; belongsAt: string }[];
  /** What stands in the way of putting the original arrangement back. */
  conflicts: { location: string; reason: string }[];
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
  /**
   * The list marks it a library, installed only as another addon's required
   * dependency (the export's own `dependency` key); imported as one (WF-21).
   */
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
  /** What Install will do with the installed addons (the card's button). */
  match: ArchiveMatch;
}

/**
 * What installing a picked archive does to the installation's records
 * (`ArchivePreview.match`), by the match rule a direct link's install
 * follows too: an archive that installs any folder exactly one record owns
 * goes into that record.
 *
 * - "new": no record owns any of its folders; Install adds one.
 * - "update": it goes into that record in place (id, flags and name kept,
 *   the files on disk kept as its previous version); the card says
 *   "Updates <name>".
 * - "reinstall": the same archive is already installed as that record.
 * - "takeover": an "update" of a record from a catalogue provider
 *   (CurseForge, Wago, …; `providerId`). Install switches its source to
 *   the file or link, so it stops getting update checks from there; the
 *   card warns before Install. A record from another file or link is a
 *   plain "update".
 * - "conflict": two or more records own its folders (`records`, each with
 *   the folders it shares with the archive, sorted). Install is refused,
 *   here and on a direct install call, since merging records is
 *   guesswork; the card offers Remove on each, and with one left the
 *   archive is an "update" of it.
 *
 * A discriminated union so later kinds can join without changing these.
 */
export type ArchiveMatch =
  | { kind: "new" }
  | { kind: "update"; addonId: string; name: string }
  | { kind: "reinstall"; addonId: string; name: string }
  | { kind: "takeover"; addonId: string; name: string; providerId: string }
  | { kind: "conflict"; records: ArchiveConflict[] };

/** One record an archive conflicts with (ArchiveMatch "conflict"). */
export interface ArchiveConflict {
  addonId: string;
  name: string;
  /** The record's folders the archive also installs, sorted. */
  folders: string[];
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

/**
 * Another WoW version a Settings copy can bring settings from (wtf.copySources).
 * Ordered related first, then newest settings first.
 */
export interface WtfCopySource {
  /** Flavor key (`_classic_beta_`, …), as recorded in its backups and named back to wtf.copy. */
  flavor: string;
  /** The client's display name (Forever Beta, Retail PTR …), never the folder name. A version this build can't name isn't listed. */
  displayName: string;
  installed: boolean;
  /** An installation of this version, when installed. */
  installationId: string | null;
  /** In the same version family as the target installation (the engine alone decides). */
  related: boolean;
  /**
   * This version's current settings (its WTF folder), copyable as "Current settings". Null when it isn't
   * installed or has no WTF folder yet.
   */
  current: {
    /** Last time the settings changed: Config.wtf's mtime (WoW rewrites it on every logout), else the folder's (ms). */
    modifiedAt: number;
    hasConfig: boolean;
  } | null;
  /** This version's backups, newest first, as in wtf.list. */
  backups: WtfBackupInfo[];
  /** The source the copy dialog opens on: the related version with the newest settings, else the newest of any kind. */
  isDefault: boolean;
}

export type WtfJobKind = "create" | "restore" | "copy";
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

export interface TradeSkillMasterAccount {
  account: string | null;
  followedCount: number;
  allowance: number | null;
  follows: { realmId: number; name: string; region: string; gameVersion: string; auctionHouseType: string }[];
}
export interface TradeSkillMasterDestination {
  tier: "free" | "gold" | "platinum";
  followedCount: number;
  allowance: number | null;
  realms: { id: number; name: string; auctionHouseType: string; followed: boolean; owned: boolean; declined: boolean; updated: number | null }[];
  regions: { id: number; name: string; updated: number | null }[];
}
export interface TradeSkillMasterAuthStatus {
  state: "off" | "signingIn" | "signedIn" | "signedOut";
  tier?: "free" | "gold" | "platinum";
  channels?: string[];
  account: string | null;
}

export interface MethodMap {
  /** Local removal and optional account cleanup have independent outcomes. */
  "tradeskillmaster.cleanupPreview": { params: { installationId: string }; result: TradeSkillMasterAccount["follows"] };
  "tradeskillmaster.removeAddons": { params: { installationId: string; cleanupFollows?: boolean; cleanupPreview?: TradeSkillMasterAccount["follows"] }; result: { operations: OperationResult[]; cleanup?: { removed: TradeSkillMasterAccount["follows"]; leftBehind: TradeSkillMasterAccount["follows"]; error?: string } } };
  "tradeskillmaster.account": { params: Record<string, never>; result: TradeSkillMasterAccount };
  "tradeskillmaster.unfollow": { params: { realmId: number; auctionHouseType: string }; result: TradeSkillMasterAccount };
  "tradeskillmaster.refresh": { params: { installationId?: string }; result: void };
  "tradeskillmaster.wake": { params: Record<string, never>; result: void };
  "tradeskillmaster.setFollow": { params: { installationId?: string; realmId: number; auctionHouseType: string; followed: boolean }; result: TradeSkillMasterDestination };
  "tradeskillmaster.destination": { params: { installationId?: string }; result: TradeSkillMasterDestination };
  "tradeskillmaster.status": { params: Record<string, never>; result: TradeSkillMasterAuthStatus };
  "tradeskillmaster.signIn": { params: Record<string, never>; result: { authorizeUrl: string } };
  "tradeskillmaster.cancel": { params: Record<string, never>; result: TradeSkillMasterAuthStatus };
  "tradeskillmaster.signOut": { params: Record<string, never>; result: TradeSkillMasterAuthStatus };
  "system.getStatus": {
    params: Record<string, never>;
    result: {
      backendVersion: string;
      protocolVersion: number;
      pid: number;
      /**
       * The engine's HOME: the home folder of the user Decky runs Steam for
       * (main.py sets it from DECKY_USER_HOME). File pickers start here.
       */
      homeDir: string;
    };
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
     * "available" carries the `offer`; whether it is installable says
     * whether the release has the WoWDeck.zip system.updateStage downloads.
     * On a test build (X.Y.Z-test.N) the channel's newest build is always
     * offered (`leaveTest`, older or not), so a test build's owner has the
     * way back to a published channel; a genuinely newer build still offers
     * as `update`.
     *
     * A PR build (X.Y.Z-pr.N or X.Y.Z-pr.N.K) is on its PR channel
     * (GLOSSARY: PR channel) from the moment it first runs until the owner
     * picks Stable or Beta (system.setUpdateChannel). The PR channel's
     * source is the PR builds list, asked under the same daily cadence,
     * failure backoff and once-per-version toast as Stable and Beta: a
     * newer listed build of the same PR offers as `prUpdate`, and a listed
     * PR with nothing newer answers "current". While the PR is not listed,
     * the stored channel's newest build offers as `prClosed` or `prUnlisted`.
     * A PR build that left its PR channel is on no channel, like a test build.
     */
    params: {
      /**
       * A toast trigger (plugin load, wake from suspend): only such a call
       * may report — and so spend — the version's once-only toast. Options
       * and staging leave it unset; they show the update panel instead.
       */
      notify?: boolean;
      /**
       * Check again (GLOSSARY): ask GitHub at once, past the daily interval
       * and any failure backoff. Its answer is stored and clears the
       * backoff like any success, so the daily cadence restarts; a failure
       * counts toward the backoff like any other.
       */
      force?: boolean;
    };
    result: {
      status: "current" | "available" | "unknown";
      currentVersion: string;
      /**
       * The update channel this answer served (GLOSSARY: Update channel,
       * PR channel), so the channel modal can check its row and the panel
       * can say "Up to date with PR #N". Null on no channel: a test build,
       * or a PR build whose owner left its PR channel.
       */
      channel: ServedChannel | null;
      /**
       * The one release on offer, ready to render: the toast, the update
       * panel, its dot and the Options → Updates row all read it, so they
       * cannot disagree. Non-null exactly on "available".
       */
      offer: PluginUpdateOffer | null;
      /**
       * True when a network attempt just ran (a failed one still serves the
       * stored answer); false when the interval or a failure-backoff window
       * served it without one. No surface keys on it: it makes the cadence
       * observable over the RPC.
       */
      checked: boolean;
      /**
       * True when this call's network attempt failed, so the answer is the
       * stored one (or "unknown"): Check again says "Couldn't check for
       * updates" instead of reporting a stale answer as fresh.
       */
      failed: boolean;
      /**
       * Whether the update toast should fire now: computed engine-side,
       * true only for a `notify` call's first answer whose `offer` is
       * installable *and* not already toast-shown. At-most-once
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
  "about.get": {
    /**
     * Options › About's data (GLOSSARY: Funding link, Supporter). Local
     * only: it never asks the network, so opening About is instant. The
     * fetched files behind it refresh only when the WoWDeck update check
     * asks GitHub (ADR-0005).
     */
    params: Record<string, never>;
    result: AboutInfo;
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
     * not be asked. The channel is stored even then. On a PR build this
     * leaves the PR channel (GLOSSARY: PR channel) for the picked one.
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
     *
     * The download reports its bytes as `system.downloadProgress` events
     * (total from Content-Length). system.cancelDownload aborts it: the
     * partial file is deleted, nothing is staged, and `error.code` is
     * "cancelled". A failure partway is "download_failed".
     * A `prUpdate` offer stages through system.installPrBuild's path: the
     * PR builds list is read again, the build must still be the offered
     * version ("not_listed" otherwise), and its zip must match the
     * published sha256.
     */
    params: Record<string, never>;
    result: {
      result: { artifact: string; version: string; sha256: string } | null;
      error: { code: string; message: string } | null;
    };
  };
  "system.listPrBuilds": {
    /**
     * The PR builds published right now (GLOSSARY: PR build), newest PR
     * first, read from the list CI publishes on GitHub Pages beside the
     * zips (ADR 0010). Asked only when the PR builds modal opens: one
     * network call per call, no cache, no polling, no toast. Entries that
     * do not match the published shape are left out. `builds` is null —
     * never an RPC error — when the list could not be fetched or is not a
     * list at all (offline, Pages down, garbage), so the modal can say it
     * couldn't load and offer a retry; an empty array is "no PR builds
     * right now".
     */
    params: Record<string, never>;
    result: { builds: PrBuild[] | null };
  };
  "system.installPrBuild": {
    /**
     * Stage the PR build the owner confirmed (GLOSSARY: PR build) for
     * Decky's own installer, like system.updateStage: read the list again
     * (the zip's URL and sha256 never come from the caller), download the
     * PR's WoWDeck.zip from Pages without any token, refuse it unless its
     * sha256 matches the published one, verify the package (WoWDeck at
     * exactly `version`), and leave it as a 0600 file in the OS temp dir.
     * The caller hands the returned file:// artifact, version and sha256
     * to utilities/install_plugin, whose native prompt confirms the
     * install. The stored Stable or Beta choice is never touched; the
     * installed build joins its PR channel when it first runs. Nothing is
     * staged on any failure, and `error.code` says which:
     * "list_unavailable" (the list couldn't load), "not_listed" (the PR
     * left the list, or was rebuilt since the owner confirmed `version`),
     * "download_failed", "checksum_mismatch", "archive_invalid" or
     * "cancelled" (system.cancelDownload). The download reports its bytes
     * as `system.downloadProgress` events, the total from the list's
     * `zipSize`.
     */
    params: {
      /** The PR's number. */
      number: number;
      /** The build's version the owner confirmed (X.Y.Z-pr.N or X.Y.Z-pr.N.K). */
      version: string;
    };
    result: MethodMap["system.updateStage"]["result"];
  };
  "system.cancelDownload": {
    /**
     * Cancel the WoWDeck download in flight (system.updateStage or
     * system.installPrBuild): its partial file is deleted, nothing is
     * staged, and that call answers with `error.code` "cancelled".
     * `cancelled` is false, and nothing happens, when no download is in
     * flight (it already finished, or never started).
     */
    params: Record<string, never>;
    result: { cancelled: boolean };
  };
  "installations.list": {
    params: Record<string, never>;
    result: { installations: Installation[] };
  };
  "installations.detect": {
    params: Record<string, never>;
    result: { installations: Installation[] };
  };
  "installations.update": {
    params: { installationId: string } & InstallationPreferences;
    result: { installation: Installation };
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
    result: { found: FoundInstallation[] };
  };
  "installations.remove": {
    params: { installationId: string };
    result: { installationId: string };
  };
  /**
   * Every installation's recovery status (read-only; allowed in a recovery
   * required installation). Refused calls answer error code
   * "recovery_required" or an operation with `recoveryRequired`.
   */
  "installations.recoveryStatus": {
    params: Record<string, never>;
    result: { installations: InstallationRecoveryStatus[]; stateFile: StateFileRecoveryStatus };
  };
  /**
   * One installation's recovery details: the preserved locations and the
   * conflicts found now (read-only, never repairs; allowed in a recovery
   * required installation). Unknown installation: "not_found".
   */
  "installations.recoveryDetails": {
    params: { installationId: string };
    result: InstallationRecoveryDetails;
  };
  /**
   * Retry recovery, on the player's request only: in the engine's addon
   * change queue, check the recorded evidence again and, when it shows the
   * files are exactly as the stopped operation left them, put the original
   * folders and record back, then lift the block. Refusals are a result,
   * never an error. Unknown installation: "not_found".
   */
  "installations.retryRecovery": {
    params: { installationId: string };
    result: RecoveryRetryResult;
  };
  /**
   * Verify recovery, on the player's request only, after they put the
   * original files back by hand: in the engine's addon change queue, check
   * that every place the stopped operation touched holds exactly what it
   * held before (and that what wasn't there isn't), then save the original
   * record and only then lift the block. Never changes files or the
   * recorded evidence; refusals are a result, never an error. Unknown
   * installation: "not_found".
   */
  "installations.verifyRecovery": {
    params: { installationId: string };
    result: RecoveryVerifyResult;
  };
  /**
   * The active installation's addons. In a recovery-required installation
   * this is read-only: the stored addon records as they are, without
   * scanning folders or reconciling anything, and `unverified` is set (the
   * files may not match them). Unmanaged folders are not listed then.
   */
  "addons.list": {
    params: { installationId?: string };
    result: { addons: Addon[]; unverified?: true };
  };
  "addons.refresh": {
    params: { installationId?: string };
    result: { addons: Addon[]; updated: number; failed: number };
  };
  "addons.search": {
    /** providerId: one source with `ProviderInfo.catalogSearch`; any other answers no results. */
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
    result: Settled<SearchResult>;
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
    result: Settled<ArchivePreview>;
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
    params: { providerId: string; externalId: string; channel?: ReleaseChannel; installationId?: string };
    result: AddonOperation;
  };
  /**
   * Put the kept previous version back (BEYOND-02); the current one becomes
   * the kept one, so this can be undone. Status "installed". Auto-update
   * leaves the release rolled back from alone.
   */
  "addons.rollback": {
    params: { addonId: string };
    result: AddonOperation;
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
    result: AddonOperation;
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
    /**
     * `removeLibraries`: also remove the libraries this removal leaves
     * unneeded (the engine's own reckoning, as `Addon.leavesUnneeded`
     * lists them), each in its own transaction, reported in `followUps`.
     * Off, they stay installed, still libraries. No other library is ever
     * removed.
     */
    params: { addonId: string; removeLibraries: boolean };
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
    result: AddonOperation;
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
    result: AddonOperation;
  };
  "addons.setIgnored": {
    params: { addonId: string; ignored: boolean };
    result: { addon: Addon };
  };
  "addons.update": {
    params: { addonId: string };
    result: AddonOperation;
  };
  /** Install the addon's current release again (repair). Status "installed" on success. */
  "addons.reinstall": {
    params: { addonId: string };
    result: AddonOperation;
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
    params: { refresh?: boolean; manual?: boolean };
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
      /** Keep this device's Config.wtf (graphics/display settings). Default false: the backup's own is restored. */
      keepCurrentConfig?: boolean;
    };
    result: { jobId: string };
  };
  "wtf.copySources": {
    /** Other versions with something to copy; empty when there is none (or the backup folder is unavailable). */
    params: { installationId?: string };
    result: {
      dirAvailable: boolean;
      /**
       * Whether WoW is running. One state for every version: the process scan can't tell installations
       * apart, so WoW running blocks every copy, whichever version it is.
       */
      gameRunning: GameRunning;
      sources: WtfCopySource[];
    };
  };
  "wtf.copy": {
    /**
     * Settings copy: restore another version's backup into this installation (a job, see wtf.restore,
     * with the same safety backup, verification and swap). Plain wtf.restore keeps refusing other versions.
     * With `sourceInstallationId` instead it copies that installation's current settings: one job first backs
     * up its WTF into its own list (kept, as the record of what was copied), then restores it.
     * Refused with game_running while WoW runs at all, the source's WoW included.
     */
    params: {
      installationId?: string;
      /** Flavor key of the version the settings belong to (WtfCopySource.flavor). */
      sourceFlavor: string;
      /**
       * Keep this device's Config.wtf (graphics/display settings). Default true when sourceFlavor is another
       * version (its Config.wtf describes another client); false when it is this installation's own, as for wtf.restore.
       */
      keepCurrentConfig?: boolean;
    } & (
      | {
          /** A backup of that version. */
          fileName: string;
          /** Required to copy a backup that doesn't record its game version (desktop WowUp), as for wtf.restore. */
          acceptUnknownFlavor?: boolean;
        }
      | {
          /** Copy the current settings of this installation of that version (WtfCopySource.installationId). */
          sourceInstallationId: string;
        }
    );
    result: { jobId: string };
  };
  "wtf.delete": {
    params: { installationId?: string; fileName: string };
    result: { fileName: string };
  };
  "wtf.import": {
    /**
     * Add a backup zip from anywhere (copied into a backup folder after validation). A zip that records
     * another flavor goes into that flavor's folder, never this one's: it is then a Settings copy source.
     * Zips that record no flavor (desktop WowUp) go into this flavor's folder.
     */
    params: { installationId?: string; path: string };
    result: {
      fileName: string;
      alreadyPresent: boolean;
      /** The other version the zip was filed under; null when it went into this installation's list. */
      otherVersion: { flavor: string; displayName: string } | null;
    };
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
     * `updateToastEnabled` — most calls return `toast: null`
     * immediately without doing any provider/network work at all. When
     * it does run, it refreshes every known installation (not just the
     * selected one) via the normal update-check pipeline. `toast` comes
     * worded (UpdateToastText): the frontend shows it as is.
     */
    params: Record<string, never>;
    result: { toast: { title: string; body: string } | null };
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
  /**
   * The PR whose PR channel the owner is on (GLOSSARY: PR channel): set
   * when a PR build first runs, cleared when the owner picks Stable or
   * Beta or a build that is no PR build runs. Engine-written only; it
   * counts only while the running build is that PR's build.
   */
  pluginUpdatePrChannel: number | null;
  /**
   * Move to Stable after release (GLOSSARY: Update channel; default off):
   * when a stable release our updater staged first runs while Beta is
   * selected, select Stable instead of keeping Beta. Set through
   * settings.set from the channel modal, shown there only while Beta is
   * selected. Off leaves Beta selected, as before the toggle existed.
   */
  pluginMoveToStableAfterRelease: boolean;
  /** Last engine-start version; engine-written only. Null before the first start. */
  pluginUpdateLastRunVersion: string | null;
  /** Last successfully verified updater package; engine-written only. */
  pluginUpdateStagedVersion: string | null;
  /** User-chosen folder for WTF backups (e.g. on an SD card); null = the plugin's own data folder. */
  wtfBackupDir: string | null;
  /** How many automatic pre-restore safety backups to keep per game version (1-10). */
  wtfKeepSnapshots: number;
  /**
   * The Steam library entry (usually a non-Steam shortcut) that launches WoW,
   * picked in Options (BEYOND-05). Its game page shows the addon-updates
   * section. Null leaves only automatic links, when enabled.
   */
  steamGame: { appId: number; name: string } | null;
  /** Attach discovered WoW entries to their Steam game pages and home tiles. Does not enable automatic updates. */
  steamAutoLink: boolean;
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

export interface TradeSkillMasterDiagnostics {
  enabled: boolean;
  signedIn: boolean;
  tier: "free" | "gold" | "platinum" | null;
  connected: boolean;
  lastPush: number | null;
  followedCount: number;
}

export interface Diagnostics {
  tradeSkillMaster?: TradeSkillMasterDiagnostics;
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

/**
 * Everything Options › About shows, in one answer (about.get). The
 * frontend decides which About rows appear from it (src/about.ts).
 */
export interface AboutInfo {
  /**
   * THIRD_PARTY_NOTICES.md from the installed plugin, as Markdown the
   * project wrote (rendered with the frontend's Markdown renderer). Null
   * when the file can't be read (a development run without a plugin dir,
   * a damaged install); the Third-party notices row still shows.
   */
  notices: string | null;
  /**
   * The Funding links (GLOSSARY), in FUNDING.yml's order. From
   * .github/FUNDING.yml on `next` (ADR-0005), the last copy fetched or else
   * the snapshot in the zip. Every url is `https://` or, for a Bitcoin
   * link, `bitcoin:<address>`; every name is plain text the engine picked,
   * and the engine caps the count. Empty hides the Support WoWDeck row.
   */
  funding: FundingLink[];
  /**
   * The Supporters (GLOSSARY) to credit, in display order (alphabetical),
   * as plain text: never Markdown or HTML. From SUPPORTERS.md on `next`
   * (ADR-0005), the last copy fetched or else the snapshot in the zip. The
   * engine caps the count and each name's length. Empty hides the row.
   */
  supporters: string[];
}

/** One way to fund WoWDeck (GLOSSARY: Funding link), shown as a QR code. */
export interface FundingLink {
  /**
   * `web`: a page A opens in Steam's browser. `bitcoin`: an address for a
   * wallet app to scan, with nothing to open.
   */
  kind: "web" | "bitcoin";
  /** The platform's display name ("Ko-fi", "PayPal", "Bitcoin"), else the link's bare hostname. */
  name: string;
  /**
   * `web`: an `https://` URL. `bitcoin`: `bitcoin:<address>` with no
   * parameters, the address's checksum verified.
   */
  url: string;
}

// ---------------------------------------------------------------------------
// Events emitted by the engine
// ---------------------------------------------------------------------------

/**
 * The WoWDeck update channels the owner can pick (GLOSSARY: Update
 * channel). The PR channel is not one of them: a PR build joins it by
 * running, never by a pick (ServedChannel).
 */
export const UPDATE_CHANNELS = ["stable", "beta"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * One PR build (GLOSSARY: PR build) as the PR builds modal lists it: a
 * build of an open pull request a maintainer labeled `pr-build`, published
 * by CI beside the list the engine reads (ADR 0010). Every field comes
 * from that list, which is untrusted data: `title` is the PR title as its
 * author wrote it and is shown as plain text only.
 */
export interface PrBuild {
  /** The pull request number. */
  number: number;
  /** The PR title, as written; never rendered as markup. */
  title: string;
  /** The PR author's GitHub login. */
  author: string;
  /** X.Y.Z-pr.N or X.Y.Z-pr.N.K (the Kth build of the PR). */
  version: string;
  /** The 40-hex commit the build was made from. */
  headSha: string;
  /** When CI built it, ISO 8601 UTC. */
  builtAt: string;
  /** The zip's size in bytes. */
  zipSize: number;
}

/**
 * The update channel an answer served (system.updateCheck's `channel`):
 * Stable or Beta, or the PR channel of the running PR build (GLOSSARY: PR
 * channel) with its PR's number and title. `title` is the PR builds list's
 * untrusted text, shown as plain text only; null until the list has named
 * the PR.
 */
export type ServedChannel =
  | { kind: UpdateChannel }
  | { kind: "pr"; number: number; title: string | null };

/**
 * Where the PR channel's PR stood when its answer was stored
 * (PluginUpdateSnapshot.pr): still on the PR builds list, merged, closed
 * without merging, or open but unlisted (its label was removed).
 */
export type PrChannelState = "listed" | "merged" | "closed" | "unlisted";

/** The PR channel's part of a stored answer (PluginUpdateSnapshot.pr). */
export interface PrChannelSnapshot {
  /** The pull request's number. */
  number: number;
  /** The PR's title from the list; null when the list never named it. */
  title: string | null;
  state: PrChannelState;
}

/** The kinds a PR channel offer can take (PluginUpdateOffer.kind). */
export const PR_CHANNEL_OFFER_KINDS = ["prUpdate", "prMergedBeta", "prMergedBuilding", "prClosed", "prUnlisted"] as const;

/**
 * A WoWDeck release offered by system.updateCheck, with its text decided
 * engine-side. "update" offers a newer build; "switchToStable" offers the
 * latest stable, older than the running beta, to an owner who left Beta;
 * "leaveTest" offers the channel's newest build, older or not, to an owner
 * running a test build (X.Y.Z-test.N, or a PR build off its PR channel),
 * the way out of a test build. The PR
 * channel's kinds (PR_CHANNEL_OFFER_KINDS): "prUpdate" offers a newer
 * listed build of the running PR build's own PR. "prMergedBeta" offers
 * the beta containing its merge as an update, even below the running
 * version; "prMergedBuilding" is informational and never installable.
 * `prClosed` and `prUnlisted` offer the stored channel's newest build,
 * older or not, keeping the PR channel.
 */
export interface PluginUpdateOffer {
  kind: "update" | "switchToStable" | "leaveTest" | (typeof PR_CHANNEL_OFFER_KINDS)[number];
  /** X.Y.Z, X.Y.Z-beta.N or (on the PR channel) X.Y.Z-pr.N.K, without a leading v. */
  version: string;
  /** The toast's and the update panel's line: "WoWDeck X available" or "Switch to stable X". */
  headline: string;
  /** The panel's button: "Update" or "Switch to stable X". */
  buttonLabel: string;
  /** The toast's second line, saying where to go: "Update in Options" or "Install it in Options". */
  toastBody: string;
  /** The Options → Updates row's label: "WoWDeck update available" or "Switch to stable X". */
  rowLabel: string;
  /**
   * The release notes as plain text (ADR-0004: trusted CHANGELOG text, so
   * the engine strips the Markdown); still shown as a text node, never
   * HTML. Null when the release has none.
   */
  releaseNotes: string | null;
  /** The release page; the releases page when GitHub named none. */
  releaseUrl: string;
  /**
   * The release has its WoWDeck.zip, so Update can install it. Without it
   * the Updates row still names the release, but there is no panel, dot or
   * toast (the engine re-asks hourly until the zip is attached).
   */
  installable: boolean;
}

/** The last completed WoWDeck release check, as persisted (see PluginSettings.lastPluginUpdate). */
export interface PluginUpdateSnapshot {
  /** Epoch ms of the check that produced this answer. */
  checkedAt: number;
  /** The update channel that answered; absent in answers stored before channels, which were Stable's. */
  channel?: UpdateChannel;
  /** The offered build's version (X.Y.Z or X.Y.Z-beta.N), without a leading v. */
  latestVersion: string;
  /** Running PR version whose merge was confirmed in this Beta answer. */
  mergedFromPr?: string;
  /** The release page to point the user at. */
  releaseUrl: string | null;
  /** The release's WoWDeck.zip asset, when the release published one. */
  downloadUrl: string | null;
  /** The release notes (the GitHub release body, Markdown); absent when it has none. */
  releaseNotes?: string;
  /**
   * Set exactly when the PR channel answered (GLOSSARY: PR channel): its
   * PR and where it stood. A listed PR's latestVersion is its listed
   * build; otherwise the fields above are the stored channel's newest
   * build. Such an answer serves only that PR's channel.
   */
  pr?: PrChannelSnapshot;
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
  "operation.completed": { result: OperationResult };
  "operation.failed": { result: OperationResult };
  "tradeskillmaster.changed": Record<string, never>;
  "addons.changed": { addonIds: string[] };
  "wtf.progress": { job: WtfJobSnapshot };
  /**
   * Bytes of the WoWDeck download in flight (system.updateStage,
   * system.installPrBuild), in order: one at the start (received 0), at
   * most one per percent while it runs, and one when the last byte lands.
   * `total` is null when the size isn't known.
   */
  "system.downloadProgress": { version: string; received: number; total: number | null };
  "wtf.completed": {
    jobId: string;
    kind: WtfJobKind;
    installationId: string;
    /** create: the new backup; restore/copy: the backup that was restored (for current settings, the source's new backup). */
    fileName: string | null;
    /** restore/copy: the automatic safety backup of the settings that were replaced. */
    snapshotFileName: string | null;
    /** copy only: the display name of the version the settings came from. */
    sourceName: string | null;
    error: { code: string; message: string } | null;
  };
}

export type EventName = keyof EventMap & string;
