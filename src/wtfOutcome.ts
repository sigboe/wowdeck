/**
 * Outcomes of settings-backup calls and jobs: the error text, outcome lines,
 * notices and toasts the lifecycle (ADR 0007) shows when a call answers, a
 * job ends, or its result can no longer be told. Dialog and row wording live
 * in `wtfText.ts` instead.
 */

import { errorText } from "./errors";
import type { WtfCompleted, WtfImportResult } from "./types";

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

export interface WtfOutcome {
  /** The job kind, or the import or delete request whose result is unknown. */
  kind: WtfCompleted["kind"] | "import" | "delete";
  installationId: string;
  /** null: the result is unknown (the engine's answer or completion was lost). */
  ok: boolean | null;
  text: string;
}

/**
 * The line for a job whose result can't be established (ADR 0007): its start
 * answer was lost, or it ended without a completion reaching the UI. Neither
 * success nor failure; the engine keeps no outcome to look up.
 */
export function unknownOutcome(kind: WtfOutcome["kind"], installationId: string): WtfOutcome {
  const what = {
    create: "the backup finished. Check the backup list",
    import: "the import finished. Check the backup list",
    delete: "the backup was deleted. Check the backup list",
    restore: "the restore finished. Check your settings in game",
    copy: "the Settings copy finished. Check your settings in game",
  }[kind];
  return {
    kind,
    installationId,
    ok: null,
    text: `Couldn't tell whether ${what} before trying again.`,
  };
}

/** A cancel whose answer was lost: the job runs on until its result arrives. */
export function unknownCancelOutcome(
  kind: WtfCompleted["kind"],
  installationId: string,
): WtfOutcome {
  return {
    kind,
    installationId,
    ok: null,
    text: "Couldn't tell whether Cancel reached the job. Its result shows here when it ends.",
  };
}

/** A backup folder or retention write whose answer was lost (Options then shows the engine's). */
export const UNKNOWN_SETTINGS_WRITE =
  "Couldn't tell whether that was saved. The settings shown are the ones in use.";

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
