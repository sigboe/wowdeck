/**
 * Valve's gamepad scrolling, reimplemented from measured SteamOS behaviour
 * (docs/valve-bpm-scrolling.md, sp.js @ changelist 11146165, measured on the
 * reference Deck 2026-10-25). Used where OUR code owns the scrolling (the
 * Details modal's pages); the QAM lists' focus-driven scrolling stays Steam's
 * own NoTransform scroller (guide S21) and is not touched by this module.
 *
 * What is implemented here:
 * - The tween engine (§3.1, modules 84719/47537): a rAF tween of 200 ms with
 *   the "sine" ease-in-out (0.5 − cos(π·u)/2); a tween issued while another
 *   one is in flight starts from the current position with LINEAR timing, so
 *   an interrupt keeps a constant velocity instead of restarting the ease.
 * - Direct-scroll presses (§3.3, module 50908 ScrollOnGamepadDirection): one
 *   D-pad press scrolls 30 % of the viewport with a distance-scaled duration
 *   clamp(distance/1000·200, 300, 500) ms; the next press accumulates from the
 *   previous tween's TARGET (the scrollTop-returns-target trick, §3.1), so a
 *   held D-pad moves at a constant speed.
 * - The auto-repeat staircase (§2.1, module 20505 ButtonRepeatHandler): first
 *   repeat after 400 ms, then every 50 ms, and no repeat when the scroller has
 *   no room left in that direction (measured: holds at the end of a list
 *   produce no repeats).
 *
 * Wheel and touch input never come through here: Valve leaves them to the
 * browser — pixel-precise, unanimated, never moving focus (§4).
 */

import { canScroll } from "./scrollEdge";
import { STEAM_BUTTON_DPAD_DOWN, STEAM_BUTTON_DPAD_UP } from "./shoulderNav";

/** Valve's "sine" ease-in-out (§3.1): 0.5 − cos(π·u)/2. */
export function easeSine(u: number): number {
  return 0.5 - Math.cos(u * Math.PI) / 2;
}

/** The focus-move tween duration (§3.1): always 200 ms. */
export const FOCUS_SCROLL_MS = 200;

/** One direct-scroll press moves this fraction of the viewport (§3.3). */
export const DIRECT_SCROLL_FRACTION = 0.3;

/** Distance-scaled tween: 200 ms per 1000 px, clamped to 300–500 ms (§3.3). */
export const DIRECT_SCROLL_MIN_MS = 300;
export const DIRECT_SCROLL_MAX_MS = 500;
export const DIRECT_SCROLL_MS_PER_1000PX = 200;

/** Auto-repeat staircase (§2.1): first repeat 400 ms after the press… */
export const REPEAT_FIRST_MS = 400;
/** …then every 50 ms (20 moves per second). */
export const REPEAT_MS = 50;

export function directScrollStepPx(viewportPx: number): number {
  return viewportPx * DIRECT_SCROLL_FRACTION;
}

export function directScrollDurationMs(distancePx: number): number {
  const scaled = (distancePx / 1000) * DIRECT_SCROLL_MS_PER_1000PX;
  return Math.min(Math.max(scaled, DIRECT_SCROLL_MIN_MS), DIRECT_SCROLL_MAX_MS);
}

/**
 * The scrollTop to aim one direct-scroll press at: `fromPx` (the in-flight
 * tween target, not the current position) plus one step in `direction`,
 * clamped into the scroller's range.
 */
export function nextDirectScrollTarget(
  input: { fromPx: number; viewportPx: number; maxScrollPx: number },
  direction: -1 | 1,
): number {
  const to = input.fromPx + direction * directScrollStepPx(input.viewportPx);
  return Math.min(Math.max(to, 0), Math.max(0, input.maxScrollPx));
}

/** The surface of a scrollable element the engine touches (a DOM element is this). */
export interface ScrollerBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface Tween {
  el: ScrollerBox & object;
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (u: number) => number;
  cancelFrame: (() => void) | null;
  onDone?: () => void;
}

const tweens = new WeakMap<object, Tween>();

// One clock and one frame source for tweens and repeats; overridable in tests
// (same pattern as focusMemory's resetFocusMemory clock).
let runtimeNow: () => number = () => performance.now();
let runtimeFrame: (cb: (t: number) => void) => () => void = (cb) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

/** For tests: a deterministic clock and frame pump. */
export function setScrollTweenRuntime(runtime: {
  now?: () => number;
  frame?: (cb: (t: number) => void) => () => void;
}): void {
  if (runtime.now) {
    runtimeNow = runtime.now;
  }
  if (runtime.frame) {
    runtimeFrame = runtime.frame;
  }
}

/** For tests: restore the real clock and rAF. */
export function resetScrollTweenRuntime(): void {
  runtimeNow = () => performance.now();
  runtimeFrame = (cb) => {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  };
}

/**
 * The scrollTop that new scroll math should compose against: the running
 * tween's target while one is in flight (the scrollTop-returns-target trick,
 * §3.1), else the element's current position.
 */
export function scrollTweenTarget(el: ScrollerBox & object): number {
  return tweens.get(el)?.to ?? el.scrollTop;
}

function tickTween(t: Tween): void {
  const u = Math.min(1, (runtimeNow() - t.start) / t.duration);
  t.el.scrollTop = t.from + (t.to - t.from) * t.ease(u);
  if (u >= 1) {
    tweens.delete(t.el);
    t.onDone?.();
    return;
  }
  t.cancelFrame = runtimeFrame(() => tickTween(t));
}

/**
 * Tween `el.scrollTop` to `top` the way Valve's patched scrollTo does (§3.1):
 * a sine ease-in-out for `durationMs` (200 by default); issued while a tween
 * is already running, the new one starts from the current position with
 * LINEAR timing, so a press in the middle of a scroll keeps a constant
 * velocity instead of restarting the ease. The target is clamped into the
 * scroller's range.
 */
export function tweenScrollTop(
  el: ScrollerBox & object,
  top: number,
  opts: { durationMs?: number; onDone?: () => void } = {},
): void {
  // A tween already in flight → this press is an interrupt: linear timing
  // (§3.1). Checked before cancelScrollTween deletes the running one.
  const interrupted = tweens.has(el);
  cancelScrollTween(el);
  const to = Math.min(Math.max(top, 0), Math.max(0, el.scrollHeight - el.clientHeight));
  const duration = opts.durationMs ?? FOCUS_SCROLL_MS;
  if (duration <= 0 || Math.abs(to - el.scrollTop) < 0.5) {
    el.scrollTop = to;
    opts.onDone?.();
    return;
  }
  const tween: Tween = {
    el,
    from: el.scrollTop,
    to,
    start: runtimeNow(),
    duration,
    ease: interrupted ? (u) => u : easeSine,
    cancelFrame: null,
    onDone: opts.onDone,
  };
  tweens.set(el, tween);
  tween.cancelFrame = runtimeFrame(() => tickTween(tween));
}

/** Stop the running tween (if any); the element stays wherever it is. */
export function cancelScrollTween(el: ScrollerBox & object): void {
  const t = tweens.get(el);
  if (t) {
    t.cancelFrame?.();
    tweens.delete(el);
  }
}

/**
 * One direct-scroll press (§3.3): ± 30 % of the viewport, measured from the
 * in-flight tween's target, as a distance-scaled tween. Cancelling and
 * retargeting happens in tweenScrollTop even when there is nothing to animate
 * (pressing back at the top mid-flight must cancel the running tween, not
 * leave it running to its old target).
 */
export function stepDirectScroll(el: ScrollerBox & object, direction: -1 | 1): void {
  const target = nextDirectScrollTarget(
    {
      fromPx: scrollTweenTarget(el),
      viewportPx: el.clientHeight,
      maxScrollPx: Math.max(0, el.scrollHeight - el.clientHeight),
    },
    direction,
  );
  tweenScrollTop(el, target, {
    durationMs: directScrollDurationMs(Math.abs(target - el.scrollTop)),
  });
}

/**
 * The press/repeat state machine behind a gamepad-scroll region: a press
 * scrolls one step at once; while the button is held, the first repeat comes
 * after 400 ms and every further one after 50 ms (§2.1, ButtonRepeatHandler),
 * each repeating press interrupted-retargeting the running tween (linear, so
 * a held D-pad moves at a constant speed). Repeats stop when the scroller has
 * no room left in that direction (measured: holds at the end of a list
 * produce no repeats) but stay armed, so content that grows mid-hold resumes
 * scrolling. A press of the other direction switches and restarts the
 * staircase (any other button resets it, §2.1). The element is re-read on
 * every use, so remounts and null windows are skipped safely; a D-pad held
 * across a page switch (the modal re-registers per page) scrolls the new page
 * only after a fresh press, as with the ramp this replaced.
 */
export interface DirectScrollMachine {
  press(direction: -1 | 1, pressed: boolean): void;
  dispose(): void;
}

export function createDirectScroll(
  getEl: () => (ScrollerBox & object) | null,
): DirectScrollMachine {
  let held: -1 | 1 | 0 = 0;
  let nextRepeatMs = 0;
  let cancelFrame: (() => void) | null = null;

  const stopLoop = () => {
    cancelFrame?.();
    cancelFrame = null;
  };

  const loop = () => {
    if (!held) {
      cancelFrame = null;
      return;
    }
    if (runtimeNow() >= nextRepeatMs) {
      const el = getEl();
      if (el && canRepeat(el, held)) {
        stepDirectScroll(el, held);
        nextRepeatMs = runtimeNow() + REPEAT_MS;
      }
    }
    cancelFrame = runtimeFrame(loop);
  };

  return {
    press(direction, pressed) {
      if (!pressed) {
        if (held === direction) {
          held = 0;
          stopLoop();
        }
        return;
      }
      const el = getEl();
      if (el) {
        stepDirectScroll(el, direction);
      }
      held = direction;
      nextRepeatMs = runtimeNow() + REPEAT_FIRST_MS;
      stopLoop();
      cancelFrame = runtimeFrame(loop);
    },
    dispose() {
      held = 0;
      stopLoop();
    },
  };
}

/** Steam's 2 px tolerance (scrollEdge.ts): is there room for one more press from the target? */
function canRepeat(el: ScrollerBox & object, direction: -1 | 1): boolean {
  return canScroll(direction === -1 ? "up" : "down", {
    scrollTop: scrollTweenTarget(el),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  });
}

/**
 * Whether a gamepad Up/Down press on the focus target beside a directly
 * scrolled box is ours (true: handled, no bell): while the box can still
 * scroll that way, measured from the tween's target so the edge is known at
 * once. Held repeats at an edge are swallowed too, so a held press rings
 * Steam's bell once. Any other direction, or no box, is Steam's.
 */
export function directScrollHandles(
  direction: "up" | "down" | null,
  isRepeat: boolean,
  box: (ScrollerBox & object) | null,
): boolean {
  if (!box || !direction) {
    return false;
  }
  return canRepeat(box, direction === "up" ? -1 : 1) || isRepeat;
}

/**
 * Gamepad Up/Down over a scroller WE own (the Details modal's pages): wires
 * D-pad Up/Down (SteamClient input, codes from shoulderNav.ts) to a
 * DirectScrollMachine on the element `getEl` returns. Wheel and touch never
 * come through here (§4: unanimated, never moving focus). Returns the
 * unsubscribe.
 */
export function registerDirectScroll(getEl: () => (ScrollerBox & object) | null): () => void {
  const input = typeof window === "undefined" ? undefined : window.SteamClient?.Input;
  if (!input) {
    return () => {};
  }
  const machine = createDirectScroll(getEl);
  const registration = input.RegisterForControllerInputMessages(
    (_controller, buttonCode, pressed) => {
      if (buttonCode === STEAM_BUTTON_DPAD_UP) {
        machine.press(-1, pressed);
      } else if (buttonCode === STEAM_BUTTON_DPAD_DOWN) {
        machine.press(1, pressed);
      }
    },
  );
  return () => {
    machine.dispose();
    registration.unregister();
  };
}
