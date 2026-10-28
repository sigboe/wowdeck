import { ScrollBuffer } from "./ScrollBuffer";
import { useState } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogButtonPrimary,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import { STEAM } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import type { GameRunning, WtfBackupInfo } from "../types";
import { type CopyFrom, keepCurrentConfigFor, restoreDialogText } from "../wtfText";

export interface RestoreChoice {
  acceptUnknownFlavor: boolean;
  keepCurrentConfig: boolean;
}

export interface RestoreDialogExtras {
  /** Why this backup can't be restored right now; the Restore button is then off. */
  blockedReason: string | null;
  /** Delete the backup (asks for confirmation). For touch and mouse; X does it in the list. */
  onDelete: (() => void) | null;
  /** Settings copy: the version the backup belongs to (adds the copy wording and warning). */
  copyFrom?: CopyFrom;
}

interface Props extends RestoreDialogExtras {
  backup: WtfBackupInfo;
  installationName: string;
  gameRunning: GameRunning;
  onOK: (choice: RestoreChoice) => void;
  closeModal?: () => void;
}

/**
 * The Restore dialog (guides A8, S8-S12): built from Steam's own dialog
 * components (header / body / controls section / footer) with no plugin CSS
 * overrides, so spacing, type and focus colours are Steam's. It is not
 * ConfirmModal because it carries the per-restore choice "keep this device's
 * graphics & display settings" (Config.wtf): off for this device's own backups,
 * on for one from another computer or WowUp or for a Settings copy, disabled for one without it. A copy
 * adds its warning line (red for an unrelated version). A green/red line says whether the
 * backup is from this device or another computer. Footer order follows Steam's
 * own dialogs: the action first, Cancel second, two equal columns. Focus starts
 * on the toggle (the first control), so a stray A press changes nothing; B
 * cancels.
 */
function RestoreBackupModal({
  backup,
  installationName,
  gameRunning,
  onOK,
  closeModal,
  blockedReason,
  onDelete,
  copyFrom,
}: Props) {
  const text = restoreDialogText(backup, installationName, gameRunning, Date.now(), copyFrom);
  const [keepConfig, setKeepConfig] = useState(text.config.defaultOn);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <DialogHeader>{text.title}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogBodyText
            style={{ color: text.origin.good ? STEAM.positive : STEAM.danger, fontWeight: "bold" }}
          >
            {text.origin.text}
          </DialogBodyText>
          {text.paragraphs.map((p) => (
            <DialogBodyText key={p}>{p}</DialogBodyText>
          ))}
          {text.warning && (
            <DialogBodyText
              style={text.warning.danger ? { color: STEAM.danger, fontWeight: "bold" } : undefined}
            >
              {text.warning.text}
            </DialogBodyText>
          )}
          {blockedReason && (
            <DialogBodyText style={{ color: STEAM.warning }}>{blockedReason}</DialogBodyText>
          )}
          <DialogControlsSection>
            <ToggleField
              label={text.config.label}
              description={text.config.help}
              checked={text.config.disabled ? false : keepConfig}
              disabled={text.config.disabled}
              onChange={setKeepConfig}
            />
            {onDelete && (
              // Touch and mouse have no X button; Steam puts a destructive action as
              // its own row rather than a third footer button.
              <Field
                focusable
                label={<span style={{ color: STEAM.danger }}>Delete this backup…</span>}
                description="Removes the backup file. You'll be asked to confirm."
                onClick={() => {
                  closeModal?.();
                  onDelete();
                }}
              />
            )}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
          <DialogButtonPrimary
            disabled={!!blockedReason}
            onClick={() => {
              onOK({
                acceptUnknownFlavor: text.acceptUnknownFlavor,
                keepCurrentConfig: keepCurrentConfigFor(backup, keepConfig),
              });
              closeModal?.();
            }}
          >
            {text.okText}
          </DialogButtonPrimary>
          <DialogButton onClick={closeModal}>Cancel</DialogButton>
        </Focusable>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openRestoreBackupModal(
  backup: WtfBackupInfo,
  installationName: string,
  gameRunning: GameRunning,
  onOK: (choice: RestoreChoice) => void,
  extras: RestoreDialogExtras = { blockedReason: null, onDelete: null },
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <RestoreBackupModal
      backup={backup}
      installationName={installationName}
      gameRunning={gameRunning}
      onOK={onOK}
      closeModal={close}
      blockedReason={extras.blockedReason}
      onDelete={extras.onDelete}
      copyFrom={extras.copyFrom}
    />,
    window,
    {
      strTitle: extras.copyFrom ? "Copy settings" : "Restore backup",
      bHideMainWindowForPopouts: false,
    },
  );
}
