import { useSyncExternalStore } from "react";
import { ButtonItem, DropdownItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaChevronRight, FaFolderOpen } from "react-icons/fa";
import { FileSelectionType, openFilePicker } from "@decky/api";
import type { Installation } from "../types";
import { settingsStore } from "../settings";
import { useBackupList, useWtfOperation, wtfLifecycle } from "../wtfSession";
import { formatBytes, formatWhen } from "../wtfFormat";
import { jobPercent, jobProgressText } from "../wtfText";
import { FocusRow } from "./FocusSlot";
import { QAM_VIEW } from "../qamState";
import { QamProgressBar } from "./QamProgressBar";
import { STEAM, descriptionStyle, outcomeColor } from "../steamTheme";

import { openWtfBackupModal } from "./WtfBackupModal";

const KEEP_OPTIONS = [1, 2, 3, 5, 10].map((n) => ({ data: n, label: String(n) }));

interface Props {
  installation: Installation | null;
}

/**
 * Options → WTF Backup: a small fixed summary + the two actions that matter.
 * The variable-length backup list lives in a modal (guide P9).
 */
export function WtfBackupSection({ installation }: Props) {
  const op = useWtfOperation();
  const { data: list, error, loading, refresh: reload } = useBackupList(installation?.id ?? null);
  const actionError = installation ? (op.errors[installation.id] ?? null) : null;
  // Null until the engine answered: the folder and count rows never show a default.
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const settings = stored.loaded ? stored.settings : null;
  // A rejected folder (not writable, inside WTF…) is kept by the lifecycle, so it outlives the picker.
  const settingsError = op.settingsError;
  // A job reads the folder and count while it runs; they change only when nothing is pending.
  const settingsFree = op.activity === null;

  // The folder picker is a modal and unmounts this panel (guide G4), so the choice is saved
  // straight from the picker's result instead of through component state.
  const chooseFolder = async () => {
    let picked: { path: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FOLDER,
        settings?.wtfBackupDir || "/home/deck",
        false,
        true,
      );
    } catch {
      return; // cancelled
    }
    await wtfLifecycle.saveSettings({ wtfBackupDir: picked.path });
  };

  const jobHere =
    op.job && installation && op.job.installationId === installation.id ? op.job : null;
  const outcome =
    op.outcome && installation && op.outcome.installationId === installation.id ? op.outcome : null;
  const newest = list?.backups.find((b) => b.valid);

  const backUp = () => installation && void wtfLifecycle.create(installation.id);
  const cancel = () => void wtfLifecycle.cancel();

  const status = !installation
    ? "Select a WoW installation first."
    : !list
      ? loading
        ? "Loading…"
        : ""
      : !list.dirAvailable
        ? "Backup folder not available. Is the SD card inserted?"
        : !list.wtfExists
          ? "No WTF folder yet. Start WoW and log in once."
          : newest
            ? `Last backup ${formatWhen(newest.createdAt, Date.now())} · ${formatBytes(newest.sizeBytes)} · ${list.backups.length} in total`
            : "No backups yet.";
  // The slot is global: a job starting or running anywhere blocks this one.
  const canBackUp =
    !!installation && op.activity === null && !!list?.wtfExists && !!list?.dirAvailable;
  const line = (text: string, color: string = STEAM.textMuted) => (
    <PanelSectionRow>
      <div style={{ ...descriptionStyle, color, paddingTop: "8px" }}>{text}</div>
    </PanelSectionRow>
  );

  // Steam settings rows (guide S14, S19); the backup list itself is a modal (P9).
  return (
    <PanelSection title="Settings backup">
      {installation && error && line(error, STEAM.danger)}
      {installation && error && (
        <FocusRow view={QAM_VIEW.settings} id="wtf:retry">
          <ButtonItem layout="below" onClick={() => void reload()}>
            Retry
          </ButtonItem>
        </FocusRow>
      )}
      {installation &&
        list?.gameRunning === "running" &&
        line(
          "WoW is running. It saves addon settings when you log out or reload, so a backup now won't include this session's changes.",
          STEAM.warning,
        )}
      {jobHere ? (
        <PanelSectionRow>
          {(() => {
            const pct = jobPercent(jobHere);
            return (
              <QamProgressBar
                indeterminate={pct === null}
                nProgress={pct ?? undefined}
                sOperationText={jobProgressText(jobHere)}
              />
            );
          })()}
        </PanelSectionRow>
      ) : null}
      {outcome && line(outcome.text, outcomeColor(outcome.ok))}
      {actionError && line(actionError, STEAM.danger)}

      <FocusRow view={QAM_VIEW.settings} id="wtf:backUp">
        <Field
          focusable={!!jobHere || canBackUp}
          disabled={!jobHere && !canBackUp}
          label={jobHere ? "Cancel" : "Back up now"}
          description={
            <span style={descriptionStyle}>
              {jobHere
                ? "Stop the backup"
                : status || "Addon settings, keybinds, macros and UI layout (the WTF folder)"}
            </span>
          }
          onClick={() => (jobHere ? cancel() : canBackUp && backUp())}
        />
      </FocusRow>
      <FocusRow view={QAM_VIEW.settings} id="wtf:manage">
        <Field
          focusable={!!installation}
          disabled={!installation}
          label="Manage backups"
          description={
            <span style={descriptionStyle}>Restore, delete or import (WowUp backups too)</span>
          }
          onClick={() => installation && openWtfBackupModal(installation)}
        >
          <FaChevronRight />
        </Field>
      </FocusRow>
      <FocusRow view={QAM_VIEW.settings} id="wtf:folder">
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
      </FocusRow>
      {settings?.wtfBackupDir && (
        <FocusRow view={QAM_VIEW.settings} id="wtf:defaultFolder">
          <ButtonItem
            layout="below"
            disabled={!settingsFree}
            onClick={() => void wtfLifecycle.saveSettings({ wtfBackupDir: null })}
          >
            Use default folder
          </ButtonItem>
        </FocusRow>
      )}
      {settingsError && line(settingsError, STEAM.danger)}
      {op.settingsUnknown && line(op.settingsUnknown)}
      {settings && (
        <FocusRow view={QAM_VIEW.settings} id="wtf:keep">
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
        </FocusRow>
      )}
    </PanelSection>
  );
}
