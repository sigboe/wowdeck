# UI Development Best Practices — Decky Plugin (WoWDeck Addon Manager)

## Contents

- [1. Purpose, audience, scope, how to use this guide](#1-purpose-audience-scope-how-to-use-this-guide)
- [2. Quick-start checklist](#2-quick-start-checklist)
- [3. General Decky / Steam Deck UI principles [GENERAL]](#3-general-decky--steam-deck-ui-principles-general)
- [4. This plugin's architecture and conventions [PROJECT]](#4-this-plugins-architecture-and-conventions-project)
- [5. Shared components and styling [PROJECT]](#5-shared-components-and-styling-project)
- [6. Focus, controller navigation, modals and forms](#6-focus-controller-navigation-modals-and-forms)
- [7. Async state, errors and feedback](#7-async-state-errors-and-feedback)
- [8. Testing and verification](#8-testing-and-verification)
- [9. Anti-patterns and lessons (case studies)](#9-anti-patterns-and-lessons-case-studies)
- [10. Initial UI improvement backlog](#10-initial-ui-improvement-backlog)
- [11. Sources, version assumptions and maintenance](#11-sources-version-assumptions-and-maintenance)

Audience: LLM coding agents (and humans) changing the **frontend UI** under
`src/`. This is an engineering investigation record plus a rulebook. It is
not a style showcase: every rule says where it comes from and how sure we are.

Baseline of this document: repository HEAD `4a9b577`, revised for the
Steam-native rework at `dd81038` (2026-10-15); `@decky/ui` **4.12.1**
(lockfile; `package.json` allows `^4.11.0`), `@decky/api` 1.1.3, React types
19.1.1, TypeScript ^5.6, Bun 1.4.2 for tests. Re-check everything marked
"version-sensitive" after any dependency or SteamOS/Decky update.

---

## 1. Purpose, audience, scope, how to use this guide

### 1.1 What this is

- A guide to building and changing UI in this plugin without repeating
  mistakes already paid for in git history.
- A separation of **GENERAL** guidance (applies to any Decky/Steam Deck
  plugin) from **PROJECT-SPECIFIC** guidance (applies only here).
- A verification protocol that says what a change must prove, and what an
  agent is **not allowed to claim** without hardware.

### 1.2 What this is not

- Not a redesign proposal, not a refactor plan, not an upgrade plan.
- Not a copy of other plugins' code. Other plugins are cited only as pattern
  evidence (licenses are mixed or unclear; see §11.3).
- Not a statement that undocumented Steam internals are stable.

### 1.3 Authority markers

| Marker | Meaning |
|---|---|
| **MUST** | Violating it caused a bug, breaks a build/contract, or is an explicit project policy. Needs a written reason to deviate. |
| **SHOULD** | Strong default backed by evidence; deviate with a stated reason. |
| **CONSIDER** | Plausible improvement or alternative; not yet evidence-backed for this project. |
| **UNVERIFIED** | Claim not confirmed against source, docs or hardware. Do not build on it without checking. |

Scope tags: **[GENERAL]** and **[PROJECT]**. Evidence tags used in citations:

- `OFFICIAL` — Decky docs/wiki or installed type declarations.
- `LIVE` — observed on a real Steam Deck by a previous maintainer, recorded in
  a commit message or code comment. We could not re-observe it for this guide.
- `INFERRED` — deduced from reading source/commits, never observed.
- `DEVICE` — observed for this guide, by an agent, on the owner's own Steam
  Deck over SSH + the Steam CEF debugger (§8.4a). Covers only what the §8.4a
  tables list. Part 1 is read-only (`Runtime.evaluate` reads); part 2 used
  **synthetic keyboard events** (CDP `Input.dispatchKeyEvent`), which drive
  SteamUI's navigation tree but are **not** real controller input.
- `COMMIT <hash>` — a git commit in this repository.

### 1.4 How an agent should use this

1. Read §2 before touching UI.
2. Read the §3/§4 rules that match what you are changing (focus? modal? layout?).
3. Check §9 anti-patterns and §10 backlog so you do not "fix" something that is
   a deliberate workaround, or re-attempt a rejected approach.
4. Finish with the §8 verification report. State which tiers you did and did
   not reach.
5. **Every rule says what, why and how.** What to do; why (the measurement or
   owner decision behind it, with date and method); how (the helper to use,
   a code example, or a recipe in §5.4). When you add or change a rule, write
   all three. A rule without a "how" is not finished. When you learn something
   on the device, record it here the same day (§11.4), with the method, so the
   next person can repeat it (`tools/deck-ui/`).

### 1.5 Hard project constraints (from `AGENTS.md`)

- **MUST** never modify `wowup/` (read-only pinned reference checkout).
- **MUST** keep `src/` frontend-only; backend calls go through
  `src/services/backend.ts` → `@decky/api` `callable`. Wire contracts live in
  `backend/src/api/contracts.ts`.
- **MUST** run lint, format check, typecheck, tests and build before committing
  (commands in §8).
- Use small, descriptive commits.

---

## 2. Quick-start checklist

Before editing UI:

- [ ] Which surface? QAM panel (300 px column), a modal (`showModal`), or a full-screen route (G11, P9)?
- [ ] Does state need to survive a modal opening? (If yes → module scope, §4.3, rule P6.)
- [ ] Is there already a shared component/helper? (§5) Use it before writing a new one.
- [ ] Does the change touch focus/navigation? Then write the nav contract (§6.6) for it.
- [ ] Is there a Steam component for it (§5.3)? Use it; do not restyle Steam classes (S3).
- [ ] Does it change CSS in `src/sharedStyles.ts`? List every control family
      that CSS can reach and check each (§9, case study 1).
- [ ] List items: one focus stop each, actions on A / X / Menu with footer labels (S14).
- [ ] A QAM row? Give it focus memory (`FocusRow` / `focusTarget`, S21, recipe R1).
- [ ] A view that scrolls? Wrap it in Valve's scroll buffer with Steam's NoTransform scroll type (S21, R2).
- [ ] A bar at the top or a view-wide control? Floating pane, attached by measurement (S24, R3).
- [ ] A full-screen page? Steam's `Tabs`, stable tabs, bar, bumpers, enter/leave choreography (S18, S26, R4).
- [ ] Unsure how Valve does it? Look it up before inventing (R7): Steam's own CSS/JS and a measurement on the device.

After editing UI:

- [ ] `pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm test && pnpm run build`
- [ ] If you added `src/**/*.test.ts`, add it to the explicit file list in the `test` script of `package.json` (it is **not** a glob).
- [ ] Fill in the verification report (§8.5). Never write "verified on Steam Deck" unless a human did it on hardware.
- [ ] If you discovered new platform behavior, record it in a code comment **and** in this guide (§11.4).

---

## 3. General Decky / Steam Deck UI principles [GENERAL]

### 3.1 Platform model

- Decky renders plugin content inside Steam's Quick Access Menu (QAM) React
  tree. `definePlugin` returns `{ name, titleView, content, icon, onDismount }`
  (OFFICIAL: `@decky/api`).
- QAM plugin content is a narrow column: **300 CSS px** wide, **268 px**
  inside a `PanelSectionRow` (LIVE, measured on a Steam Deck LCD 1280×800,
  DPR 1.28, pre-rework); re-measured 300 px at DPR 1.28 (DEVICE,
  §8.4a). A Deck OLED or a different Steam UI scale may differ: UNVERIFIED.
- Navigation is a **private virtual focus tree** owned by SteamUI, not the
  browser's focus. `document.activeElement` stayed `<body>` during real
  controller navigation (LIVE, header of the since-removed `src/focusScrollWatcher.ts`, git history). Gamepad
  focus is painted with `gpfocus` / `gpfocuswithin` classes.
- Consequence: **plain DOM elements are invisible to the gamepad**. Anything
  a user must reach with the D-pad has to be a `@decky/ui` interactive
  component or a `Focusable`.

### 3.2 Rules

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
whether it would help). DEVICE (§8.4a): re-confirmed on SteamOS 3.8.28, and
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
Evidence: project uses a bundled `xclip` via a backend RPC for clipboard;
`Navigation.NavigateToExternalWeb` for URLs (`AddonDetailsModal.tsx`).

**G9 [GENERAL] SHOULD** prefer `Navigation` over deprecated `Router.*` and
`@decky/api` over deprecated `@decky/ui` re-exports (the installed type
declarations carry `@deprecated` markers for `Router.*`, `findModuleChild`,
`findAllModules`, the `useQuickAccessVisible` re-export and `staticClasses`).
This project now uses `quickAccessMenuClasses.Title` (U-12 resolved).

**G10 [GENERAL] SHOULD** use `useQuickAccessVisible()` from `@decky/api`
(compiles against the installed version) to gate polling or timers that only
matter while the QAM is open. The project does not currently need it
(CONSIDER, §10).

**G11 [GENERAL] SHOULD** use a wider surface for dense UI instead of fitting
it in 300 px: a full-screen route (`routerHook.addRoute`, declared in the
installed `@decky/api` types) or a full-size modal (as the Details modal does).
Owner decision (2026-10-13): the 300 px QAM column is not a design limit for
the whole plugin. Evidence: SteamGridDB's plugin keeps only settings in the
QAM and puts its gallery in a route with `Tabs`; the Details modal already
breaks out of the column (§6.4). EXPERIMENTAL for routes: the only use
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
  it. Steam moves it itself while its Friends UI store flag
  `qamFriendsExpanded` is set (`SetQAMFriendsChatExpanded(bool)`, sp.js): the
  placeholder gets the CSS-module class `Expanded` and Steam's hook slides the
  view (animateIn 300 ms, animateOut 200 ms). The plugin sets that flag
  (DEVICE 2026-10-21). An earlier `executeInTab` script that called
  `SetBounds` itself lost every Steam re-layout: the on-screen keyboard and a
  closing modal put the view back at its collapsed x until the script slid it
  out again. With the flag those re-layouts keep x 0, exactly like Friends. In
  Big Picture the flag does NOT add `QAMFriendExpanded` inside the QAM window,
  so lever 1 below is still ours.
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
(compiles against the installed version; see example in §3.3).

**G13 [GENERAL] MUST** document each use of an undocumented SteamUI property
with: what it does, how it was verified (LIVE/INFERRED), and what to do if it
is missing. Example: `navEntryPreferPosition` (§6.3).

**G14 [GENERAL] SHOULD** open a choice menu inside the panel (an in-pane
overlay list, `SegmentMenu`) rather than a Steam context-menu popup
(`@decky/ui` `Dropdown` / `showContextMenu`) wherever the menu anchors to a
control the pane owns. Reason (DEVICE, 2026-10-24, PC-20): every popup hides
the QAM BrowserView entirely (`SetBounds [0,0,0,0]`, §2 QAM motion), and on
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

### 3.3 Compilable examples [GENERAL]

All examples in §3.3 and §4.5 were compiled with `pnpm run typecheck`
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

---

## 4. This plugin's architecture and conventions [PROJECT]

### 4.1 Layout of the frontend

| Path | Role |
|---|---|
| `src/index.tsx` | `definePlugin`; `Content()`; tab state; global LB/RB registration; update toast |
| `src/components/*` | Screens and shared components (§5) |
| `src/steamTheme.ts` | Steam's colour and type tokens (S20) |
| `src/toast.tsx` | `pluginToast`: every toast, with the plugin icon (S17) |
| `src/addonRow.ts` | Pure text and context-menu actions for My Addons rows (unit-tested) |
| `src/loadMore.ts` | Pure load-more paging for Get Addons lists (unit-tested) |
| `src/addonSession.ts` | Module-scope installations and addon list, and the one set of addon actions (`addonActions.ts`, install included); `src/session.ts` wires it to the engine |
| `src/shoulderNav.ts` | Raw controller input (LB/RB, D-pad) helpers |
| `src/sharedStyles.ts` | Tab-pill and markdown CSS only (no Steam class overrides) |
| `src/browseSessionState.ts` | Module-scope state for the Get Addons tab |
| `src/services/backend.ts` | Typed `callable` wrappers + backend event subscription |
| `src/types.ts` | Frontend mirrors of wire types |

Screens: QAM tabs My Addons (`InstalledView`, with `AddonDetailsModal`), Get
Addons — the widened QAM tab: `GetAddonsTab` (destination list and browse
pane, floating plugin tab bar) and `browseTabs.tsx` (Search / Latest /
Popular / From URL bodies; details stay in the modal) — and Options
(`SettingsView`, `WtfBackupSection`); modals `AddonDetailsModal` (My Addons
and Get Addons), `AddonPortabilityModal`, `WtfBackupModal`,
`RestoreBackupModal` and `ConfirmModal`s.

### 4.2 Conventions to keep

**P1 [PROJECT] MUST** keep all backend access in `src/services/backend.ts`.
Components never call `callable` directly.

**P2 [PROJECT] MUST** unit-test new pure UI logic in a `*.test.ts` file (and
list it in `package.json`). Width maths for QAM rows is gone with the
Steam-native rows (S14, S16): Steam's own `Field` lays out label and control,
so do not reintroduce padding budgets. If a layout really needs a measured
constant, put it in a pure module with a test.

**P9 [PROJECT] SHOULD** choose the surface by content, not by habit:
the QAM column for quick glanceable actions and settings; a wide surface
(modal or route) for lists with several actions per row, galleries, long text
and anything needing a second column. A wide surface needs its own `<style>`
copy if it renders in another document (P3) and its own entry in the §6.6
navigation contract. Do not move an existing, working QAM screen onto a wide
surface without a stated reason and owner agreement (Get Addons was moved with
the owner's agreement, 2026-10-15).

**P3 [PROJECT] MUST** put shared CSS in `src/sharedStyles.ts` and inject it as
`<style>{wowdeckSharedStyleCss()}</style>` where it is used (the QAM panel, the
Details modal). Since the Steam-native rework it holds only our own classes
(`.wowdeck-tab*`, `.wowdeck-markdown`), never overrides of Steam classes (S3). DEVICE (§8.4a): the panel lives in the
`QuickAccess_uid2` CEF document, while a modal opened with `showModal` is
rendered in the main `Steam Big Picture Mode` document; a `<style>` applies to
its own document only, so the panel's stylesheet cannot reach the modal and the
modal must carry its own copy. An injected `<style>` applies document-wide, so
all overrides **must be scoped under `.wowdeck-root`** (in the modal too) so
they never leak into Steam UI.

**P4 [PROJECT] SHOULD** take colours and text sizes from `src/steamTheme.ts`
(`STEAM`, `STEAM_FONT`, `descriptionStyle`) rather than literals (S20).

**P5 [PROJECT] SHOULD** keep text short: a row label plus one line of
description; longer explanations go in a sub page or modal (S19).
The former `docs/ui-guidelines.md` (removed 2026-10-22) is superseded by
§5.3 for sizes and layout.

### 4.3 Session / lifecycle model

- `Content()` in `src/index.tsx` renders sections conditionally by tab, so
  **each tab switch remounts the section**. Local `useState` is lost on tab
  change by design.
- Opening any modal unmounts the whole panel (G4), so **a modal-triggered
  remount looks like a tab switch to React**.
- Therefore, state that must survive a modal round-trip lives in module scope:
  - `persistedTab` in `index.tsx`;
  - the Get Addons destinations in `browseDestinations.ts` and `pageState`
    in `browseSessionState.ts`, reset by `resetBrowseSessionState()` when
    the selected installation changes (results depend on its game version);
  - `sourcesStore` in `sourcesStore.ts`: the addon sources and their
    categories, shared by Get Addons and Options and kept across that reset
    (reference data, not per installation).
- `Content()` fetches status/installations/addons on every mount, so a modal
  round-trip triggers backend calls again (INFERRED from source, not measured;
  backlog U-6).

**P6 [PROJECT] MUST** decide for each new piece of UI state: *does it need to
survive (a) tab switches, (b) modal round-trips, (c) QAM close/open?* Put it
in module scope only if (b) or (c). Add it to the `reset` function if it
should not outlive leaving the screen.

**P7 [PROJECT] MUST NOT** implement "Install from URL"-style flows as a modal
that has to hand data back via React state of the unmounted panel. The
project moved URL import inline for exactly this reason (COMMIT 4de2067).

### 4.4 Global input

- QAM tab switching (L1/R1) is NOT raw input any more (2026-10-15): the panel
  root is a `Focusable` with `onButtonDown` handling `GamepadButton.BUMPER_LEFT`
  / `BUMPER_RIGHT`, which is how Steam's own `Tabs` take the bumpers. Gamepad
  button events travel through the focus tree, so the handler only fires while
  focus is in the panel. The old global `registerShoulderNav` kept firing while
  the full-screen Get Addons page was open and silently changed the QAM tab.
- Raw input (`SteamClient.Input.RegisterForControllerInputMessages`; codes
  LB=30, RB=31, D-pad Up=20, Down=21, Left=22, Right=23; undocumented,
  INFERRED stable only by observation) remains only in the Details modal.
  Open item (audit 2026-10-15): its L1/R1 and Left/Right paging should move to
  `onButtonDown` on the page `Field` (the one focus target) like every other
  bumper handler (S15); hold-to-scroll Up/Down has no Steam equivalent for a
  single focus target and stays raw, implemented to Valve's own measured model
  (`registerDirectScroll`, `src/valveScroll.ts`; see 6.4 and
  docs/valve-bpm-scrolling.md). Not changed yet because it cannot be
  tested without a deploy, and Details paging works today.
- Modals register their own handlers for their lifetime. The Details modal
  uses `galleryOpenRef` so the Details LB/RB handler is inert while the
  stacked Gallery viewer is open (mount/unmount-driven, so it is correct for
  any dismissal path).

**P8 [PROJECT] MUST** unregister every raw-input registration on unmount
(return the unregister function from `useEffect`) and, when stacking UI that
shares an input, decide which layer owns it and encode that explicitly (as
`galleryOpenRef` does).

### 4.5 Async patterns that are working

Stale-response guard (used by the Get Addons tab's search and lists):

```tsx
import { useEffect, useRef, useState } from "react";

export function useLatestOnly<T>(load: (page: number) => Promise<T>, page: number) {
  const requestRef = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    (async () => {
      try {
        const result = await load(page);
        if (requestId === requestRef.current) setData(result);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    })();
  }, [page]);
  return { data, loading };
}
```

(The real components also catch errors; this trimmed form shows only the guard.)

Module-scope state surviving remount (the shape of `browseSessionState.ts`):

```tsx
import { useState } from "react";

const sessionState = { page: 0 };

export function usePersistedPage(): [number, (n: number) => void] {
  const [page, setPageRaw] = useState(sessionState.page);
  const setPage = (n: number) => {
    sessionState.page = n;
    setPageRaw(n);
  };
  return [page, setPage];
}
```

Caveat: writing module state from a setter that fires after unmount is safe
(plain assignment), whereas a React setter on an unmounted component does
nothing. The removed `PopularBrowseSection.tsx` lost a category chosen in its
filter modal until the selection moved to module scope; the Popular tab now
picks its category with a `DropdownItem`, so no modal is involved.

---

## 5. Shared components and styling [PROJECT]

### 5.1 Inventory

| Component / module | Purpose | Reuse rule |
|---|---|---|
| `TopNav` | Steam-style tab pills with Steam's glyphs; inactive tabs icon-only | Only for plugin-level tabs (S15) |
| `SteamGlyph` | Steam's own controller glyph (LB/RB, L1/R1 … for the controller in use) | MUST use for any button glyph we draw (S15) |
| `focusMemory.ts`, `FocusSlot` / `FocusRow` / `focusTarget` | Focus kept by row identity across panel rebuilds | MUST use for every QAM row (S21) |
| `qamState.ts` | QAM tab and focus-view names outside the panel component | Use instead of new module-scope tab variables |
| `InstalledView` / `AddonRow` | My Addons rows with context menu | Pattern for any list of owned items (S14) |
| `AddonResultRow` | One search/latest/popular/URL result, a Steam `Field` row | MUST reuse for any addon-result list |
| `GetAddonsTab` / `browseTabs.tsx` | The widened QAM tab (ADR-0001): destination list, browse pane beside | Pattern for browsing UI |
| `UpdateDot`, `updateDot.ts` | Decky's notification-badge dot on a positioned anchor, one semantic colour per kind of news | MUST use for any "news here" marker on a tab pill or button; add a colour to `DotColor`, never a second dot |
| `steamTheme.ts` | Steam colour and type tokens | MUST use instead of literals (S20) |
| `pluginToast` | Toast with the plugin icon | MUST use instead of `toaster.toast` (S17) |
| `addonRow.ts`, `loadMore.ts`, `addonActions.ts` | Pure row text and actions, paging, every addon action with its toast | Extend these; keep them tested |
| `scrollBuffer.ts`, `useScrollBuffer` / `ScrollBuffer`, `SCROLL_BUFFER_CSS` | Valve's 250/60 px scroll buffer below floating bars | MUST wrap every scrolling view: QAM root, modal bodies, page tabs (S21) |
| `valveScroll.ts`, `registerDirectScroll` | Valve's gamepad scrolling (docs/valve-bpm-scrolling.md): 30 % viewport per press as a 300–500 ms sine tween, linear retarget on interrupt, 400→50 ms repeat staircase, scroll-target composition | MUST use wherever we own the D-pad scrolling ourselves (not the QAM lists, whose scrolling stays Steam's, S21) |

### 5.2 Rules

**S1 [PROJECT] MUST** reuse `AddonResultRow` for addon lists. If a variant is
required, extend the component rather than copying it.

**S2** (superseded 2026-10-15). `.wowdeck-focus-section` and the focus-scroll
policy were removed: every list item is now one focus target that Steam
scrolls into view itself.

**S3 [PROJECT] MUST NOT** override Steam component classes
(`gamepadDialogClasses.Field`, `DialogButton`, Steam's `Field` padding).
Adjust a single element with an inline `style` (for example `minWidth: 0` on a
`DialogButton`) or choose a different Steam component. History: a global
`Field` override (padding 0, margin 10px 0) made the QAM rows tight, broke
`ToggleField` highlights (case study 1), made rows touch, and was the main
reason the panel looked unlike Steam. It was removed in commit dd81038.

**S4 [PROJECT] SHOULD** use longhand margin/padding properties. The Chromium
build in Steam drops `auto` from 3-value margin shorthand (LIVE, recorded in
project comments). UNVERIFIED whether this still holds; longhand is harmless.

**S5** (superseded by S20).

**S6 [PROJECT] SHOULD** set `minWidth: 0` (and usually `width: "auto"`) inline
on a `DialogButton` that sits beside other content: Steam's default is
`min-width: 160px`, the real root cause of the old "buttons still stack" reports.

**S7** (superseded 2026-10-15). Fixed action columns are gone with the
one-focus-stop rows (S14).

### 5.3 The Steam Deck design language (DEVICE-derived)

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
reach past `.wowdeck-root`'s edges (audit rule OVERFLOW). Steam's progress
row goes through `QamProgressBar` (`childrenContainerWidth="max"`, no label).
Why: the owner saw the Update all progress bar run off the panel
(2026-10-16). `ProgressBarWithInfo` is a Field laid out inline: a label column
plus a bar column with a 270 px minimum width, in a 268 px row, so the bar
ended 120-136 px past the panel; it ignores `layout="below"` (a label is then
squeezed into a one-letter column). With a full-width children column the bar
fits Steam's 12 px row padding (DEVICE, in-memory render with
`tools/deck-ui/render.mjs`: OVERFLOW 120 px before, no issues after; the WTF
backup progress in Options used the same component and had the same flaw).
How: `QamProgressBar` for any progress row; before adopting another Steam
component in the QAM, render it with its real props via `render.mjs` and keep
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

**Preview without a Deck.** Chromium can render Steam's real stylesheets against
a static copy of the DOM: copy `css/sp.css` and `library.css`, wrap the markup in
`<div class="BasicUI GamepadMode">` and Steam's hashed dialog classes, and run
`chromium --headless --force-device-scale-factor=1.5 --window-size=854,534
--screenshot`. The page's DOM can be copied from a running modal over CDP
(`outerHTML`, read-only). This reproduced the touching button rows and the
cramped toggle before any fix and the corrected layout after (2026-10-15). The
font falls back to Arial off the Deck, so widths differ slightly. It is a
sketch, not proof; the Deck is still the test (section 8).

### 5.4 How to build it (recipes)

Copy these; each is the working pattern behind a rule. Names are real.

**R1 — A QAM row that keeps its place (S21).**

```tsx
// A row that is itself focusable (Field, DialogButton): spread focusTarget.
<Field focusable label="Find WoW installations" onClick={detect}
  {...focusTarget(QAM_VIEW.settings, "detect")} />
// A control that takes no such props (TextField, DropdownItem, ToggleField):
<FocusRow view={QAM_VIEW.settings} id="gameVersion">
  <DropdownItem label="Game version" rgOptions={…} selectedOption={…} onChange={…} />
</FocusRow>
// The view: restore the last row on mount (or as soon as it loads).
useRestoreFocus(QAM_VIEW.settings, restoreRows);
// After a picker/modal returns, decide where focus goes next:
requestFocus(QAM_VIEW.settings, picked ? "displayName" : "browse");
```

Keys must be stable (an id, not an index). Every focusable QAM row gets one.

**R2 — A view that scrolls like Valve's (S21).**

```tsx
// QAM root (index.tsx): measure, attach and carry Steam's NoTransform type.
const rootRef = useRef<HTMLDivElement>(null);
const remeasure = useScrollBuffer(rootRef, { attach: true });
<Focusable ref={rootRef} className="wowdeck-root wowdeck-scroll-buffer"
  onGamepadFocus={remeasure} {...STEAM_NO_TRANSFORM_SCROLL}>…</Focusable>
// A modal or a page tab: the component does all of it.
<DialogBody><style>{wowupModalStyleCss()}</style><ScrollBuffer>…rows…</ScrollBuffer></DialogBody>
```

Needs `SCROLL_BUFFER_CSS` in the document (panel CSS, `wowupModalStyleCss()`,
`PAGE_CSS`). Do not put an `overflow: auto` box that does not scroll (Steam's
`DialogBody` inside a page) between the rows and the real scroller; the hook
carries the margin through one, but avoid it. Verify with
`tools/deck-ui/step.mjs` going up and down: the row must stop on the same line
and every further press must scroll one row.

**R3 — A floating pane in the QAM (S24, S25).**

```tsx
<div className="wowdeck-float-pane">
  <TopNav … />
  {viewWideControl /* e.g. the installation picker on My Addons */}
</div>
```

The pane sticks under Decky's title (`--wowdeck-pane-top`), stacks above it
(`--wowdeck-pane-z`), keeps Valve's 16 px (`--wowdeck-attach-gap`) and ends in the
scroll fade (`::after`, shown only once scrolled), all measured by
`useScrollBuffer({ attach: true })` on the root. Never hard-code another
component's height or z-index.

**R4 — A full-screen page (S18, S26).**

```tsx
<Focusable style={{ marginTop: "var(--basicui-header-height, 40px)",
    height: "calc(100% - var(--basicui-header-height, 40px))" }}
  {...STEAM_NO_TRANSFORM_SCROLL}
  onOptionsButton={…} onOptionsActionDescription="Category">
  <style>{PAGE_CSS}</style>
  <Tabs activeTab={active} onShowTab={…} tabs={sameTabsEveryTime}
    belowHeaderTabsContent={<Focusable className="wowdeck-page-bar" onButtonDown={bumpers}>…</Focusable>}
    onCancelFromTabHeader={leaveToQam} />
</Focusable>
// each tab: <ScrollBuffer overlays={pageHeaderOverlay} reserveOverlap>…</ScrollBuffer> (no DialogBody)
// leave: OpenQuickAccessMenu(QuickAccessTab.Decky); setTimeout(NavigateBack, QAM_SLIDE_IN_MS)
```

**R5 — A modal.** `ModalRoot` + `DialogHeader` + `DialogBody` (+ `R2`'s
`ScrollBuffer`) + `DialogFooter` with `DialogTwoColLayout` (action first,
Cancel second). Rows are `Field focusable` with footer labels (S14).

**R6 — A controller glyph.** `<SteamGlyph button="LeftBumper" fallback="L1" />`
(Steam's own component; shows the glyph of the controller or keyboard in use).

**R8 — Audit a view against the guidelines.** With the CDP tunnel up:

```sh
node tools/deck-ui/audit-view.mjs QuickAccess_uid      # every row on screen: INSET, TOUCH, SMALL_TEXT, CLIPPED
node tools/deck-ui/walk.mjs QuickAccess_uid tools/deck-ui/audit-focus.js ArrowDown ArrowDown …
                                                        # what really lights up at each focus, and its insets
```

`audit-view` measures statically (no input); `audit-focus` follows real focus,
including rows that light up on focus-within. Run both on every view: each
QAM tab, each page tab, each modal (open with a harmless click, close with
Escape = B). Calibrate on Steam's own page first (`audit-focus` with the
`ours` check removed): Valve's rows pass, so a flag on ours is ours.

**R7 — Find out how Valve does it.**

1. Search Steam's own code on the Deck: `~/.local/share/Steam/steamui/sp.js`
   and `css/sp.css`. Map a hashed class to its name with
   `grep -o '[A-Za-z]*:"<hash>"' sp.js`; read its rules in `sp.css`. Look for
   the component's props (e.g. `scrollIntoViewType`, `canBeHeaderBackground`,
   `wrapAround`) where Steam uses them.
2. Measure the real thing (`tools/deck-ui/eval.mjs`): computed styles, sizes,
   which element scrolls, `scroll-padding`/`scroll-margin`, shadows, z-index.
3. Watch behaviour: `step.mjs` for per-press scrolling, `film.mjs` for
   animations and stalls, `profile.mjs` for where time goes, `shot.mjs` to see.
4. Try the fix in memory on the device before coding it, then record the
   finding in this guide with the method (DEVICE, date).

---

## 6. Focus, controller navigation, modals and forms

### 6.1 Facts about `Focusable` (installed `@decky/ui` 4.12.1, OFFICIAL types)

- `flow-children?: string` — maps to SteamUI's layout enum
  (NONE/COLUMN/ROW/GRID/GEOMETRIC). Valid string values for this prop are
  UNVERIFIED beyond what COMMIT 4eb1029 recorded and the device check in
  §8.4a: `"row"` → `layout 2`; `"horizontal"` → no layout set.
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

### 6.2 Rules — general [GENERAL]

**F1 MUST** give every focus target visible focus styling by using platform
components. For custom `Focusable`s, check that a focus ring or highlight
actually appears (visual tier, §8).

**F2 MUST** keep a modal's B-button/close working: pass `onCancel` and
`closeModal` to `ModalRoot`.

**F3 SHOULD** keep modal focus management to `ModalRoot`'s own behavior.
Commit 7370532 records (LIVE) that focus returns to the opener on close; no
restoration code exists in `src/`. After a panel *remount* (G4) it did **not**
reproduce on the observed device: focus landed on a different element (DEVICE,
§8.4a part 2) — see backlog U-5.

**F4 MUST NOT** make a non-focusable scroll region the only way to read
content, unless you provide an alternate input route. The Details modal uses
`registerDirectScroll` (`src/valveScroll.ts`) for that reason (6.4).

**F5 SHOULD** render link content as real `ButtonItem`s. Anchors injected with
`dangerouslySetInnerHTML` are invisible to gamepad focus (LIVE, Details
modal). The project extracts links and shows up to 6 buttons. The planned
Details redesign deliberately drops this and accepts pointer-only links
(backlog U-18).

### 6.3 Rules — project [PROJECT]

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
a valid value. **Device check (§8.4a):** on SteamOS 3.8.28 / Decky 3.2.10 the
nav nodes for `"horizontal"` groups carry no `layout` at all, whereas `"row"`
yields `layout === 2`. So `"horizontal"` is confirmed to configure nothing;
the rows work through SteamUI's default handling: Left/Right in the toolbar
`"horizontal"` group moved correctly with synthetic keys (DEVICE, §8.4a part 2).
The `layout === 2` reading for `"row"` was first seen on Decky's own `TextField`
wrappers; part 2 later found it on this project's `InstalledView` action row
too. Do not mass-edit (backlog U-4).

**F8 [PROJECT] SHOULD** treat `onGamepadFocus` as the only reliable per-element
focus hook (the focus-scroll watcher that used it was removed with S14). A `MutationObserver` on `gpfocus` was tried and never corrected
anything live (header of the removed `focusScrollWatcher.ts`, git history). `gamepadFocusProp` returns
an untyped spread because earlier typings did not declare the prop. In 4.12.1
it **is** declared and a typed `onGamepadFocus={(e) => ...}` compiles (checked
for this guide, §3.3 scratch file). The helper's own duck-typing for the event
target is still necessary (G7).

**F9 [PROJECT] SHOULD** set `.focus()` on the element, not simulate input,
when moving focus programmatically: SteamUI's nav tree picks up a real
`.focus()` (LIVE). Always wait one `setTimeout` tick before correcting scroll
afterward (60 ms in `resetListFocusAndScroll`), because Decky's native
scroll-into-view runs after focus and will overwrite an earlier correction.

### 6.4 Details modal: carousel and scrolling (workaround, not a pattern)

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
on Steam's news view (§8.4b-2). Verified on the device with the owner
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
  (docs/valve-bpm-scrolling.md §3.3, sp.js module 50908): one press scrolls
  30 % of the page's viewport as a sine-eased tween of
  clamp(distance/1000·200, 300, 500) ms — per-press distances on panel-sized
  viewports always sit at the 300 ms floor, exactly the ~300 ms measured on
  Steam's All Games list — and holding auto-repeats after 400 ms, then every
  50 ms (Valve's ButtonRepeatHandler staircase), each repeat retargeting from
  the running tween's *target* at linear timing, so a held D-pad glides at a
  constant speed instead of restarting the ease; repeats stop when the
  scroller has no room left (Steam's 2 px tolerance, `scrollEdge.ts`) but stay
  armed, so content growing mid-hold resumes scrolling. Wheel and touch stay
  the browser's: unanimated, never moving focus (Valve, §4 of the report).
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
is open (G4): keep the form draft in module scope
(`src/installationFormState.ts`, a subscribable store read with
`useSyncExternalStore`) so the picked path reaches the remounted form whether it
arrives before or after the remount. First applied to Options → Add Installation
Manually; the export dialog's folder/file pickers in `AddonPortabilityModal`
already used `openFilePicker`. Source of the API: installed `@decky/api` types
(OFFICIAL). Not yet verified on a Deck (see action items).

### 6.5 Pagination focus

Superseded 2026-10-15: lists load more (S18) instead of paging, so focus stays
on the "Load more" row and the new rows appear below it. The old Prev/Next
focus reset (`resetListFocusAndScroll`) was removed. UNVERIFIED on a Deck where
focus lands after a load; if it jumps, move focus to the first new row.

### 6.6 Navigation contract (testable, per screen)

Use this as the template when changing a screen. Rows marked (LIVE) were
observed by prior maintainers; everything else is the *intended* contract and
needs a human on a controller to confirm.

| Screen | Contract |
|---|---|
| Plugin top level | L1/R1 cycle My Addons ↔ Get Addons ↔ Options, clamped, not wrapped. Left/Right on the tab row moves between tabs. (Switching LIVE per commits c77955a, 4881005; the pill look is new, 2026-10-15) |
| My Addons list (2026-10-15) | One focus stop per addon. A = Details (unmanaged: menu), X = Update when offered (unmanaged: Find online source, 2026-10-21), Menu = context menu (Update / Details / Ignore / Remove…), footer shows the labels; ⋯ opens the menu by touch. B closes the menu. |
| Get Addons in the QAM (rev 2, 2026-10-19; device verification pending) | Collapsed: Install into above a vertical destination list (Search, Latest, Popular, From URL), focus on the plugin-tab nav bar, standard width. Focusing a destination widens the QAM and shows that destination's browse UI in the pane beside a ~240 px list; Right/A enters the pane; the pane holds Search, the lists, Popular's Category and From URL. A on a row = Details modal, X = Install, Menu = release channel. B/Left out of the pane collapses to the plugin-tab nav bar; L1/R1 leave and every re-entry lands collapsed. |
| Details modal | LB/RB cycle Description/Changelog/Gallery (disabled Gallery skipped); Up/Down scroll text; Install and View-on-source reachable; B closes. Gallery thumbnail A opens viewer; viewer Left/Right changes image; B closes viewer only. (Viewer behavior LIVE per `AddonDetailsModal.tsx` comment.) |
| Details modal, news-style carousel (DEVICE-verified by the owner, 2026-10-13; see 6.4) | LB/RB and D-pad Left/Right switch page, clamped, Gallery present only with screenshots; Up/Down scroll the active page the way Valve's gamepad-scroll regions do (30 % viewport per press, 300–500 ms sine tween, 400→50 ms repeats retargeting linearly; `valveScroll.ts`); Y = View on <Provider> (only when `websiteUrl`), X = Install (disabled while installing), B closes; in the stacked Gallery viewer B closes only the viewer and LB/RB/Left/Right belong to the viewer (`galleryOpenRef`). Links and video are pointer-only (U-18). The footer legend does render for a `showModal` modal when the page is a `Field focusable` (6.1) |
| Options | Steam settings rows, every control reachable by Up/Down. TextFields open the platform keyboard on activation. |
| WoWDeck update, Options (#20; device verification pending) | The floating panel's **Update** button: A = Update, X = Check again, Y = Release notes when the offer has notes. While a check runs, the button reads "Checking…" and is disabled. The WoWDeck row's **⋯** under Options › Updates: A = the update channel modal, X = Check again at any time, Y = Release notes while the panel offers an update with notes. That modal offers Update, as it does from the panel. While a check runs, the row's description reads "Checking…". Check again ends in one toast: "WoWDeck is up to date", "WoWDeck <version> is available" or "Couldn't check for updates". |
| Manage backups (Settings backup; device verification pending) | Up/Down over the action rows (Back up now or Cancel, Import from file…, Copy settings from another version…) and then one focus stop per backup, newest first. A row that can't act is unfocusable; **Copy settings from another version…** is hidden, never disabled, when no other version has anything to copy (#12). With no backups listed, focus starts on the first action that can run (#12). Backup row: A = Restore (Details when it can't run), X = Delete; B closes. |
| Copy settings modal (Settings copy; device verification pending) | Focus starts on **Copy from**; A opens its dropdown (B closes the dropdown only). Under it, the section header reads "Copying from <version>" in Steam blue. Down reaches **<version> · Current settings** (installed versions only), then every backup of that version, newest first, labelled **<version> · <when> · <size>**; switching **Copy from** renames the header and every row. A on a row opens the Restore dialog worded for a copy; its A label reads Details while the copy can't run (WoW running, another job, damaged backup). B closes the modal; once a copy starts the modal closes itself and Manage backups shows progress and Cancel. |

Acceptance criteria for any change that touches focus:

1. No control becomes unreachable by D-pad.
2. B closes the topmost modal only.
3. After closing a modal, user is on the same tab with the same results (module-scope state).
4. No unintended sound/scroll jump on short lists (UNVERIFIED how to observe sound without hardware).

### 6.7 Forms

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

---

## 7. Async state, errors and feedback

### 7.1 Current feedback model [PROJECT]

- Toasts go through `pluginToast` (S17). Search outcomes and URL-import errors
  are **inline** (`urlImportErrors.ts`, COMMIT 46e71b9).
- Loading: a `Spinner` at the end of a list or in a row's right column;
  long jobs use `ProgressBarWithInfo` (Update all, WTF jobs).
- Update-available toast: created in the `definePlugin` factory and on
  resume-from-suspend, rate-limited once a day by the backend. It is
  deliberately **not** shown on entering My Addons (COMMITS 7858f64, 06081bf).

### 7.2 Rules

**A1 [GENERAL] MUST** use a request-id/ref guard for any fetch whose result
can arrive after the user changed the inputs (§4.5).

**A2 [GENERAL] MUST** distinguish loading / error / empty / success as four
rendered states. `DetailsText` does; a thrown error must never render like
"no changelog".

**A3 [GENERAL] MUST** wrap every `await api.*` in `try/catch/finally` when it
is triggered by a click, so busy flags reset and the user gets feedback.
Exception noted in backlog U-7 (`getDiagnostics` in Settings' Show button).

  Applied in the audit pass and accepted by the owner (2026-10-13): every
  click handler that awaits the backend (diagnostics load, both clipboard
  copies, Re-scan) now has `try/catch` plus a busy flag that disables the
  button and shows a `Spinner`; a failed startup `getStatus` falls back to the
  "Engine is not running" + Retry state instead of a blank panel.

**A4 [GENERAL] MUST NOT** fire toasts from effects that run on every mount
(the original My Addons toast fired on every remount, COMMIT 7858f64).
**MUST NOT** toast raw identifiers such as operation UUIDs (COMMIT 46f4921).

**A8 [PROJECT] MUST** put a confirmation (`ConfirmModal`, `confirmRemoveAddon`)
in front of any action that deletes data from disk, and say in the text what is
deleted and whether it can be undone. Source (adapted, not mandated): Xbox
Accessibility Guideline 115, "Offer players a mechanism to review, confirm, and
undo permanent or destructive actions". Because opening the modal remounts the
panel (G4), the action must not depend on the opener's React state; it runs
through the module-scope addon session, which reads the list again when it
ends, so the remounted list is current. Accepted by the owner after
on-device use (2026-10-13). Known limitation: the left stick did not move
focus in this Steam-owned dialog, only the D-pad (not investigated; not our
code).

**A9 [PROJECT] MUST NOT** show a failed load as an empty state: Latest
Addons / Popular keep a separate red inline error line (via
`friendlySearchError`) distinct from the muted "No addons found." The Import
modal preview takes a request-id guard like other fetches (A1), since a pasted
string and a loaded file can overlap. Removing a WoW installation also
confirms (A8), because it drops the installation's addon records and ignore
flags (WoW files stay). Found in the audit pass; accepted by the owner on the Deck (2026-10-13): flight-mode red error, Remove-installation dialog and Import preview verified; the My Addons empty-text wording was not tested.

**A10 [PROJECT] MUST** run anything that can take more than a few seconds as an
engine **job**, never as one long call. The engine serves requests strictly one
at a time and the Python bridge times a request out after 120 s, so a long RPC
freezes every other call and then fails. The pattern (WTF backup/restore, see
`docs/wtf-backup.md`): the RPC validates, starts the work without awaiting it
and returns a job id at once; progress and the outcome are pushed as events
(`wtf.progress`, `wtf.completed`); the engine allows one such job at a time. The
UI keeps job state in a **module-scope store** fed by an event subscription made
once per plugin load (never in a component: a modal unmounts the panel, G4),
shows progress and the result **inline** (A6), and on every list load takes the
engine's own view of the running job (`job` in `wtf.list`) so a reopened UI or a
reloaded plugin re-attaches instead of showing a stale or missing spinner. A
failed load of the list is an error with Retry, never an empty list (A9), and a
user-chosen folder that has disappeared (SD card) is its own state, not "no
backups". Destructive steps confirm (A8), saying what is replaced and what is
kept as a way back. Status: implemented and unit-tested; NOT yet verified on a
Deck (verification list: `ActionItems.yaml` WF-01 `deck_verification`).

**A5 [PROJECT] SHOULD** truncate error text before display (existing code
uses `String(e).slice(0, 120–160)`), and prefer user-facing mapped messages
for errors that have codes.

**A5b [PROJECT] MUST** run every caught backend error through
`backendErrorMessage` (`src/errors.ts`) before showing or mapping it. DEVICE
(owner, 2026-10-13): a failed call otherwise put Python exception text in the
UI. The helper drops a traceback, the exception class and the engine's
`[code]` prefix; `friendlySearchError` then turns the result into an
actionable sentence. Unit-tested on sample strings; the exact string Decky
delivers on the Deck was not captured, so the fix is defensive.
  Root cause (DEVICE, owner, 2026-10-13): Decky replaces any exception raised
  in `main.py` with the text "Python Exception", so the engine's message never
  reached the UI at all. `Plugin._rpc` now returns a failure as
  `{"__error": {code, message}}` and `src/services/backend.ts` rethrows it with
  the real message (`unwrapBackendResult`, unit-tested). New bridge methods
  MUST call `self._rpc(...)`, not `self.backend.request(...)`, unless they
  handle `BackendError` themselves (as `get_status` does). A `main.py` change
  needs a Decky plugin reload, not just a Steam UI reload.

**A6 [PROJECT] SHOULD** prefer inline feedback when the user's attention is
already on the control (forms, URL import) and toasts for events that happen
away from the control (background update checks, completed installs from
modals). The current code is not fully consistent with this (U-8).
  Applied to Search (accepted by the owner): "No results" is a muted inline
  line, a provider failure a red one, and raw errors go through
  `friendlySearchError` (`src/search.ts`) so the text says what to do, e.g.
  "check your internet connection" (Xbox Accessibility Guideline 115, adapted).
  The UI stops waiting after 20 s; the backend still retries up to 3 x 30 s.
  Applied to settings backups (owner, 2026-10-17): a backup or restore is a
  background job (A10), so its end is a notification as well as the inline
  line; the inline line alone was missed on the Deck. A cancel, which the user
  just did, gets no notification.

**A7 [PROJECT] MUST** guard SteamClient APIs with a `typeof ... === "function"`
check and run them outside `Content` effects when they must happen once per
session (COMMIT 01bffce).

---

### 7.3 Copy rules (C01–C12) [PROJECT]

Every word a player reads: labels, descriptions, toasts, dialogs, and
engine messages that reach the screen. Agreed with the owner in the string
review of 2026-10-16 (StringReview.yaml, G01–G12 approved). Helpers live in
`src/text.ts` (`plural`, `dayMonth`, `dayAndTime`, `updateAllToast`) and
`src/errors.ts` (`backendErrorMessage`).

- **C01 MUST** word every failure "Couldn't <verb> <thing>" ("Couldn't
  install DBM", "Couldn't save"). Why: four patterns were in use ("Failed
  to…", "… failed", "Could not…", "Operation failed") for one situation;
  the contraction matches the rest of the UI. How: toast titles and inline
  errors; an unknown action is "Something went wrong".
- **C02 MUST** count with real plurals ("1 addon", "3 addons"), never
  "addon(s)". Why: "(s)" reads unfinished, and "Added 1 installations" had
  shipped. How: `plural(n, "addon")`.
- **C03 MUST** end only full multi-sentence text with periods. One-line
  descriptions and toast bodies have none (Steam's own settings rows);
  empty states and inline errors that are full sentences keep theirs. Why:
  mixed punctuation is the most visible sign of unpolished copy.
- **C04 MUST NOT** join clauses with dashes; use two short sentences. Why:
  em dashes and " - " were both in use for the same message, and two
  sentences read better at QAM width.
- **C05 MUST NOT** show internal words: engine, provider, flavor, job,
  Proton prefix, bundled key, toast, HTTP codes, ids, engine names like
  "Curse". Say WoWDeck Addon Manager, addon source, version folder, backup,
  built-in access, notification, and a provider's real name
  (`providerLabel` in the UI, `providerDisplayName` in the engine). Why:
  players do not think in implementation terms.
- **C06 MUST NOT** put a raw error in front of the user. Engine errors are
  user sentences at the source (`NotFoundError` maps what was not found to a
  sentence; `plainSystemError` keeps "Not enough free space" / "No
  permission" and logs the rest; `ProviderError` carries no "[Curse]"
  prefix). The UI passes every backend error through `backendErrorMessage`,
  which turns network, timeout, HTTP and disk errors into plain words; code
  that must classify the raw text uses `rawErrorText`. Raw detail goes to
  the log and Diagnostics.
- **C07 MUST** use sentence case for every title, dialog and button
  ("Export addon list", "Restore backup?"), like Steam's own dialogs.
  Proper names keep their capitals (My Addons, Get Addons, CurseForge).
- **C08 MUST** use curly quotes (“dbm”) around quoted user input.
- **C09 SHOULD** use contractions (can't, isn't, weren't); only warnings
  that must sound firm stay uncontracted ("World of Warcraft must be
  closed").
- **C10 MUST** write dates and times one way: "14 Oct" this year, "14 Oct
  2024" before (`dayMonth`); "5 hours ago", "3 minutes ago" (`formatWhen`);
  "today at 14:32" (`dayAndTime`). Never ISO dates, never "5 h".
- **C11 MUST** title a toast with what happened to what ("Updated DBM",
  "Removed Bagnon", "Updated 3 addons", "Installation removed"); the body
  only adds what the user needs next. Why: titles like "Removed" with the
  name in the body, or "Update all complete", made the reader do the work.
- **C12 MUST** call the WTF feature "Settings backup", naming the folder in
  the description ("Addon settings, keybinds, macros and UI layout (the WTF
  folder)"). Why: players know the folder, but as a heading it reads as
  slang to everyone else; WowUp also leads with what the feature does.

## 8. Testing and verification

### 8.1 Tooling that exists (verified by running)

Run during this investigation at HEAD `4a9b577` with
`nix shell nixpkgs#nodejs_22 nixpkgs#pnpm nixpkgs#bun`:

| Tier | Command | Result for this investigation |
|---|---|---|
| T1 static | `pnpm run lint` (eslint src) | pass |
| T1 static | `pnpm run format:check` (prettier --check src) | pass |
| T1 static | `pnpm run typecheck` (tsc --noEmit) | pass |
| T2 automated | `pnpm test` (bun test, 12 explicit files) | 106 pass, 0 fail |
| T3 build | `pnpm run build` (rollup -c → `dist/`) | pass |
| T4 visual | none | **no screenshot, Storybook, Playwright or component-test tooling in the repo** |
| T5 keyboard/controller | none automated | manual only |
| T6 hardware | none automated | manual only (`docs/steam-deck.md` checklist) |

Notes:

- `make lint` runs eslint + prettier check but **not** `tsc`; `make typecheck`
  is separate (this contradicts the "eslint + prettier + tsc" wording in
  `docs/development.md`). `make test` runs the **backend** tests only.
- Automated tests cover **pure logic only**: `qam`, `scrollPolicy`,
  `diagnostics`, `search`, `shoulderNav`, `discover`, `gallery`,
  `popularCategories`, `browseSessionState`, `urlImportErrors`, `markdown`,
  `curseForgeAuthUi`. There are no component, focus, layout or modal tests.
- The `test` script lists files explicitly. A new test file not added there
  silently never runs.
- `dist/` is gitignored.
- Backend: `cd backend && bun install && bun run typecheck && bun test && bun run build`
  when a UI change touches `contracts.ts`. Not run for this documentation task.

Added since (device tools, `tools/deck-ui/`, 2026-10-16):

- **Render a Steam component on the Deck without building or deploying:**
  `node render.mjs <Component> '<props JSON>' [out.png]` mounts any @decky/ui
  component in memory in our QAM panel (inside a PanelSectionRow, under the
  list's heading), prints its box against the panel's, runs the guideline
  audit, takes a screenshot and removes it again. This is the rendering test:
  real Steam components and CSS, seconds per try, nothing saved.
- **Why not render locally:** @decky/ui does not ship Steam's components; it
  finds them in Steam's own webpack modules at runtime, so off the Deck there is
  nothing to render. A local Chromium can only show a static copy of DOM and
  CSS taken from the Deck (§6 "Preview without a Deck"): good for comparing
  styles, blind to props, layout logic and focus.
- **Audit rule OVERFLOW** (S32) in `audit.js`: anything in the QAM panel that
  reaches past its edge.

### 8.2 What each tier can and cannot prove

| Tier | Can prove | Cannot prove |
|---|---|---|
| T1 | Syntax, types, style, lint rules | Anything about runtime behavior or appearance |
| T2 | Pure fit/scroll/state logic | That the logic is wired to the right element or matches Steam's real layout |
| T3 | The bundle builds | That `@decky/ui` exports exist at runtime in Steam |
| T4 (manual / CDP) | Layout and clipping at a given size | Controller behavior |
| T5 | Key/mouse operation in a desktop browser or Steam desktop mode | Real gamepad nav tree behavior |
| T6 | Everything above on the real device | Other firmware/Steam versions |

### 8.3 Hardware-claim policy

**V1 MUST NOT** state or imply a change was verified on a Steam Deck unless
a human reports it. An LLM agent without hardware access reaches **T3 at
most**. Say so explicitly. Acceptable wording: "Static checks, tests and build
pass; no visual, controller or hardware verification was performed."
Device access follows `AGENTS.md` ("The owner's Steam Deck") and the
`deck-test` skill. Record device observations as in §8.4a; synthetic keys or
`pad.sh` presses count as synthetic input, **not** as controller verification
by a human (§1.3 `DEVICE`).

**V2 MUST** label recollected-from-history observations as `LIVE (prior
maintainer, commit <hash>)`, not as your own verification.

### 8.4 How to get higher tiers (for humans)

- Remote debugging (OFFICIAL, Decky developer settings): enable CEF debugging.
  DEVICE (§8.4a): on SteamOS 3.8.28 the `steamwebhelper` command line has
  `--remote-debugging-address=127.0.0.1 --remote-debugging-port=8080` and
  `ss -ltn` shows the only listener on `127.0.0.1:8080`. So: reach it with an
  SSH tunnel (`ssh -L 18080:localhost:8080 deck@<ip>`), or `localhost:8080` on
  the device itself. The Decky docs also mention `DECK_IP:8081` for
  `chrome://inspect` from another machine; nothing listened on 8081 on the
  observed device in its default state, so treat 8081 as UNVERIFIED.
  Targets of interest: `QuickAccess_uid2` (the plugin panel),
  `Steam Big Picture Mode` (where modals render) and `SharedJSContext`.
  `window.DFL` is exposed for inspecting `@decky/ui`.
  Agents: prefer the Chrome DevTools MCP over that tunnel
  (`docs/remote-browser.md`) to `ssh` batches and ad-hoc CDP scripts.
- `docs/steam-deck.md` gives SSH instructions and the pre-release checklist
  (Game Mode and Desktop Mode, suspend/resume, Wi-Fi loss, Decky reload, SD
  card). Another person's device is read-only.

### 8.4a Device observations (2026-10-13)

Recorded by the agent that wrote this guide, over SSH + the Steam CEF debugger,
on the owner's own device (tag `DEVICE`, §1.3). Part 1 is read-only
(`Runtime.evaluate` reads and file reads). Part 2 was run after the owner said
buttons may be simulated: synthetic keyboard events only, no data-mutating
control was activated, nothing was installed or changed. It is the only device
evidence the guide itself produced, and it covers only what is listed. One
LCD Deck, one session.

Part 1 — read-only:

| Observation | Value |
|---|---|
| Hardware / OS | Steam Deck LCD (`Jupiter`), SteamOS 3.8.28 (build 20260922.1), kernel 6.18.50-valve2 |
| Decky Loader | v3.2.10; CEF `Chrome/126.0.6478.183` |
| Deployed plugin | `dist/index.js` SHA-256 identical to a local `pnpm run build` of HEAD `4a9b577` |
| QAM plugin column | `.wowdeck-root` width **300 px**, `devicePixelRatio` 1.28, Options tab open (re-confirms the pre-rework measurements, from the removed `docs/ui-guidelines.md`) |
| `window.DFL` exports | `Focusable`, `ModalRoot`, `Spinner`, `ConfirmModal`, `Marquee`, `showModal`, `Navigation`, `PanelSection`, `Field` are functions; `Tabs`, `ScrollPanel`, `ButtonItem`, `ToggleField`, `DialogButton` are objects (memo/forwardRef style); none `undefined` |
| Nav-entry enum | `findModuleExport` with the shape test from `navEntry.ts` finds `{FIRST:0, LAST:1, MAINTAIN_X:2, MAINTAIN_Y:3, PREFERRED_CHILD:4}` |
| `flow-children` → nav layout | Nav nodes (reachable from the element's React fiber hooks; class with `m_Properties`, `m_rgChildren`, `m_iLastActiveChildIndex`) for our `flow-children="horizontal"` `Focusable`s have **no `layout` property** (undefined). Nodes for `flow-children="row"` have `layout === 2` (these were Decky's own `TextField` wrappers, not our code). Plain `DialogButton` nodes have `layout === 0` |
| Muted text | `#95a3ab` on the QAM background `rgb(14, 20, 27)` = contrast **7.14:1** (WCAG AAA for normal text). Rendered at 12.8 CSS px (about 16 device px) |
| Plugin log | Latest `wowdeck` log has no error/exception lines |

Part 2 — My Addons on screen, synthetic keys (`Input.dispatchKeyEvent`
ArrowUp/Down/Left/Right, `Escape`, and one guarded `Enter` on the Details icon):

| Observation | Value |
|---|---|
| Project `"row"` nodes | The `InstalledView` action `Focusable` (`.wowdeck-btn-row`) has `layout === 2`, `navEntryPreferPosition === 2` (`MAINTAIN_X`), 4 children. The `wowdeck-addon-row` wrapper, the toolbar `.wowdeck-btn-row` and the top-nav row have `layout` undefined (all are `"horizontal"`). This is the provenance F7 lacked: project `"row"` and `"horizontal"` nodes both seen |
| Column preservation (F6, Case 4) | Down/Up between rows kept the focused column: from the icon at x=242 stayed x=242, from x=288 stayed x=288, from Ignore stayed Ignore. Right clamped at the last icon. Works with synthetic keys; not tried with a real controller |
| Scroll vs focus | Repeated Down scrolled the container (`scrollTop` 0 → 406 over several rows) while the focused button stayed on screen |
| Horizontal toolbar | Left/Right moved Refresh ↔ "Update all (1)" correctly although it is `flow-children="horizontal"` (no layout set): SteamUI's default handling works for this group, so U-4 is about the declared value, not a visible fault here |
| Leaving the panel | Left from the first toolbar button left the plugin panel into the QAM tab strip (x=0); Right from there reached another panel. Expected platform behavior; the panel has no edge trap |
| Modal | Enter on the Details icon opened the modal: `.wowdeck-root` disappeared from `QuickAccess_uid2` (G4 confirmed on this device). The modal rendered in the **`Steam Big Picture Mode`** CEF document, not in `QuickAccess_uid2`, with its own `<style>` copy inside the modal (P3). With the modal closed the panel's `<style>` exists only in `QuickAccess_uid2` and not in the main document or `SharedJSContext` |
| Close and remount | `Escape` closed the modal; the panel remounted within 1.5 s on the **same tab** (My Addons, 10 rows), so module-scope tab state works (P6). Immediately afterwards no element had `.gpfocus`; a few seconds later `.gpfocus` was on an unlabeled element at x=64,y=224 (not identified), **not** on the Details icon (x=242). Treat "focus returns to the opener" (F3) as not reproduced after a remount (U-5) |
| Stray `Escape` | An `Escape` sent by mistake to the main window while the QAM plugin view was open left the plugin view: panel unmounted, Decky's plugin list shown. So B/Escape in that context backs out of the plugin |

Not observed: modal contents beyond the style, LB/RB, gallery, tooltips, sound,
real gamepad input, the OLED model, a mutating action's result.

### 8.4b Steam news view (reference design, 2026-10-13, read-only)

Read-only DOM/screenshot inspection (`DEVICE`) of Steam's own game-news view
in `Steam Big Picture Mode` (854×534 CSS px, DPR 1.5), used as the model for
the Details-modal redesign. Nothing was pressed.

| Observation | Value |
|---|---|
| Structure | Horizontal carousel of pages, 683 px each, 635 px content column, 24 px padding; neighbours peek in at the edges. Only the active page is the vertical scroll container |
| Page top | Hero image about 635×214 (3:1) with a gradient over its lower part; 36 px game icon + game name (16 px/300); tag line = coloured type tag (12 px/500–600, e.g. blue "Regular Update") + "POSTED" + date (12 px); headline 24 px/500; body 14 px/300, sub-headings 19 px bold |
| Input props | The page is a `Focusable` with `noFocusRing`, `onOKButton`, `onCancelButton`, `onOptionsButton`, `onOptionsActionDescription="View Game in Library"`; the Y label in the footer comes from `onOptionsActionDescription`, so Y is the Options button. X is `onSecondaryButton` per the `@decky/ui` types (not observed) |
| Footer | Drawn by Steam: STEAM MENU left; Y / A / B labels right |
| Video | `div.YoutubePlayer` wrapping a `youtube-nocookie.com/embed/<id>` iframe (`autoplay=0`, `enablejsapi=1`, `allow="…autoplay; encrypted-media; picture-in-picture…"`), 587×330, no `tabindex`, no `sandbox`. The owner reports it plays inline when pressed by pointer |

Since verified on the device (DEVICE, 2026-10-13): the footer legend works in a
Decky `showModal` modal when the focus target is a `Field focusable` (6.1), and
the whole card scrolls through Steam's own `overflow: auto` wrapper (6.4). The
YouTube iframe allowlist is not yet confirmed to play inside a modal.

#### 8.4b-2 News-item card styles (DEVICE, read-only CDP, 2026-10-13)

Measured on an open news item (viewport 854×534). Class names are obfuscated
and change; the values are what matters.

| Element | Measured |
|---|---|
| Scroller | 683.2×494 px, padding 24 px, `overflow-y: scroll`, colour `rgb(220,222,223)`, font `"Motiva Sans", Arial, Helvetica, sans-serif` 16 px/400. Sits inside a react-virtualized grid (`overflow: hidden`) inside a 854×534 container with `padding-top: 40px` |
| Backdrop | Behind everything: `backdrop-filter: blur(5px) brightness(0.65) saturate(0.7)` |
| Card | **No border, no border-radius.** Width 635.2 px (max 640), margin `24px 0 40px`, `overflow: hidden`, `position: relative`, font-weight 300. Background `rgb(37,40,46)` with `radial-gradient(at left top, rgb(66,69,76), rgb(37,40,46))` |
| Card hero | Absolute `<img>` 635×845 at `opacity: 0.2`, used as a blurred backdrop for the whole card |
| Header block | 169 px high; `box-shadow: rgba(0,0,0,0.2) 0 0 15px`; `backdrop-filter: blur(32px)`; `overflow: hidden`. Inner: padding `16px 24px 12px`, background `radial-gradient(at center bottom, rgba(255,255,255,0.1) 10%, rgba(255,255,255,0) 80%)` |
| Header rows | Tag row 32 px high (padding `4px 0`, flex); meta row 17 px; headline 24 px/500, line-height 36 px, colour `rgb(234,234,235)`, margin-top 12 px; subtitle 17 px/200, line-height 22.1 px, colour `rgb(204,204,204)`, margin-top 4 px, padding-bottom 10 px |
| Body block | Padding 24 px; `backdrop-filter: blur(32px)`. Text 14 px/300, line-height 19 px, colour `rgb(207,210,211)`; paragraphs margin `7px 0`; `ul.bullets` margin `14px 0`, padding-left 40 px |
| Bottom action bar | A `Panel Focusable`; flex, padding 24 px, 46 px content height; background `radial-gradient(at center top, rgba(255,255,255,0.1) 10%, rgba(255,255,255,0) 80%)`. Holds pills (background `rgba(30,33,38,0.5)`, border-radius 4 px, margin-right 10 px), e.g. Rate Up / Discuss |

Carousel (DEVICE, same session): the news view is a react-virtualized Grid,
854 px wide, `overflow-x: auto`, no scroll-snap, no CSS transitions. Each cell
is 683.2 px (635 card + 2×24 padding) and is itself a 494 px-tall
`overflow-y` scroller, so every page keeps its own scroll position; the active
cell is centered (its left edge at x=85.9) and neighbours are neither dimmed
nor scaled. The only visible "border" on the card is the focus outline
`2px solid rgba(255,255,255,0.6)`, offset 2 px; the card rule itself says
`border: none` under `.BasicUI`. PROJECT: our modal reproduces this in 6.4.

PROJECT-SPECIFIC: `src/markdown.ts` strips every `iframe` except a single
YouTube video embed. The surviving element is rebuilt from the 11-character
video id on `youtube-nocookie.com` with a fixed attribute set, so nothing from
third-party markup (style, sandbox, srcdoc, handlers, query string) survives.
The playlist path `videoseries` is rejected. Pointer-only playback is the
accepted weakness (U-18).


### 8.5 Verification report template

Copy into the PR/commit notes for any UI change:

```
UI change verification
- T1 lint / format:check / typecheck: pass | fail | not run
- T2 pnpm test (N pass): pass | fail | not run
- T3 pnpm run build: pass | fail | not run
- T4 visual (screenshot/CDP, width 300): done by <who> | not done
- T5 keyboard/controller: done by <who> | not done
- T6 Steam Deck hardware: done by <human> on <model/OS/Decky version> | not done
- Nav contract rows touched: <list from §6.6>
- UNVERIFIED claims remaining: <list>
```

### 8.6 Regression checklist (human, on device)

The checklist lives in `docs/regression-test-plan.md` (gates, smoke subset,
full run, result record); section 7 there lists the likeliest failures first.
Kept in one place on purpose: the short list that used to be here went stale
within a day of the Steam-native rework (it still described L1/R1 glyphs that
dim at the ends). Methods that worked on the device (2026-10-15), for anyone
continuing: synthetic arrow keys over CDP (`Input.dispatchKeyEvent`, arrow keys
only; Enter only after checking that the focused element is a harmless one
such as a tab), a per-press measurement of the focused row, the scroller's
`scrollTop` and the floating panes, and frame recording for animations. Steam's
screensaver swallows synthetic input (it does not count as activity); ask the
owner to disable it for a test run.

---

## 9. Anti-patterns and lessons (case studies)

Evidence: git history. Every "fix" below is cited by commit; claims of live
verification are those recorded by the committers, not re-observed.

### Case 1 — Radio/provider focus highlight shrinks

- **Symptom:** Provider toggle rows lost their whole-row focus highlight.
- **Root cause:** A blanket `Field` override (`padding:0`) added for layout
  (878385e, 2851af6) also hit `ToggleField`, which relies on that padding for
  its highlight. The commit message had claimed other controls were
  "confirmed unaffected".
- **Fix:** Narrow exception `.wowdeck-provider-options` (366ba1a).
- **Type:** Local fix to a self-inflicted regression; the *lesson* is general.
- **Lesson:** Global overrides on Steam component classes break neighbors.
  **MUST** enumerate every component family a selector reaches and look at
  each before saying "no impact".
- **Avoid:** Claims of "confirmed unaffected" without naming what was checked.
- **Still resolved?** Yes at HEAD. Stale comments remain: `SettingsView.tsx`
  (~lines 641, 700) and `layout/qam.ts` (~line 13) point to `index.tsx` for CSS
  that now lives in `sharedStyles.ts`, as did the removed
  `docs/ui-guidelines.md`.

### Case 2 — Top navigation: Tabs vs custom row

- **Symptom:** Need LB/RB tab switching and compact labels in 268 px.
- **Root cause:** `Tabs` provides bumper navigation but forces full-width
  titles and is a fragile export (G6).
- **Fix:** Custom `TopNav` + raw input `SteamClient.Input` (4881005),
  `flow-children` for Left/Right (c77955a), `flex: 0 0 auto` to remove dead
  clickable space (fc3706f), shared `SectionNavItems` (7370532).
- **Type:** Workaround for a platform limitation + a local layout choice.
- **Lesson:** If you replace a platform control you also take over its input
  handling and must keep both mouse and controller paths working.
- **Avoid:** Re-introducing `Tabs` without checking title width.
- **Still resolved?** Yes (LIVE per commits).

### Case 3 — Four actions in a 268 px row

- **Superseded 2026-10-15** (commit dd81038): rows are one focus stop with a context menu (S14); no per-row button budget remains.

- **Symptom:** Refresh/Update All plus per-row actions stacked or overflowed.
- **Root cause:** Text labels of four buttons exceed 268 px by ≈20 px; plus
  DialogButton's `min-width` (S6).
- **Fix:** Details/Remove as icon-only with `tooltip`; `fitFixedColumns`;
  toolbar wrapped in `Focusable` (4eb1029).
- **Type:** Local, width-driven choice.
- **Lesson:** Compute widths; do not eyeball. `textWidthEstimate` is an
  estimate so keep slack.
- **Avoid:** Icon-only buttons with no label for **destructive** actions (U-1).
- **Still resolved?** Yes. Whether the `tooltip` is visible on a Deck is
  UNVERIFIED.

### Case 4 — Preserving the action column

- **Superseded 2026-10-15**: no action columns remain (S14).

- **Symptom:** Moving between rows landed on the wrong action button.
- **Root cause (LIVE via CDP, 4eb1029):** `navEntryPreferPosition` unset →
  SteamUI uses the node's last active child index.
- **Fix:** `flow-children="row"` + `navEntryPreferPosition=MAINTAIN_X` +
  identical column widths across rows.
- **Type:** Platform workaround relying on **private SteamUI internals**.
- **Lesson:** Keep such code isolated (`navEntry.ts`), make it fail soft.
- **Avoid:** Using it for rows whose columns are not width-aligned.
- **Still resolved?** At HEAD yes. DEVICE (§8.4a part 2): the action row node
  has `layout 2` / `MAINTAIN_X`, and Up/Down kept the column with synthetic
  keys on SteamOS 3.8.28 / Decky 3.2.10. Real-controller behavior not tested.
  Inconsistent `"horizontal"` usage elsewhere (F7).

### Case 5 — Details modal and stacked Gallery

- **Symptom/need:** Rich details, enlarged images, shoulder-button nav.
- **Root cause of difficulty:** modal teardown (G4); stacked modals share
  input; refs on `Focusable` null; raw scrolling needed.
- **Fix:** `ModalRoot`; Gallery as a second `showModal`; `galleryOpenRef`;
  ref on a plain div. Later (news-style redesign): a carousel of per-page
  scrollers that escapes Steam's dialog box (6.4); Y/X live
  in Steam's footer legend through a `Field focusable` page (6.1); no link
  buttons (U-18).
- **Type:** Mix of pattern (modal structure) and workarounds (raw input,
  scroller lookup).
- **Lesson:** Own input explicitly when stacking layers; verify nested
  modal focus live (it was).
- **Avoid:** Assuming a focus wrapper provides scrolling; assuming the right
  stick emits input.
- **Still resolved?** Yes for the current carousel design: no edge bell (§6.4).
  Scroll/focus position is not restored after a panel remount (U-5, suspected).

### Case 6 — Toast on entering My Addons

- **Symptom:** Repeated update toasts.
- **Root cause:** Effect-driven toast refired on every remount, and remounts
  are frequent (G4).
- **Fix:** Removed (7858f64), then re-added in the `definePlugin` factory with
  a backend rate limit (06081bf); resume-from-suspend guard (01bffce);
  UUID toast removed (46f4921).
- **Type:** Local pattern with a platform workaround (guard).
- **Lesson:** Lifecycle-scoped side effects belong at plugin scope, not in
  components that remount.
- **Still resolved?** Yes.

### Case 7 — Install from URL

- **Symptom:** URL import mixed into the search box; modal approach loses
  state on remount.
- **Fix:** Own inline section (4de2067); structured error codes (46e71b9);
  Enter-handling change (6cd6c8d, **cause never confirmed**).
- **Type:** Local design choice driven by G4.
- **Lesson:** Prefer inline flows in the QAM. Record uncertain causes as such.

### Case 8 — Scroll workarounds

- **Superseded 2026-10-15**: the focus-scroll watcher was removed; single-target rows let Steam scroll natively.
- **Regressed, then fixed the Valve way (2026-10-15, owner report):** without
  the watcher, rows scrolled up to slid under Decky's sticky title again. The
  owner asked for Steam's behaviour, not the old fix. Steam's scroller reads
  `scroll-padding` and `scroll-margin`, so our rows now carry a `scroll-margin`
  (S21) and Steam does the scrolling. Not yet seen on a Deck.

- **Symptom:** Focused item hidden behind Decky's sticky title bar; row
  text clipped when navigating up; import preview list not scrollable.
- **Fix:** `focusScrollWatcher.ts` (f92165c): find scroll container by
  computed overflow, sticky header by `position: sticky`, `setTimeout(60)` to
  yield to native scroll; import preview chain 6de2cd3 → ca7294e → c0babd0 →
  4a9b577 (final `Field focusable` rows).
- **Type:** Platform workarounds (stable only by observation).
- **Lesson:** Don't match Steam's obfuscated class names; inspect computed
  style. Expect repeated iteration; reverted/superseded attempts below.
- **Still resolved?** Yes per commits; not re-observed.

### Case 9 — Ignore/Unignore width and button stacking

- **Superseded 2026-10-15**: Ignore lives in the context menu.

- **Root cause:** DialogButton `min-width: 160px` (S6), not label width; and a
  label-width estimate that ignores the longest label in a column.
- **Fix:** `fitFixedColumns` over max label; zero out `min-width`.
- **Lesson:** Look at inherited component CSS before editing your own.

### Case 10 — Other platform limits recorded

- `navigator.clipboard` unavailable → bundled `xclip` RPC.
- Anchors in injected HTML invisible to gamepad → ButtonItems (F5).
- Bare `div`/`pre` invisible to gamepad → wrap in `Focusable` (G3).
- `Spinner` and others may be missing after Steam updates (G6).

### Case 11 — Looking like Steam (2026-10-15)

- **Symptom:** Owner: the plugin looked "beautiful but off" next to Steam; the
  Restore dialog's toggle was cramped; two button rows touched.
- **Root cause:** Valve publishes no UI guideline, so the plugin had grown its
  own conventions: a global `Field` override that removed Steam's row padding,
  multi-button rows, pill tabs of our own, `em` font sizes, our own colours.
- **Fix:** Measured Steam's client (stylesheets, class maps, live computed
  styles; §5.3, `tools/steamui_rules.py`), compared every element (review page
  for the owner, 2026-10-15), then applied it in full (dd81038): Steam rows and
  dialog components with no overrides, one focus stop per item with A / X /
  Menu, context menus with tones, Steam tab pills with L1/R1, settings rows,
  progress bars, toasts with an icon, Get Addons as a full-screen route.
- **Type:** Design-language change, owner-approved (decisions: context menu yes,
  full-screen Get Addons yes, X = Update/Install).
- **Lesson:** Read the platform's own implementation before inventing a style;
  overriding platform classes to save space costs more than it saves.
- **Avoid:** Re-adding Steam class overrides or per-row button groups (S3, S14).
- **Still resolved?** Code only. Needs the §8.6 device pass.

### Case 12 — First device pass of the Steam-native UI (2026-10-15)

- **Owner report:** "a huge upgrade in looks", with regressions: wrong
  shoulder glyphs; rows sliding under the title when moving up; focus jumping
  to another row after every dropdown, modal or picker; the full-screen page's
  B closing the QAM; R1 often animating the wrong way; a redundant Install
  button and heading; help text at the bottom.
- **Method:** before changing anything, read how Steam itself does each thing
  in the installed client (`sp.js`, `sp.css`): the glyph component, `Tabs`
  (bumpers, wrap-around, slide direction, header props, `belowHeaderTabsContent`,
  `onCancelFromTabHeader`), the focus scroller (`scroll-padding` +
  `scroll-margin`), the QAM and modal scroll paddings, the disabled `Field`
  colour.
- **Fix:** S15, S18, S21, S22, S23, S24. The global L1/R1 handler is replaced by
  Steam's focus-scoped button events; it had kept switching the QAM tab while
  the page was open.
- **Lesson:** when something feels "not quite Steam", find the property Steam
  itself uses (often already exposed by the component:
  `belowHeaderTabsContent`, `preferredFocus`, `scroll-margin`,
  `scrollIntoViewType`) before writing a workaround, and check it works in a
  Decky context: `canBeHeaderBackground` is a Steam property that does not
  (S18).
- **Later the same day:** the R1 slide was diagnosed by recording frames over
  CDP (Steam's window scrolled sideways by the slide offset; fixed with
  `scrollIntoViewType` NoTransform, S18); Details was resized by proportion and
  lost Steam's 85 % black modal layer (6.4); `canBeHeaderBackground="always"`
  was dropped because on a Decky route it puts the tab row behind the clock
  (S18, S24).
- **Evening, owner away, unattended device runs:** the scrolloff feel was
  reverse engineered with synthetic presses (Steam's NoTransform scroll type;
  browser "nearest" ignores scroll-margin when deciding to scroll), then the
  page's DialogBody dropping the margin, and Decky's title shadow fading over
  our tab bar (S21, S24). Each was confirmed with an in-memory trial on the
  device before the code change.
- **Still resolved?** QAM scrolloff confirmed by the owner on the device;
  the rest awaits a deploy (regression plan section 7).

### Reverted / superseded attempts (do not repeat blindly)

| Commit | Attempt | Outcome |
|---|---|---|
| 546068b | Sentinel focus targets to silence bell | Reverted by 7060fac; no effect on sound |
| f3c06b1 | Remove text wrapper `Focusable` | Kept, but did not fix bell |
| ca7294e, 6de2cd3 | Import-preview scroll approaches | Reverted by c0babd0 |
| c0babd0 | Combined picker/paste row, scroll target buttons | Superseded by 4a9b577 |
| 2851af6 | Global Field override | Narrowed by 366ba1a |
| c77955a | `fitMixedButtonRow` in InstalledView | Superseded by 4eb1029 |
| 7858f64 | Remove toast on entering My Addons | Superseded by 06081bf (plugin-scope toast) |
| 4eb1029, 2851af6, 366ba1a | Fixed action columns, global Field override and its exception | Superseded by dd81038 (Steam-native rework) |

### Anti-pattern list

1. Asserting "no impact" on neighbors without listing them (Case 1).
2. State in component `useState` that must survive a modal (G4).
3. Effects that toast or fetch on every mount (Case 6).
4. Plain `div`/anchors as controller targets (G3, F5).
5. `rAF` or `instanceof HTMLElement` in SteamUI callbacks (G7).
6. Matching Steam's hashed class names (Case 8), or overriding Steam's
   component classes at all (S3, Case 11).
7. Copying a formatting rule without checking `min-width` etc. (S6).
8. Declaring a platform limitation "fixed" without hardware (V1).
9. Mass-editing `flow-children` / `navEntry` without a device (F7, U-11).
10. Expanding `docs/` claims beyond what a commit message actually verified.

---

## 10. Initial UI improvement backlog

Not implemented in this work. Each item: **Screen**, **Issue**, **Evidence**,
**Recommendation**, **Status** (CONFIRMED = verified by reading code/types;
SUSPECTED = plausible, not observed), **Risk**, **Verification**.

**U-1 Remove has no confirmation and is icon-only.**
Screen: My Addons. Evidence: `InstalledView.tsx` calls `api.removeAddon`
directly from the trash icon, no `ConfirmModal`. Recommendation: add
`ConfirmModal` (example §3.3) or a two-step button. Status: CONFIRMED (code);
user impact SUSPECTED. Risk: modal remount (G4) reloads panel; keep state in
module scope. Verification: T1–T3 + human flow on device.
RESOLVED in code (cleanup sprint, A8): both Remove buttons now confirm. Accepted by the owner (2026-10-13).

**U-2 Icon-only controls rely on `tooltip` only.**
Screens: Search, URL import, Refresh, Pagination, Details. Issue:
tooltip visibility on gamepad is UNVERIFIED. Status: SUSPECTED. Risk: low;
adding labels competes with width budget. Verification: T4/T6.
Audit decision (owner, 2026-10-13): accepted as is; no change planned.

SUPERSEDED (2026-10-15, dd81038): icon-only buttons are gone from rows and the tab bar labels the active tab; actions are labelled in the footer and the context menu.

**U-3 Search has no stale-response guard and `doSearch` does not return early while `searching`.**
Screen: Get Addons → Search (`BrowseView.tsx`). Evidence: Discover/Popular use
`requestRef`; Search does not. Issue: out-of-order results, double submit
(Enter plus click).
Status: CONFIRMED (code); occurrence SUSPECTED. Risk: low. Verification: T1–T3
and a unit test for any extracted pure helper.
RESOLVED in code (cleanup sprint): request-id guard, early return while searching, button disabled while searching/empty; empty and failed results are inline, not toasts (A6). Accepted by the owner (2026-10-13).

**U-4 `flow-children="horizontal"` vs `"row"`.**
Evidence: COMMIT 4eb1029 message vs 21 uses at HEAD; device check §8.4a
confirms `"horizontal"` sets no nav layout, yet Left/Right in the toolbar
group worked. Status: CONFIRMED that the value configures nothing; no visible
fault observed; whether switching to `"row"` improves or regresses Left/Right
behavior is SUSPECTED/untested. Risk: **medium** — could change nav behavior in many rows.
Verification: T6 on every touched screen.
Audit decision (owner, 2026-10-13): accepted as is; no change planned.

RESOLVED (2026-10-15, dd81038): every group uses `flow-children="row"`.

**U-5 Scroll/focus position not restored after modal round-trip.**
Screens: Search/Discover/Popular after Details. Evidence: only tab/query/page
state is persisted. Status: partly OBSERVED (DEVICE, synthetic Escape, My
Addons): the tab is restored and focus returns, after a delay, to a row-level
element rather than the opener; scroll position after remount was not
measured; Search/Discover/Popular not tried. Risk: medium. Verification: T6.

PARTLY SUPERSEDED (2026-10-15): Get Addons moved to a route, which a modal does not unmount; My Addons rows are single focus stops. Still unmeasured on a Deck.

**U-6 Repeated backend fetches on each `Content()` mount.**
Evidence: mount-time fetch in `index.tsx` plus G4. Status: SUSPECTED (not
measured). Recommendation: cache in module scope with explicit refresh.
Risk: staleness after install elsewhere. Verification: T2 for the cache
logic, T6 for UX.

**U-7 `getDiagnostics` without try/catch in Show button.**
Screen: Options. Status: CONFIRMED (code). Risk: low. Verification: T1–T3.
RESOLVED in code (cleanup sprint): try/catch added; also on the two clipboard-copy buttons. Accepted by the owner after on-device use.

**U-8 Inconsistent feedback: toast vs inline vs loading text.**
Examples: Search "No results" toast; URL import inline; Discover "Loading…"
text. Status: CONFIRMED (code). Recommendation: pick per A6, apply
incrementally. Risk: low–medium (visual). Verification: T4.

RESOLVED in code (2026-10-15): one toast helper (S17), inline outcomes for search and URL import, progress bars for long jobs.

**U-9 Hard-coded colors (no token module).**
Evidence: 40+ occurrences of `#95a3ab`. The contrast concern is **resolved**:
measured 7.14:1 against the QAM background on a Deck (DEVICE, §8.4a). Remaining
question, size legibility at 0.75em–0.85em (12–13.6 CSS px) at handheld
distance, is subjective and UNVERIFIED. Status: CONFIRMED (duplication),
low priority. Risk: low.
Text size (DEVICE, read-only CDP, 2026-10-13, panel DPR 1.5, 854x534 CSS px on a
1280x800 screen): the plugin's rendered font sizes are 10.4 (LB/RB glyph), 12.8,
13.6 and 16 CSS px, i.e. about 16-24 device px. Valve's compatibility page
(Steam Deck Specific Requirements > Display > Text Legibility; written for
games, so a reference point, not a plugin mandate) sets 9 px at 1280x800 as the
minimum and recommends aiming for 12 px: all sizes here clear both. Conformant.
**SHOULD NOT** go below 0.8em for text a user needs to read; the 0.65em/0.7em
uses are the LB/RB glyph and the diagnostics dump.

RESOLVED (2026-10-15): `src/steamTheme.ts` with Steam's measured values (S20).

**U-10 Deviations from the pre-rework settings guide (removed 2026-10-22).**
- Long multi-sentence helper text in Options (rule 11).
- Details links row has `overflowX: auto` (rule 2).
- Details hint "Scroll: D-pad / left stick ↑↓" (rule 9) — probably a justified
  exception since no standard affordance exists; document it.
- `AddonResultRow` has no Marquee/truncation (rule 5 says Marquee for names;
  only `InstalledView` uses it). Long names may wrap.
Status: CONFIRMED (code); visual impact SUSPECTED. Risk: low.
Audit decision (owner, 2026-10-13): long helper text is approved. The UI space is small and the text is needed to communicate; do not shorten it to meet rule 11 of the old guide.

SUPERSEDED (2026-10-15): help text moved into row descriptions; §5.3 of this guide is the sizing rule now.

**U-11 Obsolete/stale comments and a possible simplification.**
- `navEntry.ts` and `focusScrollWatcher.ts` comments say the enum / typed
  `onGamepadFocus` are not available in `@decky/ui`; 4.12.1 types have both.
  (The runtime lookup itself still works on Decky 3.2.10, §8.4a.)
- The removed `docs/ui-guidelines.md` placed `--wowdeck-btn-pad` in
  `index.tsx`; it is in `sharedStyles.ts`.
- `make lint` vs `docs/development.md` wording.
Status: CONFIRMED (code and types). Recommendation: fix comments/docs only;
do **not** change runtime lookups without a device (they must keep working at
`@decky/ui` 4.11.x too: UNVERIFIED). Risk: none for comment-only changes.

MOSTLY MOOT (2026-10-15): `navEntry.ts` and `focusScrollWatcher.ts` were removed.

**U-12 Deprecated API use.** `staticClasses` import in `index.tsx` (deprecated
in favor of `quickAccessMenuClasses`). Status: CONFIRMED. Risk: low; verify
class mapping first.

RESOLVED (2026-10-15): `quickAccessMenuClasses.Title`.

**U-13 Duplicated install-and-toast logic** in `BrowseView`, `DiscoverSection`,
`PopularBrowseSection`, `InstallFromUrlSection`; duplicated `persisted*`
mechanisms; three modals repeat the `showModal` boilerplate. Status: CONFIRMED.
Risk: refactor risk; out of scope until tests exist for it.

RESOLVED (2026-10-15): one install path (`src/installAddon.ts`); the four Get Addons components became one page.

**U-14 No component/focus tests; `make test` omits frontend tests.**
Status: CONFIRMED. Recommendation: CONSIDER extracting more pure logic before
introducing any framework.

**U-15 Per-row action descriptions and secondary-button shortcuts**
(`onSecondaryButton` etc. with action descriptions, as seen in other
plugins). Status: CONSIDER. Risk: low; verify the footer legend appears in the
QAM context: UNVERIFIED.

RESOLVED in code (2026-10-15): S14 (A / X / Menu with footer labels). Footer legend inside the QAM still UNVERIFIED on a Deck.

**U-16 `useQuickAccessVisible` for any future polling.** CONSIDER.

**U-17 GitHub token field is not masked.**
Screen: Options → GitHub. Evidence: the `TextField` for "Personal access
token" has no `bIsPassword`; the CurseForge key field does. Status:
CONFIRMED (code). Risk: low (shoulder-surfing / screen capture exposure of a
secret). Verification: T1–T3, then check the on-screen keyboard still works with
a masked field on device (UNVERIFIED).
RESOLVED in code (cleanup sprint): `bIsPassword` added, same as the CurseForge key. Accepted by the owner (2026-10-13); needed `type="password"` too (FM3).

**U-18 Links and embedded video inside rich text are pointer-only.**
Screen: Details modal (Description/Changelog). Evidence: DEVICE (§8.4b) Steam's
own news view has the same property: a YouTube `iframe` with no `tabindex`, and
anchors in article text, are reached by touch/mouse/trackpad, not by the D-pad.
Decision (owner): accepted for now; the planned redesign does **not** add a
links `ButtonItem` row. Revisit if Valve changes its news UI. Status: KNOWN
WEAKNESS, accepted. Risk: users without a pointer cannot open links or press
play. Note: F5 describes the previous workaround (up to 6 link buttons), which
the redesign removes.

---

## 11. Sources, version assumptions and maintenance

### 11.1 Comparison of reference implementations

Read via public source (GitHub raw files). Nothing here was run; only declared
`package.json` ranges were inspected. **Licenses vary or are ambiguous**:
describe patterns, do not copy code.

| Reference | Pattern examined | Evidence and benefits | Limitations or risks | Applicability |
|---|---|---|---|---|
| Decky Loader docs & wiki | Plugin API, remote debug, submitting | Official, authoritative | Wiki Getting Started page is stale (documents ServerAPI) | High for API names; verify against installed types |
| Installed `@decky/ui` 4.12.1 types | Props, exports, deprecations | Ground truth for this repo | Types don't prove runtime behavior; many `any` | High |
| SteamGridDB plugin | QAM for settings, gallery in a full-screen route with `Tabs`; `Focusable` items with `onSecondaryButton`/`onMenuButton` + action descriptions; `flow-children="row"`; debounce + spinner | Dense UI isn't squeezed into 300 px; per-item shortcuts | Uses internal input element props (`m_elInput`); `IntersectionObserver` with brittle parent chain; matches via `toString()`; license metadata conflicting | CONSIDER only (route is a big change) |
| DeckThemes CSS Loader | Title-bar buttons with `Navigation.CloseSideMenus()` then `Navigate`; per-row `Focusable`; Load More then focus new item via 100 ms timeout | Shows focus-after-load pattern similar to ours | Hashed class selectors with versioned fallbacks ("DOM churn"), legacy `decky-frontend-lib`, timing hack | Low; confirms our timeout approach is common, and why to avoid class names |
| MoonDeck | `useQuickAccessVisible` gating, `ConfirmModal` for destructive actions, `Field` `childrenContainerWidth`, async button disabled + relabelled | Good conventions for polling and confirmation | One busy flag reset only in some branches | Medium (U-1, G10) |
| decky-plugin-template | Minimal baseline | Shows current official shape | No UI depth | Baseline only |
| This repo's git history | Real regressions and fixes | Highest relevance | Commit messages record live observations we cannot re-check | High |

Excluded: PowerTools and protondb-decky (archived). hltb-for-deck, AudioLoader
and ProtonUp were not read.

Caveats on external research: plugins were not run; focus restoration after
modal close in other plugins is unverified; bumper behavior in `Tabs` was not
verified from source.

### 11.2 Non-UI note: Decky plugin store policy

OFFICIAL (Decky wiki "submitting plugins"): the plugin-store PR template
requires a checkbox that generative AI was not used to write a majority of the
code. If this plugin is ever submitted to the store, discuss this with the
maintainer; it is unrelated to UI quality.

### 11.3 Licensing posture

Other plugins' licenses are mixed (GPL-3.0, BSD-3-Clause, or unclear).
Treat the table above as a description of ideas. Do not paste their code.

### 11.4 Maintenance procedure

Update this guide when:

- `@decky/ui`, `@decky/api`, Decky Loader or SteamOS/Steam client versions change.
- A UI commit adds a workaround or changes a rule here.
- A backlog item is implemented, rejected or disproved.

Procedure:

1. Re-run T1–T3 (§8.1) and paste the new results into §8.1.
2. Re-check version-sensitive claims against the installed types:
   `Focusable`/`FooterLegend` props, `NavEntryPositionPreferences`,
   `ConfirmModal`, `useQuickAccessVisible`, deprecations.
3. For each LIVE-tagged claim, either have a human re-confirm on hardware and
   add the date/device, or leave it labelled as historical.
4. Move resolved backlog items to a "Resolved" note with the commit hash.
5. Never delete a case study; mark it "superseded" with the new commit.

Staleness signals: a `docs/` claim mentions a file that moved (e.g. CSS in
`index.tsx`); a commit message says "confirmed" without naming a device; a
`@decky/ui` major version bump.

### 11.5 Known gaps in this guide

- No real-controller verification: the only device contact was the owner-
  authorized SSH + CEF session in §8.4a (reads plus synthetic keyboard events).
  No visual, audio or physical-gamepad behavior was tested.
- Device observations (§8.4a) are one LCD Deck, one session.
- Official docs/wiki were read through a subagent using raw GitHub/npm
  sources; the wiki may have changed.
- `AddonPortabilityModal.tsx` and `markdown.ts` were only skimmed.
- No screenshot tooling exists, so layout claims rely on recorded
  measurements (§5.3 and §8.4a of this guide).
- Whether Steam OLED, other scale factors or Desktop Mode differ is unknown.
