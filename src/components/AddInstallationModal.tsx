import { useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  DropdownItem,
  Field,
  Focusable,
  ModalRoot,
  TextField,
  showModal,
} from "@decky/ui";
import type { GameType } from "../types";
import type { AddInstallationParams, AddInstallationRequest } from "../addWowFolder";
import { MANUAL_GAME_TYPES, gameTypeLabel } from "../../backend/src/api/gameTypes";
import { descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";

const TITLE = "Add installation";

const GAME_TYPE_OPTIONS = MANUAL_GAME_TYPES.map((gameType) => ({
  data: gameType,
  label: gameTypeLabel(gameType),
}));

interface Props extends AddInstallationRequest {
  /** True when the installation was added; false keeps the modal open. */
  onAdd: (params: AddInstallationParams) => Promise<boolean>;
  closeModal?: () => void;
}

/**
 * Add WoW folder's check step (spec #183): the picked folder as read-only
 * text, its display name and game version. The draft lives here: the modal
 * opens after the picker returned, so nothing has to survive an unmount.
 * Add stays disabled until a game version is chosen; an unrecognised
 * folder opens with none.
 */
export function AddInstallationModal({ path, displayName, gameType, onAdd, closeModal }: Props) {
  const [name, setName] = useState(displayName);
  const [clientType, setClientType] = useState<GameType | null>(gameType);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!clientType) {
      return;
    }
    setAdding(true);
    const added = await onAdd({ path, displayName: name.trim() || displayName, clientType });
    setAdding(false);
    if (added) {
      closeModal?.();
    }
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <DialogControlsSection>
          <Field
            label="WoW folder"
            description={
              <span style={{ ...descriptionStyle, wordBreak: "break-all" }}>{path}</span>
            }
          />
          <Field label="Display name" childrenLayout="below" childrenContainerWidth="max">
            <TextField
              aria-label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DropdownItem
            label="Game version"
            description={
              gameType ? undefined : "This folder isn't a known WoW version. Choose which it is."
            }
            strDefaultLabel="Choose a version"
            rgOptions={GAME_TYPE_OPTIONS}
            selectedOption={clientType}
            onChange={(option) => setClientType(option.data as GameType)}
          />
        </DialogControlsSection>
      </DialogBody>
      <DialogFooter>
        {/* The action first, Cancel second (S12). */}
        <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
          <DialogButton disabled={!clientType || adding} onClick={() => void add()}>
            Add
          </DialogButton>
          <DialogButton disabled={adding} onClick={closeModal}>
            Cancel
          </DialogButton>
        </Focusable>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openAddInstallationModal(
  request: AddInstallationRequest,
  onAdd: (params: AddInstallationParams) => Promise<boolean>,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <AddInstallationModal {...request} onAdd={onAdd} closeModal={close} />,
    window,
    { strTitle: TITLE, bHideMainWindowForPopouts: false },
  );
}
