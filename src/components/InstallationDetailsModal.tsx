import { RowGlyph } from "./RowGlyph";
import { useState } from "react";
import { toastError } from "../toast";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ToggleField,
  ModalRoot,
  showModal,
} from "@decky/ui";
import { FaSync, FaTrash } from "react-icons/fa";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import type { Installation, InstallationPreferences } from "../../backend/src/api/contracts";
import { addonCountText, gameFolder, homePath, splitGameVersion } from "../installationDetails";

interface Actions {
  onUpdate: (changes: InstallationPreferences) => Promise<Installation>;
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
  installation: initialInstallation,
  counts,
  actions,
  closeModal,
}: {
  installation: Installation;
  counts: { installed: number; managed: number };
  actions: Actions;
  closeModal?: () => void;
}) {
  const [installation, setInstallation] = useState(initialInstallation);
  const [saving, setSaving] = useState(false);
  const update = async (changes: InstallationPreferences) => {
    setSaving(true);
    try {
      setInstallation(await actions.onUpdate(changes));
    } catch (e) {
      toastError("Couldn't change installation", e);
    } finally {
      setSaving(false);
    }
  };
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
            <ToggleField
              label="Auto updates"
              checked={!installation.hidden && installation.autoUpdateEnabled}
              disabled={saving || installation.hidden}
              description={
                installation.hidden
                  ? "Hidden installations never update automatically. Unhide this installation to change Auto updates."
                  : installation.autoUpdateEnabled
                    ? "Updates automatically when 'Update automatically' is on in Options › Updates."
                    : "Never updates or checks automatically, even when 'Update automatically' is on in Options. Rescan checks it by hand."
              }
              onChange={(autoUpdateEnabled) => void update({ autoUpdateEnabled })}
            />
            <ToggleField
              label="Hide"
              checked={installation.hidden}
              disabled={saving}
              description="Hide from My Addons and Get Addons pickers. Hidden installations never update automatically."
              onChange={(hidden) => void update({ hidden })}
            />
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
              <RowGlyph>
                <FaSync />
              </RowGlyph>
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
              <RowGlyph>
                <FaTrash />
              </RowGlyph>
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
