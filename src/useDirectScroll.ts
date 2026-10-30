import { useEffect, useRef, type RefObject } from "react";
import { GamepadButton, type GamepadEvent } from "@decky/ui";
import { directScrollHandles, registerDirectScroll } from "./valveScroll";

export interface DirectScroll {
  /** The box D-pad/stick Up/Down scroll (valveScroll). */
  boxRef: RefObject<HTMLDivElement | null>;
  /**
   * For the modal's one focus target (its footer button): Up/Down are
   * handled with no bell while the box can scroll that way (directScrollHandles).
   */
  onGamepadDirection: (evt: GamepadEvent) => void;
}

/**
 * Valve's direct scrolling for a read-only modal body whose only focus
 * target is its footer button (the release notes, About's text modals).
 * Armed at once: the button that opened the modal was A or Y, so no D-pad
 * press is in flight. `enabled` false leaves the box to Steam's focus scrolling.
 */
export function useDirectScroll(enabled = true): DirectScroll {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => (enabled ? registerDirectScroll(() => boxRef.current) : undefined), [enabled]);
  const onGamepadDirection = (evt: GamepadEvent): boolean => {
    const { button, is_repeat } = evt.detail;
    const direction =
      button === GamepadButton.DIR_UP ? "up" : button === GamepadButton.DIR_DOWN ? "down" : null;
    return directScrollHandles(direction, !!is_repeat, boxRef.current);
  };
  // Steam reads the boolean; @decky/ui types the handler as void.
  return { boxRef, onGamepadDirection: onGamepadDirection as (evt: GamepadEvent) => void };
}
