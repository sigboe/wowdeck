import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  showModal,
} from "@decky/ui";
import { FaSync, FaTrash } from "react-icons/fa";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import type { Installation } from "../types";
import { addonCountText, gameFolder, homePath, splitGameVersion } from "../installationDetails";

interface Actions {
  onRescan: () => void;
  onRemove: () => void;
  /** Recovery required (#107): the engine refuses both, so they're off. */
  recoveryRequired?: boolean;
}

const RECOVERY_OFF = "Not available until this installation's recovery is done";

/**
 * The Installation details dialog: read-only facts about the selected
 * installation (game version, build, client type, how it was added, folder,
 * addon counts) plus the two actions that used to live in Settings' rows
 * (rescan and remove). Built from Steam's dialog components like
 * RestoreBackupModal, so spacing and focus colours are Steam's; B closes.
 */
export function InstallationDetailsModal({
  installation,
  counts,
  actions,
  closeModal,
}: {
  installation: Installation;
  counts: { installed: number; managed: number };
  actions: Actions;
  closeModal?: () => void;
}) {
  const close = () => closeModal?.();
  const { version, build } = splitGameVersion(installation.version);
  const gameTypeDescription = (
    <span style={descriptionStyle}>
      {installation.clientFullName
        ? `${installation.clientFullName} · ${gameFolder(installation.path)}`
        : gameFolder(installation.path)}
    </span>
  );
  return (
    <ModalRoot onCancel={close} closeModal={close} bAllowFullSize>
      <DialogHeader>{installation.displayName}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        {/* Read-only rows are focusable so the D-pad scrolls to every one (F4). */}
        <ScrollBuffer>
          <DialogControlsSection>
            <Field focusable label="Game version">
              {version ?? "Unknown"}
            </Field>
            {build !== null && (
              <Field focusable label="Build">
                {build}
              </Field>
            )}
            <Field focusable label="Game type" description={gameTypeDescription}>
              {installation.clientName ?? "Unknown"}
            </Field>
            <Field focusable label="Added">
              {installation.source === "manual" ? "Added manually" : "Detected automatically"}
            </Field>
            <Field focusable label="Game folder" childrenLayout="below">
              {homePath(installation.path)}
            </Field>
            <Field focusable label="Addons">
              {addonCountText(counts.installed, counts.managed)}
            </Field>
            <Field
              focusable
              label="Rescan addons"
              disabled={actions.recoveryRequired}
              description={
                <span style={descriptionStyle}>
                  {actions.recoveryRequired
                    ? RECOVERY_OFF
                    : "Finds addons added or changed outside WoWDeck Addon Manager"}
                </span>
              }
              onClick={() => {
                if (actions.recoveryRequired) {
                  return;
                }
                close();
                actions.onRescan();
              }}
            >
              <FaSync />
            </Field>
            <Field
              focusable
              label={
                <span style={{ color: actions.recoveryRequired ? undefined : STEAM.danger }}>
                  Remove this installation…
                </span>
              }
              disabled={actions.recoveryRequired}
              description={
                <span style={descriptionStyle}>
                  {actions.recoveryRequired
                    ? RECOVERY_OFF
                    : "Your game and addon files won't be deleted"}
                </span>
              }
              onClick={() => {
                if (actions.recoveryRequired) {
                  return;
                }
                close();
                actions.onRemove();
              }}
            >
              <FaTrash />
            </Field>
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={close}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openInstallationDetails(
  installation: Installation,
  counts: { installed: number; managed: number },
  actions: Actions,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <InstallationDetailsModal
      installation={installation}
      counts={counts}
      actions={actions}
      closeModal={close}
    />,
    window,
    {
      strTitle: installation.displayName,
      bHideMainWindowForPopouts: false,
    },
  );
}
