/**
 * Depends on: Steam's QAM stylesheet rules keyed on `QAMFriendExpanded` and a
 * hashed companion class (read from the sheets, never hardcoded), the QAM's
 * BasicUI root and `tab_*` container, and a live `QamExpander` (index.tsx
 * installs `QamExpandHook`, qamExpandHook.tsx).
 * Fails as: no widening CSS or no live expander -> `available` false and Get
 * Addons keeps its collapsed layout, one console warning. Never throws.
 * Kill switch: the automatic fallback above; there is no user setting.
 */

/**
 * QAM widening service: the only module that knows how Steam's Quick Access
 * Menu widens (glossary "Widened mode"). Widening has TWO levers, both owned
 * here:
 *
 *  1. DOM/CSS (the QAM window, our tab). Steam's own Friends & Chat tab widens
 *     with classes on the QAM's BasicUI div: the readable `QAMFriendExpanded`
 *     lifts the per-tab 300 px cap and the inner widths, while the 348 px clip
 *     is widened by a hashed companion class (`.O_8CAF… ._3k5MHj`). Both are
 *     discovered from Steam's own stylesheets — neither is hardcoded. This
 *     service adds the same classes and lifts the cap on OUR tab container
 *     only, and re-applies after Steam re-renders (Steam drops the classes when
 *     the active tab changes).
 *  2. Native view (Big Picture). The QAM is a BrowserView as wide as the
 *     widened QAM (854 px) whose VISIBLE width is its native position:
 *     collapsed 348 px show, widened all of it. Steam's placeholder for it
 *     moves it, with Steam's own slide, while it carries Steam's `Expanded`
 *     class (`QamExpander`); this service turns that on and off. Lever 1 only
 *     lifts inner caps; without lever 2 the QAM never visibly slides out.
 *
 * The service reports the mechanism unavailable so Get Addons can fall back to
 * the collapsed layout. Every Steam-facing lookup lives here and selects
 * defensively: readable names first, structural fallbacks second, capability
 * check before touching anything — never a throw.
 *
 * Measurements: "QAM widening measurements" in
 * docs/UI_DEVELOPMENT_BEST_PRACTICES.md; decision: docs/adr/0001-get-addons-widened-qam.md.
 */

import { subscribeWidening } from "../browseSessionState";

const READABLE_WIDENED_CLASS = "QAMFriendExpanded";
/**
 * The one "this is the widened layout" width. The QAM web panel window is
 * always full-screen (854 CSS px) while its visible column is 348 px, so an
 * ancestor this wide is the QAM root, and a Steam rule setting a width this
 * large can only be part of the widening mechanism.
 */
const WIDE_PX = 800;

/**
 * Everything the service knows, in one object (RF-21): the Steam DOM it is
 * bound to, the mode it enforces, the native lever, and the watchers to
 * disarm. Changed only through the named transitions below (`enforce` and
 * its steps, attach/detach, the collapse slide, reset).
 */
interface WideningState {
  /** Our tab content (the anchor everything is derived from), set by attachQamWidening. */
  anchorEl: HTMLElement | null;
  /** The QAM BasicUI root the classes go on. */
  rootEl: HTMLElement | null;
  /** Our tab container, whose 300 px cap is lifted. */
  tabContainerEl: HTMLElement | null;
  /** The hashed classes Steam's widening rules need besides the readable one. */
  companionClasses: string[];
  /** Steam's widening CSS was found at the last attach. */
  available: boolean;
  /** The browse session wants widened mode. */
  desiredWide: boolean;
  /** Our classes are on Steam's DOM (layout listeners hear of every change). */
  applied: boolean;
  /** The native view was last sent widened. */
  nativeApplied: boolean;
  /** The collapse slide (PC-08) is running and the clip is held under it. */
  collapsing: boolean;
  collapseTimer: ReturnType<typeof setTimeout> | null;
  /** Lever 2 (none, or not live: the mechanism is unavailable). */
  expander: QamExpander | null;
  /** The QAM DOM observer and its coalescing timer. */
  observer: MutationObserver | null;
  timer: ReturnType<typeof setTimeout> | null;
  warned: boolean;
}

function initialState(): WideningState {
  return {
    anchorEl: null,
    rootEl: null,
    tabContainerEl: null,
    companionClasses: [],
    available: false,
    desiredWide: false,
    applied: false,
    nativeApplied: false,
    collapsing: false,
    collapseTimer: null,
    expander: null,
    observer: null,
    timer: null,
    warned: false,
  };
}

const state = initialState();

/** The mode part of the state, as enforceStep reads it. */
function modeOf(s: WideningState): Omit<EnforceInput, "bound" | "visible"> {
  return {
    available: s.available,
    desiredWide: s.desiredWide,
    applied: s.applied,
    collapsing: s.collapsing,
    nativeApplied: s.nativeApplied,
  };
}

function warnOnce(what: string, err?: unknown): void {
  if (!state.warned) {
    state.warned = true;
    console.warn(`wowdeck: QAM widening unavailable (${what})`, err ?? "");
  }
}

/**
 * Lever 2's handle: expands the QAM the way Friends & Chat does, by giving
 * Steam's view placeholder its `Expanded` class; Steam's own placeholder then
 * slides the native view (animateIn 300 ms, animateOut 200 ms) and keeps it
 * there through every re-layout of its own (keyboard, modals).
 * `QamExpandHook` (qamExpandHook.tsx) is the Steam implementation.
 *
 * History: on SteamOS 3.8 the Friends store flag alone did this
 * (`SetQAMFriendsChatExpanded`, LIVE 2026-10-21). The arm64 Steam client
 * honours that flag only while the Friends tab is active (DEVICE 2026-10-31,
 * DroidDeck), so there it widened the page but never the view.
 * Not live (another Steam build): `available` false, Get Addons collapsed.
 */
export interface QamExpander {
  setExpanded(expanded: boolean): void;
  /** Steam's QAM renders through it, so `setExpanded` moves the QAM. */
  readonly live: boolean;
}

/**
 * Install the native lever (index.tsx at plugin load). Left unset by default
 * so the module loads and is tested without Steam.
 */
export function setQamExpander(expander: QamExpander | null): void {
  state.expander = expander;
}

function setNativeExpanded(expanded: boolean): void {
  try {
    state.expander?.setExpanded(expanded);
  } catch (err) {
    warnOnce("Steam's QAM expand failed", err);
  }
}

/** Drive the native view, but only on a real transition (never per observer pass). */
function applyNative(wide: boolean): void {
  if (state.nativeApplied === wide) {
    return;
  }
  state.nativeApplied = wide;
  setNativeExpanded(wide);
}

/**
 * How long the clip is held under Steam's collapse slide: its animateOut is
 * 200 ms (sp.js), started on the placeholder's re-render, so one frame more.
 */
export const COLLAPSE_HOLD_MS = 250;

/**
 * The collapse slide (PC-08). The QAM page must keep its widened clip until
 * Steam has slid the native view back, or the slide would expose the page's
 * empty right side once the 348 px clip returns. So a collapse holds the clip
 * only (`holdClipOnly`), clears Steam's flag, and reverts the rest
 * `COLLAPSE_HOLD_MS` later.
 */

function cancelCollapse(): void {
  state.collapsing = false;
  if (state.collapseTimer) {
    clearTimeout(state.collapseTimer);
    state.collapseTimer = null;
  }
}

function startCollapse(): void {
  if (state.collapsing) {
    return;
  }
  state.collapsing = true;
  applyNative(false);
  state.collapseTimer = setTimeout(() => {
    state.collapseTimer = null;
    state.collapsing = false;
    enforce();
  }, COLLAPSE_HOLD_MS);
}

/**
 * How long Steam re-render churn is coalesced before one enforcement pass
 * (homeBadge uses the same pattern at 250 ms; widening re-applies faster so
 * the slide is not visibly interrupted after a class drop).
 */
export const WIDENING_REAPPLY_MS = 100;

function viewOf(el: Element): (Window & { MutationObserver?: typeof MutationObserver }) | null {
  return el.ownerDocument?.defaultView ?? null;
}

function disarmObserver(): void {
  state.observer?.disconnect();
  state.observer = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

type LayoutListener = (wide: boolean) => void;
const layoutListeners: LayoutListener[] = [];

/**
 * Follow the layout the QAM page actually has. Get Addons draws its widened
 * layout (the pane) from this, not from the wanted mode: during a collapse
 * slide the mode is already collapsed but the page must stay widened under the
 * moving view (PC-08). Returns the unsubscribe.
 */
export function subscribeQamLayout(listener: LayoutListener): () => void {
  layoutListeners.push(listener);
  return () => {
    const i = layoutListeners.indexOf(listener);
    if (i >= 0) {
      layoutListeners.splice(i, 1);
    }
  };
}

function setApplied(next: boolean): void {
  if (state.applied === next) {
    return;
  }
  state.applied = next;
  for (const listener of [...layoutListeners]) {
    listener(next);
  }
}

/** Add exactly what Steam's own widening adds: the two root classes and our cap lift. */
function applyToDom(): void {
  if (!state.rootEl || !state.tabContainerEl) {
    return;
  }
  addClasses(state.rootEl, [READABLE_WIDENED_CLASS, ...state.companionClasses]);
  state.tabContainerEl.style.maxWidth = "none";
  setApplied(true);
}

/**
 * Only the tokens missing: `classList.add` rewrites the attribute even when
 * nothing changes, and that write would wake our own observer into a
 * re-apply every WIDENING_REAPPLY_MS for as long as the QAM stays widened.
 */
function addClasses(el: Element, tokens: string[]): void {
  const missing = tokens.filter((token) => !el.classList.contains(token));
  if (missing.length > 0) {
    el.classList.add(...missing);
  }
}

/**
 * Remove the tokens from the root and from every copy under it: after a modal
 * Steam renders the QAM content in a nested BasicUI whose className copies
 * the root's, our classes included (DEVICE 2026-10-20).
 */
function removeClasses(root: Element, tokens: string[]): void {
  const selector = tokens.map((token) => `.${token}`).join(",");
  for (const el of [root, ...Array.from(root.querySelectorAll(selector))]) {
    if (tokens.some((token) => el.classList.contains(token))) {
      el.classList.remove(...tokens);
    }
  }
}

/**
 * The collapse hold: keep only the visible clip widened (the companion class)
 * so no empty strip shows behind the sliding view, but give every content
 * width back — the readable class and our cap lift would stretch whatever
 * renders meanwhile (our tab bar, My Addons, Options, Decky's plugin list).
 * Get Addons' pane is `position: fixed` and needs only the clip.
 */
function holdClipOnly(): void {
  if (!state.rootEl || !state.tabContainerEl) {
    return;
  }
  removeClasses(state.rootEl, [READABLE_WIDENED_CLASS]);
  addClasses(state.rootEl, state.companionClasses);
  state.tabContainerEl.style.maxWidth = "";
}

/** Remove them, restoring the stylesheet's 300 px cap exactly as the on-device proof did. */
function revertFromDom(): void {
  if (!state.rootEl || !state.tabContainerEl) {
    return;
  }
  removeClasses(state.rootEl, [READABLE_WIDENED_CLASS, ...state.companionClasses]);
  state.tabContainerEl.style.maxWidth = "";
  setApplied(false);
}

/**
 * Our tab container: the ancestor Steam caps at 300 px (`overflow hidden
 * auto`). Found by the readable `tab_*` class prefix (ours is
 * `tab_undefined`, Friends' is `tab_Friends` — stable so far), falling back
 * to the measured structure: the ancestor with a 300 px max-width.
 */
function findTabContainer(anchor: HTMLElement, view: Window): HTMLElement | null {
  for (
    let el = anchor.parentElement;
    el && el !== anchor.ownerDocument.body;
    el = el.parentElement
  ) {
    if (Array.from(el.classList).some((c) => c.startsWith("tab_"))) {
      return el;
    }
  }
  for (
    let el = anchor.parentElement;
    el && el !== anchor.ownerDocument.body;
    el = el.parentElement
  ) {
    if (view.getComputedStyle(el).maxWidth === "300px") {
      return el;
    }
  }
  return null;
}

const CLASS_TOKEN = /\.[A-Za-z0-9_-]+/g;

function classTokens(compound: string): string[] {
  return (compound.match(CLASS_TOKEN) ?? []).map((token) => token.slice(1));
}

/**
 * The widening rules Steam ships. Two shapes have been measured:
 *  - the readable `QAMFriendExpanded` lifts the per-tab 300 px cap and the
 *    inner widths (`._2BB6uf`, `._1pXu`), and
 *  - the visible 348 px QAM clip (`._3k5MHj`) is lifted by a *companion*
 *    class alone: `.O_8CAF… ._3k5MHj { max-width: 854px }` (DEVICE
 *    2026-10-19 — the readable class alone left the panel clipped, which is
 *    why the QAM never slid out).
 * So `companions` are every class the widening rules need *besides* the
 * readable one: classes that prefix a widened descendant, plus any class
 * compounded with the readable class on the same element. Classes with their
 * own standalone rules are structural elements, not flags — adding them to the
 * QAM root would restyle it (`._2orc8` is Friends' absolutely-positioned
 * content, `transform: translateX(506px)`) — so they are excluded.
 *
 * `found` reports that Steam's widening rules (keyed on the readable class)
 * exist at all. Nested rules (@media) are walked; unreadable sheets are skipped.
 */
function findWideningCss(doc: Document): { companions: string[]; found: boolean } {
  const ancestorTokens = new Set<string>();
  const standaloneTokens = new Set<string>();
  let readableSeen = false;
  const setsWide = (style: CSSStyleDeclaration | undefined): boolean => {
    if (!style) {
      return false;
    }
    const width = parseFloat(style.width);
    const maxWidth = parseFloat(style.maxWidth);
    return (
      (Number.isFinite(width) && width >= WIDE_PX) ||
      (Number.isFinite(maxWidth) && maxWidth >= WIDE_PX)
    );
  };
  const visit = (rules: unknown): void => {
    if (!rules || typeof rules !== "object") {
      return;
    }
    for (const rule of Array.from(rules as ArrayLike<unknown>)) {
      const r = rule as {
        selectorText?: unknown;
        style?: CSSStyleDeclaration;
        cssRules?: unknown;
      };
      if (r.cssRules && typeof r.cssRules === "object") {
        visit(r.cssRules);
      }
      if (typeof r.selectorText !== "string") {
        continue;
      }
      if (r.selectorText.includes(`.${READABLE_WIDENED_CLASS}`)) {
        readableSeen = true;
      }
      const wide = setsWide(r.style);
      for (const part of r.selectorText.split(",")) {
        const compounds = part
          .trim()
          .split(/[\s>+~]+/)
          .filter(Boolean);
        const target = compounds[compounds.length - 1];
        if (target && classTokens(target).length === 1 && /^\.[A-Za-z0-9_-]+$/.test(target)) {
          standaloneTokens.add(classTokens(target)[0]!);
        }
        if (!wide) {
          continue;
        }
        for (const compound of compounds) {
          const tokens = classTokens(compound);
          if (tokens.includes(READABLE_WIDENED_CLASS) && tokens.length > 1) {
            for (const token of tokens) {
              ancestorTokens.add(token);
            }
          }
        }
        for (const compound of compounds.slice(0, -1)) {
          for (const token of classTokens(compound)) {
            ancestorTokens.add(token);
          }
        }
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit((sheet as CSSStyleSheet).cssRules);
    } catch {
      // cross-origin or otherwise unreadable sheet: skip it
    }
  }
  const companions = Array.from(ancestorTokens).filter(
    (token) => token !== READABLE_WIDENED_CLASS && !standaloneTokens.has(token),
  );
  // Only Steam's own widening rules mean the mechanism is there: other wide
  // rules (`.BasicUI ._2jPMy… { ≥ 800px }`) also yield "companions", and
  // taking those for it slid the view out over a page that could not widen
  // (GA-12 drill, DEVICE 2026-10-20).
  return { companions, found: readableSeen };
}

/**
 * The QAM BasicUI root the classes go on. An ancestor already carries the
 * widened classes when Steam widens Friends itself or ours survived a modal
 * round trip; otherwise the outermost BasicUI, or structurally the outermost
 * ancestor spanning the always full-screen panel (>= 800 px wide), which the
 * inner clip/wrappers are not.
 */
function findQamRoot(
  tabContainer: HTMLElement,
  view: Window,
  companions: string[],
): HTMLElement | null {
  const body = tabContainer.ownerDocument.body;
  // The outermost carrier: a nested BasicUI that Steam renders after a modal
  // copies the root's classes (DEVICE 2026-10-20) and is gone again after the
  // collapse, so binding to it would leave the real root widened.
  let carrier: HTMLElement | null = null;
  for (let el = tabContainer.parentElement; el && el !== body; el = el.parentElement) {
    if (
      el.classList.contains(READABLE_WIDENED_CLASS) ||
      companions.some((c) => el.classList.contains(c))
    ) {
      carrier = el;
    }
  }
  if (carrier) {
    return carrier;
  }
  // Topmost qualifying ancestor, not the nearest: the widening rules target
  // descendants of the class (`.QAMFriendExpanded .<clip>`), and the panel's
  // inner wrappers are already >= 800 px wide while the QAM is clipped. An
  // 806 px wrapper lower down would be an ancestor of nothing those rules
  // target (DEVICE 2026-10-19). Prefer the BasicUI element by name, the
  // outermost one for the same nested copy as above.
  let topmost: HTMLElement | null = null;
  let basicUi: HTMLElement | null = null;
  for (let el = tabContainer.parentElement; el && el !== body; el = el.parentElement) {
    if (Array.from(el.classList).some((c) => c.includes("BasicUI"))) {
      basicUi = el;
    }
    const width = parseFloat(view.getComputedStyle(el).width);
    if (!Number.isNaN(width) && width >= WIDE_PX) {
      topmost = el;
    }
  }
  return basicUi ?? topmost;
}

/** For tests: forget everything without touching the DOM. */
export function resetQamWidening(): void {
  disarmObserver();
  cancelCollapse();
  Object.assign(state, initialState());
}

export function qamWideningStatus(): { available: boolean; applied: boolean } {
  return { available: state.available, applied: state.applied };
}

/** What one enforcement pass knows (see `enforceStep`). */
export interface EnforceInput {
  /** Attached with the mechanism available: anchor, QAM root and tab container found. */
  bound: boolean;
  /** Steam's widening CSS was found (false also before the first attach). */
  available: boolean;
  /** The browse session wants widened mode. */
  desiredWide: boolean;
  /** Our tab content is connected and not display-none (only meaningful when bound). */
  visible: boolean;
  /** Our classes are on Steam's DOM (the page is laid out widened). */
  applied: boolean;
  /** The native view is sliding back and the clip is held under it. */
  collapsing: boolean;
  /** The native view was last sent widened. */
  nativeApplied: boolean;
}

/**
 * One pass's transition:
 *  - `widen`: classes + cap lift on, native view widened;
 *  - `hold`: a collapse slide is running; keep only the clip under it;
 *  - `collapse`: start the collapse slide (hold the clip, slide the view back);
 *  - `revert`: nothing widened is wanted or shown; take everything off;
 *  - `snapCollapse`: detached, and the mode ended meanwhile (a QAM close after
 *    the panel unmounted, story 33): revert and snap the view, nothing to hold for;
 *  - `nativeOff`: no mechanism (Steam's widening CSS or QAM view changed): never leave the
 *    native view widened with nothing to show;
 *  - `none`: detached while still wanted (a modal round trip, G4): keep it.
 */
export type EnforceStep =
  "widen" | "hold" | "collapse" | "revert" | "snapCollapse" | "nativeOff" | "none";

export function enforceStep(s: EnforceInput): EnforceStep {
  if (!s.bound) {
    if (s.applied && !s.desiredWide) {
      return "snapCollapse";
    }
    return s.available ? "none" : "nativeOff";
  }
  if (s.desiredWide && s.visible) {
    return "widen";
  }
  if (s.collapsing) {
    return "hold";
  }
  return s.nativeApplied ? "collapse" : "revert";
}

/**
 * Enforce the desired mode on the DOM. Idempotent by DOM truth, not by a
 * remembered flag: Steam's React re-renders can silently drop our classes, so
 * every pass re-reads what should hold. Applies while widened mode is wanted
 * and the plugin's tab content is actually showing (connected and not
 * display-none — a hidden anchor means another QAM section is active and our
 * widening must not reach it); reverts otherwise. Never throws.
 */
function enforce(): void {
  try {
    const bound = !!(state.available && state.anchorEl && state.rootEl && state.tabContainerEl);
    let visible = false;
    if (bound && state.anchorEl && state.rootEl) {
      const view = viewOf(state.anchorEl);
      if (!view) {
        return;
      }
      visible = state.anchorEl.isConnected;
      for (
        let el: Element | null = state.anchorEl;
        visible && el && el !== state.rootEl.parentElement;
        el = el.parentElement
      ) {
        if (view.getComputedStyle(el).display === "none") {
          visible = false;
        }
      }
    }
    switch (enforceStep({ ...modeOf(state), bound, visible })) {
      case "widen":
        cancelCollapse();
        applyToDom();
        applyNative(true);
        return;
      case "hold":
        // Steam may drop our classes meanwhile, e.g. on a QAM tab change.
        holdClipOnly();
        return;
      case "collapse":
        holdClipOnly();
        startCollapse();
        return;
      case "revert":
        revertFromDom();
        return;
      case "snapCollapse":
        cancelCollapse();
        revertFromDom();
        applyNative(false);
        return;
      case "nativeOff":
        applyNative(false);
        return;
      case "none":
        return;
    }
  } catch (err) {
    warnOnce("enforce failed", err);
  }
}

/** Steam re-renders a lot while the QAM is open; coalesce into one pass (homeBadge pattern). */
function scheduleEnforce(): void {
  if (!state.observer) {
    return;
  }
  if (!state.timer) {
    state.timer = setTimeout(() => {
      state.timer = null;
      enforce();
    }, WIDENING_REAPPLY_MS);
  }
}

/**
 * The machine's single lever (browseSessionState calls this on every widened-
 * mode transition): records whether widened mode is wanted and enforces it.
 * Safe to call before attach (records the desire only) and when unavailable
 * (fallback: nothing happens).
 */
export function setQamWidening(wide: boolean): void {
  state.desiredWide = wide;
  enforce();
}

// The machine produces the wanted mode; this service owns the Steam DOM only
// (UI-02 ticket 02). One binding at module load: every widened-mode transition
// in browseSessionState lands in setQamWidening. The machine module never
// imports this file, so the state machine stays pure and the bare-environment
// tests exercise the fallback world without touching Steam's DOM.
subscribeWidening(setQamWidening);

/**
 * Unbind from the panel content: GetAddonsTab unmounts for every modal,
 * dropdown and file picker (guide G4), and a remount re-attaches with a fresh
 * anchor. Detaching disarms the observer but deliberately does NOT revert —
 * the mode is still wanted, so the QAM must not visibly flap closed around a
 * modal and back open after it. `attachQamWidening` re-derives on re-attach.
 */
export function detachQamWidening(): void {
  disarmObserver();
  state.anchorEl = null;
}

/**
 * Full teardown for plugin unload (definePlugin's onDismount): Steam's DOM
 * outlives a plugin reload, so the widening is reverted unconditionally and
 * the service goes inert no matter what was wanted.
 */
export function stopQamWidening(): void {
  try {
    // Steam's state outlives a plugin reload: a reload mid-widened (or
    // mid-collapse, already cleared) must not leave the QAM slid out with no content.
    cancelCollapse();
    revertFromDom();
    applyNative(false);
  } catch (err) {
    warnOnce("stop failed", err);
  }
  resetQamWidening();
}

/**
 * Bind the service to the plugin's mounted tab content (the anchor everything
 * is derived from). Runs on every Get Addons mount, including the remounts
 * after modals unmount the panel (guide G4). Returns the availability flag;
 * when false, widened mode silently stays off (fallback).
 */
export function attachQamWidening(anchor: HTMLElement): boolean {
  disarmObserver();
  state.anchorEl = anchor;
  state.rootEl = null;
  state.tabContainerEl = null;
  state.companionClasses = [];
  state.available = false;
  // desiredWide survives: it is the state machine's wanted mode, and a
  // remount after a modal (G4) re-derives the DOM from it.
  try {
    const view = viewOf(anchor);
    if (!view) {
      return false;
    }
    if (!state.expander?.live) {
      // Without lever 2 the QAM never visibly widens: stay collapsed.
      warnOnce("Steam's QAM view does not take Expanded");
      return false;
    }
    const tab = findTabContainer(anchor, view);
    if (!tab) {
      warnOnce("no tab container around the plugin");
      return false;
    }
    const wideningCss = findWideningCss(anchor.ownerDocument);
    if (!wideningCss.found) {
      warnOnce("Steam widening CSS not found");
      return false;
    }
    const companions = wideningCss.companions;
    const root = findQamRoot(tab, view, companions);
    if (!root) {
      warnOnce("no QAM root above the tab container");
      return false;
    }
    state.tabContainerEl = tab;
    state.rootEl = root;
    state.companionClasses = companions;
    state.available = true;
    // Re-apply loop: Steam drops our root classes whenever its React
    // re-renders the BasicUI className (active tab change), so watch the QAM
    // DOM — class rewrites included — and re-enforce the desired mode.
    const doc = anchor.ownerDocument;
    // The observer must belong to the anchor's window (jsdom, Steam's panel):
    // the module's own global does not implement it in every environment.
    const MutationObserverCtor = view.MutationObserver;
    if (!MutationObserverCtor) {
      warnOnce("MutationObserver not state.available in this view");
      return false;
    }
    if (doc.body) {
      state.observer = new MutationObserverCtor(scheduleEnforce);
      state.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    enforce();
  } catch (err) {
    warnOnce("attach failed", err);
    state.available = false;
  }
  return state.available;
}
