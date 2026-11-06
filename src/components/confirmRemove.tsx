import { ConfirmModal, showModal } from "@decky/ui";
import { useEffect, type ComponentProps } from "react";
import { holdBrowseSessionForModal } from "../browseSessionState";
import { removeConfirmation, removeInstallationConfirmation } from "../removeConfirm";

function RemoveConfirmModal({
  releaseHold,
  ...props
}: ComponentProps<typeof ConfirmModal> & { releaseHold?: () => void }) {
  useEffect(() => releaseHold, []);
  return <ConfirmModal {...props} />;
}

/**
 * Destructive-action confirmation for Remove (guide U-1). ConfirmModal
 * closes itself after OK/Cancel, and B cancels. Opening it unmounts the
 * panel (guide G4); the removal runs through the module-scope addon
 * session, which reads the list again when it ends, so the remounted
 * panel does not show a stale list. Opened from Get Addons (Manual
 * Install's conflict card), `holdBrowseSession` keeps the browse session
 * open while the modal hides the QAM (PC-09), so the panel comes back in
 * Manual Install with focus where it was.
 */
export function confirmRemoveAddon(
  name: string,
  managed: boolean,
  onOK: () => void,
  alsoRemoves: string[] = [],
  { holdBrowseSession = false }: { holdBrowseSession?: boolean } = {},
): void {
  const text = removeConfirmation(name, managed, alsoRemoves);
  showModal(
    <RemoveConfirmModal
      releaseHold={holdBrowseSession ? holdBrowseSessionForModal() : undefined}
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
