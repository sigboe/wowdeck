import { useSyncExternalStore } from "react";
import {
  ButtonItem,
  DialogBody,
  DialogControlsSection,
  DialogHeader,
  DropdownItem,
  Field,
  ModalRoot,
  showModal,
} from "@decky/ui";
import { FaFolderOpen } from "react-icons/fa";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { settingsStore } from "../settings";
import { useWtfOperation, wtfLifecycle } from "../wtfSession";
import { requestFocus } from "../focusMemory";
import { QAM_VIEW } from "../qamState";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { pickerStartPath } from "../pickerStart";
import { FocusSlot } from "./FocusSlot";

const TITLE = "Backup settings";
/** Focus-memory view of the modal's rows. */
const VIEW = "modal.backupSettings";
/** The Options row that opens this modal, where focus goes back on close. */
export const BACK_UP_ROW = "wtf:backUp";

const KEEP_OPTIONS = [1, 2, 3, 5, 10].map((n) => ({ data: n, label: String(n) }));

/**
 * Options › Settings backup › Back up now's ⋯: the set-once settings of the
 * settings backup (folder, default folder, safety backups to keep). Reads the
 * settings store and the shared backup lifecycle itself (ADR 0007), so the
 * panel teardown behind it (G4) loses nothing and a job that starts while it
 * is open disables its rows at once.
 */
export function BackupSettingsModal({ closeModal }: { closeModal?: () => void }) {
  const op = useWtfOperation();
  // Null until the engine answered: the folder and count rows never show a default.
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const settings = stored.loaded ? stored.settings : null;
  // A job reads the folder and count while it runs; they change only when nothing is pending.
  const settingsFree = op.activity === null;

  // The lifecycle keeps a rejected folder's error, so it outlives the picker.
  const chooseFolder = async () => {
    let picked: { path: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FOLDER,
        pickerStartPath(settings?.wtfBackupDir),
        false,
        true,
      );
    } catch {
      return; // cancelled
    }
    await wtfLifecycle.saveSettings({ wtfBackupDir: picked.path });
  };

  // Use default folder hides itself once saved, and Steam then leaves focus
  // on nothing (#132): hand it to Backup folder, the row above. A save that
  // failed keeps the button, so focus goes back to it. Asked once the save is
  // done (while it runs both rows are disabled), from the settings it left:
  // a save with a lost answer is re-read and may have gone through.
  const resetBackupFolder = async () => {
    await wtfLifecycle.saveSettings({ wtfBackupDir: null });
    const gone = !settingsStore.get().settings.wtfBackupDir;
    requestFocus(VIEW, gone ? "folder" : "defaultFolder");
  };

  const line = (text: string, color: string = STEAM.textMuted) => (
    <div style={{ ...descriptionStyle, color, paddingTop: "8px" }}>{text}</div>
  );

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <DialogControlsSection>
          <FocusSlot view={VIEW} id="folder">
            <Field
              focusable={settingsFree}
              disabled={!settingsFree}
              label="Backup folder"
              description={
                <span style={{ ...descriptionStyle, wordBreak: "break-all" }}>
                  {settings?.wtfBackupDir ?? "Internal storage (default)"}
                </span>
              }
              onClick={() => settingsFree && void chooseFolder()}
              onOKActionDescription="Choose"
            >
              <FaFolderOpen />
            </Field>
          </FocusSlot>
          {op.settingsError && line(op.settingsError, STEAM.danger)}
          {op.settingsUnknown && line(op.settingsUnknown)}
          {settings?.wtfBackupDir && (
            <FocusSlot view={VIEW} id="defaultFolder">
              <ButtonItem
                layout="below"
                disabled={!settingsFree}
                onClick={() => void resetBackupFolder()}
              >
                Use default folder
              </ButtonItem>
            </FocusSlot>
          )}
          {settings && (
            <FocusSlot view={VIEW} id="keep">
              <DropdownItem
                label="Safety backups to keep"
                description="Made automatically before each restore"
                rgOptions={KEEP_OPTIONS}
                selectedOption={settings.wtfKeepSnapshots}
                disabled={!settingsFree}
                onChange={(option) =>
                  void wtfLifecycle.saveSettings({ wtfKeepSnapshots: option.data as number })
                }
              />
            </FocusSlot>
          )}
        </DialogControlsSection>
      </DialogBody>
    </ModalRoot>
  );
}

/**
 * Open Backup settings. Closing it (B or touch) puts focus back on the Back
 * up now row (guide S21), now when Options is still mounted, or once it
 * mounts again.
 */
export function openBackupSettingsModal(): void {
  const close = () => {
    modalResult.Close();
    requestFocus(QAM_VIEW.settings, BACK_UP_ROW);
  };
  const modalResult = showModal(<BackupSettingsModal closeModal={close} />, window, {
    strTitle: TITLE,
    bHideMainWindowForPopouts: false,
  });
}
