import { RowChevron } from "./RowChevron";
import { ScrollBuffer } from "./ScrollBuffer";
import { useState } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogHeader,
  DropdownItem,
  Field,
  ModalRoot,
  Spinner,
  showModal,
} from "@decky/ui";

import { wowupModalStyleCss } from "../sharedStyles";
import { STEAM, outcomeColor } from "../steamTheme";
import type { Installation, WtfBackupInfo, WtfCopySource } from "../types";
import { useCopySources, useWtfOperation, wtfLifecycle } from "../wtfSession";
import {
  copyGameRunningNotice,
  copySourceHeader,
  copySourceOption,
  copySourceRowLabel,
  copySourceRows,
  copySourceStatus,
  currentSettingsDescription,
  currentSettingsSource,
  jobProgressText,
  okActionLabel,
  restoreBlockedReason,
  type RestoreSource,
} from "../wtfText";
import { BackupRowDescription } from "./BackupRowDescription";
import { confirmRestoreBackup } from "./confirmWtf";

interface ModalProps {
  installation: Installation;
  closeModal?: () => void;
}

/**
 * Settings copy (GLOSSARY.md): one screen with a **Copy from** dropdown and,
 * below it, what that version has: **Current settings** first (installed
 * versions only), then its backups, newest first. The header ("Copying from
 * <version>", white like the dialog title) and every row label name the source version.
 * Choosing a row opens the Restore dialog worded for a copy; once the job
 * starts this modal closes and Manage backups shows its progress and Cancel,
 * as for a restore. WoW running blocks every copy (the engine can't tell which
 * version runs): one line under the intro says so, each row's A reads Details
 * and its dialog has Copy off.
 * Navigation contract: UI guide §6.6, "Copy settings modal".
 */
function WtfCopyModal({ installation, closeModal }: ModalProps) {
  const op = useWtfOperation();
  const { data, error, refresh: reload } = useCopySources(installation.id);
  const sources = data?.sources ?? null;
  const dirAvailable = data?.dirAvailable ?? true;
  const gameRunning = data?.gameRunning ?? "unknown";
  const [chosen, setChosen] = useState<string | null>(null);
  const actionError = op.errors[installation.id] ?? null;
  // A copy whose answer was lost, or a job adopted here, explains why Copy is blocked.
  const jobHere = op.job && op.job.installationId === installation.id ? op.job : null;
  const outcome = op.outcome && op.outcome.installationId === installation.id ? op.outcome : null;
  // The slot is global: a job starting or running anywhere blocks a copy.
  const anyJob = op.activity !== null;
  const now = Date.now();

  const source: WtfCopySource | undefined =
    sources?.find((s) => s.flavor === chosen) ?? sources?.find((s) => s.isDefault) ?? sources?.[0];

  const runningNotice = copyGameRunningNotice(gameRunning);
  const blockedReasonFor = (shown: RestoreSource) =>
    restoreBlockedReason(shown, anyJob, gameRunning, "copy");

  /** `backup` null: copy the source's current settings (offered only for an installed version). */
  const startCopy = (from: WtfCopySource, backup: WtfBackupInfo | null) => {
    const what = backup
      ? { fileName: backup.fileName }
      : from.installationId
        ? { sourceInstallationId: from.installationId }
        : null;
    if (!what) {
      return;
    }
    const shown: RestoreSource = backup ?? currentSettingsSource(from);
    confirmRestoreBackup(
      shown,
      installation.displayName,
      gameRunning,
      async (options) => {
        // The guard is checked again here: a job may have started while the dialog was open.
        const started = await wtfLifecycle.copy(installation.id, {
          sourceFlavor: from.flavor,
          keepCurrentConfig: options.keepCurrentConfig,
          // Only a backup can lack its version (desktop WowUp); the dialog then asked to confirm it.
          ...("fileName" in what
            ? { ...what, acceptUnknownFlavor: options.acceptUnknownFlavor }
            : what),
        });
        // Manage backups shows the job; a refusal stays here as the action error.
        if (started) {
          closeModal?.();
        }
      },
      {
        blockedReason: blockedReasonFor(shown),
        onDelete: null,
        copyFrom: { name: from.displayName, related: from.related, current: backup === null },
      },
    );
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <DialogHeader>Copy settings to {installation.displayName}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogBodyText>
            Bring another WoW version&apos;s addon settings, keybinds, macros and UI layout into{" "}
            {installation.displayName}. The other version&apos;s files are only read.
          </DialogBodyText>
          {runningNotice && (
            <DialogBodyText style={{ color: STEAM.warning }}>{runningNotice}</DialogBodyText>
          )}
          {jobHere && (
            <DialogBodyText style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Spinner style={{ width: "1.2em" }} />
              <span style={{ flex: 1 }}>{jobProgressText(jobHere)}</span>
            </DialogBodyText>
          )}
          {outcome && (
            <DialogBodyText style={{ color: outcomeColor(outcome.ok) }}>
              {outcome.text}
            </DialogBodyText>
          )}
          {actionError && (
            <DialogBodyText style={{ color: STEAM.danger }}>{actionError}</DialogBodyText>
          )}
          {!sources && !error && <Spinner style={{ width: "1.2em" }} />}
          {error && (
            <Field
              label="Retry"
              description={<span style={{ color: STEAM.danger }}>{error}</span>}
              focusable
              onClick={() => void reload()}
            />
          )}
          {!dirAvailable && (
            <DialogBodyText style={{ color: STEAM.warning }}>
              The backup folder isn&apos;t available. Is the SD card inserted?
            </DialogBodyText>
          )}
          {sources && dirAvailable && sources.length === 0 && (
            <DialogBodyText style={{ color: STEAM.textMuted }}>
              No other WoW version has settings to copy.
            </DialogBodyText>
          )}

          {source && (
            <>
              <DialogControlsSection>
                <DropdownItem
                  label="Copy from"
                  description={copySourceStatus(source) ?? undefined}
                  rgOptions={sources!.map((s) => ({ data: s.flavor, label: copySourceOption(s) }))}
                  selectedOption={source.flavor}
                  onChange={(option) => setChosen(option.data as string)}
                />
              </DialogControlsSection>
              <DialogControlsSection>
                <DialogControlsSectionHeader style={{ color: STEAM.header }}>
                  {copySourceHeader(source)}
                </DialogControlsSectionHeader>
                {copySourceRows(source).map((row) => {
                  if (row.kind === "current") {
                    const current = currentSettingsSource(source);
                    return (
                      <Field
                        key="current"
                        focusable
                        label={copySourceRowLabel(source, row, now)}
                        onClick={() => startCopy(source, null)}
                        onOKActionDescription={okActionLabel(blockedReasonFor(current), "Copy")}
                        description={currentSettingsDescription(current, now)}
                      >
                        <RowChevron />
                      </Field>
                    );
                  }
                  const { backup } = row;
                  return (
                    <Field
                      key={backup.fileName}
                      focusable
                      label={copySourceRowLabel(source, row, now)}
                      onClick={() => startCopy(source, backup)}
                      onOKActionDescription={okActionLabel(blockedReasonFor(backup), "Copy")}
                      description={<BackupRowDescription backup={backup} />}
                    >
                      <RowChevron />
                    </Field>
                  );
                })}
              </DialogControlsSection>
            </>
          )}
        </ScrollBuffer>
      </DialogBody>
    </ModalRoot>
  );
}

export function openWtfCopyModal(installation: Installation): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <WtfCopyModal installation={installation} closeModal={close} />,
    window,
    { strTitle: "Copy settings", bHideMainWindowForPopouts: false },
  );
}
