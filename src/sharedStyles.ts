/**
 * Valve's scroll buffer (guide S21): `scroll-margin` from the variables that
 * useScrollBuffer measures and sets. Steam's focus scroller reads it. Every
 * document that shows our rows needs it (panel, modals).
 */
export const SCROLL_BUFFER_CSS = `.wowdeck-scroll-buffer .Focusable {
  scroll-margin-top: var(--wowdeck-scroll-margin-top, 0px);
  scroll-margin-bottom: var(--wowdeck-scroll-margin-bottom, 0px);
}
.wowdeck-float-pane {
  position: sticky; top: var(--wowdeck-pane-top, 0px); z-index: var(--wowdeck-pane-z, 6);
  background: #0e141b; padding-top: var(--wowdeck-attach-gap, 0px);
}
.wowdeck-float-pane::after {
  content: ""; position: absolute; left: 0; right: 0; top: 100%;
  height: var(--wowdeck-fade-size, 20px); pointer-events: none;
  background: linear-gradient(#0e141b, rgba(14, 20, 27, 0));
  opacity: 0; transition: opacity .15s ease;
}
[data-wowdeck-scrolled] .wowdeck-float-pane::after { opacity: 1; }`;

/**
 * The widened pane is not animated in this window (UI-02 ticket 04, revised
 * 2026-10-19): the native QAM BrowserView slides left over ~0.5 s (see
 * `qamWidenScript`), and the QAM page is already laid out at its full width.
 * Animating the slot's own width made the text reflow as it grew, so the slot
 * snaps to its final width and the native slide does the reveal. QAM classes
 * only — the details modal renders none of these elements.
 */
export const QAM_MOTION_CSS = `.wowdeck-pane-slot {
  /* The pane is a column of its own, not part of the destination list's
     scrolling flow: pin it to the QAM viewport so it starts at the very top
     (under the OS bar, above Decky's title) and spans the full height. The
     left offset is the 48 px icon rail + the destination list's collapsed
     300 px, so the pane attaches to its right; it keeps the same DOM position
     for gamepad flow-children navigation. */
  position: fixed; top: 0; bottom: 0; left: 348px;
  display: flex; flex-direction: column;
  width: 0; min-width: 0; opacity: 0; overflow: hidden;
  box-sizing: border-box; z-index: 7;
}
/* A small outer inset only: the rows inside carry Steam's own horizontal
   padding via PanelSectionRow (guide S27), so the pane does not need another
   full 16 px on each side. The landing leaves room for the OS bar. The pane
   scrolls itself, independent of the destination list. */
.wowdeck-pane-slot-open {
  width: calc(100vw - 348px); opacity: 1; padding: 8px;
  overflow-x: hidden; overflow-y: auto;
  /* The Friends list's own 1 px divider at the list/pane boundary: it touches
     the highlighted row (owner's reference, 2026-10-19) and is off-screen in
     the collapsed QAM because the slot has no width there. */
  border-left: 1px solid rgba(0, 0, 0, 0.6);
}`;

/** For modals, which render in another document than the QAM panel. */
export function wowupModalStyleCss(): string {
  return SCROLL_BUFFER_CSS;
}

/**
 * The plugin's shared CSS, injected in the QAM panel (index.tsx) and in the
 * Details modal, which may render into a separate document. Since the
 * Steam-native rework (guide 5.3, S14-S19) it no longer overrides any Steam
 * component class: rows, buttons and dialogs keep Steam's own spacing. What is
 * left is our tab bar (Steam's tab-pill look, which @decky/ui does not export
 * at QAM width), the glyph box and status tag, markdown for addon descriptions,
 * and `scroll-margin` on our own focusable elements: not a visual override but
 * the value Steam's focus scroller reads to keep a row clear of Decky's sticky
 * title (guide S21).
 */
export function wowdeckSharedStyleCss(): string {
  // The pane slot's motion, kept with the tab styles it belongs to.
  return `${QAM_MOTION_CSS}
.wowdeck-tab {
  display: flex; align-items: center; gap: 6px; height: 22px; padding: 6px 10px;
  position: relative; border-radius: 64px; white-space: nowrap; cursor: pointer;
  font-size: 12px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase;
  color: #dcdedf; background: transparent;
  transition: background-color .1s ease, color .1s ease, box-shadow .1s ease;
}
.wowdeck-tab svg { width: 14px; height: 14px; }
.wowdeck-tab-selected { background: rgba(255,255,255,.15); color: #fff; padding: 6px 14px; }
.wowdeck-tab.gpfocus { background: #fff; color: #23262e; box-shadow: 0 3px 6px rgba(0,0,0,.32); }
/* The destination whose pane holds focus keeps a subtle selected background:
   the destination loses Steam's focus ring when focus moves into the pane, and
   without this the list looked unselected (owner, Valve's Friends list keeps
   the selection). Painted on the Field, which is not focused in this state, so
   it never fights Steam's own focus highlight. */
.wowdeck-destination-selected { background: rgba(255,255,255,.1); border-radius: 2px; }
/* A destination nothing can serve (ZeroCapabilityScreen, ADR 0002): Steam's
   empty state — centred icon, title, what the destination needs, one button to
   Options, then the fine print. */
.wowdeck-zero-capability {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 8px; padding: 32px 16px 16px; max-width: 420px; margin: 0 auto;
}
.wowdeck-zero-capability-icon {
  display: flex; align-items: center; justify-content: center;
  width: 64px; height: 64px; border-radius: 50%; margin-bottom: 8px;
  background: rgba(255,255,255,.06); color: #b8bcbf; font-size: 28px;
}
.wowdeck-zero-capability-title { color: #dcdedf; font-size: 18px; font-weight: 500; line-height: 24px; }
.wowdeck-zero-capability-body { color: #b8bcbf; font-size: 14px; line-height: 20px; }
.wowdeck-zero-capability-action { align-self: stretch; margin-top: 12px; }
.wowdeck-zero-capability-status { color: #67707b; font-size: 12px; line-height: 16px; margin-top: 4px; }
/* The Options jump's attention effect (optionsJump.ts; ADR 0002, story 17):
   the sources section marks the rows the jump navigated for, and they pulse
   with Steam's own row highlight — no outline, no box of our own (owner,
   2026-10-23). The pulse is a layer on the row's Field, the element whose box
   is Steam's focus highlight (it reaches out by
   --field-negative-horizontal-margin), so it is exactly the row's size. A
   layer over the row's background, not the background itself: the focused
   row keeps its focus colour and pulses brighter in step with the others
   instead of flashing off against them. The row's inline animation-delay
   (SourcesSection) keeps every marked row on the one jump's phase. Transient:
   the class goes when the jump is used, focus moves on or the section
   leaves. */
@keyframes wowdeck-source-jump-blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
.wowdeck-source-jump > * { position: relative; isolation: isolate; }
.wowdeck-source-jump > *::before {
  content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: rgba(255,255,255,.15); opacity: 0;
  animation: wowdeck-source-jump-blink .6s ease-in-out 3;
  animation-delay: inherit;
}
.wowdeck-glyph { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; }
.wowdeck-glyph img, .wowdeck-glyph svg { width: 32px; height: auto; }
/* A browse bar segment's open menu (SegmentMenu; ADR 0002 revision
   2026-10-24): Valve's context-menu column drawn inside the pane. The QAM
   BrowserView never hides for a popup, so Steam's entrance replay (PC-20,
   DEVICE 2026-10-24) never plays, and the panel never unmounts (G4).
   Steam's own DialogButton focus is the item highlight; the current choice
   carries the check. */
.wowdeck-segment-menu {
  background: #23262e; border-radius: 2px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
  max-height: min(320px, calc(100vh - 180px));
  overflow-y: auto; overflow-x: hidden; padding: 4px 0;
}
.wowdeck-segment-menu-item { justify-content: flex-start; }
.wowdeck-segment-menu-label {
  flex: 1; min-width: 0; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wowdeck-glyph-text {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 18px; padding: 0 4px; border-radius: 4px 4px 2px 2px;
  background: #dcdedf; color: #0e141b; font-size: 12px; font-weight: bold;
}
.wowdeck-facts { display: block; overflow: hidden; min-width: 0; }
.wowdeck-facts > span { display: flex; flex-wrap: wrap; margin-left: -14px; }
.wowdeck-facts > span > span { white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.wowdeck-facts > span > span::before { content: "·"; display: inline-block; width: 14px; text-align: center; }
.wowdeck-status-tag {
  display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 2px;
  background: rgba(255,255,255,.1); color: #dcdedf;
  font-size: 12px; line-height: 16px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase;
}
${SCROLL_BUFFER_CSS}
.wowdeck-markdown { line-height: 1.4; }
.wowdeck-markdown h1, .wowdeck-markdown h2, .wowdeck-markdown h3,
.wowdeck-markdown h4, .wowdeck-markdown h5, .wowdeck-markdown h6 {
  margin: 0.6em 0 0.3em;
  font-size: 19px;
  font-weight: bold;
}
.wowdeck-markdown p { margin: 0.4em 0; }
.wowdeck-markdown a { color: #66c0f4; }
.wowdeck-markdown ul, .wowdeck-markdown ol { margin: 0.3em 0 0.3em 1.2em; padding: 0; }
.wowdeck-markdown code {
  background: rgba(255,255,255,0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.wowdeck-markdown pre {
  background: rgba(255,255,255,0.08);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}
.wowdeck-markdown pre code { background: none; padding: 0; }
.wowdeck-markdown blockquote {
  border-left: 2px solid rgba(255,255,255,0.2);
  margin: 0.4em 0;
  padding-left: 8px;
  color: #b8bcbf;
}
.wowdeck-markdown img { max-width: 100%; }
.wowdeck-markdown iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; margin: 0.4em 0; }`;
}
