/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import {
  cancelScrollTween,
  createDirectScroll,
  directScrollDurationMs,
  directScrollStepPx,
  easeSine,
  FOCUS_SCROLL_MS,
  nextDirectScrollTarget,
  registerDirectScroll,
  resetScrollTweenRuntime,
  scrollTweenTarget,
  setScrollTweenRuntime,
  tweenScrollTop,
  type ScrollerBox,
} from "./valveScroll";

// The fake runtime must never leak into other test files in the same run.
afterEach(() => {
  resetScrollTweenRuntime();
  delete (globalThis as { window?: unknown }).window;
});

/** A scrollable element stand-in: exactly the surface the engine touches. */
function fakeScroller(scrollHeight = 4000, clientHeight = 500): ScrollerBox & object {
  return { scrollTop: 0, scrollHeight, clientHeight };
}

/**
 * Deterministic rAF: tests pump time by hand, so the engine's clock and frame
 * source are injected (setScrollTweenRuntime). Every scheduled frame runs on
 * the next tick(), like one rAF per display frame.
 */
interface FakeFrame {
  cb: (t: number) => void;
  cancelled: boolean;
}

function fakeRuntime() {
  const state = { now: 0, frames: [] as FakeFrame[] };
  setScrollTweenRuntime({
    now: () => state.now,
    frame: (cb) => {
      const f = { cb, cancelled: false };
      state.frames.push(f);
      return () => {
        f.cancelled = true;
      };
    },
  });
  const tick = (ms: number) => {
    state.now += ms;
    for (const f of state.frames.splice(0)) {
      if (!f.cancelled) {
        f.cb(state.now);
      }
    }
  };
  return { tick, state };
}

describe("easeSine (Valve's default tween curve, docs/valve-bpm-scrolling.md §3.1)", () => {
  test("matches 0.5 − cos(π·u)/2 at the anchors and mid-quarter", () => {
    expect(easeSine(0)).toBe(0);
    expect(easeSine(1)).toBe(1);
    expect(easeSine(0.5)).toBeCloseTo(0.5, 12);
    // Worked example: 0.5 − cos(π/4)/2 ≈ 0.1464466
    expect(easeSine(0.25)).toBeCloseTo(0.1464466, 6);
  });

  test("is symmetric, so the tween eases in and out equally", () => {
    for (const u of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      expect(easeSine(u) + easeSine(1 - u)).toBeCloseTo(1, 12);
    }
  });
});

describe("direct-scroll press math (§3.3, sp.js module 50908)", () => {
  test("one press moves 30 % of the viewport", () => {
    expect(directScrollStepPx(600)).toBe(180);
    expect(directScrollStepPx(452)).toBeCloseTo(135.6, 6);
  });

  test("duration is 200 ms per 1000 px, clamped to 300–500 ms", () => {
    // The clamp dominates on panel-sized viewports: every per-press distance
    // (≤ 30 % of the viewport) sits at the 300 ms floor, exactly the ~300 ms
    // measured on Steam's All Games list at 243 px per press (§4).
    expect(directScrollDurationMs(243)).toBe(300);
    expect(directScrollDurationMs(1000)).toBe(300);
    expect(directScrollDurationMs(1500)).toBe(300);
    expect(directScrollDurationMs(2000)).toBe(400);
    expect(directScrollDurationMs(2500)).toBe(500);
    expect(directScrollDurationMs(25000)).toBe(500);
  });

  test("the next target steps from the given base and clamps to the scroll range", () => {
    expect(nextDirectScrollTarget({ fromPx: 500, viewportPx: 600, maxScrollPx: 4000 }, 1)).toBe(
      680,
    );
    expect(nextDirectScrollTarget({ fromPx: 500, viewportPx: 600, maxScrollPx: 4000 }, -1)).toBe(
      320,
    );
    expect(nextDirectScrollTarget({ fromPx: 100, viewportPx: 600, maxScrollPx: 4000 }, -1)).toBe(0);
    expect(nextDirectScrollTarget({ fromPx: 3900, viewportPx: 600, maxScrollPx: 4000 }, 1)).toBe(
      4000,
    );
  });
});

describe("tween engine (§3.1: 200 ms sine, linear on interrupt)", () => {
  test("eases over 200 ms to the target by default", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    tweenScrollTop(box, 300);
    expect(FOCUS_SCROLL_MS).toBe(200);
    tick(100); // u = 0.5, sine 0.5 → half the distance
    expect(box.scrollTop).toBeCloseTo(150, 6);
    tick(50); // u = 0.75, sine ≈ 0.8535534
    expect(box.scrollTop).toBeCloseTo(300 * 0.85355339, 6);
    tick(50); // complete
    expect(box.scrollTop).toBe(300);
  });

  test("clamps the target into the scroller's range", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller(4000, 500); // max scroll 3500
    tweenScrollTop(box, 99999);
    expect(scrollTweenTarget(box)).toBe(3500);
    tick(200);
    expect(box.scrollTop).toBe(3500);
  });

  test("an interrupt retargets from the current position at constant speed", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    tweenScrollTop(box, 300);
    tick(100); // sine 0.5 → 150
    expect(box.scrollTop).toBeCloseTo(150, 6);
    tweenScrollTop(box, 500);
    // The scrollTop-returns-target trick: the new target is visible at once,
    // so a queued press composes against where the scroll will end (§3.1).
    expect(scrollTweenTarget(box)).toBe(500);
    tick(100); // linear 0.5 → 150 + 0.5 · (500 − 150)
    expect(box.scrollTop).toBeCloseTo(325, 6);
    tick(100); // complete
    expect(box.scrollTop).toBe(500);
    expect(scrollTweenTarget(box)).toBe(500);
  });

  test("a fresh tween after the previous one completed eases sine again", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    tweenScrollTop(box, 300);
    tick(200);
    tweenScrollTop(box, 600);
    tick(100); // sine 0.5 → the midpoint again, not the linear 3/4 point
    expect(box.scrollTop).toBeCloseTo(450, 6);
  });

  test("onDone fires once, on completion only", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    let done = 0;
    tweenScrollTop(box, 300, { onDone: () => done++ });
    tick(100);
    expect(done).toBe(0);
    tick(100);
    expect(done).toBe(1);
    tick(50); // nothing scheduled any more
    expect(done).toBe(1);
  });

  test("cancelling freezes mid-flight; the target getter falls back to scrollTop", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    tweenScrollTop(box, 300);
    tick(100);
    cancelScrollTween(box);
    expect(scrollTweenTarget(box)).toBeCloseTo(150, 6);
    tick(200);
    expect(box.scrollTop).toBeCloseTo(150, 6);
  });
});

describe("direct-scroll press staircase (§2.1 400 ms → 50 ms; §3.3 accumulation)", () => {
  test("a press scrolls at once, the first repeat waits 400 ms, then every 50 ms", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller(); // viewport 500 → step 150
    const m = createDirectScroll(() => box);
    m.press(1, true);
    expect(scrollTweenTarget(box)).toBe(150); // immediate
    tick(399);
    expect(scrollTweenTarget(box)).toBe(150); // the 400 ms grace
    tick(1);
    expect(scrollTweenTarget(box)).toBe(300); // first repeat
    tick(49);
    expect(scrollTweenTarget(box)).toBe(300);
    tick(1);
    expect(scrollTweenTarget(box)).toBe(450); // every 50 ms, from the target
    m.press(1, false);
  });

  test("holds at the end of the scroller produce no repeats, and resume if it grows", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller(700, 500); // only 200 px can scroll
    const m = createDirectScroll(() => box);
    m.press(1, true); // 0 → 150
    tick(400); // repeat clamps to the end
    expect(scrollTweenTarget(box)).toBe(200);
    tick(150); // the 450 ms repeat point passes at the edge: no further target
    expect(scrollTweenTarget(box)).toBe(200);
    tick(300); // the clamped tween settles
    expect(box.scrollTop).toBe(200);
    box.scrollHeight = 2000; // content grows while still held
    tick(50);
    expect(scrollTweenTarget(box)).toBe(350); // the staircase was alive, not dead
    m.dispose();
  });

  test("release ends the staircase but the running tween finishes", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    const m = createDirectScroll(() => box);
    m.press(1, true);
    tick(400);
    expect(scrollTweenTarget(box)).toBe(300);
    m.press(1, false);
    tick(1000);
    expect(box.scrollTop).toBe(300); // animated to its target, never stepped past it
  });

  test("a fresh press after release starts a new staircase", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    const m = createDirectScroll(() => box);
    m.press(1, true);
    tick(400);
    m.press(1, false);
    tick(500);
    m.press(1, true); // immediate again, from the settled position
    expect(scrollTweenTarget(box)).toBe(450);
    tick(399);
    expect(scrollTweenTarget(box)).toBe(450); // full 400 ms grace is back
    tick(1);
    expect(scrollTweenTarget(box)).toBe(600);
    m.dispose();
  });

  test("pressing the other direction while held steps that way at once", () => {
    const { tick } = fakeRuntime();
    const box = fakeScroller();
    const m = createDirectScroll(() => box);
    m.press(1, true);
    tick(400); // target 300
    m.press(-1, true); // from the target, one step up
    expect(scrollTweenTarget(box)).toBe(150);
    tick(399); // the staircase restarted with this press
    tick(1);
    expect(scrollTweenTarget(box)).toBe(0); // clamped at the top
    m.press(-1, false);
  });

  test("a null element (page gone) is skipped; the staircase survives", () => {
    const { tick } = fakeRuntime();
    let box: (ScrollerBox & object) | null = fakeScroller();
    const m = createDirectScroll(() => box);
    m.press(1, true);
    box = null;
    expect(() => {
      tick(1000);
    }).not.toThrow();
    box = fakeScroller(4000, 500);
    tick(50);
    expect(scrollTweenTarget(box)).toBe(150);
    m.dispose();
  });
});

describe("registerDirectScroll (SteamClient wiring, codes from shoulderNav.ts)", () => {
  test("without SteamClient.Input it registers nothing and unsubscribes cleanly", () => {
    const box = fakeScroller();
    const off = registerDirectScroll(() => box);
    expect(() => off()).not.toThrow();
  });

  test("D-pad Down (21) steps down, Up (20) steps up, and unregister detaches", () => {
    fakeRuntime(); // presses create tweens; no real rAF in the test runtime
    const box = fakeScroller();
    let callback: ((c: number, code: number, pressed: boolean) => void) | null = null;
    let unregistered = false;
    (globalThis as { window?: unknown }).window = {
      SteamClient: {
        Input: {
          RegisterForControllerInputMessages: (
            cb: (controllerIndex: number, buttonCode: number, pressed: boolean) => void,
          ) => {
            callback = cb;
            return { unregister: () => (unregistered = true) };
          },
        },
      },
    };
    const off = registerDirectScroll(() => box);
    expect(callback).not.toBeNull();
    callback!(0, 21, true);
    expect(scrollTweenTarget(box)).toBe(150);
    callback!(0, 21, false);
    callback!(0, 20, true);
    expect(scrollTweenTarget(box)).toBe(0);
    callback!(0, 20, false);
    callback!(0, 30, true); // LB or anything else: not ours
    expect(scrollTweenTarget(box)).toBe(0);
    off();
    expect(unregistered).toBe(true);
  });
});
