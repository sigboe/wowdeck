import { STEAM, STEAM_FONT, STEAM_PAGE_BOX as BOX } from "./steamTheme";

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
     for gamepad flow-children navigation. While a game runs Steam draws its
     status bar and button bar inside the QAM window, over the panel:
     qamBars.ts measures them into --wowdeck-bar-top/bottom. */
  position: fixed; top: var(--wowdeck-bar-top, 0px); bottom: var(--wowdeck-bar-bottom, 0px);
  left: 348px;
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

/**
 * The boxes we add to Steam's game page (#252), in Steam's feedback-box
 * look (STEAM_PAGE_BOX). Each line has a fixed height and the bar sits in
 * the text column's reserved bottom padding, so the box is one height in
 * every state. Buttons are Focusables like Steam's own, focused white with
 * black text; an inert one stays focusable and fades.
 */
export const STEAM_PAGE_BOX_CSS = `.wowdeck-page-box {
  display: flex; flex-direction: row; align-items: center;
  margin: ${BOX.margin}; padding: ${BOX.padding}; background: ${BOX.background};
}
.wowdeck-page-box-text {
  position: relative; flex: 1 1 auto; min-width: 30%; padding: ${BOX.textPadding};
  color: ${BOX.text}; font-size: ${STEAM_FONT.body};
}
.wowdeck-page-box-line {
  display: flex; align-items: center; gap: 6px; height: 23px; line-height: 23px;
  white-space: nowrap; overflow: hidden;
}
.wowdeck-page-box-line > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wowdeck-page-box-line b { font-weight: 700; }
.wowdeck-page-box-count { color: ${BOX.count}; font-weight: 700; }
.wowdeck-page-box-detail { color: ${STEAM.textMuted}; }
.wowdeck-page-box-error { color: ${STEAM.danger}; }
.wowdeck-page-box-track {
  position: absolute; left: 10px; right: 30px; bottom: 9px; height: 4px;
  border-radius: 2px; overflow: hidden; background: rgba(103, 112, 123, 0.35);
}
.wowdeck-page-box-fill { height: 100%; background: ${STEAM.primary}; }
.wowdeck-page-box-button {
  box-sizing: border-box; flex-shrink: 0; margin: ${BOX.buttonMargin};
  padding: ${BOX.buttonPadding}; border-radius: ${BOX.buttonRadius};
  font-size: ${STEAM_FONT.body}; white-space: nowrap; text-align: center;
  color: ${BOX.text}; background: ${BOX.buttonSecondary}; outline: none;
  transition: background-color .2s ease-out, color .2s ease-out, opacity .2s ease-out;
}
.wowdeck-page-box-primary { background: ${BOX.buttonPrimary}; }
.wowdeck-page-box-inert { opacity: .45; }
.wowdeck-page-box-button.gpfocus { background: ${BOX.focusBackground}; color: ${BOX.focusText}; opacity: 1; }
.wowdeck-page-box-inert.gpfocus { color: ${STEAM.textDisabled}; }`;

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
/* A pane's own navigation (the TradeSkillMaster destination's title row
   with its view pills) floats at the top of the widened pane while its rows scroll under it
   (S24). The pane is pinned to the QAM viewport and scrolls itself inside
   8 px of padding, with nothing above it to attach to: the bar sticks at
   the scroller's very top and covers that padding, opaque on the QAM's own
   background, like .wowdeck-float-pane, and ends in the same scroll fade
   once rows scroll under it. The pane's rows keep the root's scroll buffer,
   which is taller than the bar and its fade, so a focused row never rests
   under them. */
.wowdeck-pane-slot-open .wowdeck-pane-bar {
  position: sticky; top: -8px; z-index: 1; background: #0e141b;
  margin-top: -8px; padding-top: 8px; padding-bottom: 8px;
  /* Paints the QAM background above the bar too: scrolled rows showed
     through a few px over the pills (DEVICE 2026-11-24). */
  box-shadow: 0 -16px 0 0 #0e141b;
}
/* The title row: the destination's name in Steam's 16 px row text, its
   views' pills right-aligned and centred on it (owner, PR #318 review). */
.wowdeck-pane-title {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  color: ${STEAM.text}; font-size: ${STEAM_FONT.body}; line-height: 24px;
}
.wowdeck-pane-title > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wowdeck-pane-slot-open .wowdeck-pane-bar::after {
  content: ""; position: absolute; left: 0; right: 0; top: 100%;
  height: var(--wowdeck-fade-size, 20px); pointer-events: none;
  background: linear-gradient(#0e141b, rgba(14, 20, 27, 0));
  opacity: 0; transition: opacity .15s ease;
}
.wowdeck-pane-slot-open .wowdeck-pane-bar[data-wowdeck-scrolled]::after { opacity: 1; }
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
/* Text that names a glyph-only control for screen readers and the device
   test tool's seek, which reads text nodes, not aria-label (#146). Kept in
   the layout tree but drawn nowhere. */
.wowdeck-visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
  white-space: nowrap; border: 0;
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
.wowdeck-segment-menu-label {
  flex: 1; min-width: 0; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The Ledger's figures (TsmLedger): the in-game Dashboard's summary as a
   2×2 grid of a caption over a value, and its Sales, Expenses and Profit
   rows as label-left, value-right lines. Captions are Steam's 12 px muted
   description text; values its 16 px body text. */
.wowdeck-dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.wowdeck-dashboard-caption { color: #b8bcbf; font-size: 12px; line-height: 16px; text-transform: uppercase; letter-spacing: .5px; }
.wowdeck-dashboard-value { color: #dcdedf; font-size: 16px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.wowdeck-dashboard-line { display: flex; justify-content: space-between; gap: 12px; color: #b8bcbf; font-size: 12px; line-height: 20px; }
.wowdeck-dashboard-line .wowdeck-dashboard-value { display: inline-flex; align-items: center; gap: 4px; }
.wowdeck-dashboard-item { min-width: 0; white-space: normal; overflow-wrap: anywhere; text-align: right; }
/* Sales, Expenses and Profit as one table: the name, then Total and Per
   day right-aligned, the caption row above using the same columns. */
.wowdeck-dashboard-flows {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.2fr);
  gap: 12px; align-items: center; width: 100%;
}
.wowdeck-dashboard-flows > :not(:first-child) { justify-content: flex-end; text-align: right; }
.wowdeck-dashboard-flows > .wowdeck-dashboard-value { display: inline-flex; align-items: center; gap: 4px; }
.wowdeck-dashboard-flow-name { color: #dcdedf; font-size: 16px; line-height: 20px; }
.wowdeck-dashboard-recorded { padding-bottom: 4px; }
/* The Export row's focus highlight met the REALM caption (DEVICE
   2026-11-24, #319): the same 8 px the other control rows keep. */
.wowdeck-ledger-export { margin-bottom: 8px; }
.wowdeck-dashboard-trend { display: inline-flex; }
.wowdeck-dashboard-trend svg { width: 12px; height: 12px; }
/* The gold graph as the in-game Dashboard draws it: gold labels in a
   column as wide as the widest, the plot with its gridlines, and the dates
   under the plot. Labels sit absolutely at the offsets tsmGoldAxes gives. */
.wowdeck-dashboard-graph { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 4px; margin-top: 4px; }
.wowdeck-dashboard-graph > svg { display: block; width: 100%; overflow: visible; }
.wowdeck-dashboard-yaxis, .wowdeck-dashboard-xaxis { position: relative; color: #b8bcbf; font-size: 12px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.wowdeck-dashboard-yaxis > span { position: absolute; right: 0; }
.wowdeck-dashboard-yaxis > .wowdeck-dashboard-axis-sizer { position: static; display: block; height: 0; overflow: hidden; visibility: hidden; }
.wowdeck-dashboard-xaxis { height: 16px; margin-top: 2px; margin-bottom: 4px; }
.wowdeck-dashboard-xaxis > span { position: absolute; top: 0; }
.wowdeck-dashboard-gridline { opacity: .5; }
.wowdeck-dashboard-note { color: #b8bcbf; font-size: 12px; line-height: 16px; }
/* Item | Sold | Earned | Bought | Spent | Net. The list measures one set of
   tracks for the header and its rows (--wowdeck-ledger-items-tracks): Item
   takes what is left, the rest fit their widest cell on one line. A row's
   Item track is empty: its name sits on the line above. */
.wowdeck-ledger-items-columns {
  display: grid;
  grid-template-columns: var(--wowdeck-ledger-items-tracks, minmax(0, 1fr) repeat(5, max-content));
  gap: 12px; width: 100%; font-variant-numeric: tabular-nums;
}
.wowdeck-ledger-items-columns > :first-child { min-width: 0; overflow-wrap: anywhere; }
.wowdeck-ledger-items-columns > :not(:first-child) { text-align: right; white-space: nowrap; }
/* A rarity colour under 4.5:1 on Steam's focus highlight (#3d4450) turns
   white on the focused row (spec #323). */
.gpfocus .wowdeck-ledger-items-name-focus, .Focusable:focus .wowdeck-ledger-items-name-focus { color: ${STEAM.header} !important; }
/* A column header: a focus stop that sorts, white with dark text when
   focused as Steam's tab pills are (S15), its text kept clear of the
   highlight's edges (S27). */
.wowdeck-ledger-items-sort {
  padding: 2px 6px; border-radius: 4px; white-space: nowrap; cursor: pointer;
  transition: background-color .1s ease, color .1s ease;
}
.wowdeck-ledger-items-sort.gpfocus { background: ${STEAM.header}; color: ${STEAM.row}; }
.wowdeck-ledger-items-arrow-room::after { content: " ▼"; visibility: hidden; }
.wowdeck-ledger-items-arrow-room-lead::after { content: "▼ "; visibility: hidden; white-space: pre; }
/* The column header (TsmLedger): it sticks right under the floating title
   row, whose height TsmDestination measures into --wowdeck-pane-bar-height.
   The pane scrolls inside 8 px of padding, which sticky offsets count from,
   as .wowdeck-pane-bar's -8px does. Above the title row's fade in stacking
   order, so its own fade, shown only once rows scroll under it, ends the
   floating part (S24). */
.wowdeck-pane-slot-open .wowdeck-ledger-items-head {
  position: sticky; top: calc(var(--wowdeck-pane-bar-height, 48px) - 8px);
  z-index: 2; background: #0e141b;
}
.wowdeck-ledger-items-head::after {
  content: ""; position: absolute; left: 0; right: 0; top: 100%;
  height: var(--wowdeck-fade-size, 20px); pointer-events: none;
  background: linear-gradient(#0e141b, rgba(14, 20, 27, 0));
  opacity: 0; transition: opacity .15s ease;
}
.wowdeck-ledger-items-head[data-wowdeck-scrolled]::after { opacity: 1; }
/* The column labels in the Dashboard's caption style. In the QAM a row's
   text starts at its PanelSectionRow's edge, so the labels row reaches 6 px
   past it on both sides, each cell's own 6 px padding: the labels then line
   up with the values. A 6 px inset put every label 12 px inside its column
   (DEVICE 2026-11-26, LEDGER-PILL-3). */
.wowdeck-ledger-items-labels {
  color: #b8bcbf; font-size: 12px; line-height: 16px; text-transform: uppercase; letter-spacing: .5px;
  box-sizing: border-box; width: calc(100% + 12px); margin: 0 -6px; padding: 0 0 6px;
}
/* An item row: the icon slot (no room when the page has no icons) beside
   its two lines. The name, which wraps only between words unless a word is
   wider than the pane, then the figures under it in the header's columns.
   Steam's Field pads 12 px on every side in Game Mode, and its "compact"
   padding is the same there (Classic only differs). The row takes back
   6 px above and below inside our own class, so rows are 12 px shorter
   while Steam's padding, separator and highlight stay as Steam draws them
   (owner, #335 review). */
.wowdeck-ledger-items-row { display: flex; align-items: stretch; gap: 8px; width: 100%; min-width: 0; margin-top: -6px; margin-bottom: -6px; }
.wowdeck-ledger-items-icon { flex: none; align-self: center; width: 36px; height: 36px; }
.wowdeck-ledger-items-icon > img { display: block; width: 100%; height: 100%; border-radius: 2px; }
.wowdeck-ledger-items-lines { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.wowdeck-ledger-items-item { min-width: 0; }
.wowdeck-ledger-items-item > .wowdeck-ledger-items-name { overflow-wrap: break-word; }
.wowdeck-ledger-count { padding-bottom: 4px; }
.wowdeck-ledger-items-none { color: ${STEAM.textDisabled}; }
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
