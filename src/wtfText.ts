import { errorText } from "./errors";
import type {
  GameRunning,
  WtfBackupInfo,
  WtfCompleted,
  WtfCopySource,
  WtfImportResult,
  WtfJobSnapshot,
} from "./types";
import { backupOrigin, formatBytes, formatWhen } from "./wtfFormat";

/**
 * Friendly text for the engine's stable WTF error codes. Never shows raw
 * exception text: unknown codes fall back to the engine's own (already
 * sanitized) message, trimmed.
 */
export function friendlyWtfError(code: string | undefined, message?: string): string {
  switch (code) {
    case "wtf_missing":
      return "There's no WTF folder yet. Start WoW and log in once first.";
    case "wtf_too_large":
      return "Your WTF folder has too many files to back up as a single zip.";
    case "backup_dir_unavailable":
      return "The backup folder isn't available. Is the SD card inserted?";
    case "backup_dir_invalid":
      return "That backup folder can't be used.";
    case "insufficient_space":
      return "Not enough free space.";
    case "game_running":
      return "Close World of Warcraft first. It rewrites these files when you log out.";
    case "job_in_progress":
      return "Another backup or restore is already running.";
    case "backup_invalid":
      return "This backup file is damaged or isn't a WoW settings backup.";
    case "flavor_mismatch":
      return "This backup was made for a different WoW version.";
    case "flavor_unknown_needs_confirm":
      return "Confirm that this backup is for this WoW version to continue.";
    case "verify_failed":
      return "The backup didn't pass its integrity check. Your settings weren't changed.";
    case "too_late_to_cancel":
      return "The restore is already switching your settings over and can't be cancelled now.";
    case "cancelled":
      return "Cancelled. Nothing was changed.";
    case "not_found":
      return "That backup no longer exists.";
    case "internal_error":
      return "Something went wrong. Your WoW settings weren't changed.";
    default:
      return message ? errorText(message) : "Something went wrong.";
  }
}

/** The error code carried by a rejected backend call (set by unwrapBackendResult), if any. */
export function errorCodeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

export function friendlyWtfCallError(e: unknown): string {
  return friendlyWtfError(errorCodeOf(e), e instanceof Error ? e.message : String(e));
}

/** 0-100, or null when unknown. */
export function jobPercent(job: Pick<WtfJobSnapshot, "done" | "total">): number | null {
  if (job.total === null || job.total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.floor((job.done / job.total) * 100)));
}

export function jobProgressText(job: WtfJobSnapshot): string {
  const pct = jobPercent(job);
  const suffix = pct === null ? "…" : ` ${pct}%`;
  switch (job.phase) {
    case "scan":
      return job.kind === "create"
        ? "Looking at your settings…"
        : job.kind === "copy"
          ? "Looking at the settings to copy…"
          : "Preparing…";
    case "compress":
      // A copy of current settings backs up the source version first.
      return `${job.kind === "copy" ? "Backing up the settings to copy…" : "Backing up…"}${pct === null ? "" : ` ${pct}%`}`;
    case "snapshot":
      return `Saving a safety backup first…${pct === null ? "" : ` ${pct}%`}`;
    case "extract":
      return `${job.kind === "copy" ? "Copying" : "Restoring"}…${pct === null ? "" : ` ${pct}%`}`;
    case "verify":
      return "Checking the restored files…";
    case "swap":
      return "Switching over…";
    case "cleanup":
      return "Finishing…";
    default:
      return `Working${suffix}`;
  }
}

export interface WtfOutcome {
  kind: WtfCompleted["kind"];
  installationId: string;
  ok: boolean;
  text: string;
}

/** Inline result line for a finished job (guide A6: inline, not a toast). */
export function outcomeOf(c: WtfCompleted): WtfOutcome {
  if (c.error) {
    return {
      kind: c.kind,
      installationId: c.installationId,
      ok: false,
      text: friendlyWtfError(c.error.code, c.error.message),
    };
  }
  if (c.kind === "create") {
    return { kind: c.kind, installationId: c.installationId, ok: true, text: "Backup created." };
  }
  const done =
    c.kind === "copy"
      ? `Settings copied from ${c.sourceName ?? "another version"}.`
      : "Settings restored.";
  return {
    kind: c.kind,
    installationId: c.installationId,
    ok: true,
    text: c.snapshotFileName
      ? `${done} Your previous settings were saved as a safety backup.`
      : done,
  };
}

/**
 * The notification for a finished job (guide A6: the job runs in the background,
 * so the user may be anywhere when it ends). None for a cancel: the user did that.
 */
export function wtfCompletedToast(c: WtfCompleted): { title: string; body: string } | null {
  if (c.error?.code === "cancelled") {
    return null;
  }
  if (c.error) {
    const failed = {
      create: "Couldn't back up settings",
      restore: "Couldn't restore settings",
      copy: "Couldn't copy settings",
    } as const;
    return { title: failed[c.kind], body: friendlyWtfError(c.error.code, c.error.message) };
  }
  if (c.kind === "create") {
    return { title: "Backup created", body: "" };
  }
  return {
    title:
      c.kind === "copy"
        ? `Settings copied from ${c.sourceName ?? "another version"}`
        : "Settings restored",
    body: c.snapshotFileName ? "Your previous settings were saved as a safety backup." : "",
  };
}

export interface RestoreDialogText {
  title: string;
  /** Paragraphs, in order. */
  paragraphs: string[];
  /** Green when made on this device, red when from another computer. */
  origin: { text: string; good: boolean };
  okText: string;
  /** Settings copy only: what may not carry over; red (`danger`) for an unrelated version. */
  warning: { text: string; danger: boolean } | null;
  /** Sent as acceptUnknownFlavor: only for backups that don't record their game version. */
  acceptUnknownFlavor: boolean;
  config: {
    label: string;
    help: string;
    /**
     * Initial toggle value: the engine's keepConfigSuggested. Off for this device's own
     * backups (restore them whole), on for one from another computer or WowUp, whose
     * Config.wtf describes another machine's display (owner, 2026-10-17).
     */
    defaultOn: boolean;
    /** Off and not changeable when the backup has no Config.wtf (nothing to choose). */
    disabled: boolean;
  };
}

type RestoreDialogBackup = Pick<
  WtfBackupInfo,
  "createdAt" | "flavor" | "hasConfig" | "fromThisDevice" | "keepConfigSuggested"
>;

/** A Settings copy's source, for the Restore dialog. */
export interface CopyFrom {
  /** The source version's display name. */
  name: string;
  related: boolean;
  /** Copying its current settings rather than one of its backups. */
  current?: boolean;
}

/** Wording and defaults for the Restore dialog, or for a Settings copy with `copyFrom` (pure so it can be unit-tested). */
export function restoreDialogText(
  backup: RestoreDialogBackup,
  installationName: string,
  gameRunning: GameRunning,
  now: number,
  copyFrom?: CopyFrom,
): RestoreDialogText {
  const when = formatWhen(backup.createdAt, now);
  const what = !copyFrom
    ? `the backup from ${when}`
    : copyFrom.current
      ? `${copyFrom.name}'s current settings`
      : `${copyFrom.name}'s backup from ${when}`;
  const paragraphs = [
    `This replaces your current ${installationName} settings (addon settings, keybinds, macros and UI layout) with ${what}. A safety backup of your current settings is made first, so you can undo this.`,
  ];
  if (copyFrom?.current) {
    paragraphs.push(
      `${copyFrom.name}'s settings are backed up first and kept in its backups, as a record of what was copied. They are only read.`,
    );
  }
  // A desktop WowUp backup asks the same question in another version's list: it may be for any version.
  const unknownFlavor = backup.flavor === null;
  if (unknownFlavor) {
    paragraphs.push(
      `This backup was made by WowUp and doesn't say which WoW version it is for. Only continue if it is for ${copyFrom ? copyFrom.name : "this one"}.`,
    );
  }
  paragraphs.push(
    gameRunning === "unknown"
      ? "Make sure World of Warcraft is closed."
      : "World of Warcraft must be closed.",
  );
  return {
    title: copyFrom ? "Copy settings?" : "Restore backup?",
    paragraphs,
    origin: backupOrigin({ ...backup, valid: true })!,
    okText: !copyFrom ? "Restore" : copyFrom.related ? "Copy" : "Copy anyway",
    warning: !copyFrom
      ? null
      : copyFrom.related
        ? {
            text: "Characters on the old realms won't match, and addons you don't have here keep their settings unused.",
            danger: false,
          }
        : {
            text: `${copyFrom.name} is a different kind of WoW from ${installationName}. Its addon settings, keybinds and macros may not work here.`,
            danger: true,
          },
    acceptUnknownFlavor: unknownFlavor,
    config: {
      label: "Keep this device's graphics & display settings",
      help: backup.hasConfig
        ? "Config.wtf holds resolution, graphics API and window mode, which differ between computers and can change over time. On keeps what this device has now; addon settings, keybinds and macros are restored either way."
        : "This backup has no graphics settings (Config.wtf), so your current ones are kept.",
      // Another version's Config.wtf never describes this installation's client: keep this one by default.
      defaultOn: backup.hasConfig && (backup.keepConfigSuggested || copyFrom !== undefined),
      disabled: !backup.hasConfig,
    },
  };
}

/**
 * Why a backup can't be restored (or copied, for a Settings copy) now, shown in its Restore dialog
 * (null: it can). WoW running blocks a copy whichever version is running: the engine can't tell them apart.
 */
export function restoreBlockedReason(
  backup: Pick<WtfBackupInfo, "valid" | "invalidReason">,
  anyJob: boolean,
  gameRunning: GameRunning,
  action: "restore" | "copy" = "restore",
): string | null {
  if (!backup.valid) {
    const verb = action === "copy" ? "copied" : "restored";
    return `This backup can't be ${verb}${backup.invalidReason ? `: ${backup.invalidReason}` : "."}`;
  }
  if (anyJob) {
    return "Settings are already being backed up, restored or copied. Wait for it to finish.";
  }
  if (gameRunning === "running") {
    return "Close World of Warcraft first.";
  }
  return null;
}

/** A backup row's A label: the action, or Details when its dialog will only say why it can't run. */
export function okActionLabel(blockedReason: string | null, action: string): string {
  return blockedReason ? "Details" : action;
}

/**
 * The copy screen's line while WoW runs. Every copy is blocked then, the source version's WoW included:
 * the engine sees one running state and can't tell which version it is.
 */
export function copyGameRunningNotice(gameRunning: GameRunning): string | null {
  return gameRunning === "running"
    ? "World of Warcraft is running. Close it to copy settings, even when it's the version you copy from."
    : null;
}

/**
 * A version's current settings as a backup-shaped value for the Restore dialog (made on this device,
 * dated by their last change). `fileName` is empty: a current-settings copy names no backup.
 */
export function currentSettingsBackup(
  source: Pick<WtfCopySource, "flavor" | "current">,
): WtfBackupInfo {
  return {
    fileName: "",
    sizeBytes: 0,
    createdAt: source.current?.modifiedAt ?? 0,
    kind: "manual",
    fileCount: null,
    flavor: source.flavor,
    hasConfig: source.current?.hasConfig ?? false,
    fromThisDevice: true,
    keepConfigSuggested: false,
    valid: true,
    invalidReason: null,
  };
}

export type CopySourceRow = { kind: "current" } | { kind: "backup"; backup: WtfBackupInfo };

/** The rows under the Copy from dropdown: Current settings first (installed versions that have them), then backups. */
export function copySourceRows(
  source: Pick<WtfCopySource, "installed" | "current" | "backups">,
): CopySourceRow[] {
  const backups = source.backups.map((backup): CopySourceRow => ({ kind: "backup", backup }));
  return source.installed && source.current ? [{ kind: "current" }, ...backups] : backups;
}

/** The section header over the rows: names the version the settings come from. */
export function copySourceHeader(source: Pick<WtfCopySource, "displayName">): string {
  return `Copying from ${source.displayName}`;
}

/** A row's label. Each one starts with the source version, so the list stays labelled after the header scrolls off. */
export function copySourceRowLabel(
  source: Pick<WtfCopySource, "displayName">,
  row: CopySourceRow,
  now: number,
): string {
  return row.kind === "current"
    ? `${source.displayName} · Current settings`
    : `${source.displayName} · ${formatWhen(row.backup.createdAt, now)} · ${formatBytes(row.backup.sizeBytes)}`;
}

/** The line under the Current settings row: when they last changed (the label already names the version). */
export function currentSettingsDescription(
  current: Pick<WtfBackupInfo, "createdAt">,
  now: number,
): string {
  return `Changed ${formatWhen(current.createdAt, now)}`;
}

/** The line under the Copy from dropdown for the chosen version (null: nothing to say). */
export function copySourceStatus(source: Pick<WtfCopySource, "installed">): string | null {
  return source.installed ? null : "Not installed · backups only";
}

/** A version's entry in the Copy from dropdown. */
export function copySourceOption(source: Pick<WtfCopySource, "displayName" | "installed">): string {
  return source.installed ? source.displayName : `${source.displayName} (not installed)`;
}

/** The value sent as keepCurrentConfig: the toggle, but never when the backup has no Config.wtf. */
export function keepCurrentConfigFor(
  backup: Pick<WtfBackupInfo, "hasConfig">,
  toggle: boolean,
): boolean {
  return backup.hasConfig && toggle;
}

/** What Import from file… says afterwards. Another version's zip is filed under that version: say where, and how to use it here. */
export function importNotice(
  result: Pick<WtfImportResult, "alreadyPresent" | "otherVersion">,
): string {
  const { alreadyPresent, otherVersion } = result;
  if (!otherVersion) {
    return alreadyPresent ? "That backup is already in the list." : "Backup added to the list.";
  }
  const where = `${otherVersion.displayName}'s backups`;
  const next = "To use it here, choose Copy settings from another version.";
  return alreadyPresent
    ? `That backup is already in ${where}. ${next}`
    : `Added to ${where}. ${next}`;
}

export function deleteConfirmation(
  backup: Pick<WtfBackupInfo, "createdAt" | "kind">,
  now: number,
): { title: string; description: string; okText: string } {
  return {
    title: "Delete backup?",
    description: `The ${backup.kind === "pre-restore" ? "safety backup" : "backup"} from ${formatWhen(backup.createdAt, now)} will be deleted. This can't be undone.`,
    okText: "Delete",
  };
}
