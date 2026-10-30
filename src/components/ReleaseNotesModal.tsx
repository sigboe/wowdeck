import { useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogFooter,
  DialogHeader,
  ModalRoot,
  showModal,
} from "@decky/ui";
import type { ReleaseNotesAction } from "../pluginUpdate";
import { selfUpdateStore } from "../selfUpdate";
import { wowupModalStyleCss } from "../sharedStyles";
import { descriptionStyle } from "../steamTheme";
import { useDirectScroll } from "../useDirectScroll";

/** The notes box's height cap: the modal keeps its header and Update button on screen. */
const NOTES_MAX_HEIGHT = "50vh";

/**
 * The offered WoWDeck build's release notes (GLOSSARY: Release notes),
 * opened with Y on the update panel's Update button. The modal's Update
 * button is its one focus target: A starts the update and closes the modal
 * (the panel then shows "Preparing…"), disabled while staging. D-pad/stick
 * Up/Down scroll the notes the way the Details modal's pages scroll
 * (valveScroll), B closes. The panel is unmounted while this is open (G4);
 * on close its focus memory puts focus back on its Update button. Plain text
 * from the engine (ADR-0004): a React text node, never HTML.
 */
function ReleaseNotesModal({
  title,
  notes,
  buttonLabel,
  closeModal,
}: {
  title: string;
  notes: string;
  buttonLabel: string;
  closeModal?: () => void;
}) {
  const { staging } = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const { boxRef, onGamepadDirection } = useDirectScroll();

  const update = () => {
    closeModal?.();
    void selfUpdateStore.runUpdate();
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{title}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <div
          ref={boxRef}
          style={{
            ...descriptionStyle,
            maxHeight: NOTES_MAX_HEIGHT,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {notes}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogButton
          disabled={staging}
          onClick={update}
          onOKActionDescription={buttonLabel}
          onGamepadDirection={onGamepadDirection}
        >
          {staging ? "Preparing…" : buttonLabel}
        </DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openReleaseNotesModal(
  { title, notes }: ReleaseNotesAction,
  buttonLabel: string,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <ReleaseNotesModal title={title} notes={notes} buttonLabel={buttonLabel} closeModal={close} />,
    window,
    { strTitle: title, bHideMainWindowForPopouts: false },
  );
}
