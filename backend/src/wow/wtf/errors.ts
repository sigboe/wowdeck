/**
 * WTF backup domain errors (project-owned).
 *
 * `code` is a stable wire code (see errorCodeFor in bridge/jsonl.ts); the
 * frontend maps it to friendly text, so keep codes stable and messages
 * short, plain-language and free of file names found *inside* WTF
 * (character/realm names are personal data — never put them in errors).
 */

export type WtfErrorCode =
  | "wtf_missing"
  | "wtf_too_large"
  | "backup_dir_unavailable"
  | "backup_dir_invalid"
  | "insufficient_space"
  | "game_running"
  | "job_in_progress"
  | "backup_invalid"
  | "flavor_mismatch"
  | "flavor_unknown_needs_confirm"
  | "verify_failed"
  | "too_late_to_cancel"
  | "cancelled"
  | "not_found";

export class WtfBackupError extends Error {
  constructor(
    public code: WtfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WtfBackupError";
  }
}
