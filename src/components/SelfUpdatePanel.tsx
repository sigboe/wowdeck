import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DialogButton, Field, GamepadButton, type GamepadEvent } from "@decky/ui";
import { QAM_VIEW } from "../qamState";
import { panelOffer, pluginUpdateDot } from "../pluginUpdate";
import { canScroll } from "../scrollEdge";
import { selfUpdateStore } from "../selfUpdate";
import { descriptionStyle } from "../steamTheme";
import { registerDirectScroll, scrollTweenTarget } from "../valveScroll";
import { FocusRow } from "./FocusSlot";
import { UpdateDot } from "./UpdateDot";

/** The notes box's height cap: about six lines, so the panel never grows past the QAM's top third. */
const NOTES_MAX_HEIGHT_PX = 96;
/** Longer than the focusing press takes to reach the raw input listener, shorter than any second press. */
const ARM_AFTER_FOCUS_MS = 100;

/**
 * Options' update panel, floating under the nav bar while the engine offers
 * an installable WoWDeck release: the offer's headline plus the plugin's
 * only Update button ("Preparing…" while staging), then the offer's release
 * notes when it has any. Same row context and focus
 * memory as My Addons' installation switcher.
 */
export function SelfUpdatePanel() {
  const { info, staging } = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const offer = panelOffer(info);
  if (!offer) {
    return null;
  }
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field label={offer.headline} bottomSeparator="none">
          <DialogButton
            style={{ position: "relative", minWidth: 0, width: "auto", padding: "8px 16px" }}
            disabled={staging}
            onClick={() => void selfUpdateStore.runUpdate()}
          >
            {staging ? "Preparing…" : offer.buttonLabel}
            <UpdateDot color={pluginUpdateDot(info)} />
          </DialogButton>
        </Field>
      </FocusRow>
      {offer.releaseNotes && (
        <FocusRow view={QAM_VIEW.settings} id="selfUpdateNotes">
          <ReleaseNotes notes={offer.releaseNotes} />
        </FocusRow>
      )}
    </div>
  );
}

/**
 * The release notes under the Update button, capped in height so long notes
 * never push the button off-screen. The box is one focus target below the
 * button: while it has focus, D-pad Up/Down scrolls it the way the Details
 * modal's pages scroll (valveScroll), and at its top or bottom edge the press
 * falls through to Steam, which moves focus on (Up back to the button).
 * Plain text from the engine (ADR-0004): a React text node, never HTML.
 */
function ReleaseNotes({ notes }: { notes: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  // Armed a moment after focus arrives: the D-pad press that moved focus
  // here reaches the raw input listener too, and must not also scroll
  // (DEVICE 2026-10-27: armed at once, it skipped the first line).
  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    let unregister = () => {};
    const timer = setTimeout(() => {
      unregister = registerDirectScroll(() => boxRef.current);
    }, ARM_AFTER_FOCUS_MS);
    return () => {
      clearTimeout(timer);
      unregister();
    };
  }, [focused]);

  // Handled (true, no bell, focus stays) while the box can still scroll that
  // way; held repeats at an edge are swallowed so a held D-pad stops at the
  // end instead of running on into the rows below. Reads the tween's target,
  // as the Details modal does, so the edge is known before the tween settles.
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

  return (
    <Field
      focusable
      padding="none"
      bottomSeparator="none"
      childrenLayout="below"
      childrenContainerWidth="max"
      onGamepadFocus={() => setFocused(true)}
      onGamepadBlur={() => setFocused(false)}
      onGamepadDirection={onGamepadDirection as (evt: GamepadEvent) => void}
    >
      <div
        ref={boxRef}
        style={{
          ...descriptionStyle,
          maxHeight: NOTES_MAX_HEIGHT_PX,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          padding: "4px 0",
        }}
      >
        {notes}
      </div>
    </Field>
  );
}
