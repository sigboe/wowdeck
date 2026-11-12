# UI guide

Rules for building and changing the frontend UI under `src/`. Every rule
says what to do, why (the measurement or owner decision behind it) and how
(a helper, an example or a recipe).

Don't read the whole guide. Find your change in the task router, then read
only the files and rules it names. The rule index below lists every rule
in one line each; open the linked section when a rule applies to you.
`src/AGENTS.md` repeats the MUST rules that cause the most rework.

## Task router

| You are changing… | Read | Rules to check |
| --- | --- | --- |
| Anything in `src/` | [Quick-start checklist](#2-quick-start-checklist) | G1, G2, P1, S3, S20 |
| Which surface to use (QAM, modal, full-screen page) | [general.md](general.md), [architecture.md](architecture.md) | G11, P9, S18 |
| A modal or dialog | [design-language.md](design-language.md), [recipes.md](recipes.md), [focus.md](focus.md) | G4, G5, G12, P6, P7, S8, S12, S36, F2, F3, R5 |
| A list or list row | [components.md](components.md), [design-language.md](design-language.md) | S1, S9, S14, S23, S30, S33, S37 |
| A QAM row or QAM view | [design-language.md](design-language.md), [recipes.md](recipes.md) | S16, S21, S25, S32, R1, R3 |
| Scrolling | [design-language.md](design-language.md), [recipes.md](recipes.md), [focus.md](focus.md) | S21, F4, R2 |
| A tab bar, filter bar or full-screen page | [design-language.md](design-language.md), [recipes.md](recipes.md) | S15, S18, S24, S26, R3, R4 |
| A settings row, text field or warning | [design-language.md](design-language.md) | S19, S28, S38, S39, F10, R9 |
| Focus, D-pad or button handling | [focus.md](focus.md), [architecture.md](architecture.md) | G2, G3, F1–F10, P8, S29, S36 |
| CSS, colours or text sizes | [components.md](components.md), [design-language.md](design-language.md), [lessons.md](lessons.md) case 1 | P3, P4, S3, S4, S10, S11, S20, S27 |
| Loading, errors, toasts or long-running work | [feedback.md](feedback.md) | A1–A10, A5b, S17 |
| Any text the player reads | [feedback.md](feedback.md) | C01–C12, S22 |
| Steam's own pages (library, store) | [design-language.md](design-language.md) | S34, G13 |
| How Valve does something | [recipes.md](recipes.md), [device-notes.md](device-notes.md) | R7, R8 |
| What you may claim was tested | [verification.md](verification.md) | tiers T1–T6, the hardware-claim policy |
| A workaround that looks wrong | [lessons.md](lessons.md), [backlog.md](backlog.md) | read before "fixing" it |

## Files

| File | Sections | What it holds |
| --- | --- | --- |
| [README.md](README.md) | §1, §2 | This index, how to use the guide, rule markers, the quick-start checklist |
| [general.md](general.md) | §3 | Platform model, G1–G14, compilable examples |
| [architecture.md](architecture.md) | §4 | Frontend layout, P1–P9, session model, global input, async patterns |
| [components.md](components.md) | §5–§5.2 | Component inventory, S1–S7 |
| [design-language.md](design-language.md) | §5.3 | Steam's design language, S8–S39 |
| [recipes.md](recipes.md) | §5.4 | R1–R9 |
| [focus.md](focus.md) | §6 | `Focusable` facts, F1–F10, details modal, nav contract, forms |
| [feedback.md](feedback.md) | §7 | A1–A10, copy rules C01–C12 |
| [verification.md](verification.md) | §8 (not §8.4a–c) | Tooling, test tiers, hardware-claim policy, report template |
| [device-notes.md](device-notes.md) | §8.4a–§8.4c | Device measurements the rules cite |
| [lessons.md](lessons.md) | §9 | Case studies, reverted attempts, anti-patterns |
| [backlog.md](backlog.md) | §10 | Known improvements not yet done |
| [sources.md](sources.md) | §11 | Reference plugins, licensing, maintenance, known gaps |

Section numbers (§5.3, §8.4a) are the same as before the split, and code
comments and older documents still cite them. Find a section's file in this
table.

## Rule index

### General Decky rules

| Rule | Level | What it says |
| --- | --- | --- |
| [G1](general.md#32-rules) | MUST | build controls from `@decky/ui` components (`PanelSection`, `PanelSectionRow`, `ButtonItem`, `ToggleField`, `TextField`, `Dropdown`, `Focusable`, … |
| [G2](general.md#32-rules) | MUST | make every action reachable with D-pad + A (and B for back/cancel). |
| [G3](general.md#32-rules) | MUST | wrap custom non-interactive content the user needs to reach (text blocks, preview rows) in `Focusable` (or `Field focusable`). |
| [G4](general.md#32-rules) | MUST | treat `showModal` as destroying the QAM panel. |
| [G5](general.md#32-rules) | SHOULD | still pass `window` as the `showModal` parent and `bHideMainWindowForPopouts: false`, as other working plugins do. |
| [G6](general.md#32-rules) | MUST | be defensive about `@decky/ui` exports. |
| [G7](general.md#32-rules) | MUST NOT | rely on `requestAnimationFrame` or `instanceof HTMLElement` inside SteamUI-invoked callbacks. |
| [G8](general.md#32-rules) | MUST NOT | use `navigator.clipboard`, `window.open`, or the browser keyboard-focus model as if this were a normal web page. |
| [G9](general.md#32-rules) | SHOULD | prefer `Navigation` over deprecated `Router.*` and `@decky/api` over deprecated `@decky/ui` re-exports (the installed type declarations carry … |
| [G10](general.md#32-rules) | SHOULD | use `useQuickAccessVisible()` from `@decky/api` (compiles against the installed version) to gate polling or timers that only matter while the QAM … |
| [G11](general.md#32-rules) | SHOULD | use a wider surface for dense UI instead of fitting it in 300 px: a full-screen route (`routerHook.addRoute`, declared in the installed … |
| [G12](general.md#32-rules) | SHOULD | use `ConfirmModal` for destructive actions (compiles against the installed version |
| [G13](general.md#32-rules) | MUST | document each use of an undocumented SteamUI property with: what it does, how it was verified (LIVE/INFERRED), and what to do if it is missing. |
| [G14](general.md#32-rules) | SHOULD | open a choice menu inside the panel (an in-pane overlay list, `SegmentMenu`) rather than a Steam context-menu popup (`@decky/ui` `Dropdown` / … |

### Project architecture

| Rule | Level | What it says |
| --- | --- | --- |
| [P1](architecture.md#42-conventions-to-keep) | MUST | keep all backend access in `src/services/backend.ts`. |
| [P2](architecture.md#42-conventions-to-keep) | MUST | unit-test new pure UI logic in a `*.test.ts` file. |
| [P3](architecture.md#42-conventions-to-keep) | MUST | put shared CSS in `src/sharedStyles.ts` and inject it as `<style>{wowdeckSharedStyleCss()}</style>` where it is used (the QAM panel, the Details … |
| [P4](architecture.md#42-conventions-to-keep) | SHOULD | take colours and text sizes from `src/steamTheme.ts` (`STEAM`, `STEAM_FONT`, `descriptionStyle`) rather than literals (S20). |
| [P5](architecture.md#42-conventions-to-keep) | SHOULD | keep text short: a row label plus one line of description |
| [P6](architecture.md#43-session--lifecycle-model) | MUST | decide for each new piece of UI state: *does it need to survive (a) tab switches, (b) modal round-trips, (c) QAM close/open?* Put it in module … |
| [P7](architecture.md#43-session--lifecycle-model) | MUST NOT | implement "Install from URL"-style flows as a modal that has to hand data back via React state of the unmounted panel. |
| [P8](architecture.md#44-global-input) | MUST | unregister every raw-input registration on unmount (return the unregister function from `useEffect`) and, when stacking UI that shares an input, … |
| [P9](architecture.md#42-conventions-to-keep) | SHOULD | choose the surface by content, not by habit: the QAM column for quick glanceable actions and settings |

### Components and Steam design language

| Rule | Level | What it says |
| --- | --- | --- |
| [S1](components.md#52-rules) | MUST | reuse `AddonResultRow` for addon lists. |
| [S2](components.md#52-rules) | superseded | (superseded 2026-10-15) |
| [S3](components.md#52-rules) | MUST NOT | override Steam component classes (`gamepadDialogClasses.Field`, `DialogButton`, Steam's `Field` padding). |
| [S4](components.md#52-rules) | SHOULD | use longhand margin/padding properties. |
| [S5](components.md#52-rules) | superseded | (superseded by S20) |
| [S6](components.md#52-rules) | SHOULD | set `minWidth: 0` (and usually `width: "auto"`) inline on a `DialogButton` that sits beside other content: Steam's default is `min-width: 160px`, … |
| [S7](components.md#52-rules) | superseded | (superseded 2026-10-15) |
| [S8](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | build a modal from Steam's own dialog components (`ModalRoot` with `DialogHeader`, `DialogBody`, `DialogBodyText`, `DialogControlsSection`, … |
| [S9](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | present an action in a modal or list as a whole-row `Field` (label, description, `onClick`, `focusable`), not as a free-standing button. |
| [S10](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | keep at least Steam's spacing between focus targets: 6 px between rows, 8 px between side-by-side buttons, 10 px between stacked buttons, 24 px … |
| [S11](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | use Steam's type scale: 22 header, 18 (16 uppercase in BasicUI) section header, 16 body and labels, 12 descriptions and footnotes |
| [S12](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | follow Steam's dialog template: header, body, footer. |
| [S13](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | group by proximity, align on one left edge, and show state by shape as well as colour (Steam's switch moves its knob). |
| [S14](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | make each item in a list one focus stop, as Steam's Library and Downloads do. |
| [S15](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | draw plugin tabs like Steam's tab bar: 12 px bold uppercase pills, radius 64, selected 15 % white, focused white with `#23262e` text, and Steam's … |
| [S16](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | use Steam's QAM row components as they are: `PanelSection` / `PanelSectionRow` with `Field`, `ToggleField`, `DropdownItem`, `TextField`, … |
| [S17](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | send every toast through `pluginToast` (plugin icon, trimmed body), and SHOULD show progress where the work is: a `ProgressBarWithInfo` (Update … |
| [S18](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | put browsing and searching on a full-screen route with Steam's `Tabs` (as Steam's Store and Decky's own plugin store do), with load-more rows … |
| [S19](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | build settings as Steam settings rows: a label, one short description, the control on the right (toggle, dropdown, small icon, or a chevron to a … |
| [S20](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | take colours and text sizes from `src/steamTheme.ts`: text `#dcdedf`, description `#b8bcbf`, disabled `#67707b`, positive `#59bf40`, primary … |
| [S21](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | keep people's place the way Steam does (owner, 2026-10-15: "going back from a sub menu should most of the time navigate to the same spot"): - … |
| [S22](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST NOT | put help text at the bottom of a section or page (owner, 2026-10-15). |
| [S23](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | show an inactive item (an ignored addon) the way Steam shows a row that is switched off: label and description in Steam's disabled grey `#67707b` … |
| [S24](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | make every bar at the top of a view (tab bars, filter bars, any navigation) a floating pane BELOW Steam's top bar (clock, battery), the way … |
| [S25](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | title QAM views the way Steam titles its own QAM pages. |
| [S26](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | make moving between the QAM and a wide surface calm: one animation at a time, and nothing that moves by itself after it opened. |
| [S27](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | keep everything inside a focus highlight clear of its edges, and keep values inside the control that shows them. |
| [S28](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | show every text field as a Steam settings row. |
| [S29](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | ring Steam's "can't move" bell only when a press really goes nowhere. |
| [S30](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | put a variant of a row's main action on the Menu button (≡) as a Steam context menu, named in the footer next to the action. |
| [S31](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | put a rarely used tool behind a glyph-only button and show its state on the glyph and in the heading, never as extra rows. |
| [S32](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | keep everything in the QAM inside the panel's width, and check a Steam row component there before using it. |
| [S33](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | let a line of facts wrap only between facts. |
| [S34](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | keep anything we add to Steam's own pages invisible when it cannot be added safely, and never take Steam's focus. |
| [S35](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | put every way of choosing which release of an addon is installed in one place, the row's Options menu, next to each other: "Release channel: … |
| [S36](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | return focus to the row that opened a modal, menu or picker, with no exceptions. |
| [S37](design-language.md#53-the-steam-deck-design-language-device-derived) | SHOULD | show addons that are never updated the way Steam shows a row that is switched off: greyed out with a status tag (IGNORED, UNMANAGED), sorted to … |
| [S38](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | write a warning so it works without colour, with the `Warning` component (R9). |
| [S39](design-language.md#53-the-steam-deck-design-language-device-derived) | MUST | give `>` and ⋯ one meaning each on settings rows. |

### Recipes

| Rule | Level | What it says |
| --- | --- | --- |
| [R1](recipes.md#54-how-to-build-it-recipes) |  | A QAM row that keeps its place (S21). |
| [R2](recipes.md#54-how-to-build-it-recipes) |  | A view that scrolls like Valve's (S21). |
| [R3](recipes.md#54-how-to-build-it-recipes) |  | A floating pane in the QAM (S24, S25). |
| [R4](recipes.md#54-how-to-build-it-recipes) |  | A full-screen page (S18, S26). |
| [R5](recipes.md#54-how-to-build-it-recipes) |  | A modal. |
| [R6](recipes.md#54-how-to-build-it-recipes) |  | A controller glyph. |
| [R7](recipes.md#54-how-to-build-it-recipes) |  | Find out how Valve does it. |
| [R8](recipes.md#54-how-to-build-it-recipes) |  | Audit a view against the guidelines. |
| [R9](recipes.md#54-how-to-build-it-recipes) |  | A warning on a card (S38). |

### Focus and navigation

| Rule | Level | What it says |
| --- | --- | --- |
| [F1](focus.md#62-rules--general-general) | MUST | give every focus target visible focus styling by using platform components. |
| [F2](focus.md#62-rules--general-general) | MUST | keep a modal's B-button/close working: pass `onCancel` and `closeModal` to `ModalRoot`. |
| [F3](focus.md#62-rules--general-general) | SHOULD | keep modal focus management to `ModalRoot`'s own behavior. |
| [F4](focus.md#62-rules--general-general) | MUST NOT | make a non-focusable scroll region the only way to read content, unless you provide an alternate input route. |
| [F5](focus.md#62-rules--general-general) | SHOULD | render link content as real `ButtonItem`s. |
| [F6](focus.md#63-rules--project-project) | superseded | (superseded 2026-10-15 by S14) |
| [F7](focus.md#63-rules--project-project) | MUST | use `flow-children="row"` for horizontal groups. |
| [F8](focus.md#63-rules--project-project) | SHOULD | treat `onGamepadFocus` as the only reliable per-element focus hook (the focus-scroll watcher that used it was removed with S14). |
| [F9](focus.md#63-rules--project-project) | SHOULD | set `.focus()` on the element, not simulate input, when moving focus programmatically: SteamUI's nav tree picks up a real `.focus()` (LIVE). |
| [F10](focus.md#64-details-modal-carousel-and-scrolling-workaround-not-a-pattern) | MUST | offer a Browse button (`openFilePicker` from `@decky/api`, `FileSelectionType.FOLDER` or `.FILE`) next to any text field that asks for a … |

### Async state and feedback

| Rule | Level | What it says |
| --- | --- | --- |
| [A1](feedback.md#72-rules) | MUST | use a request-id/ref guard for any fetch whose result can arrive after the user changed the inputs (§4.5). |
| [A2](feedback.md#72-rules) | MUST | distinguish loading / error / empty / success as four rendered states. |
| [A3](feedback.md#72-rules) | MUST | wrap every `await api.*` in `try/catch/finally` when it is triggered by a click, so busy flags reset and the user gets feedback. |
| [A4](feedback.md#72-rules) | MUST NOT | fire toasts from effects that run on every mount (the original My Addons toast fired on every remount, COMMIT 7858f64). |
| [A5](feedback.md#72-rules) | SHOULD | truncate error text before display (existing code uses `String(e).slice(0, 120–160)`), and prefer user-facing mapped messages for errors that have … |
| [A5b](feedback.md#72-rules) | MUST | run every caught backend error through `backendErrorMessage` (`src/errors.ts`) before showing or mapping it. |
| [A6](feedback.md#72-rules) | SHOULD | prefer inline feedback when the user's attention is already on the control (forms, URL import) and toasts for events that happen away from the … |
| [A7](feedback.md#72-rules) | MUST | guard SteamClient APIs with a `typeof … === "function"` check, and run once-per-session calls outside `Content` effects. |
| [A8](feedback.md#72-rules) | MUST | put a confirmation (`ConfirmModal`, `confirmRemoveAddon`) in front of any action that deletes data from disk, and say in the text what is deleted … |
| [A9](feedback.md#72-rules) | MUST NOT | show a failed load as an empty state: Latest Addons / Popular keep a separate red inline error line (via `friendlySearchError`) distinct from the … |
| [A10](feedback.md#72-rules) | MUST | run anything that can take more than a few seconds as an engine job, never as one long call. |

### Copy

| Rule | Level | What it says |
| --- | --- | --- |
| [C01](feedback.md#73-copy-rules-c01c12-project) | MUST | word every failure "Couldn't <verb> <thing>" ("Couldn't install DBM", "Couldn't save"). |
| [C02](feedback.md#73-copy-rules-c01c12-project) | MUST | count with real plurals ("1 addon", "3 addons"), never "addon(s)". |
| [C03](feedback.md#73-copy-rules-c01c12-project) | MUST | end only full multi-sentence text with periods. |
| [C04](feedback.md#73-copy-rules-c01c12-project) | MUST NOT | join clauses with dashes |
| [C05](feedback.md#73-copy-rules-c01c12-project) | MUST NOT | show internal words: engine, provider, flavor, job, Proton prefix, bundled key, toast, HTTP codes, ids, engine names like "Curse". |
| [C06](feedback.md#73-copy-rules-c01c12-project) | MUST NOT | put a raw error in front of the user. |
| [C07](feedback.md#73-copy-rules-c01c12-project) | MUST | use sentence case for every title, dialog and button ("Export addon list", "Restore backup?"), like Steam's own dialogs. |
| [C08](feedback.md#73-copy-rules-c01c12-project) | MUST | use curly quotes (“dbm”) around quoted user input. |
| [C09](feedback.md#73-copy-rules-c01c12-project) | SHOULD | use contractions (can't, isn't, weren't) |
| [C10](feedback.md#73-copy-rules-c01c12-project) | MUST | write dates and times one way: "14 Oct" this year, "14 Oct 2024" before (`dayMonth`) |
| [C11](feedback.md#73-copy-rules-c01c12-project) | MUST | title a toast with what happened to what ("Updated DBM", "Removed Bagnon", "Updated 3 addons", "Installation removed") |
| [C12](feedback.md#73-copy-rules-c01c12-project) | MUST | call the WTF feature "Settings backup", naming the folder in the description ("Addon settings, keybinds, macros and UI layout (the WTF folder)"). |

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
  evidence (licenses are mixed or unclear; see [§11.3](sources.md#113-licensing-posture)).
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
  Deck over SSH + the Steam CEF debugger ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)). Covers only what the [§8.4a](device-notes.md#84a-device-observations-2026-10-13)
  tables list. Part 1 is read-only (`Runtime.evaluate` reads); part 2 used
  **synthetic keyboard events** (CDP `Input.dispatchKeyEvent`), which drive
  SteamUI's navigation tree but are **not** real controller input.
- `COMMIT <hash>` — a git commit in this repository.

### 1.4 How an agent should use this

1. Read [§2](#2-quick-start-checklist) before touching UI.
2. Find your change in the [task router](#task-router) and read the files and
   rules it names. The [rule index](#rule-index) has every rule in one line.
3. Check [§9](lessons.md#9-anti-patterns-and-lessons-case-studies) anti-patterns and [§10](backlog.md#10-initial-ui-improvement-backlog) backlog so you do not "fix" something that is
   a deliberate workaround, or re-attempt a rejected approach.
4. Finish with the [§8](verification.md#8-testing-and-verification) verification report. State which tiers you did and did
   not reach.
5. **Every rule says what, why and how.** What to do; why (the measurement or
   owner decision behind it, with date and method); how (the helper to use,
   a code example, or a recipe in [§5.4](recipes.md#54-how-to-build-it-recipes)). When you add or change a rule, write
   all three. A rule without a "how" is not finished. When you learn something
   on the device, record it here the same day ([§11.4](sources.md#114-maintenance-procedure)), with the method, so the
   next person can repeat it (`tools/deck-ui/`).

### 1.5 Hard project constraints (from `AGENTS.md`)

- **MUST** never modify `wowup/` (read-only pinned reference checkout).
- **MUST** keep `src/` frontend-only; backend calls go through
  `src/services/backend.ts` → `@decky/api` `callable`. Wire contracts live in
  `backend/src/api/contracts.ts`.
- **MUST** run lint, format check, typecheck, tests and build before committing
  (commands in [§8](verification.md#8-testing-and-verification)).
- Use small, descriptive commits.

---

## 2. Quick-start checklist

Before editing UI:

- [ ] Which surface? QAM panel (300 px column), a modal (`showModal`), or a full-screen route (G11, P9)?
- [ ] Does state need to survive a modal opening? (If yes → module scope, [§4.3](architecture.md#43-session--lifecycle-model), rule P6.)
- [ ] Is there already a shared component/helper? ([§5](components.md#5-shared-components-and-styling-project)) Use it before writing a new one.
- [ ] Does the change touch focus/navigation? Then write the nav contract ([§6.6](focus.md#66-navigation-contract-testable-per-screen)) for it.
- [ ] Is there a Steam component for it ([§5.3](design-language.md#53-the-steam-deck-design-language-device-derived))? Use it; do not restyle Steam classes (S3).
- [ ] Does it change CSS in `src/sharedStyles.ts`? List every control family
      that CSS can reach and check each ([§9](lessons.md#9-anti-patterns-and-lessons-case-studies), case study 1).
- [ ] List items: one focus stop each, actions on A / X / Menu with footer labels (S14).
- [ ] A QAM row? Give it focus memory (`FocusRow` / `focusTarget`, S21, recipe R1).
- [ ] A view that scrolls? Wrap it in Valve's scroll buffer with Steam's NoTransform scroll type (S21, R2).
- [ ] A bar at the top or a view-wide control? Floating pane, attached by measurement (S24, R3).
- [ ] A full-screen page? Steam's `Tabs`, stable tabs, bar, bumpers, enter/leave choreography (S18, S26, R4).
- [ ] Unsure how Valve does it? Look it up before inventing (R7): Steam's own CSS/JS and a measurement on the device.

After editing UI:

- [ ] `make lint typecheck test build` passes. New `*.test.ts(x)` files run without being registered.
- [ ] Fill in the verification report ([§8.5](verification.md#85-verification-report-template)). Never write "verified on Steam Deck" unless a human did it on hardware.
- [ ] If you discovered new platform behavior, record it in a code comment **and** in this guide ([§11.4](sources.md#114-maintenance-procedure)).
