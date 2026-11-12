# Shared components and styling

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

The component inventory and rules S1–S7 on reusing and styling it. The Steam design language is in [design-language.md](design-language.md), and the recipes are in [recipes.md](recipes.md).

## 5. Shared components and styling [PROJECT]

## 5.1 Inventory

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
| `Warning` / `WarningLine` (`components/Warning.tsx`) | A warning inside a row's description: amber icon, heading in primary text, indented secondary lines | MUST use for every warning on a card or row (S38, R9) |
| `steamTheme.ts` | Steam colour and type tokens | MUST use instead of literals (S20) |
| `pluginToast` | Toast with the plugin icon | MUST use instead of `toaster.toast` (S17) |
| `addonRow.ts`, `loadMore.ts`, `addonActions.ts` | Pure row text and actions, paging, every addon action with its toast | Extend these; keep them tested |
| `scrollBuffer.ts`, `useScrollBuffer` / `ScrollBuffer`, `SCROLL_BUFFER_CSS` | Valve's 250/60 px scroll buffer below floating bars | MUST wrap every scrolling view: QAM root, modal bodies, page tabs (S21) |
| `valveScroll.ts`, `registerDirectScroll` | Valve's gamepad scrolling (docs/valve-bpm-scrolling.md): 30 % viewport per press as a 300–500 ms sine tween, linear retarget on interrupt, 400→50 ms repeat staircase, scroll-target composition | MUST use wherever we own the D-pad scrolling ourselves (not the QAM lists, whose scrolling stays Steam's, S21) |

## 5.2 Rules

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
