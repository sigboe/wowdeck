/**
 * Wording and defaults for the settings-backup UI: dialogs, rows and progress
 * text. Outcome lines, notices and toasts live in `wtfOutcome.ts` instead.
 */

import type { GameRunning, WtfBackupInfo, WtfCopySource, WtfJobSnapshot } from "./types";
import { formatBytes, formatWhen } from "./text";

/**
 * Where a backup came from, for a green/red line: green = made by this plugin install on this
 * device, red = another computer (another install, or desktop WowUp). Null for a damaged backup.
 */
export function backupOrigin(
  info: Pick<WtfBackupInfo, "fromThisDevice" | "flavor" | "valid">,
): { text: string; good: boolean } | null {
  if (!info.valid) {
    return null;
  }
  if (info.fromThisDevice) {
    return { text: "From this device", good: true };
  }
  return {
    text: info.flavor === null ? "From another computer (WowUp)" : "From another computer",
    good: false,
  };
}

/** Short badge text for a backup row. */
export function backupKindLabel(info: Pick<WtfBackupInfo, "kind" | "flavor" | "valid">): string {
  if (!info.valid) {
    return "Damaged";
  }
  switch (info.kind) {
    case "pre-restore":
      return "Safety backup";
    case "auto":
      return "Automatic";
    case "manual":
      return info.flavor === null ? "From WowUp" : "Manual";
    default:
      return "Other";
  }
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
 * What the Restore dialog restores (or copies) from: a backup's metadata, or a version's current
 * settings (currentSettingsSource). Only the fields the dialog and its helpers read; no file name or size.
 */
export type RestoreSource = Pick<
  WtfBackupInfo,
  | "createdAt"
  | "flavor"
  | "hasConfig"
  | "fromThisDevice"
  | "keepConfigSuggested"
  | "valid"
  | "invalidReason"
>;

/** A version's current settings as the Restore dialog's source (made on this device, dated by their last change). */
export function currentSettingsSource(
  source: Pick<WtfCopySource, "flavor" | "current">,
): RestoreSource {
  return {
    createdAt: source.current?.modifiedAt ?? 0,
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
