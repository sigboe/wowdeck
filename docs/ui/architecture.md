# This plugin's frontend architecture

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Rules P1–P9: frontend layout, conventions, the session model, global input and async patterns.

## Contents

- [4. This plugin's architecture and conventions [PROJECT]](#4-this-plugins-architecture-and-conventions-project)
- [4.1 Layout of the frontend](#41-layout-of-the-frontend)
- [4.2 Conventions to keep](#42-conventions-to-keep)
- [4.3 Session / lifecycle model](#43-session--lifecycle-model)
- [4.4 Global input](#44-global-input)
- [4.5 Async patterns that are working](#45-async-patterns-that-are-working)

## 4. This plugin's architecture and conventions [PROJECT]

## 4.1 Layout of the frontend

| Path | Role |
|---|---|
| `src/index.tsx` | `definePlugin`; `Content()`; tab state; global LB/RB registration; update toast |
| `src/components/*` | Screens and shared components ([§5](components.md#5-shared-components-and-styling-project)) |
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

## 4.2 Conventions to keep

**P1 [PROJECT] MUST** keep all backend access in `src/services/backend.ts`.
Components never call `callable` directly.

**P2 [PROJECT] MUST** unit-test new pure UI logic in a `*.test.ts` file
(`make test` finds it). Width maths for QAM rows is gone with the
Steam-native rows (S14, S16): Steam's own `Field` lays out label and control,
so do not reintroduce padding budgets. If a layout really needs a measured
constant, put it in a pure module with a test.

**P9 [PROJECT] SHOULD** choose the surface by content, not by habit:
the QAM column for quick glanceable actions and settings; a wide surface
(modal or route) for lists with several actions per row, galleries, long text
and anything needing a second column. A wide surface needs its own `<style>`
copy if it renders in another document (P3) and its own entry in the [§6.6](focus.md#66-navigation-contract-testable-per-screen)
navigation contract. Do not move an existing, working QAM screen onto a wide
surface without a stated reason and owner agreement (Get Addons was moved with
the owner's agreement, 2026-10-15).

**P3 [PROJECT] MUST** put shared CSS in `src/sharedStyles.ts` and inject it as
`<style>{wowdeckSharedStyleCss()}</style>` where it is used (the QAM panel, the
Details modal). Since the Steam-native rework it holds only our own classes
(`.wowdeck-tab*`, `.wowdeck-markdown`), never overrides of Steam classes (S3). DEVICE ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)): the panel lives in the
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
[§5.3](design-language.md#53-the-steam-deck-design-language-device-derived) for sizes and layout.

## 4.3 Session / lifecycle model

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

## 4.4 Global input

- QAM tab switching has one owner. `createPanelShoulderNavigation` in
  `src/shoulderNav.ts` advances tabs from Steam's native controller input while
  the panel is mounted and the active navigation tree is the QAM. The root's
  focused button handler consumes L1/R1 to
  prevent Steam from changing QAM sections, and advances tabs itself only when
  the native bridge or tree lookup is unavailable. This also covers presses on Decky's title
  bar, outside our content (PC-10).
- DOM focus cannot decide which of those input paths owns a press. Steam can
  focus a plugin control in its gamepad tree while `document.activeElement`
  reports `BODY`. Both handlers then advance the tab if the native fallback
  uses DOM focus to decide whether the focused handler ran. The controlled
  device reproduction and regression tests are recorded in [§8.4c](device-notes.md#84c-one-bumper-press-two-input-paths-2026-11-03).
- The panel's native subscription follows its component lifetime and checks
  that its root is connected and the active tree id starts with `QuickAccess`.
  The keyboard uses a different tree while the panel stays mounted, so checking
  component lifetime alone would still switch tabs behind the keyboard. A QAM
  close or a modal unmounts the panel. Raw input remains in the
  Details modal for paging and scrolling, with its own lifetime and ownership
  rules below.
- Modals register their own handlers for their lifetime. The Details modal
  uses `galleryOpenRef` so the Details LB/RB handler is inert while the
  stacked Gallery viewer is open (mount/unmount-driven, so it is correct for
  any dismissal path).

**P8 [PROJECT] MUST** unregister every raw-input registration on unmount
(return the unregister function from `useEffect`) and, when stacking UI that
shares an input, decide which layer owns it and encode that explicitly (as
`galleryOpenRef` does).

## 4.5 Async patterns that are working

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
