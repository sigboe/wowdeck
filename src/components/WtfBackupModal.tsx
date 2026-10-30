import { ScrollBuffer } from "./ScrollBuffer";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { STEAM, descriptionStyle } from "../steamTheme";
import type { Installation, WtfBackupInfo } from "../types";
import * as api from "../services/backend";
import { useWtfList } from "../useWtfList";
import { type BackupActionKey, backupActions, loadedBackupFocus } from "../wtfBackupFocus";
import { bumpWtfList, clearWtfOutcome, getWtfState, subscribeWtfState } from "../wtfBackupState";
import { formatBytes, formatWhen } from "../wtfFormat";
import {
  friendlyWtfCallError,
  importNotice,
  jobProgressText,
  okActionLabel,
  restoreBlockedReason,
} from "../wtfText";
import { useWtfCopySources } from "../useWtfCopySources";
import { confirmDeleteBackup, confirmRestoreBackup } from "./confirmWtf";
import { BackupRowDescription } from "./BackupRowDescription";
import { focusTarget } from "./FocusSlot";
import { openWtfCopyModal } from "./WtfCopyModal";

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
 * itself lives in module scope (wtfBackupState.ts).
 */
function WtfBackupModal({ installation, closeModal }: ModalProps) {
  const wtf = useSyncExternalStore(subscribeWtfState, getWtfState);
  const { list, error, loading, reload } = useWtfList(installation.id, wtf.listVersion);
  const { sources } = useWtfCopySources(installation.id, wtf.listVersion);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const jobHere = wtf.job && wtf.job.installationId === installation.id ? wtf.job : null;
  const jobElsewhere = wtf.job && !jobHere;
  const anyJob = wtf.job !== null;
  const outcome =
    wtf.outcome && wtf.outcome.installationId === installation.id ? wtf.outcome : null;
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

  const startCreate = async () => {
    clearWtfOutcome();
    setActionError(null);
    try {
      await api.rpc("wtf.create", { installationId: installation.id });
      await reload(true); // attach to the job the engine just started
    } catch (e) {
      setActionError(friendlyWtfCallError(e));
    }
  };

  const startRestore = (backup: WtfBackupInfo, blockedReason: string | null) => {
    const onDelete = anyJob || busyFile === backup.fileName ? null : () => startDelete(backup);
    confirmRestoreBackup(
      backup,
      installation.displayName,
      gameRunning,
      async (options) => {
        clearWtfOutcome();
        setActionError(null);
        try {
          await api.rpc("wtf.restore", {
            fileName: backup.fileName,
            acceptUnknownFlavor: options.acceptUnknownFlavor,
            keepCurrentConfig: options.keepCurrentConfig,
            installationId: installation.id,
          });
          await reload(true);
        } catch (e) {
          setActionError(friendlyWtfCallError(e));
        }
      },
      { blockedReason, onDelete },
    );
  };

  const startDelete = (backup: WtfBackupInfo) => {
    confirmDeleteBackup(backup, async () => {
      setActionError(null);
      setBusyFile(backup.fileName);
      try {
        await api.rpc("wtf.delete", { fileName: backup.fileName, installationId: installation.id });
        await reload();
      } catch (e) {
        setActionError(friendlyWtfCallError(e));
      } finally {
        setBusyFile(null);
      }
    });
  };

  const importFromFile = async () => {
    let picked: { path: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FILE,
        "/home/deck",
        true,
        false,
        undefined,
        ["zip"],
        false,
        true,
      );
    } catch {
      return; // cancelled
    }
    clearWtfOutcome();
    setActionError(null);
    setNotice(null);
    try {
      const result = await api.rpc("wtf.import", {
        path: picked.path,
        installationId: installation.id,
      });
      setNotice(importNotice(result));
      bumpWtfList();
    } catch (e) {
      setActionError(friendlyWtfCallError(e));
    }
  };

  const cancelJob = async () => {
    if (!wtf.job) {
      return;
    }
    setActionError(null);
    try {
      await api.rpc("wtf.cancel", { jobId: wtf.job.jobId });
    } catch (e) {
      setActionError(friendlyWtfCallError(e));
    }
  };

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
            <DialogBodyText style={{ color: outcome.ok ? STEAM.positive : STEAM.danger }}>
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
                onClick={() => openWtfCopyModal(installation, () => void reload(true))}
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
                const deleteOff = anyJob || busyFile === backup.fileName;
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
