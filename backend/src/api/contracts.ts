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

/**
 * An installation a folder holds (installations.inspect). Restoration offers
 * its saved name, and its saved game type when a custom layout has none to detect.
 */
export interface FoundInstallation {
  gameType: GameType;
  displayName: string;
}

/** A Steam library shortcut linked to a discovered installation. */
export interface SteamGameLink {
  appId: number;
  name: string;
}

/**
 * How a linked game got on the list: detection found it, or the player
 * added it. A game both found and added is found.
 */
export type LinkedGameSource = "found" | "added";

/** GLOSSARY: Linked game. */
export interface LinkedGame extends SteamGameLink {
  source: LinkedGameSource;
}

/**
 * Who starts a linked game's Play on this machine, decided once at engine
 * startup. `droiddeck`: DroidDeck's store launcher
 * (`/usr/local/bin/droiddeck-store-launch`, executable, under the engine's
 * system root) replaces Steam's start of every Battle.net game, so WoWDeck
 * leaves Play to it: every `launch.*` method treats every app id as having
 * no launch state, and `launch.select` is refused with
 * "play_left_to_droiddeck". Saved launch targets and Play starts WoW stay
 * as they are. `wowdeck` everywhere else.
 */
export type PlayOwner = "wowdeck" | "droiddeck";

/**
 * The engine's one answer to "which Steam games get WoWDeck's section,
 * badge and Play button" (linkedGames.get, linkedGames.changed).
 */
export type LinkedGames = {
  /**
   * Show in Steam (PluginSettings.steamEnabled). Off: Steam's pages show
   * nothing of WoWDeck and every `launch.*` method treats every app id as
   * unlinked. `games` is kept either way.
   */
  enabled: boolean;
  /** One entry per app id, in app id order. */
  games: LinkedGame[];
  /**
   * The found games the player removed (PluginSettings.steamRemovedGames),
   * in the order removed: the Add a game picker lists them first, marked
   * Removed.
   */
  removed: SteamGameLink[];
  /** Who owns Play on this machine (PlayOwner); the same for every game. */
  playOwner: PlayOwner;
};

/** linkedGames.find's answer. */
export type FoundGames = LinkedGames & {
  /** The linked games this search brought back or found for the first time, in app id order. */
  found: LinkedGame[];
};

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
  /** Short client name, e.g. "Forever Beta" (client table, wow/clients.ts). */
  clientName: string;
  /** WowUp's full client name, e.g. "World of Warcraft: Forever Beta". */
  clientFullName: string;
  /** "manual" when the user added/confirmed this installation, "detected" otherwise. */
  source: InstallationSource;
  /** True when this is the engine's canonical active installation. */
  selected: boolean;
  /** Product version string when discoverable, else null. */
  version: string | null;
  /**
   * Steam shortcuts proven to launch this installation by registry or
   * executable discovery: detection evidence only. Whether a game is linked
   * is `linkedGames.get`'s answer.
   */
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
  /** The signed-in account's label. An email address arrives shortened (`s•••@example.com`); bridge payloads end up in logs. */
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
/**
 * Why the Ledger has nothing to show, or "ready" when it has records:
 * `noAddon`, the addon is not installed and no account's file has records;
 * `noAccount`, the addon is installed but no account has saved a
 * TradeSkillMaster.lua yet; `noRecords`, the shown account's file holds no
 * sales, purchases, income, expenses, expirations, cancellations or gold log
 * points the addon would read. A file holding only headers, or an empty
 * TradeSkillMasterDB, has no records.
 */
export type TradeSkillMasterLedgerState = "noAddon" | "noAccount" | "noRecords" | "ready";
/** The Ledger of one WoW account of an installation (GLOSSARY: Ledger). */
export interface TradeSkillMasterLedger {
  state: TradeSkillMasterLedgerState;
  /** The installation's WoW accounts (`WTF/Account/<name>`) holding a TradeSkillMaster.lua, by name. */
  accounts: string[];
  /**
   * The account shown: the one asked for, else the one written last whose
   * file has records, else the one written last; null without accounts.
   */
  account: string | null;
  /** When the game last wrote the shown account's TradeSkillMaster.lua (it dates the records shown), in ms since the epoch; null without accounts. */
  recordedAt: number | null;
  /** World of Warcraft is running, so this session's trades are not on disk yet. */
  gameRunning: boolean;
  /**
   * The installation is Retail (or its test and beta clients), where the
   * addon records gold rounded to 1,000 gold, so the graph moves in those steps.
   */
  retail: boolean;
  /**
   * The installation's section of Wowhead, for links to its items: "" for
   * Retail (the site root), a path segment such as "classic" or
   * "mop-classic", or null when Wowhead has no section for it (betas, a
   * Classic client of unknown version).
   */
  wowhead: string | null;
  /**
   * The shown account's realms with records, sorted: a row of a realm's
   * record CSVs (`r@<realm>`) or a point of a character's or guild's gold log
   * there. The Realm filter adds All realms.
   */
  realms: string[];
  /** The realm shown; null is All realms (also when the one asked for has no records). */
  realm: string | null;
  /**
   * The Character filter's choices for the realm shown: each character of
   * the records' `player` column and of the gold logs, sorted by label,
   * then the Warband bank and each guild of the realm shown with a gold log,
   * guilds sorted by label. The Warband bank is a choice under every realm
   * whenever the addon saved its log (a game with a Warband bank), even one
   * with no point; picked, it has no gold history.
   */
  characters: TradeSkillMasterLedgerCharacter[];
  /**
   * The choice shown (a `characters` id); null is All characters (also when
   * the one asked for is not a choice). The Warband bank or a guild shows
   * only its gold log, and its trading figures are zero.
   */
  character: string | null;
  period: TradeSkillMasterLedgerPeriod;
  /** Distinct items bought or sold for this selection. */
  itemCount: number;
  /**
   * Export has something to write for the account and realm shown: a row of
   * a record CSV on the realm shown, or on any realm under All realms. Gold
   * logs are no records, so a realm or account with only gold logs has
   * nothing to export.
   */
  exportable: boolean;
  /** The trading figures for the selection (ADR 0018); null unless `state` is ready. */
  figures: TradeSkillMasterLedgerFigures | null;
  /**
   * The selection's gold graph (ADR 0018); null unless `state` is ready, and
   * null when the selection's gold logs hold no point ("No gold history").
   */
  gold: TradeSkillMasterLedgerGold | null;
}
/** The filters shared by the Ledger and its all-items list. */
export interface TradeSkillMasterLedgerParams {
  installationId: string;
  account?: string;
  realm?: string;
  character?: string;
  period?: TradeSkillMasterLedgerPeriod;
}

/**
 * What the Ledger's item list sorts by: `volume` is earned plus spent, the list's usual
 * order; `name` is the name the list shows.
 */
export const TSM_LEDGER_ITEM_SORTS = ["volume", "name", "sold", "earned", "bought", "spent", "net"] as const;
export type TradeSkillMasterLedgerItemSort = (typeof TSM_LEDGER_ITEM_SORTS)[number];

export interface TradeSkillMasterLedgerItemsParams extends TradeSkillMasterLedgerParams {
  /** Keep the opened selection. Missing named filters produce an empty list. */
  exact?: boolean;
  /** Start of the page, from the preceding page's nextOffset. Defaults to zero. */
  offset?: number;
  /**
   * The order of the whole list, applied before paging. Absent: volume.
   * Ties fall back to volume, highest first, then to the item string. A name
   * sort compares names in English collation and puts items without a
   * cached name after the named ones in either direction, by item ID.
   */
  sort?: TradeSkillMasterLedgerItemSort;
  /** Highest (Z) first. Absent: true, except for `name` (A to Z first). */
  descending?: boolean;
}

export interface TradeSkillMasterLedgerItemsPage {
  rows: TradeSkillMasterLedgerItem[];
  /** The next offset in the same ordered selection, or null at the end. */
  nextOffset: number | null;
}

/**
 * What Export writes: the records of one WoW account for one realm, or every
 * realm with records, whatever the Character and Period filters show.
 */
export interface TradeSkillMasterLedgerExportParams {
  installationId: string;
  /** The WoW account (`WTF/Account/<name>`); one without a TradeSkillMaster.lua is an error. */
  account: string;
  /**
   * One realm with a record row (TradeSkillMasterLedger.exportable); absent
   * is every such realm. With none, the export is an invalid request and
   * writes nothing.
   */
  realm?: string;
  /** An existing folder, as Decky's folder picker returned it. */
  folder: string;
}

export interface TradeSkillMasterLedgerItem {
  /** Canonical item string, shortened only if the row would exceed the page budget. */
  itemString: string;
  /** The cached name, or the item string when no name is available. Oversized strings may be shortened for display. */
  name: string;
  /** Items sold and bought: quantities summed over the records, as the Dashboard's daily counts sum them. */
  sold: number;
  bought: number;
  /** Amounts in copper. */
  earned: number;
  spent: number;
  net: number;
  /**
   * WoW's item quality (0 Poor … 8 WoW Token): a battle pet's from its item
   * string, else the addon's current item cache. Null when unknown (no
   * cached quality, or the older cache format, which stores none).
   */
  quality: number | null;
  /**
   * The item's icon: a FileDataID in the game's files, from the addon's
   * current item cache. Null when unknown (no cached item, or the older
   * cache format). Read it with `tradeskillmaster.itemIcons`.
   */
  texture: number | null;
}

export interface TradeSkillMasterItemIconsParams {
  installationId: string;
  /**
   * The WoW account whose Ledger shows the icons (absent: the engine's
   * pick, as for the Ledger). The other icons its item cache records are
   * looked up in the same pass, so later pages read only their files.
   */
  account?: string;
  /** TradeSkillMasterLedgerItem.texture values: at most 64. */
  textures: number[];
  /** The icon's width in device pixels, 1 to 512: the smallest stored size at least this large is read. */
  size: number;
}

export interface TradeSkillMasterItemIcons {
  /**
   * PNG data URLs by texture, decoded from the game's files on each call;
   * nothing is saved on disk. A texture the files lack is left out, as is
   * every texture of an installation without Battle.net's local storage.
   */
  icons: Record<string, string>;
}
/** The Ledger's periods, as the in-game Dashboard offers them; All is the default. */
export const TSM_LEDGER_PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "All"] as const;
export type TradeSkillMasterLedgerPeriod = (typeof TSM_LEDGER_PERIODS)[number];
export interface TradeSkillMasterLedgerCharacter {
  /**
   * `<Name> - <Realm>`: a character is its name within the realm whose
   * records hold it (the records' `player` column carries no realm).
   */
  id: string;
  /** The name, with ` - <Realm>` under All realms when the account has several realms; "Warband bank" for the Warband bank. */
  label: string;
  /**
   * A character, the account-wide Warband bank (id `warbank`) or a guild
   * (id `guild:<Guild> - <Faction> - <Realm>`): the addon logs a guild's
   * gold while one of the player's characters leads it.
   */
  kind: "character" | "warbank" | "guild";
}
/**
 * The selection's gold over time, as the in-game Dashboard's graph and
 * summary show it: the sum of the selected gold logs, each carrying its last
 * balance forward and counting zero before its first point.
 */
export interface TradeSkillMasterLedgerGold {
  /**
   * `[ms since the epoch, copper]`, oldest first, from the period's start
   * (or the first point, whichever is later) to now, sampled as the addon's
   * graph samples a plot of the asked width: a step per 3 px, at most 300
   * steps, keeping every second step and the last (at most about 150 points).
   */
  points: [number, number][];
  /** The highest balance of the last 52 weeks, sampled every 6 hours and now. */
  high: number;
  /** The lowest balance of the last 52 weeks, sampled the same way. */
  low: number;
  /** Now minus 24 hours ago, or minus the first point when that is later. */
  dailyChange: number;
}
/** Earned, spent or profit over the selection, in copper. */
export interface TradeSkillMasterLedgerFlow {
  total: number;
  /** total ÷ the period's days; for All, ÷ the days since the selection's first gold-log point (at least 1). Unrounded. */
  perDay: number;
  /**
   * The item string with the highest total (for profit: the highest earned
   * minus spent, and only when above zero); null without one.
   */
  topItem: string | null;
  /** The local item-cache name for topItem, when known. */
  topItemName?: string;
  /** total minus the previous period's total of the same length; null for All. */
  trend: number | null;
}
/** The Ledger's figures, calculated as the addon's in-game Dashboard does (ADR 0018). */
export interface TradeSkillMasterLedgerFigures {
  /** Sales from every source, Σ price × quantity. Income records never count. */
  earned: TradeSkillMasterLedgerFlow;
  /** Purchases from every source, Σ price × quantity. Expense records never count. */
  spent: TradeSkillMasterLedgerFlow;
  /** earned − spent. */
  profit: TradeSkillMasterLedgerFlow;
  /** Items sold per day (quantity, not records), divided as `perDay`. Unrounded. */
  dailySales: number;
  /** Items bought per day, divided as `perDay`. Unrounded. */
  dailyPurchases: number;
  /** The highest price per item among the sales, in copper; 0 without sales. */
  topSale: number;
  /** The highest price per item among the purchases, in copper; 0 without purchases. */
  topPurchase: number;
}
export interface TradeSkillMasterAuthStatus {
  state: "off" | "signingIn" | "signedIn" | "signedOut";
  tier?: "free" | "gold" | "platinum";
  channels?: string[];
  /** The signed-in account's label. An email address arrives masked (`s•••@example.com`): Decky's debug log records every bridge payload. */
  account: string | null;
}

/** The Battle.net launcher's target id in `launch.select` and in saved choices. */
export const BATTLE_NET_LAUNCH_TARGET = "battlenet";
/** The Battle.net launcher's name in the menu row and on the Play button. */
export const BATTLE_NET_NAME = "Battle.net";
/**
 * The Classic row's target id: one row for Mists of Pandaria Classic,
 * Classic Era and Anniversary, which Battle.net starts with one code.
 */
export const CLASSIC_LAUNCH_TARGET = "classic";

interface LaunchTargetFields {
  /**
   * What `launch.select` takes: BATTLE_NET_LAUNCH_TARGET,
   * CLASSIC_LAUNCH_TARGET, or a Retail or Forever installation id.
   */
  id: string;
  /** The menu row's label: the client's full name, or BATTLE_NET_NAME. */
  name: string;
  /** The Play button's second line: the client's short name, or BATTLE_NET_NAME. */
  shortName: string;
}

/** The Battle.net launcher itself: Steam's own launch, with no launch ask. */
export interface BattleNetLaunchClient extends LaunchTargetFields {
  kind: "battlenet";
  id: typeof BATTLE_NET_LAUNCH_TARGET;
}

/** A WoW row Battle.net can be asked to start: Retail, Classic or Forever. */
export interface WowLaunchClient extends LaunchTargetFields {
  kind: "wow";
}

export type LaunchClient = BattleNetLaunchClient | WowLaunchClient;

export interface LaunchState {
  /**
   * Battle.net first, then a row for each of Retail, Classic and Forever
   * that Battle.net lists as installed in the shortcut's prefix.
   */
  clients: LaunchClient[];
  /** The saved choice for this shortcut; Battle.net when none is saved. */
  target: LaunchClient;
  entryRunning: boolean;
  gameRunning: GameRunning;
  busy: boolean;
}

export type LaunchCompletion = {
  appId: number;
  /**
   * The short name of the client that started (Classic names its version,
   * e.g. "Classic Era"), else the target's.
   */
  clientName: string;
  /**
   * `not-started`: Battle.net took the ask, yet no target client ran in the
   * window; Battle.net stays open for its own Play.
   */
  outcome: "confirmed" | "steam-refused" | "never-ready" | "ask-failed" | "not-started" | "unconfirmed";
};

export interface MethodMap {
  /** Local removal and optional account cleanup have independent outcomes. */
  "tradeskillmaster.cleanupPreview": { params: { installationId: string }; result: TradeSkillMasterAccount["follows"] };
  "tradeskillmaster.removeAddons": { params: { installationId: string; cleanupFollows?: boolean; cleanupPreview?: TradeSkillMasterAccount["follows"] }; result: { operations: OperationResult[]; cleanup?: { removed: TradeSkillMasterAccount["follows"]; leftBehind: TradeSkillMasterAccount["follows"]; error?: string } } };
  "tradeskillmaster.account": { params: Record<string, never>; result: TradeSkillMasterAccount };
  "tradeskillmaster.unfollow": { params: { realmId: number; auctionHouseType: string }; result: TradeSkillMasterAccount };
  "tradeskillmaster.refresh": { params: { installationId: string }; result: void };
  "tradeskillmaster.wake": { params: Record<string, never>; result: void };
  "tradeskillmaster.setFollow": { params: { installationId: string; realmId: number; auctionHouseType: string; followed: boolean }; result: TradeSkillMasterDestination };
  "tradeskillmaster.destination": { params: { installationId: string }; result: TradeSkillMasterDestination };
  /**
   * The Ledger of the installation's WoW account (`account`, or the
   * engine's pick) for a realm and character (absent: All) and a period
   * (absent: All). `plotWidth` is the gold graph's plot width in CSS px:
   * the graph samples it as the addon's graph samples a plot that wide
   * (absent: the addon's limit of 300 steps). Reads WoW files only.
   */
  "tradeskillmaster.ledger": {
    params: TradeSkillMasterLedgerParams & { plotWidth?: number };
    result: TradeSkillMasterLedger;
  };
  /** Items bought or sold for the Ledger selection, highest earned plus spent first. */
  "tradeskillmaster.ledgerItems": {
    params: TradeSkillMasterLedgerItemsParams;
    result: TradeSkillMasterLedgerItemsPage;
  };
  /** The Ledger's item icons, read from the installation's game files. */
  "tradeskillmaster.itemIcons": {
    params: TradeSkillMasterItemIconsParams;
    result: TradeSkillMasterItemIcons;
  };
  /**
   * Export (GLOSSARY: Ledger): the account's records, read fresh, as the
   * ZIP of CSVs TradeSkillMaster's desktop app writes, saved into `folder`
   * as `TSM_<realm or N_Realms>_<date>.zip` (` (n)` added when that name is
   * taken). One `TSM_<realm>_<dataset>_<date>.csv` per realm and dataset
   * (Sales, Buys, Income, Expense, Expired, Cancelled): UTF-8 with a BOM, the
   * stored header and rows with an `itemName` column after `itemString`.
   * Realm names are made safe for file names (`_2`, `_3`, … tell apart
   * realms whose safe names are the same); the date is the UTC day. The ZIP
   * is written to a hidden temporary file beside its final name and
   * published without replacing any file, so a failed export leaves no
   * file; temporary files an interrupted export left go first. On success the engine remembers `folder`
   * (PluginSettings.tsmLedgerExportFolder). WoW files are only read.
   */
  "tradeskillmaster.ledgerExport": {
    params: TradeSkillMasterLedgerExportParams;
    result: { path: string };
  };
  /**
   * Where Export's folder picker starts: the folder the last export went to
   * while it still exists, else `~/Documents`, created when missing (the
   * home folder if it can't be).
   */
  "tradeskillmaster.ledgerExportFolder": {
    params: Record<string, never>;
    result: { folder: string };
  };
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
  /**
   * Saves the shortcut's launch target. It never changes My Addons'
   * active installation. Refused with "play_left_to_droiddeck" while
   * DroidDeck owns Play (PlayOwner).
   */
  "launch.select": {
    params: { appId: number; targetId: string };
    result: { target: LaunchClient };
  };
  "launch.state": {
    params: { appId: number };
    result: { state: LaunchState | null };
  };
  "launch.start": {
    params: { appId: number; canStartSteam?: boolean; steamEntryRunning?: boolean };
    result: { state: LaunchState | null; steamStart?: { gameId: string; attemptId: string } };
  };
  "launch.steamRefused": {
    params: { attemptId: string };
    result: void;
  };
  /**
   * One client's icon for the Play button: a data: URL of a single-image
   * ICO, the smallest image of at least 48 px, or validated SVG
   * (`data:image/svg+xml;base64,`). Null means WoWDeck's glyph
   * (no such client, no icon, or the read failed; a failed read is tried
   * again on the next call). Kept out of `launch.state`, which the page
   * polls every 2 s.
   */
  "launch.icon": {
    params: { appId: number; targetId: string };
    result: { icon: string | null };
  };

  /** The linked games and Show in Steam. */
  "linkedGames.get": {
    params: Record<string, never>;
    result: LinkedGames;
  };
  /**
   * Link a game from Steam's library (app id and name). A removed game
   * comes off the removed list and is found again; a game detection already
   * found stays found; any other game is added. Fails when the state file
   * can't take the change. Fires linkedGames.changed.
   */
  "linkedGames.add": {
    params: SteamGameLink;
    result: LinkedGames;
  };
  /**
   * Unlink any linked game. A found game goes on the removed list
   * (`steamRemovedGames`) and stays unlinked through later automatic scans
   * and restarts; an added game is deleted. Fails when the app id isn't
   * linked or the state file can't take the change. Fires
   * linkedGames.changed.
   */
  "linkedGames.remove": {
    params: { appId: number };
    result: LinkedGames;
  };
  /**
   * Find games: run the startup scan (removed installations stay out),
   * then clear the removed games list, so every found game comes back. Answers with what
   * came back or was found for the first time. Fires linkedGames.changed.
   */
  "linkedGames.find": {
    params: Record<string, never>;
    result: FoundGames;
  };

  "installations.list": {
    params: Record<string, never>;
    result: { installations: Installation[] };
  };
  /**
   * Find WoW installations: detect, bringing back every removed
   * installation found (GLOSSARY: Removed installation). One whose folder
   * isn't found stays removed. `restored` counts those brought back. The
   * engine's startup scan leaves removed installations out.
   */
  "installations.detect": {
    params: Record<string, never>;
    result: { installations: Installation[]; restored: number };
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
   * picked. Offers a removed installation's saved name; a custom layout
   * with WoW markers also offers its saved game type. Empty when nothing is recognised.
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
   * The installation's addons. In a recovery-required installation
   * this is read-only: the stored addon records as they are, without
   * scanning folders or reconciling anything, and `unverified` is set (the
   * files may not match them). Unmanaged folders are not listed then.
   */
  "addons.list": {
    params: { installationId: string };
    result: { addons: Addon[]; unverified?: true };
  };
  "addons.refresh": {
    params: { installationId: string };
    result: { addons: Addon[]; updated: number; failed: number };
  };
  "addons.search": {
    /** providerId: one source with `ProviderInfo.catalogSearch`; any other answers no results. */
    params: { installationId: string; query: string; providerId?: string };
    result: { results: SearchResult[]; providerErrors: ProviderErrors };
  };
  "addons.resolveUrlImport": {
    /**
     * Install from URL — a GitHub/WowInterface URL, GitHub owner/repository
     * shorthand or Nix-style github:owner/repository reference, or an
     * https link to a .zip/.rar/.7z file (provider "Zip").
     */
    params: { installationId: string; url: string };
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
    params: { installationId: string; path: string };
    result: Settled<ArchivePreview>;
  };
  "discover.latest": {
    /** providerId: a source with `ProviderInfo.discovers` (the list's Source menu). */
    params: { installationId: string; providerId: string; index: number; pageSize: number };
    result: { results: SearchResult[]; totalCount: number };
  };
  "discover.popular": {
    /**
     * providerId: as for discover.latest. categoryId: an id from
     * addons.getCategories for that source, or omitted for "All Categories".
     */
    params: { installationId: string; providerId: string; index: number; pageSize: number; categoryId?: string };
    result: { results: SearchResult[]; totalCount: number };
  };
  "addons.getDescription": {
    params: { providerId: string; externalId: string };
    result: { description: string | null };
  };
  "addons.getChangelog": {
    params: { installationId: string; providerId: string; externalId: string };
    result: { changelog: string | null };
  };
  "addons.getCategories": {
    params: { installationId: string; providerId: string };
    /** null means the provider doesn't support category retrieval — distinct from a genuinely empty list. */
    result: { categories: ProviderCategory[] | null };
  };
  "addons.install": {
    /** `channel`: install from that release channel and follow it (providers with channels only). */
    params: { providerId: string; externalId: string; channel?: ReleaseChannel; installationId: string };
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
   * is installed in the installation named. Ids the provider does not
   * return for this game version are left out.
   */
  "addons.lookup": {
    params: { installationId: string; providerId: string; externalIds: string[] };
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
   * An addon's folders in the installation's AddOns (WF-20, the
   * Details Folders page): a managed addon's recorded folders, main folder
   * first, or an unmanaged addon's one folder; `present` false when it is
   * gone from disk. With the file manager addons.showFolders would use.
   */
  "addons.folders": {
    params: { installationId: string; addonId: string };
    result: { addonsPath: string; folders: Array<{ name: string; path: string; present: boolean }>; fileManager: FileManagerState };
  };
  /**
   * Shows the addon's folders (those on disk) in the file manager that is
   * already running (WF-20). `shown` false when none is: nothing is started.
   * `steamAppId` is the Steam app it runs under, to switch to (see
   * FileManagerState).
   */
  "addons.showFolders": {
    params: { installationId: string; addonId: string };
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
    params: { folderName: string; installationId: string };
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
    params: { folderName: string; installationId: string } | { addonId: string };
    result: { results: SearchResult[]; providerErrors: ProviderErrors };
  };
  /**
   * Make an unmanaged folder managed (WF-23): installs the chosen source's
   * release over it. The files there before are kept as the previous version
   * (addons.rollback returns to them). Status "installed", or "failed".
   */
  "addons.adopt": {
    params: { installationId: string; folderName: string; providerId: string; externalId: string };
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
     * and per addon. Otherwise the installation named.
     */
    params: { installationId: string } | { allInstallations: true };
    result: { operations: OperationResult[] };
  };
  "addons.export": {
    /** WowUp-compatible addon-list export, scoped to one installation. */
    params: { installationId: string };
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
    params: { importString: string; installationId: string };
    result: {
      summary: ImportSummary | null;
      /** Set only for a whole-import failure (malformed string, empty list, incompatible client) — per-entry issues show up as "unresolved"/"conflict" rows in `summary` instead. */
      error: { code: string; message: string } | null;
    };
  };
  "addons.importAddonList": {
    /** Installs every "new" row from the same import string's preview, through the normal install pipeline. */
    params: { importString: string; installationId: string };
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
  /**
   * Fails when the state file can't be written: the engine then keeps the
   * settings it had, so an answer always matches what a restart reads.
   */
  "settings.set": {
    params: { settings: Partial<PluginSettings> };
    result: { settings: PluginSettings };
  };
  "wtf.list": {
    params: { installationId: string };
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
    params: { installationId: string };
    result: { jobId: string };
  };
  "wtf.restore": {
    /** Returns at once (see wtf.create). Always takes an automatic "pre-restore" safety backup first. */
    params: {
      installationId: string;
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
    params: { installationId: string };
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
      installationId: string;
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
    params: { installationId: string; fileName: string };
    result: { fileName: string };
  };
  "wtf.import": {
    /**
     * Add a backup zip from anywhere (copied into a backup folder after validation). A zip that records
     * another flavor goes into that flavor's folder, never this one's: it is then a Settings copy source.
     * Zips that record no flavor (desktop WowUp) go into this flavor's folder.
     */
    params: { installationId: string; path: string };
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
  /**
   * Explicit launch target by Steam app ID: a Retail or Forever installation
   * id, CLASSIC_LAUNCH_TARGET or BATTLE_NET_LAUNCH_TARGET. A Mists, Classic
   * Era or Anniversary installation id saved by an earlier picker reads as
   * Classic. Engine-written.
   */
  steamLaunchTargets: Record<string, string>;
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
  /** The folder the last Ledger export went to (tradeskillmaster.ledgerExport); engine-written only. Null before the first export. */
  tsmLedgerExportFolder: string | null;
  /** How many automatic pre-restore safety backups to keep per game version (1-10). */
  wtfKeepSnapshots: number;
  /**
   * Show in Steam (default on): the master switch for everything WoWDeck
   * adds to Steam's pages and for `launch.*`. Off keeps the linked games.
   * Replaces `steamAutoLink` (false there starts this off). Does not enable
   * automatic updates.
   */
  steamEnabled: boolean;
  /**
   * The games the player added (GLOSSARY: Linked game). Engine-written
   * through linkedGames.add and linkedGames.remove, never settings.set.
   * Replaces the hand-made `steamGame` link.
   */
  steamAddedGames: SteamGameLink[];
  /**
   * The found games the player removed: automatic scans leave them
   * unlinked. Engine-written through linkedGames.remove, linkedGames.add
   * (takes one off) and linkedGames.find (clears it), never settings.set.
   * Every scan forgets added and removed games whose app id no longer
   * appears in any Steam user's shortcuts.
   */
  steamRemovedGames: SteamGameLink[];
  /** Check for addon updates in the background when the linked game's page or tile appears (at most every 15 min). */
  steamAutoCheck: boolean;
  /** Badge on the linked game's tile on Steam's home screen; off = a kill switch if a Steam update breaks it. */
  steamBadge: boolean;
  /**
   * WoWDeck's launch target choice on Steam's Play button on the linked game
   * page (#284, ADR 0016); the off switch is #286. Off: Steam's own Play button and "Play from…"
   * menu, and the addons section drops its launch lines. A kill switch if a
   * Steam update breaks the patch. `steamLaunchTargets` is kept while off.
   */
  steamLaunchMenu: boolean;
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

/**
 * How far an Update all run has got (addons.updateAllProgress, #253). Each
 * candidate is an equal share; its turn ends whatever the outcome.
 */
export type UpdateAllProgress = {
  /** Candidates whose turn has ended: updated, current, failed, thrown or skipped. Only goes up. */
  done: number;
  /** Candidates, fixed when the run starts: one count across every installation for allInstallations. */
  total: number;
  /** Turns so far that ended in a failure (failed or thrown); current and skipped ones aren't failures. */
  failed: number;
  /** The candidate now being worked on; null once the last one is done. */
  addonName: string | null;
};

export interface EventMap {
  "launch.completed": LaunchCompletion;
  /** Preferred artwork became available for this target. No image payload. */
  "launch.iconChanged": { appId: number; targetId: string };
  /** The linked games or Show in Steam changed: after a scan, an add, a remove or a switch change. */
  "linkedGames.changed": LinkedGames;
  /** An automatic update ran and updated or failed something (WF-02). */
  "addons.autoUpdated": { result: AutoUpdateResult };
  /**
   * TradeSkillMaster state moved. `account` is the account's follows and
   * allowance when they changed, so viewers take it without reading the
   * TradeSkillMaster API again; it is absent when only auction data moved.
   */
  "tradeskillmaster.changed": { account?: TradeSkillMasterAccount };
  /** Saved Ledger records or the WoW running state changed for the active installation. */
  "tradeskillmaster.ledgerChanged": { installationId: string };
  "addons.changed": { addonIds: string[] };
  /**
   * Update all (addons.updateAll) progress, in order: one when the total is
   * known (done 0, the first candidate), then one as each candidate's turn
   * ends, the last with done equal to total. None when nothing qualifies.
   */
  "addons.updateAllProgress": UpdateAllProgress;
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

/** An engine event as main.py relays it to the frontend. */
export type EngineEvent = { [K in EventName]: { event: K; params: EventMap[K] } }[EventName];

/**
 * Methods main.py answers itself instead of forwarding to the engine. Decky
 * passes their arguments positionally, so each names them in `args`.
 * tools/test_main_bridge.py fails when main.py's Plugin and this map differ.
 */
export interface BridgeMethodMap {
  /** Health probe. Never fails: a dead or missing engine answers `ok: false`. */
  get_status: {
    args: [];
    result:
      | ({ ok: true } & MethodMap["system.getStatus"]["result"])
      | { ok: false; code: string; message: string };
  };
  /** Reads a small text file the user picked (Import Addon List's "Load from file"). */
  read_text_file: {
    args: [path: string];
    result: { ok: boolean; content: string | null; message: string };
  };
  /**
   * Writes `content` as a new file in `directory` (Export Addon List's "Save
   * to file"). Never overwrites: a taken name gets " (n)" before the extension.
   */
  save_text_file: {
    args: [directory: string, filename: string, content: string];
    result: { ok: boolean; path: string | null; message: string };
  };
}

export type BridgeMethodName = keyof BridgeMethodMap & string;

/** Events main.py emits through `decky.emit`, by name. */
export interface BridgeEventMap {
  backend_event: EngineEvent;
}

export type BridgeEventName = keyof BridgeEventMap & string;
