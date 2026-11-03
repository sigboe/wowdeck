/**
 * LB/RB section navigation.
 *
 * Mechanism investigated live on the reference Deck: Decky's official
 * `Tabs` component (@decky/ui) gets LB/RB cycling "for free" from Steam
 * itself, but it always renders full-width always-visible tab titles —
 * adopting it would conflict with the explicit requirement to preserve
 * our compact "active expands, others collapse to icon" TopNav design.
 * So instead of borrowing the widget, we borrow the underlying input
 * API Steam itself uses: `window.SteamClient.Input
 * .RegisterForControllerInputMessages(cb)`, which fires
 * `cb(controllerIndex, buttonCode, pressed)` for every digital button on
 * every connected controller, Steam-normalized across controller brands
 * (this is the same layer Big Picture/gamepad-mode UI uses generally —
 * not Deck-specific). Button codes were captured empirically via CDP
 * (see docs/shoulder-nav-investigation.md): LB = 30, RB = 31.
 *
 * Checked the installed SteamGridDB plugin's bundled source for
 * precedent: its shoulder-cycling comes from @decky/ui's `Tabs` for the
 * same reason noted above, not a custom handler — so there was no
 * existing reusable "raw button -> action" pattern to adopt verbatim;
 * this hook is the project's first.
 */

export const STEAM_BUTTON_LB = 30;
export const STEAM_BUTTON_RB = 31;
/**
 * D-pad Left/Right (gallery viewer). Captured live the same way as
 * LB/RB: registered a capture listener via
 * SteamClient.Input.RegisterForControllerInputMessages, pressed each
 * direction, and read the resulting buttonCode back. The left analog
 * stick produces the *same* codes when nudged left/right (Steam
 * normalizes it to the same logical d-pad buttons for UI navigation),
 * so one handler covers both without extra work.
 */
export const STEAM_BUTTON_DPAD_LEFT = 22;
export const STEAM_BUTTON_DPAD_RIGHT = 23;
/**
 * D-pad Up/Down (controller-scrolling the Details modal's
 * Description/Changelog text). Captured the same way as the others,
 * live, via a temporary `RegisterForControllerInputMessages` capture
 * while pressing each direction on a real controller: Up = 20, Down =
 * 21 — fits the same sequential numbering as Left (22) / Right (23)
 * exactly, but verified rather than assumed from that pattern alone.
 */
export const STEAM_BUTTON_DPAD_UP = 20;
export const STEAM_BUTTON_DPAD_DOWN = 21;

export interface ControllerInputMessage {
  controllerIndex: number;
  buttonCode: number;
  pressed: boolean;
}

/** Steam's own controller-input bridge — minimal shape we rely on. */
export interface SteamClientInput {
  RegisterForControllerInputMessages: (
    callback: (controllerIndex: number, buttonCode: number, pressed: boolean) => void,
  ) => { unregister: () => void };
}

declare global {
  interface Window {
    SteamClient?: { Input?: SteamClientInput };
  }
}

/**
 * Given the current index in a fixed-length section list, compute the
 * next index for an LB (-1) or RB (+1) press. Clamped, never wraps —
 * pressing LB on the first section or RB on the last is a no-op
 * (returns the same index), per the required behavior table.
 */
export function nextSectionIndex(current: number, direction: -1 | 1, count: number): number {
  const next = current + direction;
  if (next < 0 || next >= count) {
    return current;
  }
  return next;
}

/**
 * Generalizes nextSectionIndex to work by id rather than a
 * raw array index, for callers whose selectable list isn't the full,
 * fixed section list — AddonDetailsModal's Gallery tab is excluded
 * when the result has no screenshots (SectionNav's own `disabled`,
 * which already blocks a click from selecting it the same way).
 * Same clamp-not-wrap convention as nextSectionIndex (reused directly,
 * not reimplemented) — LB on the first selectable id or RB on the
 * last is a no-op. Returns `current` unchanged if it isn't present in
 * `selectableIds` at all; should not happen in practice, since the
 * active section can only ever be one that was selectable in the first
 * place.
 */
export function nextSelectableId<T>(current: T, direction: -1 | 1, selectableIds: readonly T[]): T {
  const index = selectableIds.indexOf(current);
  if (index === -1) {
    return current;
  }
  return selectableIds[nextSectionIndex(index, direction, selectableIds.length)]!;
}

/** Shortest horizontal travel that counts as a page swipe (PC-06). */
export const SWIPE_MIN_PX = 50;

/**
 * Which way a finished touch gesture pages a carousel: -1 for a swipe right
 * (previous page), 1 for a swipe left (next page), 0 for anything else. A
 * gesture counts only when it travelled SWIPE_MIN_PX sideways and mostly
 * sideways, so a vertical scroll inside a page never turns the page.
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) {
    return 0;
  }
  return dx < 0 ? 1 : -1;
}

/**
 * Subscribe to LB/RB presses for as long as the returned cleanup
 * function isn't called. Only reacts on the press edge (pressed ===
 * true), not the release, so holding the button doesn't repeat-fire —
 * matches what was observed live (one press -> exactly one true then
 * one false message, no auto-repeat from Steam's side).
 */
export function registerShoulderNav(onLb: () => void, onRb: () => void): () => void {
  const input = window.SteamClient?.Input;
  if (!input) {
    return () => {};
  }
  const registration = input.RegisterForControllerInputMessages(
    (_controller, buttonCode, pressed) => {
      if (!pressed) {
        return;
      }
      if (buttonCode === STEAM_BUTTON_LB) {
        onLb();
      } else if (buttonCode === STEAM_BUTTON_RB) {
        onRb();
      }
    },
  );
  return () => registration.unregister();
}

/**
 * Subscribe to D-pad/left-stick Left/Right presses — same
 * edge-triggered, press-only semantics as registerShoulderNav. Used by
 * the gallery image viewer so Left/Right
 * move between images regardless of which focusable element (if any)
 * currently has focus, matching the Previous/Next buttons' own action
 * rather than only moving focus between them.
 */
export function registerDirectionalNav(onLeft: () => void, onRight: () => void): () => void {
  const input = window.SteamClient?.Input;
  if (!input) {
    return () => {};
  }
  const registration = input.RegisterForControllerInputMessages(
    (_controller, buttonCode, pressed) => {
      if (!pressed) {
        return;
      }
      if (buttonCode === STEAM_BUTTON_DPAD_LEFT) {
        onLeft();
      } else if (buttonCode === STEAM_BUTTON_DPAD_RIGHT) {
        onRight();
      }
    },
  );
  return () => registration.unregister();
}

/** The part of Steam's gamepad event the panel's bumper handler needs. */
interface PanelButtonEvent {
  detail: { button: number };
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Own the panel's two bumper input paths, including presses on Decky's title bar.
 * Steam's gamepad focus can be inside the panel while DOM focus is BODY. Using
 * activeElement to split ownership then handles the same press twice.
 * DEVICE 2026-11-03: SSH/CEF, virtual-pad R1 and a DOM-focus fixture.
 *
 * Native input owns tab changes only while the active tree's m_ID starts with
 * QuickAccess (getFocusNavController().GetActiveNavTree(), @decky/ui). The
 * keyboard uses a separate tree even while our panel stays mounted. If that
 * lookup or the native bridge is unavailable, focused events own navigation.
 */
export function createPanelShoulderNavigation({
  getRoot,
  step,
  buttons,
  activeTreeId,
}: {
  getRoot: () => HTMLElement | null;
  step: (direction: -1 | 1) => void;
  buttons: { left: number; right: number };
  activeTreeId: () => unknown;
}): { onButtonDown: (event: PanelButtonEvent) => void; subscribe: () => () => void } {
  const nativeInput =
    typeof window.SteamClient?.Input?.RegisterForControllerInputMessages === "function";
  const treeId = (): string | null => {
    try {
      const id = activeTreeId();
      return typeof id === "string" ? id : null;
    } catch {
      return null;
    }
  };
  const onButtonDown = (event: PanelButtonEvent) => {
    const button = event.detail.button;
    const direction = button === buttons.left ? -1 : button === buttons.right ? 1 : null;
    if (direction === null) return;
    event.preventDefault();
    event.stopPropagation();
    // The focused event consumes Steam's default action. Native input moves the
    // tab; only a missing bridge/tree falls back to moving it here instead.
    if ((!nativeInput || treeId() === null) && getRoot()?.isConnected) step(direction);
  };
  const raw = (direction: -1 | 1) => {
    if (getRoot()?.isConnected && treeId()?.startsWith("QuickAccess")) step(direction);
  };
  return {
    onButtonDown,
    subscribe: () =>
      registerShoulderNav(
        () => raw(-1),
        () => raw(1),
      ),
  };
}
