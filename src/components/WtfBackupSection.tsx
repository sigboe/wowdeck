import {
  ButtonItem,
  DialogButton,
  Field,
  Focusable,
  PanelSection,
  PanelSectionRow,
} from "@decky/ui";
import { FaChevronRight, FaEllipsisH } from "react-icons/fa";
import type { Installation } from "../types";
import { useBackupList, useWtfOperation, wtfLifecycle } from "../wtfSession";
import { formatBytes, formatWhen } from "../wtfFormat";
import { jobPercent, jobProgressText } from "../wtfText";
import { FocusRow } from "./FocusSlot";
import { QAM_VIEW } from "../qamState";
import { QamProgressBar } from "./QamProgressBar";
import { STEAM, descriptionStyle, outcomeColor } from "../steamTheme";

import { openWtfBackupModal } from "./WtfBackupModal";
import { BACK_UP_ROW, openBackupSettingsModal } from "./BackupSettingsModal";

const ROW_BUTTON_STYLE = { minWidth: 0, width: "auto", padding: "8px 16px" };

interface Props {
  installation: Installation | null;
}

/**
 * Options → Settings backup: a small fixed summary + the two actions that
 * matter. Back up now is a plain row holding its Back up button and a ⋯ that
 * opens Backup settings (folder, safety backups to keep), like WoWDeck's row
 * in Updates. The variable-length backup list lives in a modal (guide P9).
 */
export function WtfBackupSection({ installation }: Props) {
  const op = useWtfOperation();
  const { data: list, error, loading, refresh: reload } = useBackupList(installation?.id ?? null);
  const actionError = installation ? (op.errors[installation.id] ?? null) : null;
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

      <FocusRow view={QAM_VIEW.settings} id={BACK_UP_ROW}>
        <Field
          label="Back up now"
          description={
            <span style={descriptionStyle}>
              {status || "Addon settings, keybinds, macros and UI layout (the WTF folder)"}
            </span>
          }
        >
          {/* Left/Right move between the two buttons (F7). */}
          <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
            <DialogButton
              style={ROW_BUTTON_STYLE}
              disabled={!jobHere && !canBackUp}
              onClick={() => (jobHere ? cancel() : canBackUp && backUp())}
            >
              {jobHere ? "Cancel" : "Back up"}
            </DialogButton>
            <DialogButton style={ROW_BUTTON_STYLE} onClick={openBackupSettingsModal}>
              <FaEllipsisH aria-hidden="true" />
              <span className="wowdeck-visually-hidden">Backup settings</span>
            </DialogButton>
          </Focusable>
        </Field>
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
    </PanelSection>
  );
}
