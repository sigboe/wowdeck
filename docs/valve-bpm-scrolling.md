# Valve's Big Picture Mode scrolling — reverse-engineered

**DEVICE** Steam Deck (SteamOS), SteamOS BPM, CEF Chrome 126, measured
2026-10-25. Static source: `~/.local/share/Steam/steamui/` changelist
**11146165** (`sp.js` 16.3 MB + `libraries~e8c5e5be4.js` 2.3 MB + `css/sp.css`
5 MB, copied to `.scratch/steamui/`). Method: webpack-module extraction and
beautifying of the scroll/navigation code, plus live driving over the CEF
tunnel (`tools/deck-ui/`: `key.mjs`, `pad.sh`, a rAF `scrollTop` sampler
installed in-memory, `wheel.mjs`). All numbers below are either code constants
or measured on device.

---

## 1. The one-paragraph version

BPM scrolling is **focus-driven, not scroll-driven**: the dpad moves *focus*
through a virtual navigation tree, and a scroll-into-view engine then brings
the newly focused element into view by animating every scrollable ancestor.
Three animation backends coexist: (1) a global monkey-patch of
`Element.scrollTo` that replaces every `{behavior:"smooth"}` call with Valve's
own 200 ms sine ease-in-out rAF tween (linear when a new target interrupts an
in-flight one), (2) the browser's native `scrollIntoView({behavior:"smooth"})`
for "Standard"-type regions, and (3) per-component animators (carousels: 100 ms
sine; gamepad-scroll regions: 300–500 ms distance-scaled sine). Long jumps skip
animation entirely: if the target is more than ~40 % of the viewport outside
it, or another such jump happened in the last 500 ms, the scroll is instant.
Held dpad auto-repeats after 400 ms, then every 50 ms. Trackpad/wheel input is
never animated — it is pixel-precise and does not move focus.

## 2. Architecture: input → nav tree → scroll

```
native (Steam Input / keyboard / mouse)
   │  custom DOM events, bubbles: "vgp_onbuttondown/up", "vgp_ondirection"
   │  detail = { button, source, is_repeat }
   ▼
ButtonRepeatHandler (sp.js module 20505)
   │  dpad-only auto-repeat: first 400 ms, then every 50 ms
   │  axis-locked (first held axis wins), any other button resets it
   ▼
Nav tree (module 74562, debug tag "FocusNavigationMovement")
   │  nodes = Focusable wrappers; layout inferred from CSS
   │  (flex row → ROW, wrap → GRID, grid → GEOMETRIC, … )
   │  finds next focusable child by layout or geometry
   │  (overlap on movement axis first, then distance)
   ▼
Scroll-into-view engine (module 84719, debug tag "ScrollSnap")
   │  walks nav-node → DOM element → all scrollable ancestors
   │  Standard | NoTransform | NoTransformSparseContent
   │  + escape hatch fnScrollIntoViewHandler per node
   ▼
ScrollElement wrapper (module 84719 class A)
      WeakMap<element>, patches element.scrollTo
      200 ms rAF tween, "sine" ease-in-out, linear on retarget
```

Everything is debuggable in a live session: `new Logger("ScrollSnap").Debug`
and `"FocusNavigationMovement"` — enabling those debug flags makes Steam log
every scroll decision.

### 2.1 Input facts (code + measured)

| Fact | Value |
|---|---|
| Events | `vgp_onbuttondown/up`, `vgp_ondirection`, `vgp_onok/cancel/secondary/options/menu` (CustomEvents, bubbling, cancelable) |
| Dpad codes | 9/10/11/12 = up/down/left/right (`pR` enum, module 20505) |
| Keyboard | arrows (and ctrl/shift variants of digits for bumpers etc.) translated to the same buttons; **right mouse button = CANCEL** |
| Auto-repeat | first repeat **400 ms**, then **50 ms** (module 20505 `firstRepeatInterval_ms/repeatInterval_ms`); dpad only |
| Axis lock | once repeating vertically, a horizontal press can't start a repeat until the vertical one is released |
| Repeat gating | repeats stop when the nav tree has no target in that direction (measured: at end of list, holds produce no repeats) |
| Measured | staircase on device: press → +400 ms → 50 ms × n, exactly; native Steam Input additionally re-fires a held dpad (~2.5 s) as a fresh non-repeat press |
| DOM focus | `focus({preventScroll:true})` — **the browser never scrolls on focus**; all scrolling is the engine's job |

### 2.2 The nav tree

Every Focusable React component registers a node with properties
(`focusable`, `layout`, `onMoveUp/…`, `scrollIntoViewType`,
`scrollIntoViewWhenChildFocused`, `navEntryPreferPosition`
(FIRST/LAST/MAINTAIN_X/MAINTAIN_Y/PREFERRED_CHILD), `fnScrollIntoViewHandler`,
`scrollRegionToStartOrEnd`, …). Children are sorted by document position.
When no explicit layout is set it is **inferred from CSS** (module 92393
`ko`): flex row → ROW (wrapped → GRID), column → COLUMN, `display:grid` →
GEOMETRIC (with template areas) or GRID, inline children → GRID, default
COLUMN. GEOMETRIC picks the next child by rect overlap on the movement axis
first, then distance — using the *last movement's* tangent axis so a straight
line is kept (MAINTAIN_X/Y preferences reuse the same data).

## 3. The scroll animation engines

### 3.1 Global `scrollTo` patch — Valve's tween (module 84719/47537)

A `WeakMap` wraps every element (and window) that the engine touches,
**replacing `element.scrollTo`**:

- `behavior` not `"smooth"` → cancel running animation, call the original
  (instant) and reset.
- `behavior:"smooth"` → **200 ms rAF tween**, easing `"sine"`
  (`0.5 − cos(π·u)/2`, i.e. ease-in-out sine). If a tween is already running
  for this element the new tween uses **`"linear"`** timing instead of
  restarting the ease — interrupts keep a constant velocity.
- During element tweens, CSS scroll-snap is switched off
  (`style.scrollSnapType = "initial"`), restored on completion.
- The wrapper's `scrollTop` getter returns the **animation target** while
  mid-flight, so focus math computes against where the scroll will end.

Cleaned-up core (de-minified):

```js
class AnimationTimer {            // modules 47537 & 84719
  Start() {
    this.m_msStart = performance.now();
    let ease = { linear: u => u,
                 "cubic-in-out": u => u < .5 ? 4*u*u*u : (u-1)*(2*u-2)*(2*u-2)+1,
                 sine: u => .5 - Math.cos(u * Math.PI) / 2 }[this.m_options.timing ?? "sine"];
    this.m_bActive = true;
    requestAnimationFrame(t => this.OnInterval(ease, t));
  } // rAF loop: Update(ease(elapsed/duration)); ≥ duration → Update(1), onComplete
}

scrollTo({top, left, behavior}) {   // class ScrollElement (patched onto element)
  if (behavior != "smooth") { this.m_animation?.Cancel(); original(); this.Reset(); }
  else {
    let timing = "sine";
    if (this.m_animation) { this.m_animation.Cancel(); timing = "linear"; }  // interrupt
    this.m_animation = new AnimationTimer(element, {scrollTop: top}, {msDuration: 200, timing, onComplete: reset});
    this.m_scrollTopTarget = top; this.m_animation.Start();
  }
}
```

### 3.2 Native smooth `scrollIntoView` (Standard type)

For nodes with `scrollIntoViewType: Standard` (the default) the engine calls
the **browser's** `el.scrollIntoView({behavior, block:"nearest",
inline:"nearest"})` — Chromium's own smooth-scroll curve and
distance-dependent duration. Measured: 401 px ≈ 206 ms (library home outer
page), one-row ≈ 40 px moves in ~100–130 ms (Settings sidebar), symmetric
bell-shaped velocity. Interrupts retarget natively (continues from the current
position).

### 3.3 Per-component animators

- **Carousels** (`VirtualizedBoxCarousel`, module 79747, debug tag
  "VirtualizedBoxCarousel"): react-virtualized `Grid` horizontal lists.
  `scrollDuration` default **100 ms** sine per item; **focus is only sent
  after the animation completes** (`OnAnimationScrollComplete → TakeFocus`);
  bumpers (L1/R1) page by the rendered window size when `enableBumperPaging`;
  250 ms debounced scroll notifications; left/right arrow indicators updated
  by comparing current scrollLeft to first/last cell offsets; overscroll past
  the first element is blocked on touch and snapped back.
- **Gamepad-scroll regions** (module 50908 hook `ScrollOnGamepadDirection`):
  containers that own `onGamepadDirection` themselves scroll
  `scrollPercentage ?? 30 %` of the viewport per press with duration
  `clamp(distance/1000·200, 300, 500) ms`, sine, **linear on interrupt**, and
  the target accumulates from the previous *target* (holding dpad yields
  continuous motion). Edge dead zone 2 px. Same module: on `wheel`/`touch`,
  regions re-`TakeFocus()` to keep the nav tree anchored; on resize the
  focused element is instantly re-kept in view.

### 3.4 Focus-driven scroll-into-view rules (module 84719 `ScrollIntoView`)

Walking from the focused node up through ancestors that set
`scrollIntoViewWhenChildFocused` (value `true` appends, `"force"` replaces the
whole chain), each with an inherited `scrollIntoViewType`:

1. A node's `fnScrollIntoViewHandler` returning ≠ false fully handles it
   (chat, library rows, etc. override scrolling wholesale).
2. No previous element & source ≠ GAMEPAD → instant (`behavior:"auto"`).
3. **Far rule** — the jump cutoffs:
   - `fe = 40`, `X = max(innerHeight · 0.4, 40)` (or 40 px when a scroll
     budget is active);
   - if the target rect is more than `X` outside the viewport **or** another
     far jump happened within the last **500 ms** → `behavior:"auto"`
     (instant). Rational: sequential hops animate, long flicks teleport.
   - restoring nav history (`BIsRestoringHistory()`) → always instant.
4. `NoTransform` types never use the browser: a hand-rolled walk computes, per
   scrollable ancestor, the exact delta that parks the target inside the
   ancestor's scroll-padding-adjusted box (larger-than-viewport targets center),
   clamps it, optionally distributes a **maximum total scroll budget across
   ancestors**, then applies all with the patched `scrollTo` (i.e. the 200 ms
   sine tween). Position math uses offsetTop chains (not
   `getBoundingClientRect`) so mid-flight positions don't corrupt it, and
   stops at fixed/sticky ancestors.
5. `scrollRegionToStartOrEnd`: when focus escapes a region in a direction,
   that region smooth-scrolls to its start/end — measured on library home as a
   ~180 ms animation to 0 when focus left the page upward.

### 3.5 Sparse (virtualized) content — scrolling without focus

`scrollIntoViewType: NoTransformSparseContent` regions implement
"scroll-first, focus-later" (module 74562 `BTryInternalNavigation`): if the
next nav child lies beyond the viewport by more than
`viewport/3.33` (single press) or `viewport/4.5` (repeat), **focus does not
move** — the region scrolls by that amount instead (smooth). This makes
unmounted rows reachable: each press advances the window until real rows come
into existence, then focus steps onto them.

Measured on the **All Games** list (1074 entries, `TabContentsScroll`
container): only a ~54-row/1370 px window is mounted; per press the list
scrolled ≈ one hero row + gap (243 px) at ~300 ms (the 300 ms floor of the
distance-scaled animator), and entering the list produced a 0→100 px ~200 ms
focus-tween — the two different durations on the same element are the
signature of the two backends (focus path = fixed 200 ms tween; list's own
direction handling = 300–500 ms scaled).

## 4. Live measurements (DEVICE 2026-10-25)

| Scenario | Observation |
|---|---|
| Library home, settled presses (~650 ms apart) | press→scroll-start latency 50–120 ms (React deferred focus); inner `TabContentsScroll` animates 145 px in **197 ms** ease-in-out (the 200 ms sine tween); outer page did 401 px in **206 ms** (native smooth); nested outer+inner scrollers share the work — outer saturated (401/401) first, inner carried the rest |
| Library home, presses 150–250 ms apart | mid-animation retargets: new tween from current position with constant velocity (linear), no restart; velocity continuous |
| Settings sidebar (`PagedSettingsDialog_PageList`), settled | one row (~40–45 px) per press, native smooth, **100–130 ms**, symmetric bell; press→scroll latency ~50–60 ms |
| Settings sidebar, rapid 8 × 60 ms | **no per-press animation at all** — one instant jump 0→276 px, then a short smooth settle 276→330 for the final row (far rule + deferred-focus batching) |
| Held dpad (real pad, 1.8 s & 2.5 s) | repeat staircase exactly 400 ms → 50 ms cadence; scroll continued to list end and repeats stopped there (no target → repeat disallowed) |
| All Games list, settled | 243 px per press at ~300 ms; sparse window extends as you go; filtered "Non-Steam" list (23 items) genuinely ends — dpad dead-ends at the last mounted row |
| Wheel (real CDP notches) | exactly 120 px per notch, **instant, no animation**, focus stays on its (now off-screen) row |

## 5. CSS & presentation

- CSS scroll-snap exists only in a few carousels (`scroll-snap-type:x
  mandatory`, `scroll-snap-align:start|center`, one `y proximity`) — and the
  JS tween disables it while animating (§3.1).
- Scrollbars are **hidden** in the gamepad UI: `::-webkit-scrollbar{width:0;
  display:none}`, transparent thumbs; chat-style lists reveal a thumb on
  hover (`background-clip:padding-box`).
- No `scroll-behavior` in stylesheets — smoothness is entirely JS.
- Focus item transitions (`ItemFocusAnim-*`, `focusAnimation` keyframes) are
  CSS animations layered on top; app-launch transition duration 800 ms
  (`duration-app-launch`).

## 6. Rules of thumb (what BPM scrolling *feels like*, and why)

1. One dpad hop = one focus move = animate only as much as needed
   ("nearest"-style alignment), ~100–300 ms, ease-in-out.
2. Press again mid-flight = retarget at constant speed; the list never snaps
   back to restart the ease.
3. Flick fast = teleport, then settle; consecutive flicks stay teleports for
   500 ms.
4. Hold = 400 ms grace, then 20 moves/second.
5. Past-the-end focus = the abandoned region glides to its edge.
6. Virtualized tails scroll the *window* first and focus *after* content
   exists; carousels focus only after the slide animation ends.
7. Mouse/trackpad scrolling is a different world: unanimated, and it never
   steals focus.

## 7. Takeaways for our QAM panel (wowdeck)

- Our lists live in Decky's QAM, not BPM's nav tree, but the same *rules*
  read well there too: fixed ~200 ms ease-in-out for short moves, linear
  retarget on interrupt, instant jumps beyond ~40 % of the panel height, and
  30 % viewport per direct-scroll press with a 300–500 ms distance-scaled
  duration.
- `focus({preventScroll:true})` + explicit scroll math is the pattern that
  keeps scrolling predictable when focus and scrolling are both scripted —
  the browser's default focus-scroll fight is what BPM avoids wholesale.
- The `scrollTop`-returns-target trick (§3.1) is a cheap way to make queued
  scroll requests compose correctly mid-animation.

Implemented 2026-10-25 in `src/valveScroll.ts` (tween engine §3.1 +
direct-scroll presses §3.3 + the 400→50 ms staircase §2.1, unit-tested),
driving the Details modal's Up/Down (`registerDirectScroll`). The QAM lists'
focus-driven scrolling intentionally stays Steam's own NoTransform scroller
(guide S21): it already behaves like §3.4's rules 1–3, far rule included,
because it *is* the same engine the report measured. Deliberately not
adopted yet: the far rule has no call site in code we own (our only scripted
jump, `focusMemory`'s restore, is instant, which §3.4 prescribes for
restores), and `focus({preventScroll:true})` at `focusMemory`'s call sites
waits for a device pass — the restore scroll there is verified as-is and it
is not certain which layer (browser native vs SteamUI) performs it today.

## Appendix: source map (sp.js @ changelist 11146165)

| Module id | Contents (beautified copies in `.scratch/steamui/`) |
|---|---|
| 20505 | button enum, ButtonRepeatHandler (400/50 ms), input base classes |
| 74562 | nav-tree node: layouts, geometric focus search, sparse-scroll branch, `SetDOMFocusAndScroll` |
| 84719 | AnimationTimer + `scrollTo` patch + focus scroll-into-view + far rule + `scrollRegionToStartOrEnd` |
| 47537 | the same AnimationTimer exported for carousels (`JV`) |
| 50908 | `ScrollOnGamepadDirection` (30 % viewport, 300–500 ms), wheel/touch refocus, resize keep-in-view |
| 79747 | `VirtualizedBoxCarousel` (100 ms/item, focus-after-animation, bumper paging) |
| 92393 | rect/axis math, CSS layout inference, nav handle |
| 26756 | scrollable-ancestor detection (`overflow` walk), lazy-mount visibility tracker |
| 54654 | `vgp_*` event plumbing, focus sources (GAMEPAD/KEYBOARD/APPLICATION/BROWSER/AUTOFOCUS) |
