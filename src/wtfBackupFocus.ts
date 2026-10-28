import type { WtfListResult } from "./types";

/** Focus-memory keys of the Manage backups action rows. */
export type BackupActionKey = "backUp" | "import" | "copy";

/** Which Manage backups actions are on (null list: still loading). */
export function backupActions(list: WtfListResult | null, anyJob: boolean) {
  return {
    canBackUp: !anyJob && !!list?.wtfExists && !!list?.dirAvailable,
    canImport: !anyJob && !!list?.dirAvailable,
  };
}

/**
 * The action row to focus once the backup list has loaded, or null to leave
 * focus to Steam. The action rows render unfocusable while the list loads, so
 * with no backup rows to land on, focus starts nowhere and Steam doesn't move
 * it when they turn focusable (#12).
 */
export function loadedBackupFocus(list: WtfListResult, anyJob: boolean): BackupActionKey | null {
  if (list.dirAvailable && list.backups.length > 0) {
    return null;
  }
  const { canBackUp, canImport } = backupActions(list, anyJob);
  return canBackUp ? "backUp" : canImport ? "import" : null;
}
