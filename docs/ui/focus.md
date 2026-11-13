# Focus, controller navigation, modals and forms

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Rules F1–F10 and the project's focus rules, the details-modal workaround, pagination, the navigation contract and forms.

## Contents

- [6. Focus, controller navigation, modals and forms](#6-focus-controller-navigation-modals-and-forms)
- [6.1 Facts about `Focusable` (installed `@decky/ui` 4.12.1, OFFICIAL types)](#61-facts-about-focusable-installed-deckyui-4121-official-types)
- [6.2 Rules — general [GENERAL]](#62-rules--general-general)
- [6.3 Rules — project [PROJECT]](#63-rules--project-project)
- [6.4 Details modal: carousel and scrolling (workaround, not a pattern)](#64-details-modal-carousel-and-scrolling-workaround-not-a-pattern)
- [6.5 Pagination focus](#65-pagination-focus)
- [6.6 Navigation contract (testable, per screen)](#66-navigation-contract-testable-per-screen)
- [6.7 Forms](#67-forms)

## 6. Focus, controller navigation, modals and forms

Options update navigation, owner decision from PR #210 review: Right from the
rightmost control of any Options row moves to the floating Update button.
Left returns to the originating control and restores the list's scroll offset.
A row's own horizontal controls take precedence. When Update is absent or
disabled, Right keeps its normal behavior. `updatePanelNavigation.ts` handles
this through the Options group's direction handler and the Update button's
return handler. Controller behavior remains unverified on hardware.

Every icon-only glyph in a Field's right column goes through `RowGlyph`
(`src/components/RowGlyph.tsx`): `RowChevron` for rows that open a modal,
`RowSpinner` for a running action, `RowGlyph` around any other icon, and
`busyIcon` switches between an icon and the spinner. A bare icon sits level
with the label's first line. On "Find WoW installations" it sat 18.7 px above
center (DEVICE, 2026-11-12), while every `RowChevron` row measured 0.0. Right
columns holding a button or text (an addon row's menu button, a search
result's download count) keep Steam's own placement, and so does the spinner
that swaps in for them.

Modal-opening rows use `RowChevron` inside a native `Field`. Its width stays
in the right control column. The glyph is positioned against the whole row,
so a wrapped description does not push it above center. Steam's normal right
inset stays in effect. `verticalAlignment="center"` and
`childrenContainerWidth="min"` are already Field defaults; the former aligns
the label, not the right column. Setting them explicitly does not fix this.

Local Chromium measurement on 2026-11-12, using the captured Steam Field DOM
and both `library.css` and `sp.css`, reproduced a 20 px center error with the
bare icon. Rendering `RowChevron` reduced it to 0 px, with the right inset
unchanged. This is a local stylesheet check, not a device result. The normal
component tests replace Steam controls and cannot verify this geometry.

Footer actions need `DialogTwoColLayout _DialogColLayout` around their
`Focusable flow-children="row"` group when there are two buttons. Direct
children of `DialogFooter` do not get the two-column layout. The same local
check measured a 28 px gap after adding the wrapper. Inside the dialog body,
actions are whole-row Fields and inputs use TextRow. Backup status and
progress also sit in native Fields, so they keep the same row insets.

## 6.1 Facts about `Focusable` (installed `@decky/ui` 4.12.1, OFFICIAL types)

- `flow-children?: string` — maps to SteamUI's layout enum
  (NONE/COLUMN/ROW/GRID/GEOMETRIC). Valid string values for this prop are
  UNVERIFIED beyond what COMMIT 4eb1029 recorded and the device check in
  [§8.4a](device-notes.md#84a-device-observations-2026-10-13): `"row"` → `layout 2`; `"horizontal"` → no layout set.
- `onActivate`, `onCancel`, `focusClassName`, `focusWithinClassName`,
  `noFocusRing` are declared on `Focusable`.
- `FooterLegendProps` (inherited) declares `onGamepadFocus`, `onGamepadBlur`,
  `onOKButton`, `onCancelButton`, `onSecondaryButton`, `onOptionsButton`,
  `onMenuButton`, `onGamepadDirection`, `preferredFocus`,
  `navEntryPreferPosition`, and action-description props.
- `NavEntryPositionPreferences` (FIRST/LAST/MAINTAIN_X/MAINTAIN_Y/PREFERRED_CHILD
  = 0..4) **is exported by 4.12.1** from the FooterLegend module.
- A `ref` on Decky's `Focusable` may be silently `null` (LIVE, Details-text
  investigation). Put refs on plain DOM elements nested inside.
- **Footer legend source (DEVICE, 2026-10-13).** Steam's footer bar (the
  Steam-owned strip with A SELECT / B BACK) takes its Y/X labels from the
  *currently focused* element and its ancestors. A `Focusable` carrying
  `onOptionsActionDescription` / `onSecondaryActionDescription` that nobody
  focuses shows nothing, and `preferredFocus` on it did not change that. What
  worked: wrap the content in `<Field focusable highlightOnFocus={false}
  padding="none" bottomSeparator="none" childrenLayout="below"
  childrenContainerWidth="max" {...legendProps}>`, so the focus target itself
  holds the legend props. The Decky "Web Browser" plugin's Default Tabs rows
  (X DELETE, Start REORDER) use the same `Field focusable` pattern. The label
  props only fill the legend; the matching button props
  (`onOptionsButton` = Y, `onSecondaryButton` = X) must also be passed.

## 6.2 Rules — general [GENERAL]

**F1 MUST** give every focus target visible focus styling by using platform
components. For custom `Focusable`s, check that a focus ring or highlight
actually appears (visual tier, [§8](verification.md#8-testing-and-verification)).

**F2 MUST** keep a modal's B-button/close working: pass `onCancel` and
`closeModal` to `ModalRoot`.

**F3 SHOULD** keep modal focus management to `ModalRoot`'s own behavior.
Commit 7370532 records (LIVE) that focus returns to the opener on close; no
restoration code exists in `src/`. After a panel *remount* (G4) it did **not**
reproduce on the observed device: focus landed on a different element (DEVICE,
[§8.4a](device-notes.md#84a-device-observations-2026-10-13) part 2) — see backlog U-5.

**F4 MUST NOT** make a non-focusable scroll region the only way to read
content, unless you provide an alternate input route. The Details modal uses
`registerDirectScroll` (`src/valveScroll.ts`) for that reason (6.4).

**F5 SHOULD** render link content as real `ButtonItem`s. Anchors injected with
`dangerouslySetInnerHTML` are invisible to gamepad focus (LIVE, Details
modal). The project extracts links and shows up to 6 buttons. The planned
Details redesign deliberately drops this and accepts pointer-only links
(backlog U-18).

## 6.3 Rules — project [PROJECT]

**F6** (superseded 2026-10-15 by S14; kept as a record). Rows with several
action buttons used `flow-children="row"` plus
`navEntryPreferPosition={MAINTAIN_X}` to preserve the horizontal position when
the user pressed Up/Down (`InstalledView`, COMMIT 4eb1029). Still valid if a
grid of per-row buttons is ever needed again. Root cause (LIVE,
inspected via CDP, recorded in the commit): without `navEntryPreferPosition`,
SteamUI falls back to the node's own remembered last-active child index.

  - `navEntry.ts` finds the enum via `findModuleExport` and degrades to a
    no-op if not found. Since 4.12.1 exports `NavEntryPositionPreferences`,
    that lookup is *probably* replaceable by a direct import; the comment
    "The enum isn't exported by `@decky/ui`" in `navEntry.ts` is stale for the
    lockfile version. Do not change it opportunistically (backlog U-11) — it
    must be tested on a device, and `^4.11.0` allows older versions where this
    may not hold: UNVERIFIED.

**F7 [PROJECT] MUST** use `flow-children="row"` for horizontal groups. All
uses of `"horizontal"` were replaced in commit dd81038 (U-4 resolved). History:
about 20 `Focusable`s used `"horizontal"`. Per COMMIT 4eb1029 that is not
a valid value. **Device check ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)):** on SteamOS 3.8.28 / Decky 3.2.10 the
nav nodes for `"horizontal"` groups carry no `layout` at all, whereas `"row"`
yields `layout === 2`. So `"horizontal"` is confirmed to configure nothing;
the rows work through SteamUI's default handling: Left/Right in the toolbar
`"horizontal"` group moved correctly with synthetic keys (DEVICE, [§8.4a](device-notes.md#84a-device-observations-2026-10-13) part 2).
The `layout === 2` reading for `"row"` was first seen on Decky's own `TextField`
wrappers; part 2 later found it on this project's `InstalledView` action row
too. Do not mass-edit (backlog U-4).

**F8 [PROJECT] SHOULD** treat `onGamepadFocus` as the only reliable per-element
focus hook (the focus-scroll watcher that used it was removed with S14). A `MutationObserver` on `gpfocus` was tried and never corrected
anything live (header of the removed `focusScrollWatcher.ts`, git history). `gamepadFocusProp` returns
an untyped spread because earlier typings did not declare the prop. In 4.12.1
it **is** declared and a typed `onGamepadFocus={(e) => ...}` compiles (checked
for this guide, [§3.3](general.md#33-compilable-examples-general) scratch file). The helper's own duck-typing for the event
target is still necessary (G7).

**F9 [PROJECT] SHOULD** set `.focus()` on the element, not simulate input,
when moving focus programmatically: SteamUI's nav tree picks up a real
`.focus()` (LIVE). Always wait one `setTimeout` tick before correcting scroll
afterward (60 ms in `resetListFocusAndScroll`), because Decky's native
scroll-into-view runs after focus and will overwrite an earlier correction.

## 6.4 Details modal: carousel and scrolling (workaround, not a pattern)

Update 2026-10-15 (owner at 1080p; DEVICE, read-only CDP of Steam's news view
and of our modal):
- **Size by proportion, never by the Deck's pixels.** Steam's news pages are
  80 % of the screen width (683 of 854 px on the Deck, 1200 of 1500 px at
  1080p), start under the 40 px top bar and run to the bottom of the screen,
  behind the footer (which blurs again on top). The card is at most 640 px,
  centred; pages keep `scroll-padding: 68px 0 56px`. Ours had 683 × 494 px
  fixed, so on a bigger screen it looked like a small window. Ours now run the
  full height, but a page is `min(80vw, 688px)` wide (card + padding), so the
  neighbouring cards still peek in at the sides at any resolution, as on the
  Deck (owner: an 80 %-wide page at 1080p pushed them off screen; Steam's own
  news view does that too at 1080p, we deliberately keep them visible).
- **No black behind it.** Every modal gets Steam's `.ModalOverlayBackground`
  dim layer (`rgba(0,0,0,.85)` + `blur(3px)`); the news view is not a modal and
  has none, only `blur(5px) brightness(0.65) saturate(0.7)` over the live
  screen. Details clears that one layer while open and restores it on close.

The Details modal is a horizontal carousel of 2–4 full-screen pages
(Description, Changelog, Gallery only when the result has screenshots), modeled
on Steam's news view ([§8.4b](device-notes.md#84b-steam-news-view-reference-design-2026-10-13-read-only)-2). Verified on the device with the owner
(DEVICE, 2026-10-13).
Relationships (WF-11, 2026-10-16) sits after Changelog and exists only when
the addon has dependencies, like Gallery only with screenshots: Required /
Optional / Embedded libraries as on CurseForge's website tab of that name,
each group with one line saying what it means here (installed along / not
installed automatically / ships inside), names and thumbnails looked up
once (`addons.lookup`), and an Installed or Missing tag. No dependants:
CurseForge's API has none (`/v1/mods/{id}/dependents` is 404) and WowUp has
none. DEVICE (2026-10-16): "DBM - Dungeons" showed Required → DBM-Core
INSTALLED; BigWigs showed its 11 embedded libraries (one without a file for
the installation's game version as "CurseForge project 1285016").

- **Breaking out of Steam's dialog box.** Steam wraps modal content in a
  660 px `DialogContent` (background `rgb(14,20,27)`, padding 24 px), inside an
  `overflow: auto`, `position: absolute` wrapper (854×452 at y=40), inside
  `ModalOverlayContent` / `FullModalOverlay` (854×534, no transform). The
  dialog carries an identity `transform` that is *animated*: setting inline
  `transform: none` leaves the computed value `matrix(1,0,0,1,0,0)`, so a
  `position: fixed` child resolved against the (0×0) dialog and the whole
  modal rendered at zero size, off-centre. What works: walk the ancestors up to
  the absolute `overflow: auto` wrapper (found by computed style, never by
  obfuscated class names) and set `animation: none`,
  `transform: none !important`, transparent background, no shadow/border,
  zero padding. Then `position: fixed; inset: 0` really is the viewport
  (`stripModalChrome`, `AddonDetailsModal.tsx`). The modal is destroyed on close,
  so nothing is restored.
- **Layout.** Pages are 683 px wide (635 px card + 24 px each side), 494 px
  tall, 40 px below the top; the active page is centered so about 85 px of each
  neighbour shows. The track moves with a CSS `translateX` transition (Steam
  itself scrolls a react-virtualized grid with no snapping or CSS transition);
  neighbours are not dimmed or scaled. A 6 px dot row replaces the old tab row.
- **Per-page scroll.** Each page is its own `overflow-y: auto` scroller, so a
  neighbour keeps its scroll position, as in Steam (one neighbour was at
  `scrollTop` 3096 while the active one was at 0).
- **Input.** The right stick emitted nothing through
  `RegisterForControllerInputMessages` (LIVE). LB/RB and D-pad Left/Right switch
  pages; D-pad Up/Down are captured raw. `registerDirectScroll`
  (`src/valveScroll.ts`) implements Valve's own gamepad-scroll regions
  (docs/valve-bpm-scrolling.md [§3.3](general.md#33-compilable-examples-general), sp.js module 50908): one press scrolls
  30 % of the page's viewport as a sine-eased tween of
  clamp(distance/1000·200, 300, 500) ms — per-press distances on panel-sized
  viewports always sit at the 300 ms floor, exactly the ~300 ms measured on
  Steam's All Games list — and holding auto-repeats after 400 ms, then every
  50 ms (Valve's ButtonRepeatHandler staircase), each repeat retargeting from
  the running tween's *target* at linear timing, so a held D-pad glides at a
  constant speed instead of restarting the ease; repeats stop when the
  scroller has no room left (Steam's 2 px tolerance, `scrollEdge.ts`) but stay
  armed, so content growing mid-hold resumes scrolling. Wheel and touch stay
  the browser's: unanimated, never moving focus (Valve, [§4](architecture.md#4-this-plugins-architecture-and-conventions-project) of the report).
  History: a fixed-step 120 ms repeat (`registerVerticalNav`) was visibly
  stepped and removed; the per-frame 260→900 px/s velocity ramp
  (`registerHoldScroll`, 2026-10-13) was replaced by this on 2026-10-25 once
  the report showed Valve's real model. A D-pad held across an LB/RB page
  switch scrolls the new page only after a fresh press (the registration is
  per page, as with the ramp); the S29 edge bell gates on the scroll tween's
  *target*, so a press at the edge rings at once even while the last tween is
  still settling.
- **One focus target.** The page-wide `Field focusable` (6.1) is the only
  focus target on every page, including the Gallery. Gallery images are plain
  `<img>`s: when they were `Focusable`s, focus never reached them and the page
  would not scroll. On the Gallery page the Field also carries
  `onOKActionDescription="Enlarge"` / `onOKButton`, which opens the image
  nearest the screen's vertical centre; a pointer press opens the pressed one.
  Gallery images show at natural size capped at the column width (no upscaling),
  with the screenshot `title` as a caption below and an `<hr>` between entries.
- **Focus ring.** The visible "border" on Steam's news card is its focus ring,
  not a border: `outline: 2px solid rgba(255,255,255,0.6)` with
  `outline-offset: 2px` (2 px gray, 2 px gap). The card itself has `border: 0`.
  Our active card draws the same outline.
- **Y/X actions.** Both close the modal after they run. From Get Addons, X is
  Install, Reinstall, or Update when the installed addon has one, with the
  row's status tags under the name (`resultInstallLabel`, `resultTags`,
  `src/addonSession.ts`); My Addons offers X only as "Update" when an update
  is available.
- **Bell only at the edges (S29, 2026-10-16).** The 2026-10-13 note that no
  bell played was wrong or went stale: the owner heard the bell on every
  Up/Down step, because the single stage Field gives Steam's navigation nowhere
  to go. The stage now answers `onGamepadDirection` like Steam's ScrollPanel:
  silent while the page can scroll (or a neighbouring page exists for
  Left/Right), one bell per press at the edge. Earlier failed attempts at the
  bell (546068b sentinels, f3c06b1 wrapper removal) are superseded; do not
  reintroduce an inner scroll pane that leaves Up/Down to Steam's navigation.

**F10 [PROJECT] MUST** offer a **Browse** button (`openFilePicker` from
`@decky/api`, `FileSelectionType.FOLDER` or `.FILE`) next to any text field that
asks for a filesystem path, instead of making the user type it on the on-screen
keyboard. Layout: the same row as the field, as an icon button
(`FaFolderOpen`, tooltip "Browse for folder") inside a `Focusable
flow-children="horizontal"` row, exactly like the Search and Install-from-URL
rows, so D-pad Right moves from the field to the button. On pick, write the
path into the field (the user can still edit it); on cancel (the promise
rejects) do nothing. The picker is a modal, so the panel is unmounted while it
is open (G4): keep a form draft in module scope (a subscribable store read
with `useSyncExternalStore`) so the picked path reaches the remounted form
whether it arrives before or after the remount. When the path is all the form
needs first, open the picker straight from the row and show the rest of the
form in a modal after it returns, as Add WoW folder does (`src/addWowFolder.ts`,
`AddInstallationModal`). Then nothing has to survive the unmount. The export
dialog's folder/file pickers in `AddonPortabilityModal` use `openFilePicker`
too. Source of the API: installed `@decky/api` types
(OFFICIAL). Not yet verified on a Deck (see action items).

## 6.5 Pagination focus

Superseded 2026-10-15: lists load more (S18) instead of paging, so focus stays
on the "Load more" row and the new rows appear below it. The old Prev/Next
focus reset (`resetListFocusAndScroll`) was removed. UNVERIFIED on a Deck where
focus lands after a load; if it jumps, move focus to the first new row.

## 6.6 Navigation contract (testable, per screen)

Use this as the template when changing a screen. Rows marked (LIVE) were
observed by prior maintainers; everything else is the *intended* contract and
needs a human on a controller to confirm.

| Screen | Contract |
|---|---|
| Plugin top level | L1/R1 cycle My Addons ↔ Get Addons ↔ Options, clamped, not wrapped. Each press advances at most one tab even when Steam gamepad focus and DOM focus differ. Left/Right on the tab row moves between tabs. (Switching LIVE per commits c77955a, 4881005; the pill look is new, 2026-10-15) |
| My Addons list (2026-10-15) | One focus stop per addon. A = Details (unmanaged: menu), X = Update when offered (unmanaged: Find online source, 2026-10-21), Menu = context menu (Update / Details / Ignore / Remove…), footer shows the labels; ⋯ opens the menu by touch. B closes the menu. |
| Get Addons in the QAM (rev 2, 2026-10-19; device verification pending) | Collapsed: Install into above a vertical destination list (Search, Latest, Popular, From URL), focus on the plugin-tab nav bar, standard width. Focusing a destination widens the QAM and shows that destination's browse UI in the pane beside a ~240 px list; Right/A enters the pane; the pane holds Search, the lists, Popular's Category and From URL. A on a row = Details modal, X = Install, Menu = release channel. B/Left out of the pane collapses to the plugin-tab nav bar; L1/R1 leave and every re-entry lands collapsed. |
| Details modal | LB/RB cycle Description/Changelog/Gallery (disabled Gallery skipped); Up/Down scroll text; Install and View-on-source reachable; B closes. Gallery thumbnail A opens viewer; viewer Left/Right changes image; B closes viewer only. (Viewer behavior LIVE per `AddonDetailsModal.tsx` comment.) |
| Details modal, news-style carousel (DEVICE-verified by the owner, 2026-10-13; see 6.4) | LB/RB and D-pad Left/Right switch page, clamped, Gallery present only with screenshots; Up/Down scroll the active page the way Valve's gamepad-scroll regions do (30 % viewport per press, 300–500 ms sine tween, 400→50 ms repeats retargeting linearly; `valveScroll.ts`); Y = View on <Provider> (only when `websiteUrl`), X = Install (disabled while installing), B closes; in the stacked Gallery viewer B closes only the viewer and LB/RB/Left/Right belong to the viewer (`galleryOpenRef`). Links and video are pointer-only (U-18). The footer legend does render for a `showModal` modal when the page is a `Field focusable` (6.1) |
| Options | Steam settings rows, every control reachable by Up/Down. TextFields open the platform keyboard on activation. |
| WoWDeck update, Options (#20; DEVICE-verified 2026-10-28, PU-25 to PU-27) | The floating panel's **Update** button: A = Update, X = Check again, Y = Release notes when the offer has notes. While a check runs, the button reads "Checking…" and is disabled. The WoWDeck row's **⋯** under Options › Updates: A = the update channel modal, X = Check again at any time, Y = Release notes while the panel offers an update with notes. That modal offers Update, as it does from the panel. While a check runs, the row's description reads "Checking…". Check again ends in one toast: "WoWDeck is up to date", "WoWDeck <version> is available" or "Couldn't check for updates". |
| Manage backups (Settings backup; device verification pending) | Up/Down over the action rows (Back up now or Cancel, Import from file…, Copy settings from another version…) and then one focus stop per backup, newest first. A row that can't act is unfocusable; **Copy settings from another version…** is hidden, never disabled, when no other version has anything to copy (#12). With no backups listed, focus starts on the first action that can run (#12). Backup row: A = Restore (Details when it can't run), X = Delete; B closes. |
| Copy settings modal (Settings copy; device verification pending) | Focus starts on **Copy from**; A opens its dropdown (B closes the dropdown only). Under it, the section header reads "Copying from <version>" in Steam blue. Down reaches **<version> · Current settings** (installed versions only), then every backup of that version, newest first, labelled **<version> · <when> · <size>**; switching **Copy from** renames the header and every row. A on a row opens the Restore dialog worded for a copy; its A label reads Details while the copy can't run (WoW running, another job, damaged backup). B closes the modal; once a copy starts the modal closes itself and Manage backups shows progress and Cancel. |

Acceptance criteria for any change that touches focus:

1. No control becomes unreachable by D-pad.
2. B closes the topmost modal only.
3. After closing a modal, user is on the same tab with the same results (module-scope state).
4. No unintended sound/scroll jump on short lists (UNVERIFIED how to observe sound without hardware).

## 6.7 Forms

**FM1 [PROJECT] SHOULD** use `PanelSectionRow` per control, with explanatory
text in the control's own `description` (S19).

**FM2 [PROJECT] MUST** keep the Enter-key behavior of search/URL inputs as
implemented; commit 6cd6c8d removed `stopPropagation` and a guard to fix a
URL-import interaction problem whose exact cause was never confirmed. Changing
it again needs hardware testing.

**FM3 [GENERAL] SHOULD** mask secrets with `TextField`'s `bIsPassword` prop
and never log or toast secret values. The CurseForge key field does this
(`SettingsView.tsx`); the GitHub personal-access-token field does **not**
(backlog U-17).
  DEVICE (2026-10-13, CDP): `bIsPassword` alone left the rendered `<input>` as
  `type="text"` on SteamOS 3.8.28; the prop is forwarded to the DOM, not acted
  on. **MUST** also pass `type="password"` (undeclared in `TextFieldProps`, so
  spread it through a cast; `PASSWORD_INPUT_PROPS` in `SettingsView.tsx`).
  Both secret fields now do; accepted by the owner.
