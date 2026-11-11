import { useSyncExternalStore } from "react";
import {
  DialogButton,
  DialogFooter,
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
import { useBackupList, useWtfOperation, wtfLifecycle } from "../wtfSession";
import { requestFocus } from "../focusMemory";
import { QAM_VIEW } from "../qamState";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { pickerStartPath } from "../pickerStart";
import type { Installation } from "../types";
import { jobPercent, jobProgressText } from "../wtfText";
import { QamProgressBar } from "./QamProgressBar";
import { ScrollBuffer } from "./ScrollBuffer";
import { FocusSlot } from "./FocusSlot";

const TITLE = "WoW Settings Backup";
/** Focus-memory view of the modal's rows. */
const VIEW = "modal.backupSettings";
/** The Options row that opens this modal, where focus goes back on close. */
export const BACK_UP_ROW = "wtf:backUp";

const KEEP_OPTIONS = [1, 2, 3, 5, 10].map((n) => ({ data: n, label: String(n) }));

/**
 * Options › WoW Settings Backup: creation and settings of the
 * settings backup (folder, default folder, safety backups to keep). Reads the
 * settings store and the shared backup lifecycle itself (ADR 0007), so the
 * panel teardown behind it (G4) loses nothing and a job that starts while it
 * is open disables its rows at once.
 */
export function BackupSettingsModal({
  installation,
  closeModal,
}: {
  installation: Installation | null;
  closeModal?: () => void;
}) {
  const op = useWtfOperation();
  const { data: list, error, loading, refresh } = useBackupList(installation?.id ?? null);
  const job = op.job?.installationId === installation?.id ? op.job : null;
  const outcome = op.outcome?.installationId === installation?.id ? op.outcome : null;
  const canBackUp =
    !!installation && op.activity === null && !!list?.wtfExists && !!list?.dirAvailable;
  const status = !installation
    ? "Select a WoW installation first."
    : loading
      ? "Loading…"
      : !list?.dirAvailable
        ? "Backup folder not available. Is the SD card inserted?"
        : !list.wtfExists
          ? "No WTF folder yet. Start WoW and log in once."
          : installation.displayName;
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
    <Field focusable label={<span style={{ color }}>{text}</span>} />
  );

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <Field
              focusable
              label="Back up now"
              description={status}
              disabled={!job && !canBackUp}
              onClick={() =>
                job
                  ? void wtfLifecycle.cancel()
                  : canBackUp && installation && void wtfLifecycle.create(installation.id)
              }
              onOKActionDescription={job ? "Cancel backup" : "Back up"}
            >
              {job ? "Cancel" : "Back up"}
            </Field>
            {error && (
              <Field
                focusable
                label="Couldn't load backups"
                description={error}
                onClick={() => void refresh()}
                onOKActionDescription="Retry"
              />
            )}
            {list?.gameRunning === "running" && (
              <Field
                focusable
                label="WoW is running"
                description="Log out or reload WoW before backing up to include this session's changes."
              />
            )}
            {job && (
              <Field focusable label="Backup progress" childrenLayout="below">
                <QamProgressBar
                  indeterminate={jobPercent(job) === null}
                  nProgress={jobPercent(job) ?? undefined}
                  sOperationText={jobProgressText(job)}
                />
              </Field>
            )}
            {outcome && <Field focusable label={outcome.text} />}
            {installation && op.errors[installation.id] && (
              <Field focusable label="Backup failed" description={op.errors[installation.id]} />
            )}
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
                <Field
                  focusable={settingsFree}
                  label="Use default folder"
                  disabled={!settingsFree}
                  onClick={() => settingsFree && void resetBackupFolder()}
                />
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
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * Open WoW Settings Backup. Closing it (B or touch) puts focus back on its
 * Options row (guide S21), now when Options is still mounted, or once it
 * mounts again.
 */
export function openBackupSettingsModal(installation: Installation | null): void {
  const close = () => {
    modalResult.Close();
    requestFocus(QAM_VIEW.settings, BACK_UP_ROW);
  };
  const modalResult = showModal(
    <BackupSettingsModal installation={installation} closeModal={close} />,
    window,
    {
      strTitle: TITLE,
      bHideMainWindowForPopouts: false,
    },
  );
}
