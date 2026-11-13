import { GamepadButton, type GamepadEvent } from "@decky/ui";
import { focusIfReady } from "./focusMemory";
import { QAM_VIEW } from "./qamState";

let origin: HTMLElement | null = null;
let scroll: { element: HTMLElement; top: number }[] = [];

/** Called by the Options group after its children's direction handlers. */
export function optionsUpdateDirection(event: GamepadEvent): boolean {
  if (event.detail.button !== GamepadButton.DIR_RIGHT) return false;
  const target = event.target as HTMLElement | null;
  const row = target?.closest<HTMLElement>("[data-options-row]");
  if (!target || !row) return false;
  const focused = row.querySelector<HTMLElement>(".gpfocus") ?? target;
  const rect = focused.getBoundingClientRect();
  // Preserve a row's own horizontal controls before taking its right exit.
  const next = [
    ...row.querySelectorAll<HTMLElement>(".Focusable[tabindex], button:not(:disabled)"),
  ].some((el) => {
    const box = el.getBoundingClientRect();
    return (
      el !== focused &&
      !el.contains(focused) &&
      box.left >= rect.right &&
      box.right > rect.right &&
      box.top < rect.bottom &&
      box.bottom > rect.top
    );
  });
  if (next) return false;
  const savedScroll: typeof scroll = [];
  for (let el: HTMLElement | null = row; el; el = el.parentElement) {
    savedScroll.push({ element: el, top: el.scrollTop });
  }
  if (!focusIfReady(QAM_VIEW.settings, "selfUpdateAction")) return false;
  origin = focused;
  scroll = savedScroll;
  return true;
}

/** Left returns to the exact control and restores the list's previous offset. */
export function updateReturnDirection(event: GamepadEvent): boolean {
  if (event.detail.button !== GamepadButton.DIR_LEFT || !origin?.isConnected) return false;
  origin.focus();
  for (const { element, top } of scroll) element.scrollTop = top;
  origin = null;
  scroll = [];
  return true;
}
