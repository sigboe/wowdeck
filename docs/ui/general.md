# General Decky and Steam Deck UI principles

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Rules G1–G14 and compilable examples. They apply to any Decky plugin.

## Contents

- [3. General Decky / Steam Deck UI principles [GENERAL]](#3-general-decky--steam-deck-ui-principles-general)
- [3.1 Platform model](#31-platform-model)
- [3.2 Rules](#32-rules)
- [3.3 Compilable examples [GENERAL]](#33-compilable-examples-general)

## 3. General Decky / Steam Deck UI principles [GENERAL]

## 3.1 Platform model

- Decky renders plugin content inside Steam's Quick Access Menu (QAM) React
  tree. `definePlugin` returns `{ name, titleView, content, icon, onDismount }`
  (OFFICIAL: `@decky/api`).
- QAM plugin content is a narrow column: **300 CSS px** wide, **268 px**
  inside a `PanelSectionRow` (LIVE, measured on a Steam Deck LCD 1280×800,
  DPR 1.28, pre-rework); re-measured 300 px at DPR 1.28 (DEVICE,
  [§8.4a](device-notes.md#84a-device-observations-2026-10-13)). A Deck OLED or a different Steam UI scale may differ: UNVERIFIED.
- Navigation is a **private virtual focus tree** owned by SteamUI, not the
  browser's focus. `document.activeElement` stayed `<body>` during real
  controller navigation (LIVE, header of the since-removed `src/focusScrollWatcher.ts`, git history). Gamepad
  focus is painted with `gpfocus` / `gpfocuswithin` classes.
- Consequence: **plain DOM elements are invisible to the gamepad**. Anything
  a user must reach with the D-pad has to be a `@decky/ui` interactive
  component or a `Focusable`.

## 3.2 Rules

**G1 [GENERAL] MUST** build controls from `@decky/ui` components
(`PanelSection`, `PanelSectionRow`, `ButtonItem`, `ToggleField`, `TextField`,
`Dropdown`, `Focusable`, `DialogButton`, `Field`) so focus rings, sounds and
fonts match the platform. Reason: they are the objects SteamUI's nav tree
understands.

**G2 [GENERAL] MUST** make every action reachable with D-pad + A (and B for
back/cancel). How: every action is a focusable row or a footer button with a
label (S14); secondary actions on X / Menu with `on…ActionDescription`; touch
gets the same action through the row (tap) or the context menu. (Shoulder
buttons are a shortcut, never the
only way: S15.)

**G3 [GENERAL] MUST** wrap custom non-interactive content the user needs to
reach (text blocks, preview rows) in `Focusable` (or `Field focusable`).
Evidence: import preview needed three attempts (6de2cd3 → ca7294e → c0babd0)
before settling on `Field focusable` rows (4a9b577).

**G4 [GENERAL] MUST** treat `showModal` as destroying the QAM panel. While a
modal is open, the plugin content subtree is unmounted and remounted when the
modal closes. LIVE (project verified; neither passing `window` as parent nor
`bHideMainWindowForPopouts: false` prevented it). Consistent with Decky
Loader rendering plugin content only while the QAM is visible (OFFICIAL
`alwaysRender` exists as a plugin option; not evaluated here: UNVERIFIED
whether it would help). DEVICE ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)): re-confirmed on SteamOS 3.8.28, and
the modal is rendered in a different CEF document (`Steam Big Picture Mode`)
than the panel (`QuickAccess_uid2`). Anything that must survive goes to module
scope.
Context menus too (DEVICE, 2026-10-16): a mark set on `.wowdeck-root`
was gone after a row's ⋯ menu opened (the menu draws in `Steam Big Picture
Mode`) and a fresh root without it came back after B. So everything My
Addons shows lives in `src/addonSession.ts` (the list, rows with an action
running, Update all, Show ignored): a channel switch from the Options menu
had left an empty list until its install finished, because the remounted
panel started from `[]` and its reload waited behind the install. Two rules
follow: never seed a list from component state, and never let a reload's
wait show as "nothing there". The engine also answers requests concurrently
(`JsonlServer.run`); AddonService's gate still serializes everything that
touches the AddOns folder, `addons.list` included, so a list never shows a
folder mid-swap. Verified on the device by the owner (2026-10-16: the list
stays during a channel switch from the Options menu).

**G5 [GENERAL] SHOULD** still pass `window` as the `showModal` parent and
`bHideMainWindowForPopouts: false`, as other working plugins do. It does not
fix G4 but matches `showModal`'s own default props object (a custom props
object replaces the default; it is not merged).

**G6 [GENERAL] MUST** be defensive about `@decky/ui` exports. Most components
are discovered by scanning Steam's webpack modules (OFFICIAL source layout),
so after a Steam update an export may be `undefined`, or typed `any`
(`ModalRoot` is `any`). Fragile examples noted by upstream: `Tabs`,
`Spinner`, `ScrollPanel`, `ModalRoot`. Guard any new use of an
undocumented export (`?.` and a documented no-op fallback; the removed
`src/layout/navEntry.ts` was the example, see git history), and never crash `definePlugin` on a missing API
(COMMIT 01bffce: an unguarded `RegisterForOnResumeFromSuspend` crashed
the plugin on a Steam build).

**G7 [GENERAL] MUST NOT** rely on `requestAnimationFrame` or `instanceof
HTMLElement` inside SteamUI-invoked callbacks. LIVE: rAF callbacks scheduled
from `onGamepadFocus` never ran; event nodes come from another JS realm so
`instanceof` is false. Use `setTimeout` and duck-typing
(`typeof el.getBoundingClientRect === "function"`). (Seen in the removed
`focusScrollWatcher.ts`, git history.)

**G8 [GENERAL] MUST NOT** use `navigator.clipboard`, `window.open`, or the
browser keyboard-focus model as if this were a normal web page.
`navigator.clipboard` is unavailable in Steam's webview. Copy to clipboard
with `copyText` in `src/services/clipboard.ts`. It copies the same way Steam's
own UI does in the Steam client's `library.js`. It puts the text in an
off-screen `<textarea>` in the top window's document, because the QAM and
modals render in Steam's window and not the plugin's. It selects the text,
calls `SteamClient.Browser.NotifyUserActivation` when that exists, and then
calls `execCommand("copy")`. A textarea keeps newlines, and an input would
drop them. Never read the clipboard. Open URLs with
`Navigation.NavigateToExternalWeb` (`AddonDetailsModal.tsx`).
Evidence: DEVICE (2026-10-31, regression plan O-13b): copies from the QAM
(Diagnostics) and from full-screen dialogs (Folders…, Export) worked with A
and with touch. The pasted text matched the source byte for byte, newlines
included, and no textarea stayed in either document. The method matches
the copy code in the Steam client's `library.js`.

**G9 [GENERAL] SHOULD** prefer `Navigation` over deprecated `Router.*` and
`@decky/api` over deprecated `@decky/ui` re-exports (the installed type
declarations carry `@deprecated` markers for `Router.*`, `findModuleChild`,
`findAllModules`, the `useQuickAccessVisible` re-export and `staticClasses`).
This project now uses `quickAccessMenuClasses.Title` (U-12 resolved).

**G10 [GENERAL] SHOULD** use `useQuickAccessVisible()` from `@decky/api`
(compiles against the installed version) to gate polling or timers that only
matter while the QAM is open. The project does not currently need it
(CONSIDER, [§10](backlog.md#10-initial-ui-improvement-backlog)).

**G11 [GENERAL] SHOULD** use a wider surface for dense UI instead of fitting
it in 300 px: a full-screen route (`routerHook.addRoute`, declared in the
installed `@decky/api` types) or a full-size modal (as the Details modal does).
Owner decision (2026-10-13): the 300 px QAM column is not a design limit for
the whole plugin. Evidence: SteamGridDB's plugin keeps only settings in the
QAM and puts its gallery in a route with `Tabs`; the Details modal already
breaks out of the column ([§6.4](focus.md#64-details-modal-carousel-and-scrolling-workaround-not-a-pattern)). EXPERIMENTAL for routes: the only use
was a removed read-only spike, so how a route is entered from the QAM
  (`Navigation.CloseSideMenus()` then `Navigate`, as DeckThemes CSS Loader does),
  how it handles B/back, the footer legend, and whether it survives the G4
  remount are all UNVERIFIED. Prove a route on the device with a small spike
  before moving a screen onto it.
  For Get Addons, superseded 2026-10-18: it took the widened QAM tab instead
  (ADR-0001, `docs/adr/0001-get-addons-widened-qam.md`).

Route spike results (DEVICE + owner on a real controller, SteamOS 3.8.28,
2026-10-13; read-only list at `/wowdeck/addons`; the spike code was removed afterwards, see git history for commit "feat: experimental full-screen route spike"):
- `Navigation.CloseSideMenus()` then `Navigation.Navigate(path)` opens the
  route full-screen (854x534 viewport, content area from y=0, so pad about
  48 px at the top). Verified.
- Entry focus lands on the first focusable item. Verified.
- A CSS two-column grid of `DialogButton`s is navigated as a single vertical
  list: D-pad Up/Down reached all 12 items, Left/Right did nothing (owner).
  Use `flow-children` on a `Focusable` wrapper for real grids (UNVERIFIED
  which value works; see F6/F7).
- B (our `onCancelButton` -> `Navigation.NavigateBack()`) leaves the plugin
  entirely: the QAM stays closed and you are back on the previous Steam page.
  Reopening the QAM shows the plugin on the same tab (Options), so the
  module-scope tab state survives (P6). A route entered from the QAM
  therefore does not return the user to the QAM; the guide treats that as the
  expected cost of a route, to be accepted or worked around per screen.
- Not checked: the footer legend, scrolling with more items than fit, sound.

QAM widening measurements (DEVICE, SteamOS 3.8.28, 2026-10-18; CDP via
`tools/deck-ui` against a Deck over SSH, Friends tab widened by the tester;
all in-memory trials were reverted, nothing persistent was changed):
- The QAM web panel window is always full-screen (854x454 CSS px, dpr 1.5).
  The normal panel is a CSS clip, not a window size: the visible column is
  `._3k5MHjpKaOv6C29MKPgd6x { max-width: 348px }` (48 px icon rail + 300 px
  tab column).
- Widening (Friends) is a root class on the QAM's `BasicUI` div — the readable
  `QAMFriendExpanded` plus a hashed companion on builds whose rules compound
  one (`._2orc8…O_8CAF… .…`); set by Steam's React from friends-UI state. CSS:
  clip 348→854, content column max-width 806, Friends' inner 280 px cap
  unset, and a per-tab rule `…tab_Friends { max-width: unset }` lifts the
  300 px cap every tab container otherwise has (`overflow hidden auto`,
  `max-width:300px`). On the 2026-10-19 check the rules key only the readable
  class (`.QAMFriendExpanded .…`), so the companion is optional.
- Friends' widened layout: a 240 px list column (min-width 300 collapsed →
  240 expanded) beside a 566 px `SteamDeckChats` pane (100 px identity strip
  with avatar + name, chat history scroll, fixed bottom input row). Top of
  the list: `TabPanelHeader` (44 px title) above `FriendsListSteamDeckTabs`
  (38 px icon nav: avatar, four 24 px icon tabs, avatar). Browse-tab
   switching slides absolutely-positioned tab panels horizontally
   (0.28–0.36 s); every transition is 0.2–0.4 s ease-in-out.
- The VISIBLE width is the native BrowserView, not CSS (DEVICE 2026-10-19,
  owner-confirmed). The QAM is a full-screen BrowserView whose collapsed x is
  `innerWidth − 348` (Deck: 506); Steam's own Friends expand slides x→0. The
  placeholder element `._2orc8…`, inside the readable `#MainNavMenu-Rest`,
  carries that `browser` object as a React fiber prop
  (`props.browser.SetBounds/GetBounds`). Nothing in the QAM window can move
  it. The placeholder measures its own box on every render and calls
  `SetBounds` to match, with Steam's slides (animateIn 300 ms, animateOut
  200 ms). Its CSS-module class `Expanded` moves it, from `translateX(506px)` to
  `0`. Steam adds that class while its Friends UI store flag
  `qamFriendsExpanded` is set, and newer Steam only while the Friends tab is
  active as well (DEVICE 2026-10-31, arm64 Steam on DroidDeck: the flag alone
  left the view where it was). The plugin gives the placeholder `Expanded`
  itself through `QamExpandHook` (steamDom/qamExpandHook.tsx, ADR 0001
  revision 7). An earlier `executeInTab` script that called `SetBounds`
  itself lost every Steam re-layout: the on-screen keyboard and a closing
  modal put the view back at its collapsed x until the script slid it out
  again. With the class in the placeholder's own render those re-layouts keep
  the view wide, exactly like Friends. In Big Picture Steam does NOT add
  `QAMFriendExpanded` inside the QAM window for us, so lever 1 below is still
  ours.
- Every QAM re-show replays the entrance (DEVICE 2026-10-24, PC-20, capture.mjs:
  per-frame bounds + SetBounds stacks). A context-menu popup (any @decky/ui
  Dropdown/showContextMenu) or a modal hides the QAM BrowserView entirely
  (`SetBounds [0,0,0,0]`, QAM window hidden); on close Steam re-shows it through
  its appear path — placed at target+300 px (sp.js 303967, React commit), then a
  ~300 ms tween to target (sp.js 212 animation callbacks). With the flag set the
  target is x 0 and the replay reads as the widened QAM contracting 300 px and
  widening again; collapsed it plays 806→506 and reads as the QAM just appearing.
  The flag itself is untouched by Steam throughout (logged on the store).
- Widen motion must reveal, not reflow (owner, 2026-10-19): the QAM page is
  already laid out at its full width when the native slide starts (lever 1
  applies in the same tick), and the pane slot snaps to
  `calc(100vw − 348px)`. Animating the slot's own width made the text re-wrap
  and rows move while the container grew; the native slide alone gives the
  Friends feel. Collapsing mirrors it (PC-08, 2026-10-20): the native view
  slides back first and the QAM page keeps only its widened clip (companion
  class), and Get Addons its fixed pane (`subscribeQamLayout`), until the slide
  has ended. Content widths (readable class, our cap lift) are released at
  once, or the tab bar, other tabs and Decky's list stretch during the slide. Restoring the 348 px
  clip in the same frame would expose the page's empty right side during the
  slide.
- Widening inside the QAM window (lever 1) — PROVEN (2026-10-18; corrected
  on-device 2026-10-19): the readable `QAMFriendExpanded` alone does NOT move
  the 348 px clip. It lifts inner widths and the per-tab cap, but the clip
  element (`._3k5MHj`, `{ max-width: 348px }`) is widened only by the hashed
  companion: `.O_8CAF… { … } .O_8CAF… ._3k5MHj { max-width: 854px }`. Adding
  both classes to `BasicUI` (plus `max-width:none` on our tab container
  `tab_undefined`) takes the clip 348→854 px; this is VISIBLE only once lever 2
  (the native view, above) sits at x=0. Classes must sit on the outermost root
  (the rules are descendant selectors; inner wrappers are already >= 800 px wide
  while clipped). Do not copy structural lookalikes: `._2orc8…` is Friends'
  absolutely-positioned content (`transform: translateX(506px)`), not a flag
  class. Steam itself drops the classes when the active tab changes (React
  re-renders className), so a plugin must re-apply its classes (e.g. via a
  MutationObserver). Decision: Get Addons adopts BOTH levers — ADR
  `docs/adr/0001-get-addons-widened-qam.md`.
- Fragility: hashed names change on Steam client updates; select defensively
  and degrade to the collapsed layout when the mechanism is not found. The
  readable names (`QAMFriendExpanded`, `tab_*`) have been stable so far.

Superseded for Get Addons (2026-10-18; revised 2026-10-19, UI-02 rev 2;
ADR-0001, `docs/adr/0001-get-addons-widened-qam.md`): the full-screen route
era is over. Get Addons is the widened QAM tab (`GetAddonsTab.tsx`), mapped
like Friends & Chat: collapsed at the standard column with Install into and a
vertical destination list (Search, Latest, Popular, From URL); focusing a
destination widens beside the pane that holds that destination's browse UI
through Steam's own mechanism (the "QAM widening measurements" above), state
in `browseSessionState.ts`. `GetAddonsPage.tsx`, the `routerHook.addRoute`
registration, the drill-in rows, rev 1's text nav bar and detail pane, and the
open/leave choreography are removed. G11 and S18 no longer apply to Get
Addons (another screen may still earn a route per P9; prove it with a spike
first). The route spike results above stay as mechanism history (P3).

**G12 [GENERAL] SHOULD** use `ConfirmModal` for destructive actions
(compiles against the installed version; see example in [§3.3](#33-compilable-examples-general)).

**G13 [GENERAL] MUST** document each use of an undocumented SteamUI property
with: what it does, how it was verified (LIVE/INFERRED), and what to do if it
is missing. Example: `navEntryPreferPosition` ([§6.3](focus.md#63-rules--project-project)).

**G14 [GENERAL] SHOULD** open a choice menu inside the panel (an in-pane
overlay list, `SegmentMenu`) rather than a Steam context-menu popup
(`@decky/ui` `Dropdown` / `showContextMenu`) wherever the menu anchors to a
control the pane owns. Reason (DEVICE, 2026-10-24, PC-20): every popup hides
the QAM BrowserView entirely (`SetBounds [0,0,0,0]`, [§2](README.md#2-quick-start-checklist) QAM motion), and on
close Steam replays the QAM's entrance — placed 300 px right of target, then a
~300 ms tween back — so every pick over the widened pane reads as
contract-then-widen; the popup also unmounts the panel for its duration (G4).
An in-pane list keeps the QAM visible and the panel mounted, and picks
Steam's own picker vocabulary — value button, context-menu column, current
choice checked, A picks, B cancels (ADR 0002 revision 2026-10-24). Modals
(Details) and menus that belong to everything outside the pane may stay
Steam's: their re-entrance reads as the QAM just appearing and is not reported
(DEVICE 2026-10-24). The menu is its own navigation surface: Up/Down move
within it and clamp at the ends, since Steam's tree navigation escapes the
overlay at the edges and the close-on-blur then reads as the menu closing on
navigation (DEVICE 2026-10-24). The move belongs in `onButtonDown`: the button
event arrives before Steam navigates and `preventDefault` cancels the
navigation, so the item's `onGamepadDirection` is never consulted (DEVICE
probe 2026-10-24). `@decky/ui`'s `Focusable` does not forward `ref`: put the
ref on a plain `div` around it, or every `contains` check reads null.

## 3.3 Compilable examples [GENERAL]

All examples in [§3.3](#33-compilable-examples-general) and [§4.5](architecture.md#45-async-patterns-that-are-working) were compiled with `pnpm run typecheck`
against the installed dependencies (in a temporary file, since deleted). They
prove they **type-check**, not that they behave correctly on a Deck.

Modal open with a late-bound close handle:

```tsx
import { ModalRoot, showModal } from "@decky/ui";

interface DemoModalProps {
  title: string;
  closeModal?: () => void;
}

function DemoModal({ title, closeModal }: DemoModalProps) {
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <div>{title}</div>
    </ModalRoot>
  );
}

export function openDemoModal(title: string): void {
  const close = () => modalResult.Close();
  const element = <DemoModal title={title} closeModal={close} />;
  const modalResult = showModal(element, window, {
    strTitle: title,
    bHideMainWindowForPopouts: false,
  });
}
```

`close` is read lazily when the modal invokes it, after `modalResult` is
assigned. `closeModal` being injected by Steam's modal manager is INFERRED;
passing it explicitly as above is what the project does.

Gating a timer on QAM visibility:

```tsx
import { useEffect } from "react";
import { useQuickAccessVisible } from "@decky/api";

export function PollingGate() {
  const visible = useQuickAccessVisible();
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {}, 5000);
    return () => clearInterval(id);
  }, [visible]);
  return null;
}
```

Destructive confirmation:

```tsx
import { ConfirmModal, showModal } from "@decky/ui";

export function confirmRemove(name: string, onOK: () => void): void {
  showModal(
    <ConfirmModal
      strTitle="Remove addon?"
      strDescription={`Remove ${name} from disk?`}
      strOKButtonText="Remove"
      onOK={onOK}
    />,
    window,
  );
}
```
