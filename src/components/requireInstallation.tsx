import { ConfirmModal, showModal } from "@decky/ui";
import { useEffect, type ComponentProps } from "react";
import { addonSession } from "../session";
import { holdBrowseSessionForModal } from "../browseSessionState";

function InstallationRequiredModal({
  releaseHold,
  ...props
}: ComponentProps<typeof ConfirmModal> & { releaseHold: () => void }) {
  useEffect(() => releaseHold, []);
  return <ConfirmModal {...props} />;
}

export function requireInstallation(onFind: () => void): boolean {
  if (addonSession.get().installations.length > 0) {
    return true;
  }
  showModal(
    <InstallationRequiredModal
      releaseHold={holdBrowseSessionForModal()}
      strTitle="No WoW installation yet"
      strDescription="Addons need a WoW installation to install into. Find yours first, or add its folder in Options."
      strOKButtonText="Find WoW installations"
      strCancelButtonText="Cancel"
      onOK={onFind}
    />,
    window,
    { bHideMainWindowForPopouts: false },
  );
  return false;
}
