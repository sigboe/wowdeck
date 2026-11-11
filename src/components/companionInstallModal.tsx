import { ConfirmModal, showModal } from "@decky/ui";
import { installCompanion, type CompanionInstallDeps } from "../companionInstall";
import { pluginToast, toastError } from "../toast";

const HUB_OFF = "Turn on WowUp Hub in Addon sources to install it.";

/**
 * A on Updates inside WoW while the active installation lacks WowUp
 * Companion. With WowUp Hub off, the modal only says how to turn it on and
 * offers Close: a source is never turned on for the player. Otherwise it
 * asks, then installs through the normal managed install path; the result
 * arrives as a toast, since the modal has closed by then. Closing either
 * modal remounts the panel (guide G4), and the row's focus memory (S21)
 * brings focus back to it.
 */
export function offerCompanionInstall(
  installation: { id: string; displayName: string },
  deps: CompanionInstallDeps,
): void {
  if (!deps.hubEnabled()) {
    showModal(
      <ConfirmModal
        strTitle="Install WowUp Companion"
        strDescription={HUB_OFF}
        strOKButtonText="Close"
        bAlertDialog
      />,
      window,
      { bHideMainWindowForPopouts: false },
    );
    return;
  }
  showModal(
    <ConfirmModal
      strTitle={`Install WowUp Companion into ${installation.displayName}?`}
      strDescription="It shows WoWDeck's addon updates inside WoW. It installs from WowUp Hub and updates like your other addons."
      strOKButtonText="Install"
      strCancelButtonText="Cancel"
      onOK={() => void install(installation, deps)}
    />,
    window,
    { bHideMainWindowForPopouts: false },
  );
}

async function install(
  installation: { id: string; displayName: string },
  deps: CompanionInstallDeps,
): Promise<void> {
  const result = await installCompanion(deps, installation.id);
  if (result.status === "installed") {
    pluginToast("Installed WowUp Companion", `In ${installation.displayName}`);
  } else if (result.status === "failed") {
    toastError("Couldn't install WowUp Companion", result.error);
  } else {
    pluginToast("WowUp Hub is off", HUB_OFF);
  }
}
