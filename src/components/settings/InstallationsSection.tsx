import { RowChevron } from "../RowGlyph";
import { useEffect, useSyncExternalStore } from "react";
import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaSearchLocation } from "react-icons/fa";
import type { Installation } from "../../types";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { confirmRemoveInstallation } from "../confirmRemove";
import { openInstallationDetails } from "../InstallationDetailsModal";
import { QAM_DROPDOWN_VALUE } from "../dropdownValue";
import { FactLine } from "../FactLine";
import { InstallationSelect } from "../InstallationSelect";
import { FocusRow } from "../FocusSlot";
import { runAddWowFolder } from "../addWowFolderUi";
import { SettingsRow, VIEW, busyIcon } from "./common";
import {
  clearInstallationJump,
  installationJump,
  subscribeInstallationJump,
} from "../../optionsJump";
import type { AddonSession } from "../../addonSession";

/** What the section writes and reads: the addon session owns the installation writes. */
export type InstallationsSession = Pick<
  AddonSession,
  | "get"
  | "subscribe"
  | "findWow"
  | "selectInstallation"
  | "addInstallation"
  | "updateInstallation"
  | "removeInstallation"
  | "rescanInstallation"
>;

interface Props {
  installations: Installation[];
  selectedId: string | null;
  session: InstallationsSession;
}

/** The active installation (its details on the Options button), detection and Add WoW folder. */
export function InstallationsSection({ installations, selectedId, session }: Props) {
  const { findingWow: detecting } = useSyncExternalStore(session.subscribe, session.get);
  const jump = useSyncExternalStore(subscribeInstallationJump, installationJump);
  useEffect(() => clearInstallationJump, []);
  const selected = installations.find((i) => i.id === selectedId) ?? null;

  // The module store holds the selected installation's addons (G4); read
  // when the dialog opens, so the counts are current.
  const addonCounts = () => {
    const { addons } = session.get();
    return { installed: addons.length, managed: addons.filter((a) => a.providerId).length };
  };

  const openDetails = () =>
    selected &&
    openInstallationDetails(selected, addonCounts(), {
      onUpdate: (changes) => session.updateInstallation(selected.id, changes),
      onRescan: () => void rescan(),
      onRemove: removeSelected,
      recoveryRequired: !!session.get().recoveryRequired[selected.id],
    });

  const rescan = async () => {
    if (!selected) {
      return;
    }
    const outcome = await session.rescanInstallation(selected.id);
    // Recovery required: the recovery state shows; nothing was rescanned.
    if (outcome === "refreshed") {
      pluginToast("Addons rescanned", selected.displayName);
    }
  };

  const removeSelected = () => {
    if (!selected) {
      return;
    }
    confirmRemoveInstallation(selected.displayName, async () => {
      try {
        await session.removeInstallation(selected.id);
        pluginToast("Installation removed", "WoW files weren't touched");
      } catch (e) {
        toastError("Couldn't remove installation", e);
      }
    });
  };

  const detect = async () => {
    clearInstallationJump();
    await session.findWow();
  };

  return (
    <PanelSection title="WoW installations">
      {installations.length > 0 ? (
        <FocusRow
          view={VIEW}
          id="activeInstallation"
          actions={
            selected
              ? {
                  onOptionsButton: openDetails,
                  onOptionsActionDescription: "Installation details",
                }
              : undefined
          }
        >
          <InstallationSelect
            session={session}
            showHidden
            label="Active installation"
            description={
              selected ? (
                // Wraps only between facts (C03, S33).
                <FactLine
                  style={descriptionStyle}
                  facts={[
                    selected.version
                      ? `Version ${selected.version.split(".").slice(0, 3).join(".")}`
                      : "Version unknown",
                    selected.source === "manual" ? "Added manually" : "Detected automatically",
                  ]}
                />
              ) : undefined
            }
            renderButtonValue={QAM_DROPDOWN_VALUE}
          />
        </FocusRow>
      ) : (
        <PanelSectionRow>
          <div style={descriptionStyle}>No installations yet. Find or add one below.</div>
        </PanelSectionRow>
      )}
      <SettingsRow
        id="detect"
        className={jump !== null ? "wowdeck-source-jump" : undefined}
        style={jump !== null ? { animationDelay: `${jump - Date.now()}ms` } : undefined}
      >
        <Field
          focusable
          label="Find WoW installations"
          description={
            <span style={descriptionStyle}>Looks in Steam, Lutris and other game folders</span>
          }
          onClick={() => !detecting && void detect()}
        >
          {busyIcon(detecting, <FaSearchLocation />)}
        </Field>
      </SettingsRow>
      {/* The manual way, next to the automatic one: the picker opens at once. */}
      <SettingsRow id="addWowFolder">
        <Field
          focusable
          label="Add WoW folder"
          description={
            <span style={descriptionStyle}>
              The World of Warcraft folder, or a version folder such as _retail_
            </span>
          }
          onClick={() => void runAddWowFolder(VIEW, "addWowFolder", installations, session)}
          onOKActionDescription="Choose folder"
        >
          <RowChevron />
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
