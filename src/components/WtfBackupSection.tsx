import { RowChevron } from "./RowGlyph";
import { Field, PanelSection } from "@decky/ui";

import type { Installation } from "../types";
import { useBackupList } from "../wtfSession";
import { formatBytes, formatWhen } from "../wtfFormat";
import { FocusRow } from "./FocusSlot";
import { QAM_VIEW } from "../qamState";
import { descriptionStyle } from "../steamTheme";

import { openWtfBackupModal } from "./WtfBackupModal";
import { BACK_UP_ROW, openBackupSettingsModal } from "./BackupSettingsModal";

interface Props {
  installation: Installation | null;
}

/** Backup entry points; creation and its lifecycle live in the settings modal. */
export function WtfBackupSection({ installation }: Props) {
  const { data: list, loading } = useBackupList(installation?.id ?? null);
  const newest = list?.backups.find((b) => b.valid);

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
  // Steam settings rows (guide S14, S19); the backup list itself is a modal (P9).
  return (
    <PanelSection title="Settings backup">
      <FocusRow view={QAM_VIEW.settings} id={BACK_UP_ROW}>
        <Field
          focusable
          label="WoW Settings Backup"
          description={<span style={descriptionStyle}>{status}</span>}
          onClick={() => openBackupSettingsModal(installation)}
        >
          <RowChevron />
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
          <RowChevron />
        </Field>
      </FocusRow>
    </PanelSection>
  );
}
