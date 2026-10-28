import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogFooter,
  DialogHeader,
  GamepadButton,
  ModalRoot,
  showModal,
  type GamepadEvent,
} from "@decky/ui";
import type { ReleaseNotesAction } from "../pluginUpdate";
import { canScroll } from "../scrollEdge";
import { selfUpdateStore } from "../selfUpdate";
import { wowupModalStyleCss } from "../sharedStyles";
import { descriptionStyle } from "../steamTheme";
import { registerDirectScroll, scrollTweenTarget } from "../valveScroll";

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
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Armed at once: Y opened the modal, so no D-pad press is in flight.
  useEffect(() => registerDirectScroll(() => boxRef.current), []);

  // Handled (true, no bell) while the notes can still scroll that way; held
  // repeats at an edge are swallowed, one bell per press (as the Details
  // modal, reading the tween's target so the edge is known at once).
  const onGamepadDirection = (evt: GamepadEvent): boolean => {
    const { button, is_repeat } = evt.detail;
    const box = boxRef.current;
    if (!box || (button !== GamepadButton.DIR_UP && button !== GamepadButton.DIR_DOWN)) {
      return false;
    }
    const room = canScroll(button === GamepadButton.DIR_UP ? "up" : "down", {
      scrollTop: scrollTweenTarget(box),
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
    });
    return room || !!is_repeat;
  };

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
          onGamepadDirection={onGamepadDirection as (evt: GamepadEvent) => void}
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
