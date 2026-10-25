import { resetDestinations } from "./browseDestinations";

export type GetAddonsTab = "search" | "latest" | "popular" | "url";

/** The four destinations in list order (Search, Latest, Popular, Manual Install). */
export const BROWSE_TABS: GetAddonsTab[] = ["search", "latest", "popular", "url"];

/**
 * Focus-memory view per destination (focusMemory.ts). The list destinations
 * remember their focused row and scroll position here, so leaving the pane for
 * the destination list and coming back returns to the same place. Search and
 * Manual Install remember their result rows (and the file flow's controls)
 * too, but only for a modal round-trip (enterBrowseSession): re-entering
 * them from the list lands on their field.
 */
export const browseFocusView = (tab: GetAddonsTab): string => `qam.browse.${tab}`;

/**
 * Which part of Get Addons holds focus: the plugin-tab nav bar ("nav", the
 * collapsed landing), the destination list ("list"), or the browse pane
 * ("pane"). Widened mode keys off the last two; see the machine below.
 */
export type BrowseFocusZone = "nav" | "list" | "pane";

export const pageState: { tab: GetAddonsTab } = { tab: "search" };

export const browseZone: { zone: BrowseFocusZone } = { zone: "nav" };

/**
 * Widened mode (glossary): whether the browse session wants the QAM opened to
 * its full width beside the pane. Module scope on purpose: the panel remounts
 * for every modal (guide G4), and the wanted mode must not flap there — the
 * widening service re-derives the DOM from this on re-attach. Collapse only on
 * the explicit triggers: B out of the pane or list, leaving the plugin tab
 * (L1/R1), or the QAM closing. Never apply it directly to the DOM: the
 * widening service (`subscribeWidening`) owns that.
 */
export const widening: { wide: boolean } = { wide: false };

type WideningListener = (wide: boolean) => void;
const wideningListeners: WideningListener[] = [];

/** Register the widening service's applied lever; returns the unsubscribe. */
export function subscribeWidening(listener: WideningListener): () => void {
  wideningListeners.push(listener);
  return () => {
    const i = wideningListeners.indexOf(listener);
    if (i !== -1) {
      wideningListeners.splice(i, 1);
    }
  };
}

/** The one widened-mode transition: notify only when the mode actually changes. */
function setWidened(wide: boolean): void {
  if (widening.wide === wide) {
    return;
  }
  widening.wide = wide;
  for (const listener of [...wideningListeners]) {
    listener(wide);
  }
}

/**
 * Entering the Get Addons plugin tab always lands collapsed on the plugin-tab
 * nav bar (spec story 8): the slid-out state is never restored. Runs on every
 * mount including modal round-trips (guide G4), so widened mode is deliberately
 * NOT touched here: the wanted mode is module state the widening service
 * re-derives on re-attach, and collapsing here would visibly flap the QAM
 * around a modal.
 *
 * The exception: a remount while widened is a modal or menu closing again —
 * from the pane (the details carousel, the Category or release-channel menu)
 * or from the list (the Install into menu). The user never left the widened
 * QAM (owner, 2026-10-20), so the session resumes in that zone and returns it:
 * the caller puts focus back where it was. A real entry can never look like
 * this: every way out of Get Addons collapses and resets the zone first.
 */
export function enterBrowseSession(): "pane" | "list" | null {
  if (widening.wide && (browseZone.zone === "pane" || browseZone.zone === "list")) {
    return browseZone.zone;
  }
  browseZone.zone = "nav";
  return null;
}

/**
 * Focus observation of the destination list (spec stories 3–4): moving focus
 * onto a destination selects it and slides the QAM open — no press — so the
 * pane can swap to that destination's browse UI immediately.
 */
export function focusDestination(tab: GetAddonsTab): void {
  pageState.tab = tab;
  browseZone.zone = "list";
  setWidened(true);
}

/** Focus observation of the pane (Right/A, or a press inside it). */
export function enterBrowsePane(): void {
  browseZone.zone = "pane";
  setWidened(true);
}

/**
 * B/Left out of the pane, B out of the list, or focus leaving the Get Addons
 * content: slide the QAM closed and reset the zone. The destination selection
 * is kept so the list stays where it was; nothing re-widens until a
 * destination gains focus again.
 */
export function popBrowseToNav(): void {
  browseZone.zone = "nav";
  setWidened(false);
}

/**
 * Left out of the pane returns focus to the destination list, still widened:
 * the two columns are one surface, so this is navigation inside it, not leaving
 * it. The selection is kept and the caller refocuses the highlighted
 * destination. Only B/Left-out-of-the-list collapses (popBrowseToNav).
 */
export function popBrowseToList(): void {
  browseZone.zone = "list";
  setWidened(true);
}

/**
 * Leaving the Get Addons plugin tab (L1/R1 bumper-cycling to another QAM tab,
 * spec story 7): widened mode falls closed on the way out, so the next
 * re-entry lands collapsed on the nav bar (spec story 8).
 */
export function leaveBrowseSession(): void {
  browseZone.zone = "nav";
  setWidened(false);
}

/**
 * Open modals that hide the QAM window without the user closing it (PC-09).
 * Decky renders plugin content only while the QAM is visible (guide G4), so
 * opening the details carousel hides the QAM; that hide is not a close, and
 * must not end the session, or closing the carousel lands collapsed instead of
 * back on the row it was opened from.
 */
let modalHolds = 0;

/** Hold the browse session while a modal is up; call the result when it closes (idempotent). */
export function holdBrowseSessionForModal(): () => void {
  modalHolds++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      modalHolds--;
    }
  };
}

/**
 * A Steam popup opened from Get Addons (a dropdown's menu, a context menu)
 * hides the QAM window too while it is up (DEVICE 2026-10-20: the Category
 * menu), so that hide is not a close either. Set right before the popup shows;
 * the QAM showing again clears it.
 */
let popupOpen = false;

/** Call right before showing a dropdown or context menu over the QAM. */
export function popupOpening(): void {
  popupOpen = true;
}

/**
 * A dropdown menu's own onMenuWillOpen: that menu hides the QAM window too,
 * so mark the hide as not a close, then show the menu. Valve's dropdown hands
 * the showing to the handler — the menu opens only when `showMenu` runs
 * (DEVICE 2026-10-20, GA-9: the picker and Installation menus) — so passing
 * `popupOpening` alone would leave the bar's menus shut and `popupOpen`
 * stuck true. Every dropdown in the browse UI goes through this.
 */
export function showWithoutClosing(showMenu: () => void): void {
  popupOpening();
  showMenu();
}

/** The QAM window was hidden: a real close ends the session; a modal or popup does not. */
export function qamHidden(): void {
  if (modalHolds === 0 && !popupOpen) {
    leaveBrowseSession();
  }
}

/** The QAM window is showing again: any popup over it has closed. */
export function qamShown(): void {
  popupOpen = false;
}

/**
 * Another installation was selected: the destinations' results depend on its
 * game version (browseDestinations.ts), and the session lands collapsed.
 */
export function resetBrowseSessionState(): void {
  resetDestinations();
  // The nav bar is the collapsed landing: never leave the QAM widened there.
  popBrowseToNav();
}
