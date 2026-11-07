import { ScrollBuffer } from "./ScrollBuffer";
import { useEffect, useRef } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogHeader,
  Field,
  ModalRoot,
  Spinner,
  showModal,
} from "@decky/ui";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { FaChevronRight } from "react-icons/fa";
import { wowupModalStyleCss } from "../sharedStyles";
import { requestFocus } from "../focusMemory";
import { STEAM, descriptionStyle, outcomeColor } from "../steamTheme";
import type { Installation, WtfBackupInfo } from "../types";
import { useBackupList, useCopySources, useWtfOperation, wtfLifecycle } from "../wtfSession";
import { type BackupActionKey, backupActions, loadedBackupFocus } from "../wtfBackupFocus";
import { formatBytes, formatWhen } from "../wtfFormat";
import { jobProgressText, okActionLabel, restoreBlockedReason } from "../wtfText";
import { confirmDeleteBackup, confirmRestoreBackup } from "./confirmWtf";
import { BackupRowDescription } from "./BackupRowDescription";
import { focusTarget } from "./FocusSlot";
import { openWtfCopyModal } from "./WtfCopyModal";
import { pickerStartPath } from "../pickerStart";

/** Focus-memory view of the modal's action rows. */
const VIEW = "modal.wtfBackups";
const actionFocus = (key: BackupActionKey) => focusTarget(VIEW, key);

interface ModalProps {
  installation: Installation;
  closeModal?: () => void;
}

/**
 * Manage WTF backups: list, restore, delete, and watch a running job.
 *
 * A modal, not a QAM section (guide P9): a variable-length list doesn't
 * belong in a 300 px column, and the modal owns its own state so the panel
 * teardown every modal causes (G4) can't lose anything — the job state
 * itself lives in module scope (wtfLifecycle.ts).
 */
function WtfBackupModal({ installation, closeModal }: ModalProps) {
  const op = useWtfOperation();
  const { data: list, error, loading, refresh: reload } = useBackupList(installation.id);
  const sources = useCopySources(installation.id).data?.sources ?? null;
  // Kept by the lifecycle for this installation, so they survive the picker and other modals.
  const actionError = op.errors[installation.id] ?? null;
  const notice = op.notices[installation.id] ?? null;

  const jobHere = op.job && op.job.installationId === installation.id ? op.job : null;
  const jobElsewhere = op.job && !jobHere;
  // The slot is global: a job starting or running anywhere blocks these actions.
  const anyJob = op.activity !== null;
  const outcome = op.outcome && op.outcome.installationId === installation.id ? op.outcome : null;
  const gameRunning = list?.gameRunning ?? "unknown";
  const now = Date.now();
  const focusChosen = useRef(false);

  // Once, when the list first arrives (loadedBackupFocus says why); later
  // polls and job changes leave focus alone, hence `list` as the only dep.
  useEffect(() => {
    if (!list || focusChosen.current) {
      return;
    }
    focusChosen.current = true;
    const key = loadedBackupFocus(list, anyJob);
    if (key) {
      requestFocus(VIEW, key);
    }
  }, [list]);

  const startCreate = () => void wtfLifecycle.create(installation.id);

  const startRestore = (backup: WtfBackupInfo, blockedReason: string | null) => {
    const onDelete = anyJob ? null : () => startDelete(backup);
    confirmRestoreBackup(
      backup,
      installation.displayName,
      gameRunning,
      (options) => {
        // The guard is checked again here: a job may have started while the dialog was open.
        void wtfLifecycle.restore(installation.id, {
          fileName: backup.fileName,
          acceptUnknownFlavor: options.acceptUnknownFlavor,
          keepCurrentConfig: options.keepCurrentConfig,
        });
      },
      { blockedReason, onDelete },
    );
  };

  const startDelete = (backup: WtfBackupInfo) => {
    // Checked by the lifecycle again on OK: something may have started meanwhile.
    confirmDeleteBackup(
      backup,
      () => void wtfLifecycle.deleteBackup(installation.id, backup.fileName),
    );
  };

  const importFromFile = async () => {
    let picked: { path: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FILE,
        pickerStartPath(),
        true,
        true,
        undefined,
        ["zip"],
        false,
        false,
      );
    } catch {
      return; // cancelled
    }
    // The guard is checked now, not when the picker opened: a job may have started meanwhile.
    await wtfLifecycle.importBackup(installation.id, picked.path);
  };

  const cancelJob = () => void wtfLifecycle.cancel();

  const { canBackUp, canImport } = backupActions(list, anyJob);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <DialogHeader>Settings backups: {installation.displayName}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogBodyText>
            WTF is the folder where WoW keeps your addon settings, keybinds, macros and UI layout.
            Restoring replaces it; a safety backup of your current settings is made first.
          </DialogBodyText>

          {gameRunning === "running" && (
            <DialogBodyText style={{ color: STEAM.warning }}>
              WoW is running. It saves addon settings when you log out or reload, so a backup made
              now won&apos;t include this session&apos;s changes, and you can&apos;t restore until
              it is closed.
            </DialogBodyText>
          )}
          {jobHere && (
            <DialogBodyText style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Spinner style={{ width: "1.2em" }} />
              <span style={{ flex: 1 }}>{jobProgressText(jobHere)}</span>
            </DialogBodyText>
          )}
          {jobElsewhere && (
            <DialogBodyText style={{ color: STEAM.textMuted }}>
              A backup or restore is running for another installation.
            </DialogBodyText>
          )}
          {outcome && (
            <DialogBodyText style={{ color: outcomeColor(outcome.ok) }}>
              {outcome.text}
            </DialogBodyText>
          )}
          {notice && <DialogBodyText style={{ color: STEAM.positive }}>{notice}</DialogBodyText>}
          {actionError && (
            <DialogBodyText style={{ color: STEAM.danger }}>{actionError}</DialogBodyText>
          )}

          <DialogControlsSection>
            <Field
              label="Back up now"
              description={
                list && !list.wtfExists
                  ? "There's no WTF folder yet. Start WoW and log in once first."
                  : "Save a copy of your settings"
              }
              disabled={!canBackUp}
              focusable={canBackUp}
              onClick={startCreate}
              {...actionFocus("backUp")}
            />
            {jobHere && (
              <Field label="Cancel" description="Stop the backup" focusable onClick={cancelJob} />
            )}
            <Field
              label="Import from file…"
              description="Add a backup zip made on this or another computer"
              disabled={!canImport}
              focusable={canImport}
              onClick={importFromFile}
              {...actionFocus("import")}
            />
            {/* Hidden, never disabled, when no other version has anything to copy (#12's focus trap). */}
            {list?.dirAvailable && sources && sources.length > 0 && (
              <Field
                label="Copy settings from another version…"
                description="Bring over another WoW version's addon settings, keybinds and layout"
                focusable
                onClick={() => openWtfCopyModal(installation)}
                {...actionFocus("copy")}
              >
                <FaChevronRight />
              </Field>
            )}
          </DialogControlsSection>

          <DialogControlsSection>
            <DialogControlsSectionHeader>
              Backups{list && list.dirAvailable ? ` (${list.backups.length})` : ""}
            </DialogControlsSectionHeader>
            {/* Where they are and how much space, above the list, not after it (S22). */}
            {list?.dirAvailable && list.backups.length > 0 && (
              <DialogBodyText style={{ ...descriptionStyle, wordBreak: "break-all" }}>
                {formatBytes(list.totalBackupBytes)} in {list.backupDir}
              </DialogBodyText>
            )}

            {loading && !list && <Spinner style={{ width: "1.2em" }} />}
            {error && (
              <Field
                label="Retry"
                description={<span style={{ color: STEAM.danger }}>{error}</span>}
                focusable
                onClick={() => void reload()}
              />
            )}
            {list && !list.dirAvailable && (
              <DialogBodyText style={{ color: STEAM.warning }}>
                The backup folder isn&apos;t available. Is the SD card inserted?
              </DialogBodyText>
            )}
            {list && list.dirAvailable && list.backups.length === 0 && !error && (
              <DialogBodyText style={{ color: STEAM.textMuted }}>No backups yet.</DialogBodyText>
            )}

            {list?.dirAvailable &&
              list.backups.map((backup) => {
                const blockedReason = restoreBlockedReason(backup, anyJob, gameRunning);
                // A delete holds the slot too, so a row being deleted is off with the rest.
                const deleteOff = anyJob;
                // One focus stop per backup (guide S14): A (or a tap) opens the
                // Restore dialog, which also offers Delete for touch; X deletes
                // (Steam's usual X). No buttons on the row.
                return (
                  <Field
                    key={backup.fileName}
                    focusable
                    label={`${formatWhen(backup.createdAt, now)} · ${formatBytes(backup.sizeBytes)}`}
                    onClick={() => startRestore(backup, blockedReason)}
                    onOKActionDescription={okActionLabel(blockedReason, "Restore")}
                    onSecondaryButton={deleteOff ? undefined : () => startDelete(backup)}
                    onSecondaryActionDescription={deleteOff ? undefined : "Delete"}
                    description={<BackupRowDescription backup={backup} />}
                  >
                    <FaChevronRight />
                  </Field>
                );
              })}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
    </ModalRoot>
  );
}

export function openWtfBackupModal(installation: Installation): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <WtfBackupModal installation={installation} closeModal={close} />,
    window,
    {
      strTitle: "Settings backups",
      bHideMainWindowForPopouts: false,
    },
  );
}
