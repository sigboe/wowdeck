# The Steam Deck design language

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Rules S8–S39: how Steam's own UI looks and behaves, measured on the device.

## Contents

- [5.3 The Steam Deck design language (DEVICE-derived)](#53-the-steam-deck-design-language-device-derived)

## 5.3 The Steam Deck design language (DEVICE-derived)

**Valve publishes no human interface guideline for its UI.** What exists
(Steamworks, "Getting your game ready for Steam Deck" and the Deck Verified
requirements, read 2026-10-15) is about games: be controller-usable, use the
on-screen keyboard API, text readable at 30 cm, nothing below 9 px at 1280x800
(12 px recommended); the getting-started page says 24 px fonts at 1080p. Neither
page gives spacing, colour, dialog or focus rules, and neither carries a date.
The Apple, Microsoft and Material guidelines are only background; **Steam's own
client is the specification.** Everything below was read from it, on SteamOS
3.8.28 with Steam client build 2026-10-13 (the installed client is current as of
this writing), from three places:

1. `~/.local/share/Steam/steamui/css/sp.css` and `library.css`: the rules.
2. The class-name map (`Field`, `StandardPadding`, ... to hashed names). It is
   plain data in the client's webpack module sources and was read as text over
   CDP without running any module.
3. Live computed styles over CDP in the running UI (the real dialog frame and
   buttons were measured while our modal was open).

`tools/steamui_rules.py` joins 1 and 2 so any value here can be re-checked after
a SteamOS update (procedure in its docstring). Re-measure when SteamOS or Steam
changes; the values are Valve's to change.

**Tokens (all CSS px; the Deck panel is 854x534 CSS px at DPR 1.5).**

| Thing | Steam's value |
|---|---|
| Dialog frame | bg `#0e141b`, 2 px `#23262e` border, width 660, padding `calc(12px + 2.25vh) 2.8vw` (31 x 42 live) |
| Dialog header | 22/28 bold, white, 10 below |
| Section header | 18/22 medium (in `BasicUI`, our case: 16 px, 600, UPPERCASE, 50 % white), 12 px vertical padding, 1 px `#23262e` underline |
| Between sections, headers | 24 above (not the first child) |
| Body text | 16/20 `#dcdedf`, 10 below |
| Row (`Field`) | flex, 12 column gap, **padding 12 x 12** (20 horizontal when the window is 1500+ wide), radius 2, bg `#23262e`, **6 above each following row** |
| Row label / description | 16/20 `#dcdedf` / 12/16 `#b8bcbf`, 4 apart (6 when the control is below) |
| Row focus | bg `#3d4450`, text white, 0.32 s ease; disabled text `#67707b` |
| Button | 16/20, padding 10 x 24, min width 160, 40 high, radius 2, bg 15 % white; **focused: white bg, `#23262e` text**; Primary focused `#1a9fff`; Destructive focused `#de3618`; disabled 40 % opacity |
| Stacked buttons | 10 apart |
| Footer | 16 above; `DialogTwoColLayout`: two equal columns (each at most half the width minus 14, at least 200), so about 28 between; **the action first, Cancel second** |
| Toggle | 38 x 22 rail, 22 px white knob, on `#1a9fff`, focus ring `#67707b` |
| Success / warning accents | Steam's `#59bf40` (positive) and `#ef806c` (danger text); ours come from `steamTheme.ts` (S20) |

**S8 [PROJECT] MUST** build a modal from Steam's own dialog components
(`ModalRoot` with `DialogHeader`, `DialogBody`, `DialogBodyText`,
`DialogControlsSection`, `DialogControlsSectionHeader`, `DialogFooter`,
`Field`, `ToggleField`, `DialogButton`, `DialogButtonPrimary`) with no plugin CSS on them. Those components carry the tokens above, so the
spacing, type and focus colours are right. The old `.wowdeck-root` Field
override (removed, S3) took away the 12 px row padding and made the label touch
the edge of the lighter row (found on the Restore
dialog, owner, 2026-10-15). Hand-rolled `<div>` headings with `em` sizes are the
other symptom: use the components. The owner set one exception. The Copy
settings modal colours its "Copying from <version>" section header
`STEAM.primary` so that the source of a copy stands out.

**S9 [PROJECT] MUST** present an action in a modal or list as a whole-row
`Field` (label, description, `onClick`, `focusable`), not as a free-standing
button. Steam's settings are rows. Use focusable `DialogButton`s only in the
footer; buttons shown inside a row are for touch and are `focusable={false}`
(S14). Two stacked `wowdeck-btn-row`s touched each other
(0 px) on the backup modal; Steam's minimum between rows is 6.

**S10 [PROJECT] MUST** keep at least Steam's spacing between focus targets: 6 px
between rows, 8 px between side-by-side buttons, 10 px between stacked buttons,
24 px between sections, 16 px above a footer. Adjacent focus targets must never
touch, because the focus highlight of one then reads as part of the other.
How: Steam's own components already carry these (`Field` rows, `PanelSection`,
`DialogControlsSection`, `DialogFooter`); for a group of our own buttons use a
flex container with `gap: "8px"` (side by side) and never set a Steam
component's margin or padding to 0 (S3). Check by measuring the gap between the
two elements' boxes with `tools/deck-ui/eval.mjs`.

**S11 [PROJECT] SHOULD** use Steam's type scale: 22 header, 18 (16 uppercase in
BasicUI) section header, 16 body and labels, 12 descriptions and footnotes;
nothing below 12 px (Valve's certification floor is 9, recommended 12) and no
`em` fractions of an unknown base. How: `STEAM_FONT` from `steamTheme.ts` (or a
px value measured from Steam, e.g. the news headline 24 px) in inline styles
and CSS; never `0.9em`. Evidence (audit 2026-10-15): Details' markdown was
`0.9em` and its inline code `0.9em` of that, 11.3 px; the gallery caption
`0.85em`, 11.9 px; our status tag and glyph fallback were 11 px. All now px. Description grey is `#b8bcbf`, not our older
`#95a3ab`, inside dialogs.

**S12 [PROJECT] SHOULD** follow Steam's dialog template: header, body, footer.
Footer = two equal columns, the action (Primary) first and Cancel second, B
cancels. Steam focuses the action by default; for a destructive or replacing
action keep initial focus on the first control above the footer (the Restore
dialog's toggle) so a stray A changes nothing. Use `bDestructiveWarning` on
`ConfirmModal` for deletes. Whole-row highlight on focus is Steam's own (Apple's HIG says the
same for lists); do not disable it.

**S13 [GENERAL] SHOULD** group by proximity, align on one left edge, and show
state by shape as well as colour (Steam's switch moves its knob). Background
reading, consistent with Steam's own choices: Apple HIG Layout, Focus and
selection, Toggles and Alerts; Microsoft Designing for Xbox and TV and Gamepad
interactions (clear, unmistakable focus; 32 epx controls; 15 epx text); Material 3
dialogs (24 dp inset, sparingly used). None gives numbers that override Steam's.

**S14 [PROJECT] MUST** make each item in a list one focus stop, as Steam's
Library and Downloads do. In this plugin: A opens the item (Details), X is its
secondary action (Update on My Addons, Install on results), and the Menu button
opens Steam's context menu (`showContextMenu` with `Menu` / `MenuItem`; the
primary action first with `tone="emphasis"`, destructive actions last with
`tone="destructive"` after a `MenuSeparator`). Label every button in the
footer (`onOKActionDescription`, `onSecondaryActionDescription`,
`onMenuActionDescription`, with the matching `onSecondaryButton` /
`onMenuButton`). For touch, show the same action on screen as a
`DialogButton` with `focusable={false}` (the ⋯ button), so it adds no focus
stop, but only when touch has no other way in: a result row's Install button
was removed (2026-10-15, owner) because it duplicated X, could not be focused
and made A look like "install"; tapping the row opens Details, which has
Install. Use the space on the right of a row for state instead (a spinner
while working, "Installed", the download count). Measured reasons: Steam's source labels X mostly as
dismiss/delete/remove and Y as options/sort, but Steam leaves the mapping to
each screen; we keep X = Update/Install to match the Details modal. Owner
decision 2026-10-15. An unmanaged My Addons row, which has nothing to update,
uses X for its own way in: Find online source (owner, 2026-10-21).

**S15 [PROJECT] MUST** draw plugin tabs like Steam's tab bar: 12 px bold
uppercase pills, radius 64, selected 15 % white, focused white with
`#23262e` text, and Steam's own shoulder glyphs at the ends. In the QAM the
inactive tabs show only their icon: three uppercase labels overflow 268 px
(measured on a mock rendered with Steam's CSS). Read from the installed client
(2026-10-15) and followed:
- **Glyphs** come from Steam's glyph component (`SteamGlyph`, found in Steam's
  webpack modules; `@decky/ui` does not export it), which draws the glyph of
  the controller in use (Xbox LB/RB, PlayStation L1/R1, Deck L1/R1, Switch,
  8BitDo). Never hard-code "L1"/"LB": the owner's controller showed the wrong
  names. Text is only the fallback when the lookup fails. 32 px wide, as in
  Steam's tab bar.
- **Bumpers** are taken as gamepad button events (`onButtonDown`,
  `GamepadButton.BUMPER_LEFT/RIGHT`) on a `Focusable` around the tabbed
  content, as Steam's `Tabs` do, never as global raw input (4.4).
- **No wrap-around**: Steam's `Tabs` wrap by default (`wrapAround ?? true`),
  but Steam's own bars differ, and ours stop at the ends (L1 on the first tab
  and R1 on the last do nothing; `shoulderNav.ts`). Owner decision 2026-10-20
  after trying both: with three tabs in the narrow QAM bar, wrapping is the
  more jarring of the two.

**S16 [PROJECT] MUST** use Steam's QAM row components as they are:
`PanelSection` / `PanelSectionRow` with `Field`, `ToggleField`, `DropdownItem`,
`TextField`, `ButtonItem layout="below"`. In the QAM these render Steam's
"Classic" rows: transparent, 1 px separator, 10 px vertical padding, focus
`#3d4450` bleeding 16 px to the panel edges. A drill-in row is a focusable
`Field` with a `FaChevronRight` child. A picker is a `DropdownItem` with a
label, never a bare `Dropdown`.

**S17 [PROJECT] MUST** send every toast through `pluginToast` (plugin icon,
trimmed body), and SHOULD show progress where the work is: a
`ProgressBarWithInfo` (Update all, WTF jobs) instead of a spinner and text.
Toasts are for results that arrive while the user may be elsewhere (A6).

**S18 [PROJECT] SHOULD** put browsing and searching on a full-screen route with
Steam's `Tabs` (as Steam's Store and Decky's own plugin store do), with
load-more rows instead of paging and no accordions. The QAM keeps quick actions,
status and settings. Use Steam's own page props (read from the client,
2026-10-15), not offsets of our own:
- **Below Steam's top bar, never under it** (S24). Start the page below the top
  bar with `margin-top: var(--basicui-header-height, 40px)` (Steam's own
  variable; 40 px measured) and let Steam's tab header float over the list.
  Do NOT use `canBeHeaderBackground="always"` on a Decky route: it shifts the
  page up by the top-bar height (`top: calc(var(--basicui-header-height) * -1)`)
  so the header can sit under a translucent top bar, which only works when the
  route already starts below the bar. Decky's route container starts at y = 0,
  so the tab row and its L1/R1 glyphs ended up behind the clock (owner,
  2026-10-15; we briefly shipped this in a local build). The glyphs belong
  where Steam's tab row puts them, at the row's ends.
- `belowHeaderTabsContent`: a bar under the tabs that stays visible while
  scrolling (Steam reserves about 60 px for it). Page-wide choices go there
  (install target, filters), not into each tab's list. Design it like Steam's
  own filter controls: a 12 px bold uppercase caption in the muted colour next
  to Steam's `Dropdown` control (not the caption and value crammed inside one
  button: owner, "looks ugly"). A filter that matters while scrolling also
  gets Y (`onOptionsButton` + `onOptionsActionDescription`), opening the same
  Steam context menu.
- Set Steam's `scrollIntoViewType: NoTransform` (1) on a `Focusable` around
  any content that animates with transforms (the page's `Tabs`). With the
  default, Steam moves focus into the new tab while it is still offset for its
  slide-in and scrolls by the transformed position: Steam's whole window
  (`overflow: hidden`, still scrollable) slid sideways by the offset, so on R1
  the new tab seemed to stand still and the old one jumped (DEVICE, frame
  recording via CDP, 2026-10-15). Going left was unaffected only because a
  window cannot scroll below 0. Steam's own scroll panels and tab row use
  NoTransform. Diagnose odd animations by recording frames (transform,
  on-screen x, ancestors' scrollLeft), not by eye.
- Steam's `Tabs` take L1/R1 only in the tab row and the tab contents, not in
  `belowHeaderTabsContent`; the bar handles them itself (`onButtonDown`, the
  same clamped stepping), or the bumpers die while it has focus.
- B: Steam's `Tabs` move focus to the tab bar first; B on the tab bar calls
  `onCancelFromTabHeader`. Ours returns to the QAM (`Navigation.NavigateBack`
  then `OpenQuickAccessMenu(QuickAccessTab.Decky)` on the Get Addons tab, with
  focus on the launcher row of the tab you were on last.

For Get Addons, S18 is superseded 2026-10-18: the route was removed and Get
Addons is the widened QAM tab (ADR-0001, `docs/adr/0001-get-addons-widened-qam.md`);
these rules hold for whichever surface earns a route later.

**S19 [PROJECT] SHOULD** build settings as Steam settings rows: a label, one
short description, the control on the right (toggle, dropdown, small icon,
or a chevron to a sub page / modal).

**S20 [PROJECT] MUST** take colours and text sizes from `src/steamTheme.ts`:
text `#dcdedf`, description `#b8bcbf`, disabled `#67707b`, positive `#59bf40`,
primary `#1a9fff`, danger text `#ef806c`, warning `#e0b54c`; sizes 22 / 18 / 16
/ 12 px. `descriptionStyle` is Steam's 12/16 px description line. The older
literals (`#95a3ab`, `#e0544c`, `#7bbf5f`) are gone (backlog U-9 resolved).

**S21 [PROJECT] MUST** keep people's place the way Steam does (owner,
2026-10-15: "going back from a sub menu should most of the time navigate to the
same spot"):
- **Focus by identity.** Returning from a dropdown menu, modal, file picker or
  the full-screen page puts focus on the row that opened it, unless there is a
  good reason (a picked folder moves on to the next field to fill in). The QAM
  panel is rebuilt each time (G4), and Steam then restores focus by position,
  which lands lower whenever a section above loads late (CurseForge "Loading…",
  the WTF section). Use `focusMemory.ts`: every QAM row is a `focusTarget` /
  `FocusSlot` / `FocusRow` with a stable key; the remembered row is Steam's
  `preferredFocus` and is focused again on mount (`useRestoreFocus`), or as soon
  as it loads (2 s). Steam does the same per tab in its own `Tabs`.
- **How Valve gets the scrolloff feel (DEVICE, 2026-10-15, synthetic arrow
  presses with per-press measurement in Steam's settings view and our QAM).**
  Steam's settings page keeps a resting zone for the focused row (there:
  250 px padding + Steam's own 80 px row margin at the top, 60 + 55 px at the
  bottom). Inside the zone focus moves without scrolling; once the row reaches
  an edge, every further press scrolls by exactly one row and the new row
  lands on the same line. That only happens with Steam's **NoTransform**
  scroll type (`scrollIntoViewType: 1`, `STEAM_NO_TRANSFORM_SCROLL`), whose
  test is `row top - scroll-margin < padded top`. With the default (Standard)
  Steam calls the browser's `scrollIntoView({block: "nearest"})`, which treats
  a row as already visible by its own box inside the scroll padding and ignores
  `scroll-margin` for that test. Measured in our QAM: going down worked (rows
  hit the bottom padding at once), going up the row slid under our floating
  pane and Decky's title with no scroll and then jumped 402 px; with
  NoTransform set on the panel the same presses scrolled one row each, the
  row resting at 432 px. So every element that carries the scroll buffer MUST
  also carry `STEAM_NO_TRANSFORM_SCROLL` (the QAM root, `<ScrollBuffer>`, the
  page). It is inherited by every descendant.
- **No non-scrolling overflow box between a row and its scroller.** Steam's
  NoTransform scroller applies a row's `scroll-margin` only against the row's
  nearest `overflow: auto/scroll` ancestor, then uses that ancestor's own
  margin against the next one. Steam's `DialogBody` has `overflow: auto` but
  does not scroll inside a page, so on the Get Addons page going up the rows
  stopped right under the header (margin lost); with the margin carried onto
  DialogBody (tried in memory) they stopped 250 px below it (DEVICE,
  2026-10-15). So: do not wrap page tab content in `DialogBody`, and
  `useScrollBuffer` copies the margin onto any such box it still finds, and
  takes the nearest ancestor that really scrolls as the scroller.
- **It must feel like Neovim's `scrolloff`** (owner, 2026-10-15): on every
  move that would bring the focused row closer than the buffer to an edge,
  the list scrolls just enough to keep exactly the buffer; never "nothing for
  a few presses, then a jump". Steam's scroll-into-view (block "nearest") does
  exactly that as long as buffer + row + buffer fits in the visible list. If
  it does not fit, it misbehaves: nothing happens while rows slide off screen,
  then it jumps (DEVICE frame recording: the QAM list is 440 px tall; 270 + 12
  px margins left a 62 px zone for 60–92 px rows; one press scrolled 504 px).
  So, like `scrolloff`, the buffer is capped: `scrollMargins()` takes the
  visible height and the tallest ordinary row (≤ 120 px; taller boxes are
  scrolled through) and shrinks the buffer until it fits, keeping Valve's
  top-heavy split. Valve's 250/60 px applies where there is room (full-screen
  pages); in the short QAM the row ends up near the middle.
- **Measure panes where they stick.** A sticky pane is drawn lower until the
  list scrolls far enough for it to stick, so the buffer uses its `top` plus
  its height, not where it is drawn at the moment; otherwise the buffer
  changes with the scroll position.
- **Every floating pane counts.** The buffer is measured from the bottom of
  the lowest pane floating over the list: Decky's title, Steam's tab header
  with our bar inside it, any bar we add later. When a pane can be taller than
  the space Steam reserves for it (the page bar wrapping to two lines under
  Steam's fixed 58 + 60 px), the list is also padded so its first row starts
  below the pane (`ScrollBuffer reserveOverlap`, `contentOverlap()`).
- **A control that adds content keeps focus where the user expects it.**
  "Load more" (owner, 2026-10-15): focus went to the top of the page because
  the focused row was replaced by a spinner while loading, and Steam then picks
  a new focus itself. How: never unmount the focused control during its own
  action (show the spinner inside it: `Field` child, label "Loading…"); when
  the new rows arrive, focus the first new one (`.wowdeck-result-row` at the old
  length, `element.focus()` from a `setTimeout`, G7). The user pressed A on
  the row below the last item, so the first new item is the next thing down.
- **Valve's big scroll buffer, everywhere** (owner, 2026-10-15: "the same
  amount of scroll-up buffer as SteamOS uses + the height of a floating top
  bar", in the QAM, modals and full-screen pages alike). Steam's settings pages
  keep the focused row 250 px below the top and 60 px above the bottom
  (`PagedSettingsDialog_PageContent`: `scroll-padding: 250px 0 60px`). We keep
  the same 250 px / 60 px, measured from the bottom of whatever floats over the
  list: Decky's sticky title in the QAM (68 px, measured), Steam's top bar +
  tab row + our bar on the full-screen page, nothing in modals.
- **How.** Steam's focus scroller honours the container's `scroll-padding`
  plus the focused element's `scroll-margin` (read from the client: it sums
  both). `useScrollBuffer` / `<ScrollBuffer>` measures the scroller, its own
  padding and the floating overlays and sets `--wowdeck-scroll-margin-top/bottom`;
  `.wowdeck-scroll-buffer .Focusable` turns them into `scroll-margin`
  (`SCROLL_BUFFER_CSS`, needed in every document: panel, modals, page). It
  re-measures on size changes (ResizeObserver) and on every focus move
  (`onGamepadFocus`; Steam's controller navigation does not move DOM focus).
  The scrolling itself stays Steam's: the old watcher that scrolled by hand
  (case 8) must not come back. Pure maths in `scrollBuffer.ts` (tested).

**S22 [PROJECT] MUST NOT** put help text at the bottom of a section or page
(owner, 2026-10-15). A controller user reaches the bottom last or never, and by
then has already acted. Put an explanation where it is needed: a row's
`description`, a line above the controls it explains, or the page bar (S18).
If a bar or row already shows the information (the install target), drop the
help text instead of moving it. Also drop a section title that repeats the tab
name (the QAM "Get Addons" tab had a "GET ADDONS" heading under a "GET ADDONS"
tab).

**S23 [PROJECT] SHOULD** show an inactive item (an ignored addon) the way Steam
shows a row that is switched off: label and description in Steam's disabled
grey `#67707b` (the colour of a disabled `Field`), plus a small uppercase status
tag ("IGNORED", `.wowdeck-status-tag`) so it reads at a glance and not only by
colour. The row stays fully usable (A, X, Menu); only `disabled` rows are
unreachable.

**S24 [PROJECT] MUST** make every bar at the top of a view (tab bars, filter
bars, any navigation) a floating pane BELOW Steam's top bar (clock, battery),
the way Steam's Library and Store do: the pane stays in view while the list
scrolls under it, but is never drawn under the top bar, and nothing we draw
(glyphs included) sits behind the clock. We only put navigation at the top.
Concretely:
- **QAM:** our tab bar is a floating pane (`.wowdeck-float-pane`, `position:
  sticky`) right under Decky's own sticky title; its `top` is the title's
  measured height (`--wowdeck-pane-top`, set by `useScrollBuffer`). Opaque QAM
  background `#0e141b`, so rows scroll under it cleanly.
- **Fades never cover anything we draw** (owner, 2026-10-15). Decky's sticky
  title carries `box-shadow: 0 0 7px 12px #0e141b` and `z-index: 5`: a 19 px
  fade meant for list content scrolling under it, which faded over the top of
  our tab bar (glyphs and pill cut off; DEVICE screenshot, fixed in memory
  first). Valve fades only scrolling content, never other UI: Steam's
  `ScrollFade` is a `-webkit-mask-image` on the scroller itself, transparent
  over `--scroll-fade-size` (20 px) at the top and bottom edge, with
  `scroll-padding` equal to the fade, and modifier classes that drop the top
  fade at scrollTop 0 and the bottom fade at the end, so an edge fades only
  while content continues past it (read from sp.css, 2026-10-15). Our pane's
  fade follows that: hidden until the list is scrolled (`data-wowdeck-scrolled`). So: our floating pane stacks one above whatever floats above it
  (`--wowdeck-pane-z`, measured), and the fade moves to the bottom of the whole
  floating stack (`.wowdeck-float-pane::after`, Valve's `--scroll-fade-size`).
  The scroll buffer counts every fade and shadow (`shadowReach()`), so a
  focused row never rests under one.
- **Attached, always, by measurement.** A floating pane joins the pane above it
  with no gap, at rest and while scrolling, and keeps doing so when anything
  changes size later. Decky leaves 16 px of padding between its title and
  plugin content (DEVICE: title 0–68 px, our pane 84–198 px at rest), so the
  pane only reached the title after 16 px of scrolling and looked detached.
  `useScrollBuffer({ attach: true })` measures the gap and pulls our panel up
  by it (up to 40 px, so real content is never covered), re-measured on every
  resize and focus move. Never hard-code another component's height.
- **View-wide controls float with the navigation.** A control that applies to
  the whole view, not one row (the My Addons installation picker, the Get
  Addons install target and category), goes in the floating pane under the
  tab bar, never as the first row of the list (owner, 2026-10-15). Rows of
  the list itself never float.
- **Full-screen pages:** Steam's tab header is the pane (S18); view-wide
  controls go in `belowHeaderTabsContent`.
- The scroll buffer (S21) includes every such pane: Decky's title, our tab
  bar and pickers, Steam's tab header, our page bar.

**S25 [PROJECT] MUST** title QAM views the way Steam titles its own QAM pages.
What: one short line ("WoWDeck Manager"), never wrapped, no shadow or fade on it,
with Valve's 16 px between the title and the first content (here our tab bar).
Why: Steam's QAM titles ("Quick Settings", "Notifications") are 22/28 px bold,
one line, outside the scroller, with `Title + ScrollPanel { padding-top: 16px }`
below them (DEVICE, CDP + screenshot, 2026-10-15). Ours read
"WoW Addon / Manager" over two lines, touched the tab bar, and the `Title`
class carried `box-shadow: 0 0 7px 12px` in Decky's panel, fading over Decky's
back button. How: Decky's `TitleView` already draws the bar (the `Title`
class, its back button, then the plugin's `titleView`, or
`<div style={{ flex: 0.9 }}>{name}</div>` when there is none). `titleView` in
`index.tsx` is that same plain div, with the short name and `whiteSpace: nowrap;
overflow: hidden; textOverflow: ellipsis`; never a second `Title` class inside
the bar: that applied its padding and height twice and misplaced the text
(PC-02, owner 2026-10-20; ProtonDB Badges, which has no `titleView`, was the
correct reference). It overrides Decky's default `flex: 0.9` with `flex: 1`:
the 0.9 slot left the last 10% of the bar unused and cut "WoWDeck Manager" by
11 px (DEVICE, CDP, 2026-10-25: 207.5 px of text at 22 px/700 in a 196.2 px
slot; at 1 the slot is 218 px, `flex: 2` measures the same, and the text ends
at the bar's 16 px padding — the gap Steam's own QAM titles keep). The plugin
list keeps the full name. The 16 px stays inside
our floating pane (`--wowdeck-attach-gap`, R3), so nothing shows through it.

**S26 [PROJECT] MUST** make moving between the QAM and a wide surface calm:
one animation at a time, and nothing that moves by itself after it opened.
For Get Addons this rule named the removed full-screen route — superseded
2026-10-18 (ADR-0001, `docs/adr/0001-get-addons-widened-qam.md`): the route is
gone and Get Addons is the widened QAM tab, which opens without a page
transition. The measurements below stay as the frame-film lesson for the next
wide surface.
Why (DEVICE frame films and a CPU profile, 2026-10-15):
- Opening: Steam fades the old page out, through one empty dark frame, and
  the new one in; that is Steam's and stays (filmed for comparison: Steam's
  own Library → Settings does exactly the same). Ours then animated a tab switch by itself, because two tabs only
  appeared once CurseForge's status had loaded and the page had fallen back to
  Search. Steam also holds a navigation until the QAM has closed, so ordering
  does not help on the way in.
- Leaving: going back and opening the QAM at the same moment stalled both
  windows (QAM's first frame 550 ms late, gaps of 130 ms). Opening the QAM
  first and going back underneath it after its slide-in gave 16 ms frames,
  and the old page returns behind the dimmed QAM, as if the QAM had been there
  all along. Steam cannot open the QAM without its slide-in.
How: keep the tab list constant (show a reason inside a tab instead of
removing it); route era — `leaveGetAddons` (code removed with the route),
`OpenQuickAccessMenu` first and
`NavigateBack` after `QAM_SLIDE_IN_MS`. Check with `tools/deck-ui/film.mjs`
(frame timestamps show stalls; a contact sheet shows extra animations).

**S27 [PROJECT] MUST** keep everything inside a focus highlight clear of its
edges, and keep values inside the control that shows them.
What: whatever lights up when focused (a row, a button, or a `Field` row that
lights up while a control inside it has focus) has its content at least 6 px
from every edge; in QAM rows Steam's own inset is 16 px. A dropdown's value
never runs past its button.
Why (DEVICE audit with `tools/deck-ui/audit-*.js`, 2026-10-15; the owner's
litmus test): the My Addons installation picker in our floating pane lit up as
a 268 × 60 px row with `padding: 10px 0`: the label touched its left edge and
the dropdown its right edge. Steam keeps a classic row's content inside its
highlight with a CSS variable, `--field-negative-horizontal-margin`: the row
pads its content by it and extends the highlight outward by the same amount.
QAM containers set it to 16 px (`PanelSectionRow` sets it on its first child).
Our picker sat in a plain `div`, so it was 0. With the variable set (tried in
memory) the audit passed. Same audit: the "Auto (from folder name)" value ran
63 px past its dropdown button and 47 px past the row.
How:
- In the QAM, every `Field`/`DropdownItem`/`ToggleField`/`TextField` row goes
  in `PanelSectionRow` (our `FocusRow`/`SettingsRow` already are one), also in
  a floating pane. Never put a Steam row in a plain `div`.
- Outside Steam's containers (our own pane or bar), set
  `--field-negative-horizontal-margin` on the wrapper, the way Steam's own
  containers do; never zero a Steam component's padding (S3).
- Dropdown values are short ("Auto", like Valve's "AUTO", "OFF"); the row's
  `description` explains them. Values that are user data (installation names,
  categories) get `renderButtonValue={QAM_DROPDOWN_VALUE}` /
  `ellipsisValue(maxWidth)` (`dropdownValue.tsx`), Valve's ellipsis.
- Check every view with the audit (recipe R8); it was calibrated on Steam's own
  QAM pages, which pass.

**S28 [PROJECT] MUST** show every text field as a Steam settings row.
What: a `Field` row carries the label and description; the input is the row's
control, without its own label; the whole row lights up while the field has
focus, like every other row. Why: Steam's own settings text fields (Settings →
Keyboard) are bare inputs inside a `Field` row, inline on the right of a
12 × 20 px padded row that lights up (DEVICE, 2026-10-16). Decky's
`TextField label=…` renders Steam's `DialogInputLabelGroup` instead (label
above, no row, only the input box lights up), the pattern of Steam's login
dialogs. In Options the owner saw two kinds of text field side by side:
"WoW folder" (row) and "Display name" / the tokens (label group). How:
`<TextRow label description>` (`components/TextRow.tsx`) around an unlabelled
`TextField`; `layout="below"` in the QAM (too narrow for inline), `"inline"` in
dialogs and pages. The audit (R8) flags any input outside a Field row
(`TEXTFIELD`).

**S29 [PROJECT] MUST** ring Steam's "can't move" bell only when a press really
goes nowhere. What: an element that handles the D-pad itself (scrolls or pages
on raw input) also answers Steam's `onGamepadDirection`: `true` while it can
still move that way (handled, silent), `false` at the edge, so Steam's
navigation runs, finds no target and plays the bell once. Why: the Details stage
is a single focus target, so Steam's navigation failed on every Up/Down and the
owner heard the bell on every scroll step (2026-10-16). Steam's own ScrollPanel
does exactly this (sp.js module 50908: returns `false` only at `scrollTop <= 2`
going up, or within 2 px of the bottom going down; READ). How: `canScroll`
(`src/scrollEdge.ts`, Steam's 2 px tolerance, unit-tested) on the element that
scrolls; Left/Right check for a neighbouring page. Held presses at an edge
(`detail.is_repeat`) return `true`, so a hold rings once, not per repeat (one
better than Valve). The raw scroll animates from the next frame, so the check
sees the position before the press moves it. Verified on the device by the
owner (heard: silent scrolling, one bell at each edge; 2026-10-16).

**S30 [PROJECT] SHOULD** put a variant of a row's main action on the Menu
button (≡) as a Steam context menu, named in the footer next to the action.
What: where X installs, ≡ "Release channel" opens a menu of "Install Stable ·
1.0 / Install Beta · 1.1b / Install Alpha · …", only where there is a real
choice: a provider with channels (CurseForge, WowUp Hub) and a pre-release
newer than the newest stable (many CurseForge addons list an old alpha
behind a newer stable, which would offer one file three times), or an addon
that already follows Beta/Alpha, so it can always go back; in My Addons the channel is an item of the
row's Options menu ("Release channel: Beta"), which opens a second menu with
the current channel marked; picking another installs that channel's latest
release at once, also an older one when going back to Stable (owner's
acceptance condition, 2026-10-16: a channel switch that only changed future
updates left the installed files on the old channel). Pre-release rows carry a BETA/ALPHA status tag
(S23). Why: the owner asked for it there (2026-10-16): the choice belongs
beside Install, and a controller user should not have to install first and
change the channel after. A footer button costs no row space and no focus
stop (S14), and Steam's own ≡ opens a context menu of options for the
focused item. A menu item names what it installs (the version), because
Beta may resolve to a newer Stable file. How: `installChannelChoices` /
`followChannelChoices` (`src/releaseChannel.ts`, unit-tested) feed
`showChoiceMenu` (`components/choiceMenu.tsx`); rows pass `onMenuButton` +
`onMenuActionDescription`; Details takes a `channelMenu` that closes the modal
after a pick, like its other actions. Verified on the device by the owner
(2026-10-16: switching channel installs that channel's release, and back).
Second use: "Update all (N)" updates this installation on A, and with more
than one installation ≡ "Update all installations" (WF-13; WowUp hides the
same choice behind a split button's arrow). The usual case stays one press.

**S31 [PROJECT] SHOULD** put a rarely used tool behind a glyph-only button
and show its state on the glyph and in the heading, never as extra rows.
What: the My Addons text filter (WF-06) is a filter glyph between Refresh and
Update all; it opens a Steam dialog with one text row (Filter / Show all, B
keeps the old filter). While a filter is on, the glyph is Steam blue, the
heading reads "INSTALLED (3 of 15)", X on the glyph shows all, and an empty
result says what to press. Why: the owner wants nothing between the user and
the addons (2026-10-16); a 300 px panel has room for the list or for tools,
and tools used once a week must not cost a row on every visit. How:
`FilterAddonsModal.tsx`, `filterAddons` (`src/addonRow.ts`, unit-tested),
state in `addonSession.ts` (the dialog unmounts the panel, G4). DEVICE
(2026-10-16, CDP run after a reboot): the dialog opens from the glyph,
Enter in the field applies, the heading read "INSTALLED (1 OF 15)", the glyph
turned blue, focus came back to it, its footer showed X Show all and "Filter:
atlas", Show all cleared it; Update all's footer showed "Update all
installations" (not pressed: it changes addons); audit: no issues.

**S32 [PROJECT] MUST** keep everything in the QAM inside the panel's width,
and check a Steam row component there before using it. What: no element may
reach past `.wowdeck-root`'s edges (audit rule OVERFLOW). Every progress row,
in the QAM or a modal, is a `ProgressRow` used as the row itself. It never
sits inside another `Field`. It sets `childrenContainerWidth="max"` and, with a
label, `childrenLayout="below"`; row actions (B cancels) go on it.
Why: the owner saw the Update all progress bar run off the panel
(2026-10-16). `ProgressBarWithInfo` is a Field laid out inline: a label column
plus a bar column with a 270 px minimum width, in a 268 px row, so the bar
ended 120-136 px past the panel. It ignores `layout="below"` but honors
`childrenLayout="below"`. Wrapped in another Field, the bar sat in a narrow
right column: 200 px of a 244 px row in the QAM with its text wrapping to two
lines, and 280 of 584 px in a modal behind an empty 268 px label column
(DEVICE, 2026-11-12, Steam's real components rendered in the panel). Used
directly, the bar fills the row: 244 of 244 px and 584 of 584 px, text on one
line, and no focusable row nested in another.
How: `ProgressRow` for any progress row; before adopting another Steam
component, render it with its real props via `render.mjs` and keep
the audit clean. Verified on the device by the owner (2026-10-16: Update all
and Update all installations, bar inside the panel).

**S33 [PROJECT] MUST** let a line of facts wrap only between facts. What: a
"·"-separated line (the Details status line) breaks between two facts, never
inside one, and no line starts or ends with "·"; a single fact wider than the
line ends in "…". Why: the owner saw the Details status line break in the
middle of a fact (2026-10-16); a lone "·" at a line edge reads as noise. How:
`FactLine` (`components/FactLine.tsx`, CSS `.wowdeck-facts` in sharedStyles):
each fact is `nowrap` with its "·" in front, the list is shifted left by one
separator inside a clipping box, so every line's leading "·" is cut off.
Checked in headless Chromium at 520/330/240/150 px (plain CSS, no Steam
component involved). Related, same day: result rows on the Get Addons page
show the download count and the last update ("14 Oct" / "Oct 2024") on the
right, as two short `nowrap` lines, so they cannot push into the row; WF-11's
dependency line in Details sits on its own line under the status line, not in
it. DEVICE (2026-10-16, CDP run after a restart): DBM's Details wrapped after
"12.1.14" with the next line starting "WoW …", DBM - Dungeons wrapped after
"95.3M downloads" with no "·" at either edge and showed "Requires 1 other
addon, installed with it"; result rows read "208M / 14 Oct", "1.1M / 24 Sep";
page audit clean.

**S34 [PROJECT] MUST** keep anything we add to Steam's own pages invisible
when it cannot be added safely, and never take Steam's focus. What: the
"WoW addons" band on the linked game's page (BEYOND-05) sits between the
hero and the Play block, starts unfocused (Play keeps the page's first
focus; Up reaches our buttons) and shows only on the game picked in Options.
Why: it lives on Steam's React internals; a Steam update can move them
(protondb-decky, which used the same patch, is archived). How:
`steamGamePage.tsx` patches `/library/app/:appid` like protondb-decky and
game-glance (renderFunc → `createReactTreePatcher` → splice into
`appDetailsClasses.InnerContainer` at index 1), every step in a guard that
logs once and leaves the page as Steam drew it, keyed so a re-render never
adds a second band. State it needs comes from module scope (the QAM is
closed there). DEVICE (2026-10-16, after restarts): band on WoW's page only,
one copy after navigating away and back, focus on Play at open, Up → Update
all, Check toasts its result in under a second, Open lands on My Addons, the
link survives a restart. Spike S8: `appStore.allApps` lists the shortcuts
(app_type 0x40000000); `SteamClient.Apps.GetAllShortcuts` does not exist on
this client (no exe paths); the home screen's WoW tile is findable by its
`customimages/<appid>.png` image.
Home-tile badge (owner, 2026-10-16: glyphs and colours only): green with a
download arrow when updates wait, dark with a check when current, blue
while checking, pinned to the top-right of the element framing the tile
image (`steamDom/homeBadge.ts`; DOM, because no Decky plugin patches home tiles;
`pointer-events: none`, never focusable). The band and the badge share one
summary (`steamUpdates.ts`); appearing shows the last counts and, with
"Check for updates when shown" on, checks in the background at most every
15 minutes. "Show a badge on its tile" is also the kill switch. DEVICE (2026-10-16,
after a restart): badge on the Recent-row tile at boot, followed the tile
when it shrank; the boot check ran (state written 30 s after boot, the
toast gate had last run the day before); the game page within 15 min
showed the counts without a new check; the toggle off removed the badge, on
restored it. Verified on the device by the owner (2026-10-16: user testing,
BEYOND-05 accepted).

**S35 [PROJECT] SHOULD** put every way of choosing which release of an addon
is installed in one place, the row's Options menu, next to each other:
"Release channel: Stable" then "Roll back to 12.1.13" (owner, 2026-10-16).
Libraries (WF-22) are tagged like IGNORED (S23), say who needs them, and
hide with a saved "Show libraries" toggle beside "Show ignored", rather than
being hidden by default: a library's update or problem stays visible unless
the user chooses otherwise. Automatic updates (WF-02) are off by default,
announce what they did in a toast, and show the last run under their toggle
(Options > Updates, with the rollback cache's size and Clear). DEVICE
(2026-10-16, agent run): Syndicator tagged "needed by Baganator", the toggle
hid/showed it; auto-update installed DBM 12.1.14 on "Check for updates"
(toast "1 addon updated automatically"), kept 12.1.13 (17 MB); "Roll back to
12.1.13" sat after "Release channel: Stable" and swapped the files; a second
check with auto-update on left the rolled-back release alone; rolling
forward cleared that; Clear emptied the cache.
Per-addon pause (owner, same day: "if we roll back, exclude the addon from
auto updating"): a rollback to an older version pauses automatic updates
for that addon, shown as a PAUSED tag (S23) and a Pause/Resume item after
"Roll back" in its Options menu, both only while automatic updates are on;
rolling forward to the latest or updating by hand resumes. DEVICE: Pause on
DBM added the tag, Resume removed it.

**S36 [PROJECT] MUST** return focus to the row that opened a modal, menu or
picker, with no exceptions. What: every remembered row (FocusRow,
FocusSlot, focusTarget) gets focus back after the panel is rebuilt (G4),
even when it renders disabled first because its data loads after the
remount. Why: the owner found Export/Import addon list and Manage backups
dropping focus (2026-10-17); the panel came back with an empty installation
list, those rows rendered disabled, the restore focused nothing and was
lost. How: a restore stays pending until its row can take focus
(`focusableTarget` in `focusMemory.ts`: a wrapper needs a `.Focusable[tabindex]`
inside, a row must be one), re-checked on every render for 2 s; the panel
also keeps its last installation list across rebuilds. Any row in focus
memory gets this; nothing else has to be done per row.

**S37 [PROJECT] SHOULD** show addons that are never updated the way Steam
shows a row that is switched off: greyed out with a status tag (IGNORED,
UNMANAGED), sorted to the end, and hideable with a saved "Show …" toggle
(owner, 2026-10-17). A dropdown row that has a second action (Active
installation → Installation details) carries it on Y through its focus
wrapper (`FocusRow actions`) and in the footer hint; it is not repeated as a
row of its own (owner, 2026-10-17: a duplicate row is clutter).

**S38 [PROJECT] MUST** write a warning so it works without colour, with the
`Warning` component (R9). What: the heading says what is happening in plain
words ("This replaces RestedXP from CurseForge"). The line under it says
what follows or what to do ("RestedXP will stop updating from CurseForge").
Amber (`STEAM.warning`) goes on the warning icon only. The heading uses
Steam's primary text grey and the lines under it the secondary grey. When
a warning lists several things, such as the addons in a conflict, each thing is a row and its details are indented secondary lines
under it, never tree connector characters such as `├─`. A warning leaves
the action enabled unless the action can't succeed. Why: colour-blind
players and a Deck screen outdoors can't rely on a colour, so the icon and
the words carry the meaning (spec #131, story 19). Indented rows read the
same at any width and cost no extra focus stops. Connector characters
depend on the font and wrap badly at QAM width. First used on the Manual
Install preview card when a file takes over a catalogue addon (#129).

**S39 [PROJECT] MUST** give `>` and ⋯ one meaning each on settings rows.
What: a chevron (`>`, `FaChevronRight`) at a row's right edge means the
row opens something: A on the row opens a modal, a picker or a page
(Options › About › Diagnostics). A ⋯ button sits beside a row's own
action and opens more settings for it (the WoWDeck row's ⋯ in Options ›
Updates opens the update channel modal). A row never uses one icon for
the other's job. Every icon-only button has an accessible name: text in a
`wowdeck-visually-hidden` span inside the button, with the glyph
`aria-hidden`, not only `aria-label`, because the device test tool reads
text nodes (`updatesSectionNames.test.tsx`). Why: the
icons mean the same thing everywhere, so players can tell what A does
before they press it, and a screen reader or the focus hint can name the
button (spec #183, stories 53 and 54).

**Preview without a Deck.** Chromium can render Steam's real stylesheets against
a static copy of the DOM: copy `css/sp.css` and `library.css`, wrap the markup in
`<div class="BasicUI GamepadMode">` and Steam's hashed dialog classes, and run
`chromium --headless --force-device-scale-factor=1.5 --window-size=854,534
--screenshot`. The page's DOM can be copied from a running modal over CDP
(`outerHTML`, read-only). This reproduced the touching button rows and the
cramped toggle before any fix and the corrected layout after (2026-10-15). The
font falls back to Arial off the Deck, so widths differ slightly. It is a
sketch, not proof; the Deck is still the test (section 8).
