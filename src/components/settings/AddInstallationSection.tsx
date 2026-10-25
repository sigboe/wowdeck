import { useState, useSyncExternalStore } from "react";
import {
  ButtonItem,
  DialogButton,
  DropdownItem,
  Field,
  Focusable,
  PanelSection,
  PanelSectionRow,
  Spinner,
  TextField,
} from "@decky/ui";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { FaFolderOpen, FaPlus } from "react-icons/fa";
import type { GameType } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import {
  getInstallationDraft,
  resetInstallationDraft,
  subscribeInstallationDraft,
  updateInstallationDraft,
  applyInspection,
} from "../../installationFormState";
import { MANUAL_GAME_TYPES, gameTypeLabel } from "../../../backend/src/api/gameTypes";
import { rememberFocus, requestFocus } from "../../focusMemory";
import { TextRow } from "../TextRow";
import { FocusSlot, focusTarget } from "../FocusSlot";
import { SettingsRow, VIEW } from "./common";

const CLIENT_TYPE_OPTIONS = [
  // Short, like Valve's dropdown values ("AUTO", "OFF"); the row's
  // description explains it (guide S27).
  { data: "auto", label: "Auto" },
  ...MANUAL_GAME_TYPES.map((gameType) => ({ data: gameType, label: gameTypeLabel(gameType) })),
];

/** Add an installation by folder: typed or picked, name and game version filled in from it. */
export function AddInstallationSection({ onChanged }: { onChanged: () => Promise<void> }) {
  // Module-scope draft: the folder picker is a modal and unmounts this panel
  // (guide G4), so the form must survive and receive the picked path.
  const draft = useSyncExternalStore(subscribeInstallationDraft, getInstallationDraft);
  const newPath = draft.path;
  const newName = draft.name;
  const newClientType = draft.clientType;
  const setNewPath = (path: string) => updateInstallationDraft({ path });
  const setNewName = (name: string) => updateInstallationDraft({ name });
  const setNewClientType = (clientType: string) => updateInstallationDraft({ clientType });
  const [adding, setAdding] = useState(false);

  const addInstallation = async () => {
    if (!newPath.trim()) {
      pluginToast("Enter a folder path first");
      return;
    }
    setAdding(true);
    try {
      const { installations: added } = await api.rpc("installations.add", {
        path: newPath.trim(),
        displayName: newName.trim() || undefined,
        // The dropdown offers "auto" and MANUAL_GAME_TYPES.
        clientType: newClientType === "auto" ? undefined : (newClientType as GameType),
      });
      pluginToast(
        added.length > 1
          ? `Added ${added.length} installations`
          : `Added ${added[0]?.displayName ?? "installation"}`,
        added.map((i) => i.displayName).join(", "),
      );
      resetInstallationDraft();
      await onChanged();
    } catch (e) {
      toastError("Couldn't add installation", e);
    } finally {
      setAdding(false);
    }
  };

  // What the folder holds fills in the name and the game version (owner,
  // 2026-10-17); the draft is module state, so this survives the picker.
  const inspectPicked = async (path: string) => {
    if (!path.trim()) {
      return;
    }
    try {
      const { found } = await api.rpc("installations.inspect", { path: path.trim() });
      updateInstallationDraft(
        applyInspection(getInstallationDraft(), found, [...MANUAL_GAME_TYPES]),
      );
    } catch {
      // Not recognised yet: Add explains why.
    }
  };

  // The picker is a full-screen page: the panel is rebuilt when it closes. Back
  // without a choice returns to Browse; after a choice the next field to fill
  // in is the display name (guide S21).
  const browseForFolder = async () => {
    rememberFocus(VIEW, "browse");
    try {
      const picked = await openFilePicker(
        FileSelectionType.FOLDER,
        newPath.trim() || "/home/deck",
        false,
        true,
      );
      updateInstallationDraft({ path: picked.path });
      await inspectPicked(picked.path);
      requestFocus(VIEW, "displayName");
    } catch {
      // picker cancelled — keep whatever is typed
      requestFocus(VIEW, "browse");
    }
  };

  return (
    <PanelSection title="Add installation manually">
      <PanelSectionRow>
        <Field
          label="WoW folder"
          description={
            <span style={descriptionStyle}>
              The World of Warcraft folder, or a version folder such as _retail_
            </span>
          }
          childrenLayout="below"
          childrenContainerWidth="max"
        >
          {/* Text field plus Browse on one row (rule F10); D-pad Right reaches Browse. */}
          <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FocusSlot view={VIEW} id="folderPath">
                <TextField
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onBlur={() => void inspectPicked(newPath)}
                />
              </FocusSlot>
            </div>
            <DialogButton
              style={{ minWidth: 0, width: "auto", padding: "10px 14px" }}
              onClick={browseForFolder}
              onOKActionDescription="Browse"
              {...focusTarget(VIEW, "browse")}
            >
              <FaFolderOpen />
            </DialogButton>
          </Focusable>
        </Field>
      </PanelSectionRow>
      <SettingsRow id="displayName">
        <TextRow label="Display name">
          <TextField value={newName} onChange={(e) => setNewName(e.target.value)} />
        </TextRow>
      </SettingsRow>
      <SettingsRow id="gameVersion">
        <DropdownItem
          label="Game version"
          description="Auto detects it from the folder name"
          rgOptions={CLIENT_TYPE_OPTIONS}
          selectedOption={newClientType}
          onChange={(option) => setNewClientType(option.data as string)}
        />
      </SettingsRow>
      <SettingsRow id="addInstallation">
        <ButtonItem layout="below" disabled={adding} onClick={addInstallation}>
          {adding ? <Spinner style={{ width: "1em" }} /> : <FaPlus />} Add installation
        </ButtonItem>
      </SettingsRow>
    </PanelSection>
  );
}
