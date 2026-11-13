import { RowChevron } from "../RowGlyph";
import { useEffect, useSyncExternalStore } from "react";
import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaSearchLocation } from "react-icons/fa";
import type { Installation } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { addonSession } from "../../session";
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

interface Props {
  installations: Installation[];
  selectedId: string | null;
  /** Reload installations + addons after structural changes. */
  onChanged: () => Promise<void>;
}

/** The active installation (its details on the Options button), detection and Add WoW folder. */
export function InstallationsSection({ installations, selectedId, onChanged }: Props) {
  const { findingWow: detecting } = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const jump = useSyncExternalStore(subscribeInstallationJump, installationJump);
  useEffect(() => clearInstallationJump, []);
  const selected = installations.find((i) => i.id === selectedId) ?? null;

  // The module store holds the selected installation's addons (G4); read
  // when the dialog opens, so the counts are current.
  const addonCounts = () => {
    const { addons } = addonSession.get();
    return { installed: addons.length, managed: addons.filter((a) => a.providerId).length };
  };

  const openDetails = () =>
    selected &&
    openInstallationDetails(selected, addonCounts(), {
      onUpdate: async (changes) => {
        const { installation } = await api.rpc("installations.update", {
          installationId: selected.id,
          ...changes,
        });
        await onChanged();
        return installation;
      },
      onRescan: () => void rescan(),
      onRemove: removeSelected,
      recoveryRequired: !!addonSession.get().recoveryRequired[selected.id],
    });

  const rescan = async () => {
    if (!selected) {
      return;
    }
    try {
      await api.rpc("addons.refresh", { installationId: selected.id });
      await onChanged();
      pluginToast("Addons rescanned", selected.displayName);
    } catch (e) {
      toastError("Couldn't rescan addons", e);
    }
  };

  const removeSelected = () => {
    if (!selected) {
      return;
    }
    confirmRemoveInstallation(selected.displayName, async () => {
      try {
        await api.rpc("installations.remove", { installationId: selected.id });
        pluginToast("Installation removed", "WoW files weren't touched");
        await onChanged();
      } catch (e) {
        toastError("Couldn't remove installation", e);
      }
    });
  };

  const detect = async () => {
    clearInstallationJump();
    await addonSession.findWow();
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
            session={addonSession}
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
          onClick={() => void runAddWowFolder(VIEW, "addWowFolder", installations, onChanged)}
          onOKActionDescription="Choose folder"
        >
          <RowChevron />
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
