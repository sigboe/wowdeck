import { useRef, useState, type FocusEvent, type ReactNode } from "react";
import { DialogButton, Focusable, GamepadButton, type GamepadEvent } from "@decky/ui";
import { FaCheck, FaChevronDown } from "react-icons/fa";
import { STEAM } from "../steamTheme";

/**
 * A browse bar segment's picker (ADR 0002, revised 2026-10-24): the choices
 * open as a list INSIDE the pane, never as a Steam context-menu popup. A
 * popup hides the whole QAM BrowserView, and when it closes Steam replays the
 * QAM's entrance — the view is placed 300 px right of the widened target,
 * then slides back over ~300 ms — which read as the widened QAM contracting
 * part-way and widening again (PC-20, DEVICE 2026-10-24). The in-pane list
 * also keeps the panel mounted (no G4 round trip, no focus restore) and
 * focus never leaves the pane.
 *
 * Shape: Valve's dropdown vocabulary. The segment keeps its caption and its
 * button (BrowseBar; the value stays inside the button as before), and the
 * open list is the context-menu column — current choice checked, Steam's own
 * DialogButton focus as the highlight. A picks and returns focus to the
 * button, B cancels the same way, Left/Right do nothing under the list (the
 * pane's Left handling must not fire there), Up/Down are the list's own
 * movement clamped at its ends (Steam's tree navigation escapes the overlay
 * at the edges and the close-on-blur read as the menu closing on
 * navigation), and focus leaving the list closes it.
 */
export interface SegmentChoice<T> {
  /** The pick's value; null is a real choice ("All categories"), not "none". */
  data: T;
  label: string;
}

export function SegmentMenu<T>({
  menuLabel,
  choices,
  selected,
  onPick,
  renderValue,
}: {
  /** The menu's name for the button's label; the caption above it is BrowseBar's. */
  menuLabel: string;
  choices: SegmentChoice<T>[];
  /** The picked choice's data (null: nothing picked or "All categories"). */
  selected: T | null;
  onPick: (data: T) => void;
  /** The button's value renderer (BAR_DROPDOWN_VALUE keeps it inside the button). */
  renderValue: (value: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The button is queried through its wrapper: @decky/ui's DialogButton does
  // not promise a forwarded ref.
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The focused choice's index, kept outside the DOM: Steam has cleared
  // activeElement by the time a button event reaches us (DEVICE 2026-10-23),
  // so the focus handler and the D-pad movement track it together.
  const cursorRef = useRef(0);

  const focusChoice = (index: number) => {
    const clamped = Math.max(0, Math.min(choices.length - 1, index));
    cursorRef.current = clamped;
    // focus() scrolls the scrollable list by itself; an already-focused entry
    // is already visible.
    listRef.current?.querySelector<HTMLElement>(`[data-seg-index="${clamped}"]`)?.focus();
  };

  const focusTrigger = () => {
    setTimeout(() => triggerRef.current?.querySelector("button")?.focus(), 0);
  };

  const openList = () => {
    // Land on the current choice, like Valve's dropdowns do.
    const initial = Math.max(
      0,
      choices.findIndex((c) => c.data === selected),
    );
    cursorRef.current = initial;
    setOpen(true);
    // Steam needs the node registered before it can take focus (guide G7).
    setTimeout(() => focusChoice(initial), 0);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      focusTrigger();
    }
  };

  const pick = (choice: SegmentChoice<T>) => {
    onPick(choice.data);
    close(true);
  };

  const onListButtonDown = (evt: GamepadEvent) => {
    const button = evt.detail.button;
    if (button === GamepadButton.CANCEL) {
      evt.preventDefault();
      evt.stopPropagation();
      close(true);
      return;
    }
    if (button === GamepadButton.DIR_UP || button === GamepadButton.DIR_DOWN) {
      // The list moves itself, clamped at its ends: Steam's tree navigation
      // escapes the overlay there. The button event comes BEFORE Steam's
      // navigation and preventDefault cancels it (DEVICE 2026-10-24, probe).
      evt.preventDefault();
      evt.stopPropagation();
      focusChoice(cursorRef.current + (button === GamepadButton.DIR_UP ? -1 : 1));
      return;
    }
    // A vertical list: Left/Right have nothing to move to, and unhandled they
    // would run the pane's Left handling (out of the pane) under the menu.
    if (button === GamepadButton.DIR_LEFT || button === GamepadButton.DIR_RIGHT) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  const onListBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget;
    // Null: Steam clears DOM focus around its own navigation bookkeeping, which
    // is not an exit. Inside: focus moved within the list.
    if (!(to instanceof Node) || listRef.current?.contains(to)) {
      return;
    }
    // Focus landed outside the list (a touch elsewhere, the pane's own
    // navigation): close without stealing focus from wherever it landed.
    setOpen(false);
  };

  const selectedLabel = choices.find((c) => c.data === selected)?.label ?? "";

  return (
    <div>
      <div ref={triggerRef}>
        <DialogButton
          aria-label={menuLabel}
          onClick={() => (open ? close(true) : openList())}
          style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}
        >
          {renderValue(selectedLabel)}
          <FaChevronDown style={{ flex: "none", width: "10px", color: STEAM.textMuted }} />
        </DialogButton>
      </div>
      {open && (
        // The ref sits on a plain div: @decky/ui's Focusable does not forward
        // refs, and a null listRef read every in-list move as focus leaving
        // (the close on Down, DEVICE 2026-10-24).
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "0",
            right: "0",
            zIndex: "30",
          }}
        >
          <Focusable
            flow-children="column"
            className="wowdeck-segment-menu"
            onButtonDown={onListButtonDown}
            onBlur={onListBlur}
          >
            {choices.map((choice, index) => (
              <DialogButton
                key={String(choice.data)}
                data-seg-index={index}
                aria-label={choice.label}
                className="wowdeck-segment-menu-item"
                onGamepadFocus={() => (cursorRef.current = index)}
                onClick={() => pick(choice)}
              >
                <span className="wowdeck-segment-menu-label">{choice.label}</span>
                {choice.data === selected && (
                  <FaCheck style={{ flex: "none", width: "12px", color: STEAM.positive }} />
                )}
              </DialogButton>
            ))}
          </Focusable>
        </div>
      )}
    </div>
  );
}
