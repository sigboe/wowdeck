/**
 * Focus memory by identity (guide S21). The QAM panel is torn down and built
 * again whenever a modal, a dropdown menu or the file picker opens (G4), and
 * Steam then puts focus back by position, which lands on a different row as
 * soon as sections above it load in a different order. Valve's own pages keep
 * focus by identity instead (Tabs saves and restores a focus snapshot per tab).
 * This module does the same for our rows: each focus target has a stable key
 * per view, the last focused key survives remounts in module scope, and the
 * remembered row is both Steam's `preferredFocus` and focused again after a
 * remount. Not yet verified on a Deck.
 */

export interface FocusableElement {
  focus: () => void;
  querySelector?: (selector: string) => FocusableElement | null;
  matches?: (selector: string) => boolean;
}

/** How long a restore waits for its row to appear (lists load after mounting). */
export const PENDING_RESTORE_MS = 2000;

/**
 * Steam puts the class `Focusable` on every navigation node, and
 * `tabindex="-1"` only on the ones that can take focus (groups have none;
 * read from a live dialog's DOM, 2026-10-15). A DialogButton is a `<button>`
 * and focusable without one while enabled (DEVICE 2026-10-20, PC-16).
 */
const FOCUSABLE_INSIDE = ".Focusable[tabindex], button.Focusable:not(:disabled)";

/** Observes focus-memory writes: (view, key) for every remembered row. */
export type MemoryListener = (view: string, key: string) => void;

const remembered = new Map<string, string>();
const pending = new Map<string, { key: string; until: number }>();
const listeners = new Set<MemoryListener>();

/**
 * Observe focus-memory writes. Every row that gains focus reports through
 * rememberFocus (FocusSlot's onGamepadFocus), and so does a jump's chosen
 * landing row (requestFocus remembers it) — the Options jump uses that to
 * end its highlight once focus moves on (optionsJump.ts). Returns the
 * unsubscribe. Not cleared by resetFocusMemory: this is wiring, not
 * remembered state.
 */
export function subscribeFocusMemory(listener: MemoryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
let schedule: (fn: () => void) => void = (fn) =>
  typeof requestAnimationFrame === "function" ? void requestAnimationFrame(() => fn()) : fn();
let now: () => number = () => Date.now();
const elements = new Map<string, { el: FocusableElement; wrapper: boolean }>();

const slot = (view: string, key: string) => `${view}\u0000${key}`;

export function rememberFocus(view: string, key: string): void {
  remembered.set(view, key);
  for (const listener of [...listeners]) {
    listener(view, key);
  }
  // The user moved on: a restore still waiting for another row must not pull focus back.
  if (pending.get(view)?.key !== key) {
    pending.delete(view);
  }
}

export function rememberedFocus(view: string): string | undefined {
  return remembered.get(view);
}

export function forgetFocus(view: string): void {
  remembered.delete(view);
}

/**
 * Track the element for `key` while it is mounted (pass null on unmount).
 * `wrapper`: the element is a non-focusable group around the real control
 * (a TextField or dropdown), so focus goes to the first focusable element
 * inside it. A row that is itself the focus target is focused directly, never
 * a child.
 */
export function registerFocusElement(
  view: string,
  key: string,
  el: FocusableElement | null,
  wrapper = false,
): void {
  if (el) {
    elements.set(slot(view, key), { el, wrapper });
    const waiting = pending.get(view);
    if (waiting?.key === key) {
      if (now() > waiting.until) {
        pending.delete(view);
      } else {
        // Only consumed once the row can take focus: a row that renders
        // disabled first (its data loads after the remount) is tried again on
        // its next render, which registers it again.
        const target = focusableTarget({ el, wrapper });
        if (target) {
          pending.delete(view);
          schedule(() => target.focus());
        }
      }
    }
  } else {
    elements.delete(slot(view, key));
  }
}

/**
 * Remember `key` for `view` and focus it now when it can take focus;
 * otherwise as soon as it can, for PENDING_RESTORE_MS. Returns true when an
 * element was focused now.
 */
export function requestFocus(view: string, key: string): boolean {
  rememberFocus(view, key);
  const entry = elements.get(slot(view, key));
  const target = entry ? focusableTarget(entry) : null;
  if (!target) {
    pending.set(view, { key, until: now() + PENDING_RESTORE_MS });
    return false;
  }
  // After the current frame: Steam registers a new element in its navigation
  // tree after React has attached it, and `element.focus()` is what Steam's
  // tree follows (seen live, 2026-10).
  schedule(() => target.focus());
  return true;
}

/**
 * The element that actually takes focus for an entry, or null while it
 * can't: a wrapper slot whose control is not focusable yet (a `Field
 * focusable={false}` while its data loads renders without tabindex), or a
 * row that is not a focus target. Focusing such an element did nothing and
 * the restore was lost (DEVICE 2026-10-17: Export/Import, Manage backups).
 */
function focusableTarget(entry: {
  el: FocusableElement;
  wrapper: boolean;
}): FocusableElement | null {
  if (entry.wrapper) {
    return entry.el.querySelector?.(FOCUSABLE_INSIDE) ?? null;
  }
  return entry.el.matches && !entry.el.matches(FOCUSABLE_INSIDE) ? null : entry.el;
}

/**
 * Focus the remembered row of `view` again after a remount. When the row is
 * not there yet (a list still loading) it is focused as soon as it registers,
 * for PENDING_RESTORE_MS, unless the user focuses something else first.
 */
export function restoreFocus(view: string): boolean {
  const key = remembered.get(view);
  if (key === undefined) {
    return false;
  }
  return requestFocus(view, key);
}

/**
 * Scroll the remembered row of `view` back into the window without moving
 * focus. Showing a list again (switching destinations remounts it) must also
 * bring the scroll with it: the pane's scroll container persists, so it would
 * otherwise open at the previous destination's offset and then jump when focus
 * was restored (owner).
 */
export function revealRemembered(view: string): boolean {
  const key = remembered.get(view);
  if (key === undefined) {
    return false;
  }
  const entry = elements.get(slot(view, key));
  const el = entry?.el as
    (FocusableElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }) | undefined;
  if (!el?.scrollIntoView) {
    return false;
  }
  el.scrollIntoView({ block: "center" });
  return true;
}

/** For tests: clear everything and make focusing synchronous with a fake clock. */
export function resetFocusMemory(clock?: () => number): void {
  remembered.clear();
  elements.clear();
  pending.clear();
  schedule = (fn) => fn();
  now = clock ?? (() => Date.now());
}
