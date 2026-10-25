import { useState, useSyncExternalStore } from "react";
import { ButtonItem, DropdownItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaChevronRight, FaFolderOpen } from "react-icons/fa";
import { FileSelectionType, openFilePicker } from "@decky/api";
import type { Installation, PluginSettings } from "../types";
import * as api from "../services/backend";
import { settingsStore } from "../settings";
import { useWtfList } from "../useWtfList";
import { bumpWtfList, clearWtfOutcome, getWtfState, subscribeWtfState } from "../wtfBackupState";
import { formatBytes, formatWhen } from "../wtfFormat";
import { friendlyWtfCallError, jobPercent, jobProgressText } from "../wtfText";
import { FocusRow } from "./FocusSlot";
import { QAM_VIEW } from "../qamState";
import { QamProgressBar } from "./QamProgressBar";
import { STEAM, descriptionStyle } from "../steamTheme";

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
  const wtf = useSyncExternalStore(subscribeWtfState, getWtfState);
  const { list, error, loading, reload } = useWtfList(installation?.id ?? null, wtf.listVersion);
  const [actionError, setActionError] = useState<string | null>(null);
  // Null until the engine answered: the folder and count rows never show a default.
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const settings = stored.loaded ? stored.settings : null;
  const [settingsError, setSettingsError] = useState<string | null>(null);

  /** Save and reload the list; a rejected folder (not writable, inside WTF…) is shown inline and nothing is stored. */
  const saveSettings = async (
    patch: Partial<Pick<PluginSettings, "wtfBackupDir" | "wtfKeepSnapshots">>,
  ) => {
    setSettingsError(null);
    try {
      await settingsStore.write(patch);
      bumpWtfList();
    } catch (e) {
      setSettingsError(friendlyWtfCallError(e));
    }
  };

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
    await saveSettings({ wtfBackupDir: picked.path });
  };

  const jobHere =
    wtf.job && installation && wtf.job.installationId === installation.id ? wtf.job : null;
  const outcome =
    wtf.outcome && installation && wtf.outcome.installationId === installation.id
      ? wtf.outcome
      : null;
  const newest = list?.backups.find((b) => b.valid);

  const backUp = async () => {
    if (!installation) {
      return;
    }
    clearWtfOutcome();
    setActionError(null);
    try {
      await api.rpc("wtf.create", { installationId: installation.id });
      await reload(true);
    } catch (e) {
      setActionError(friendlyWtfCallError(e));
    }
  };

  const cancel = async () => {
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
  const canBackUp = !!installation && wtf.job === null && !!list?.wtfExists && !!list?.dirAvailable;
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
      {outcome && line(outcome.text, outcome.ok ? STEAM.positive : STEAM.danger)}
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
          onClick={() => (jobHere ? void cancel() : canBackUp && void backUp())}
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
          focusable
          label="Backup folder"
          description={
            <span style={{ ...descriptionStyle, wordBreak: "break-all" }}>
              {settings?.wtfBackupDir ?? "Internal storage (default)"}
            </span>
          }
          onClick={() => void chooseFolder()}
          onOKActionDescription="Choose"
        >
          <FaFolderOpen />
        </Field>
      </FocusRow>
      {settings?.wtfBackupDir && (
        <FocusRow view={QAM_VIEW.settings} id="wtf:defaultFolder">
          <ButtonItem layout="below" onClick={() => void saveSettings({ wtfBackupDir: null })}>
            Use default folder
          </ButtonItem>
        </FocusRow>
      )}
      {settingsError && line(settingsError, STEAM.danger)}
      {settings && (
        <FocusRow view={QAM_VIEW.settings} id="wtf:keep">
          <DropdownItem
            label="Safety backups to keep"
            description="Made automatically before each restore"
            rgOptions={KEEP_OPTIONS}
            selectedOption={settings.wtfKeepSnapshots}
            onChange={(option) => void saveSettings({ wtfKeepSnapshots: option.data as number })}
          />
        </FocusRow>
      )}
    </PanelSection>
  );
}
