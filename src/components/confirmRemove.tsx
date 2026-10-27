import { ConfirmModal, showModal } from "@decky/ui";
import { removeConfirmation, removeInstallationConfirmation } from "../removeConfirm";

/**
 * Destructive-action confirmation for Remove (guide U-1). ConfirmModal
 * closes itself after OK/Cancel, and B cancels. Opening it unmounts the
 * panel (guide G4); the removal runs through the module-scope addon
 * session, which reads the list again when it ends, so the remounted
 * panel does not show a stale list.
 */
export function confirmRemoveAddon(
  name: string,
  managed: boolean,
  onOK: () => void,
  alsoRemoves: string[] = [],
): void {
  const text = removeConfirmation(name, managed, alsoRemoves);
  showModal(
    <ConfirmModal
      strTitle={text.title}
      strDescription={text.description}
      strOKButtonText={text.okText}
      strCancelButtonText="Cancel"
      onOK={onOK}
    />,
    window,
    { bHideMainWindowForPopouts: false },
  );
}

/** Same confirmation for dropping a WoW installation record (Options). */
export function confirmRemoveInstallation(name: string, onOK: () => void): void {
  const text = removeInstallationConfirmation(name);
  showModal(
    <ConfirmModal
      strTitle={text.title}
      strDescription={text.description}
      strOKButtonText={text.okText}
      strCancelButtonText="Cancel"
      onOK={onOK}
    />,
    window,
    { bHideMainWindowForPopouts: false },
  );
}
