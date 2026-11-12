# Device observations

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Measurements and observations from the owner's Steam Deck that rules elsewhere cite. They are background, not rules.

## 8.4a Device observations (2026-10-13)

Recorded by the agent that wrote this guide, over SSH + the Steam CEF debugger,
on the owner's own device (tag `DEVICE`, [§1.3](README.md#13-authority-markers)). Part 1 is read-only
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

## 8.4b Steam news view (reference design, 2026-10-13, read-only)

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

## 8.4b-2 News-item card styles (DEVICE, read-only CDP, 2026-10-13)

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


## 8.4c One bumper press, two input paths (2026-11-03)

DEVICE, SSH + Steam CEF with a virtual Xbox controller. The original runner
sequence reproduced an R1 skip from My Addons to Options. Normal repeats
usually passed. A controlled fixture then kept Steam gamepad focus on My Addons
while making the QAM document's `activeElement` report `BODY`, a valid platform
state ([§3.1](general.md#31-platform-model)). One R1 produced one raw press/release pair, but both handlers in
the same panel instance advanced the tab. Changing callback delays alone did
not reproduce it.

The regression tests dispatch both input paths in both orders and cover a tab
render removing the DOM-focused control. Before the fix, three tests advanced
two tabs instead of one. Native input now owns tab changes while the focused
handler only consumes the event. Nine tests pass, including title-bar input,
clamping, rapid presses, keyboard and other active trees, unmount cleanup and
missing-bridge/tree fallbacks. A real on-screen keyboard check then confirmed
that R1 leaves the plugin tab unchanged while the active tree is `virtual
keyboard`, and B returns input to the QAM.
The device fixture and normal runner sequence were repeated against the fix;
see `docs/regression-test-plan.md`, Q-1c. All temporary input observers and DOM
fixtures were removed afterward.
