import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Focusable } from "@decky/ui";
import { contentOverlap, floatingTop, scrollMargins, shadowReach } from "../scrollBuffer";

/**
 * Keeps Valve's scroll buffer (scrollBuffer.ts, guide S21) on every focusable
 * row inside `ref`: measures the scroller, its own scroll-padding and the
 * elements floating over its top, and sets `--wowdeck-scroll-margin-top/bottom`,
 * which `.wowdeck-scroll-buffer .Focusable` turns into `scroll-margin`. Steam's
 * own focus scroller then does the scrolling. It re-measures when any of
 * those change size, and the returned function re-measures on demand: call it
 * from `onGamepadFocus` so every focus move checks again (Steam's controller
 * navigation does not move DOM focus, so `focusin` alone is not enough; seen
 * live 2026-10). Not yet verified on a Deck.
 *
 * Options:
 * - `overlays`: the elements floating over the scroller. Default: sticky or
 *   fixed elements inside the scroller that are not inside `ref` (Decky's QAM
 *   title).
 * - `reserveOverlap`: pad the content so it starts below a floating pane that
 *   covers more than the scroller's own padding.
 * - `attach`: pull `ref` up so its first floating pane joins the overlays above
 *   it with no gap (Decky leaves 16 px of padding between its title and plugin
 *   content), re-measured whenever anything changes size.
 *
 * The element carrying the scroll-margin must also use Steam's NoTransform
 * scroll type (STEAM_NO_TRANSFORM_SCROLL): see there.
 */
export interface ScrollBufferOptions {
  overlays?: (el: HTMLElement, scroller: HTMLElement) => HTMLElement[];
  reserveOverlap?: boolean;
  attach?: boolean;
}

/**
 * Steam's `scrollIntoViewType` NoTransform (1; Standard 0,
 * NoTransformSparseContent 2), inherited by every descendant. Required for the
 * scroll buffer to work like Neovim's scrolloff: with Standard, Steam calls the
 * browser's `scrollIntoView({block: "nearest"})`, which treats a row as
 * already visible by its own box inside the scroll padding and ignores
 * `scroll-margin` for that test, so going up the row slid under the floating
 * panes with no scroll and then jumped (DEVICE, synthetic Up presses with
 * per-press measurement, 2026-10-15). Steam's own NoTransform scroller tests
 * `top - scroll-margin < padded top` and scrolls on every press, as Steam's
 * settings pages do; it also ignores CSS transforms (tab slide-ins). Not typed
 * by @decky/ui, so passed as a spread.
 */
export const STEAM_NO_TRANSFORM_SCROLL = { scrollIntoViewType: 1 } as Record<string, unknown>;

/** Largest gap `attach` closes: Decky's padding, not real content. */
const MAX_ATTACH_GAP_PX = 40;

export function useScrollBuffer(
  ref: RefObject<HTMLElement | null>,
  { overlays, reserveOverlap = false, attach = false }: ScrollBufferOptions = {},
): () => void {
  const updateRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const win = el.ownerDocument.defaultView ?? window;
    const initial = scrollParent(el, win);
    if (!initial) {
      return;
    }
    const findOverlays = overlays ?? stickyOverlays(win);
    const update = () => {
      // Re-resolved each time: the box that really scrolls can change as
      // content loads (guide S21).
      const scroller = scrollParent(el, win) ?? initial;
      const top = scroller.getBoundingClientRect().top;
      const found = findOverlays(el, scroller);
      // Panes that float over the list from outside (Decky's title, Steam's
      // tab header), measured where they sit when stuck. `outside` places our
      // own panes; `outsideVisual` adds their shadow or fade, which must not
      // cover a focused row either.
      const outside = floatingTop(
        top,
        found.map((o) => stuckBottom(o, top, win)),
      );
      const outsideVisual = floatingTop(
        top,
        found.map((o) => stuckBottom(o, top, win) + shadowBelow(o, win)),
      );
      // Our own floating panes stick right below those and above them in
      // stacking order, so their shadow cannot fade over our panes (guide S24).
      el.style.setProperty("--wowdeck-pane-top", `${outside}px`);
      el.style.setProperty("--wowdeck-pane-z", String(maxZ(found, win) + 1));
      if (attach) {
        // Where our content would start without the pull, in the scroller's
        // content coordinates, versus where the overlays above end.
        const pulled = -(parseFloat(el.style.marginTop) || 0);
        const natural = el.getBoundingClientRect().top - top + scroller.scrollTop + pulled;
        const gap = natural - outside;
        const pull = gap > 0 && gap <= MAX_ATTACH_GAP_PX ? gap : 0;
        el.style.marginTop = pull ? `${-pull}px` : "";
        // Keep that space, Valve's title-to-content spacing (Steam's
        // `Title + ScrollPanel { padding-top: 16px }`), inside our pane: the
        // pane joins the title with no gap for content to show through, and
        // its tab bar still sits 16 px below the title text.
        el.style.setProperty("--wowdeck-attach-gap", `${pull}px`);
      }
      const panes = Array.from(el.querySelectorAll<HTMLElement>(".wowdeck-float-pane"));
      const ownHeight = panes.reduce((sum, p) => sum + p.getBoundingClientRect().height, 0);
      // Our panes end in Valve's scroll fade (the scroller's --scroll-fade-size).
      const fade =
        parseFloat(win.getComputedStyle(scroller).getPropertyValue("--scroll-fade-size")) || 20;
      el.style.setProperty("--wowdeck-fade-size", `${fade}px`);
      const floating = panes.length ? outside + ownHeight + fade : outsideVisual;
      const cs = win.getComputedStyle(scroller);
      const m = scrollMargins({
        floatingTop: floating,
        paddingTop: parseFloat(cs.scrollPaddingTop) || 0,
        paddingBottom: parseFloat(cs.scrollPaddingBottom) || 0,
        viewportHeight: scroller.clientHeight,
        rowHeight: tallestRow(el),
      });
      el.style.setProperty("--wowdeck-scroll-margin-top", `${m.top}px`);
      el.style.setProperty("--wowdeck-scroll-margin-bottom", `${m.bottom}px`);
      // Steam's NoTransform scroller applies a row's margin only against its
      // nearest overflow box, then that box's own margin against the next.
      // A box with overflow:auto that does not scroll (Steam's DialogBody)
      // would drop the margin, so it carries the same one.
      carryMargins(el, scroller, m, win);
      if (reserveOverlap) {
        // Content must start below the floating pane even if it grew (a bar
        // wrapping to two lines): pad by whatever the scroller's own top
        // padding does not already cover.
        const extra = contentOverlap(floating, parseFloat(cs.paddingTop) || 0);
        el.style.paddingTop = `${extra}px`;
      }
    };
    updateRef.current = update;
    update();
    const ro = new win.ResizeObserver(update);
    ro.observe(initial);
    ro.observe(el);
    findOverlays(el, initial).forEach((o) => ro.observe(o));
    el.querySelectorAll<HTMLElement>(".wowdeck-float-pane").forEach((p) => ro.observe(p));
    el.addEventListener("focusin", update);
    // Valve's scroll fade shows at an edge only while content continues past
    // it (Steam's ScrollFade drops the top fade at scrollTop 0): our pane's
    // fade follows the same rule.
    const onScroll = () => el.toggleAttribute("data-wowdeck-scrolled", initial.scrollTop > 0);
    onScroll();
    initial.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      updateRef.current = () => {};
      ro.disconnect();
      el.removeEventListener("focusin", update);
      initial.removeEventListener("scroll", onScroll);
    };
    // Once per mount; size changes and focus moves trigger re-measuring.
  }, []);
  return useCallback(() => updateRef.current(), []);
}

/** Rows taller than this (a diagnostics text box) are scrolled through, not fitted. */
const MAX_ROW_PX = 120;

/** The tallest ordinary focusable row inside `el` (Steam marks those with tabindex). */
function tallestRow(el: HTMLElement): number {
  let tallest = 0;
  el.querySelectorAll<HTMLElement>(".Focusable[tabindex]").forEach((r) => {
    const h = r.getBoundingClientRect().height;
    if (h <= MAX_ROW_PX && h > tallest) {
      tallest = h;
    }
  });
  return tallest || 60;
}

/**
 * Where an overlay's bottom edge is when it is stuck: a sticky element's own
 * position changes while the list scrolls (lower until it sticks), so use its
 * `top` plus its height; others as drawn.
 */
function stuckBottom(o: HTMLElement, scrollerTop: number, win: Window): number {
  const cs = win.getComputedStyle(o);
  const r = o.getBoundingClientRect();
  if (cs.position === "sticky") {
    return scrollerTop + (parseFloat(cs.top) || 0) + r.height;
  }
  return r.bottom;
}

function isOverflowBox(p: HTMLElement, win: Window): boolean {
  return /(auto|scroll)/.test(win.getComputedStyle(p).overflowY);
}

function scrolls(p: HTMLElement): boolean {
  return p.scrollHeight > p.clientHeight + 1;
}

/**
 * The ancestor that really scrolls: the nearest overflow box whose content is
 * taller than it. Steam's DialogBody has overflow:auto but never scrolls, so
 * the first overflow box is not enough. Falls back to the first one while
 * nothing is tall enough to scroll yet.
 */
function scrollParent(el: HTMLElement, win: Window): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (isOverflowBox(p, win)) {
      first ??= p;
      if (scrolls(p)) {
        return p;
      }
    }
  }
  return first;
}

function carryMargins(
  el: HTMLElement,
  scroller: HTMLElement,
  m: { top: number; bottom: number },
  win: Window,
): void {
  for (let p = el.parentElement; p && p !== scroller; p = p.parentElement) {
    if (isOverflowBox(p, win) && !scrolls(p)) {
      p.style.scrollMarginTop = `${m.top}px`;
      p.style.scrollMarginBottom = `${m.bottom}px`;
    }
  }
}

/** How far an element's box-shadow reaches below its box (Decky's title: 7 px blur + 12 px spread). */
function shadowBelow(o: HTMLElement, win: Window): number {
  let reach = 0;
  for (const pseudo of [null, "::before", "::after"]) {
    const shadow = win.getComputedStyle(o, pseudo).boxShadow;
    reach = Math.max(reach, shadowReach(shadow));
  }
  return reach;
}

function maxZ(els: HTMLElement[], win: Window): number {
  return els.reduce((z, e) => Math.max(z, parseInt(win.getComputedStyle(e).zIndex, 10) || 0), 0);
}

function stickyOverlays(win: Window) {
  return (el: HTMLElement, scroller: HTMLElement): HTMLElement[] =>
    // Our own subtree is skipped before any style is read: it is most of the DOM.
    Array.from(scroller.querySelectorAll<HTMLElement>("*"))
      .filter((o) => !el.contains(o) && !o.contains(el))
      .filter((o) => {
        const pos = win.getComputedStyle(o).position;
        return pos === "sticky" || pos === "fixed";
      });
}

/** A block whose focusable rows keep Valve's scroll buffer (modals, page tabs). */
export function ScrollBuffer({
  children,
  ...options
}: ScrollBufferOptions & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const remeasure = useScrollBuffer(ref, options);
  return (
    <Focusable
      ref={ref}
      className="wowdeck-scroll-buffer"
      onGamepadFocus={remeasure}
      {...STEAM_NO_TRANSFORM_SCROLL}
    >
      {children}
    </Focusable>
  );
}
