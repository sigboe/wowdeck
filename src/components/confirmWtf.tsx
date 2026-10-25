import { ConfirmModal, showModal } from "@decky/ui";
import type { GameRunning, WtfBackupInfo } from "../types";
import { deleteConfirmation } from "../wtfText";
import {
  openRestoreBackupModal,
  type RestoreChoice,
  type RestoreDialogExtras,
} from "./RestoreBackupModal";

/**
 * Confirmations for the two destructive WTF actions (guide A8). Opening a
 * modal unmounts the plugin panel (G4); the WTF job state lives in module
 * scope (wtfBackupState.ts), so nothing is lost.
 */
/** Restore confirmation: our own dialog, because it carries the per-restore Config.wtf choice. */
export function confirmRestoreBackup(
  backup: WtfBackupInfo,
  installationName: string,
  gameRunning: GameRunning,
  onOK: (options: RestoreChoice) => void,
  extras?: RestoreDialogExtras,
): void {
  openRestoreBackupModal(backup, installationName, gameRunning, onOK, extras);
}

export function confirmDeleteBackup(backup: WtfBackupInfo, onOK: () => void): void {
  const text = deleteConfirmation(backup, Date.now());
  showModal(
    <ConfirmModal
      strTitle={text.title}
      strDescription={text.description}
      strOKButtonText={text.okText}
      strCancelButtonText="Cancel"
      bDestructiveWarning
      onOK={onOK}
    />,
    window,
    { bHideMainWindowForPopouts: false },
  );
}
