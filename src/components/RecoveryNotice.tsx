import { RowGlyph } from "./RowGlyph";
import { useSyncExternalStore } from "react";
import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaExclamationTriangle } from "react-icons/fa";
import type { Installation, StateFileRecoveryStatus } from "../types";
import { STEAM, descriptionStyle } from "../steamTheme";
import { addonSession } from "../session";
import { recoveryNeededFor, stateFileRecoveryFor } from "../addonSession";
import { recoveryNotice, stateFileNotice, sentences } from "../recovery";
import { focusTarget } from "./FocusSlot";
import { openRecoveryDetails } from "./RecoveryDetailsModal";

/**
 * The installation-level recovery notice (ADR 0006, #107), above every tab's
 * content. It reads the module session, so it is the same in My Addons, Get
 * Addons and Options and comes back after a reload; A opens the shared
 * recovery-details view.
 */
export function RecoveryNotice({ view }: { view: string }) {
  const state = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  return (
    <RecoveryNoticeRow
      view={view}
      installation={recoveryNeededFor(state)}
      stateFile={stateFileRecoveryFor(state)}
    />
  );
}

/** The notice for `installation`; nothing when it is null (no recovery needed). */
export function RecoveryNoticeRow({
  view,
  installation,
  stateFile,
}: {
  view: string;
  installation: Installation | null;
  stateFile?: Pick<
    Extract<StateFileRecoveryStatus, { status: "unreadable" }>,
    "reason" | "nextStep"
  > | null;
}) {
  if (stateFile) {
    const notice = stateFileNotice();
    return (
      <PanelSection>
        <PanelSectionRow>
          <Field
            focusable
            {...focusTarget(view, "recoveryNotice")}
            label={<span style={{ color: STEAM.warning }}>{notice.label}</span>}
            description={
              <span style={descriptionStyle}>
                {sentences(notice.description, stateFile.reason, stateFile.nextStep)}
              </span>
            }
          >
            <RowGlyph>
              <FaExclamationTriangle style={{ color: STEAM.warning }} />
            </RowGlyph>
          </Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }
  if (!installation) {
    return null;
  }
  const { label, description } = recoveryNotice(installation);
  return (
    <PanelSection>
      <PanelSectionRow>
        <Field
          focusable
          {...focusTarget(view, "recoveryNotice")}
          label={<span style={{ color: STEAM.warning }}>{label}</span>}
          description={<span style={descriptionStyle}>{description}</span>}
          onClick={() => openRecoveryDetails(installation)}
          onOKActionDescription="Recovery details"
        >
          <RowGlyph>
            <FaExclamationTriangle style={{ color: STEAM.warning }} />
          </RowGlyph>
        </Field>
      </PanelSectionRow>
    </PanelSection>
  );
}
