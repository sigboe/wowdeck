import { errorText } from "./errors";
import type { WtfBackupInfo, WtfCompleted, WtfJobSnapshot } from "./types";
import { backupOrigin, formatWhen } from "./wtfFormat";

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
      return job.kind === "restore" ? "Preparing…" : "Looking at your settings…";
    case "compress":
      return `Backing up…${pct === null ? "" : ` ${pct}%`}`;
    case "snapshot":
      return `Saving a safety backup first…${pct === null ? "" : ` ${pct}%`}`;
    case "extract":
      return `Restoring…${pct === null ? "" : ` ${pct}%`}`;
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
  return {
    kind: c.kind,
    installationId: c.installationId,
    ok: true,
    text:
      c.kind === "create"
        ? "Backup created."
        : c.snapshotFileName
          ? "Settings restored. Your previous settings were saved as a safety backup."
          : "Settings restored.",
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
  const backup = c.kind === "create";
  if (c.error) {
    return {
      title: backup ? "Couldn't back up settings" : "Couldn't restore settings",
      body: friendlyWtfError(c.error.code, c.error.message),
    };
  }
  return backup
    ? { title: "Backup created", body: "" }
    : {
        title: "Settings restored",
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

/** Wording and defaults for the Restore dialog (pure so it can be unit-tested). */
export function restoreDialogText(
  backup: RestoreDialogBackup,
  installationName: string,
  gameRunning: "running" | "not_running" | "unknown",
  now: number,
): RestoreDialogText {
  const paragraphs = [
    `This replaces your current ${installationName} settings (addon settings, keybinds, macros and UI layout) with the backup from ${formatWhen(backup.createdAt, now)}. A safety backup of your current settings is made first, so you can undo this.`,
  ];
  if (backup.flavor === null) {
    paragraphs.push(
      "This backup was made by WowUp and doesn't say which WoW version it is for. Only continue if it is for this one.",
    );
  }
  paragraphs.push(
    gameRunning === "unknown"
      ? "Make sure World of Warcraft is closed."
      : "World of Warcraft must be closed.",
  );
  return {
    title: "Restore backup?",
    paragraphs,
    origin: backupOrigin({ ...backup, valid: true })!,
    okText: "Restore",
    acceptUnknownFlavor: backup.flavor === null,
    config: {
      label: "Keep this device's graphics & display settings",
      help: backup.hasConfig
        ? "Config.wtf holds resolution, graphics API and window mode, which differ between computers and can change over time. On keeps what this device has now; addon settings, keybinds and macros are restored either way."
        : "This backup has no graphics settings (Config.wtf), so your current ones are kept.",
      defaultOn: backup.hasConfig && backup.keepConfigSuggested,
      disabled: !backup.hasConfig,
    },
  };
}

/** The value sent as keepCurrentConfig: the toggle, but never when the backup has no Config.wtf. */
export function keepCurrentConfigFor(
  backup: Pick<WtfBackupInfo, "hasConfig">,
  toggle: boolean,
): boolean {
  return backup.hasConfig && toggle;
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
