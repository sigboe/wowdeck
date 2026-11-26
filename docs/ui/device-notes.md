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

## 8.4d Launching a stopped Steam shortcut (2026-11-18)

DEVICE, Steam CEF, virtual Xbox controller and SSH process observation.
Pressing the plugin's Forever button called Steam's `Apps.RunGame` with
the shortcut's decimal game ID string. The local app overview's
`display_status` was 11 before launch (ReadyToLaunch) and 4 after launch
(Running). The installed Steam client exposed
`Apps.RegisterForGameActionShowError`. The successful run produced no
launch error notice. See the [stopped-entry run](../hardware/2026-11-18-steam-stopped-entry/README.md).

The Steam client app-overview schema gives
`CAppOverview_PerClientData.display_status` the `EDisplayStatus` enum.
`Launching` is 1 and `Running` is 4. Decky's Steam client types use that
enum for `appStore.GetAppOverviewByAppID(appId).local_per_client_data`.
WoWDeck reads the field before requesting a start and again before calling
`RunGame`. Either value tells it to let the existing Steam launch proceed.

DEVICE, 2026-11-18. The combined build captured `11 → 1 → 4` on both
Steam starts. See the [combined Deck run](../hardware/2026-11-18-steam-launch-integration/README.md).

If the overview is missing, unreadable or uses an unfamiliar value, the engine
checks for the shortcut session through its own process scan. That scan cannot
see Steam's launch before there is a process to observe.
[Steam client app-overview schema](https://github.com/SteamDatabase/Protobufs/blob/89b77382edac5f747bfc196c2edf8996a7fe92bc/steam/steammessages_appoverview.proto#L6-L18)

## 8.4e Steam's Play button internals (2026-11-18)

The Play button patch (ADR 0016, #285) relies on undocumented SteamUI
properties. G13 asks for each one: what WoWDeck uses it for, how it was
verified, and what happens when a Steam update removes it.

Two sources. LIVE rows were observed on the owner's Deck on 2026-11-18 and
are listed in spec #285. INFERRED rows come only from reading Steam's
minified UI source that day (module 85273 of the Gaming Mode bundle). No
Deck run has exercised the patched button yet. The regression plan's L-13
to L-24 and L-27 rows are that run.

### What Steam does (LIVE)

- Steam shows the chevron beside Play when the streaming selector is on
  and the app's per-client data has more than one entry. In Gaming Mode the
  "Remote Play Anywhere" condition is always false.
- The "Play from…" menu lists one row per per-client entry. The local row
  reads "Play on this Steam Deck". Remote rows read "Stream from <PC>" or
  "Install on <PC>".
- Picking a row calls Steam's set-streaming-client function, and Play then
  acts on the selected client.
- With a remote client selected, Play shows the action ("Stream") and the
  PC's name as a second, smaller line. WoWDeck puts the short name there.
- `local_per_client_data.display_status` is 1 while Steam launches the
  entry and 4 while it runs (§8.4d). On a Battle.net shortcut that is
  Battle.net running, not WoW. WoWDeck hands the button back to Steam only
  while WoW runs, a stream target is selected, or Battle.net is the target
  and already open.

### What WoWDeck reads or replaces

Each row names the code that uses the property. "Steam's button" means
Steam's plain Play button and its own menu, which keep working.

| Property | What WoWDeck uses it for | Evidence | When it is missing |
| --- | --- | --- | --- |
| Wrapper: a `forwardRef` whose render source contains `navigator:` and `instance:` (`isPlayButtonWrapper`, `src/steamLaunchPatch.tsx`), exported on the webpack client, in module scope on the Vite client (§8.4f) | Finds the component that renders Steam's private Play button class | INFERRED on webpack. LIVE on Vite (2026-11-22: found by `findVar`, not by `findModuleExport`) | No patch. One warning ("no Play button wrapper"), and Steam's button |
| `ShowStreamingMenu`, `GetTextForRemoteClientAction` and `render` on the class prototype (`isPlayButtonClass`) | Tells the Play button class from anything else the wrapper returns | INFERRED | The wrapper's element passes through unpatched, without a warning, and Steam's button stays |
| mobx-react v9's class `render` installer: on first render it defines the instance's own `render` with `writable: false, configurable: false` (`hookObserverRender`, `src/observerRender.ts`) | WoWDeck replaces the prototype's render and wraps the instance's render as mobx defines it; an instance rendered earlier remounts through a new key on the wrapper's element | LIVE (2026-11-18: assigning to a mounted instance's `render` did nothing) | That button stays Steam's plain Play. A hook that throws logs one warning ("render not patchable") |
| A component above the Play button re-renders Steam's wrapper, and React remounts the button when the wrapper's element gains or loses WoWDeck's key (`remountPlayButton`, `src/steamLaunchPatch.tsx`) | Applies Options' "Choose the WoW version from Play" (#286) to an open game page: on remounts Play through the patch, off disposes the patch and remounts Steam's own | LIVE for the keyed remount on plugin load (2026-11-18). INFERRED for the unkeyed remount after disposal until the L-27 run | One warning ("no component above the Play button to remount it"). Turned on, Play stays Steam's until the page reopens. Turned off, the patched button stops reading launch state and draws Steam's tree on its next render |
| `overview.appid` on the instance's props | Decides whether the page is a linked WoW entry | INFERRED | The button stays Steam's |
| `overview.BIsSelectedClientLocal()` | Tells a stream target from this Deck: Steam's labels while streaming, and the checkmark on our row only while local | INFERRED | WoWDeck treats this Deck as selected, so its label replaces Steam's Stream label even with a stream target |
| `ShowStreamingMenu(event)` on the instance (`openMenu`) | Opens Steam's own "Play from…" menu, anchored to Play | INFERRED | One warning ("no Play from menu"). The chevron does nothing, Play still works |
| The jsx runtime module (exports `jsx`, `jsxs`, `Fragment`), called as `module.jsx(...)` at call time (`openMenu`) | For the one synchronous `ShowStreamingMenu` call, WoWDeck swaps `jsx` so Steam's menu element comes back wrapped in `WowPlayMenu` | INFERRED. On Vite (2026-11-22) one such module exists, its `jsx` is writable, and the wrapper calls `(0,Y.jsx)(…)`; the swap itself is still untested there | If the module is missing or Steam binds `jsx` at import, Steam's unchanged menu opens and one warning says so |
| `onStreamingTargetSelected` prop on the menu element (`openMenu`) | Marks the one element the swapped `jsx` wraps | INFERRED | Same as the jsx runtime: Steam's unchanged menu and one warning |
| `isLocalClient` and `client.clientid` props on each menu row (`replaceLocalPlayRow`, `src/steamPlayButton.ts`) | Finds "Play on this Steam Deck" to replace, and the local client id WoWDeck sets when a row is picked | INFERRED | One warning ("unexpected Play from menu"), and Steam's menu |
| `showThrobber` and `text` props on Play's label (`isLabel`) | Finds the label whose `remoteText` carries the short name | INFERRED | One warning ("unexpected Play button"), and Steam's button |
| `remoteText` on that label | Steam renders it in place of `text`, in the slot for the PC's name | INFERRED. The look with a stream target is LIVE | The short name doesn't show. Play still starts the chosen client |
| `overview` prop, no `onDismiss`, and an `onClick` or `onMouseUp` handler on the chevron (`isSelector`) | Finds Steam's chevron so WoWDeck can route it to its menu | INFERRED | WoWDeck adds its own chevron. If Steam's chevron is there but unrecognised, the row could show two |
| `onDismiss` on the Remote Play explainer (`isExplainer`) | Places WoWDeck's chevron before the explainer, where Steam puts its own | INFERRED | WoWDeck's chevron goes last in the row |
| `onMouseUp` or `onClick` on Play and the chevron (`handlerProps`) | Steam sets one or the other per build. WoWDeck replaces whichever Steam set | INFERRED | With neither, WoWDeck sets `onClick` |
| CSS module keys in `CLASS_KEYS` (`src/components/WowPlayButton.tsx`): `PlayButtonContainer`, `PlayButton`, `ButtonChild`, `HasRemoteText`, `ShowingStreaming`, `ButtonText`, `ButtonRemoteText`, `StreamingSelector`, `StreamingContextMenuItem`, `StreamingTargetLabel`, and optional `CheckContainer` | Finds the tree, styles Play like Steam's Stream button and styles our menu rows like Steam's. On the Vite client the keys are obfuscated, so the classes come from Decky 4's `appActionButtonClasses` (§8.4f) | LIVE (2026-11-18: our button and menu rows carry the same classes and computed styles as Steam's Stream button and "Play from" rows). On Vite (2026-11-22) Decky's table maps every key but `CheckContainer` | A required key missing: `steamPlayClasses()` returns null and the button stays Steam's, without a warning. `CheckContainer` missing: the menu check loses its box class |
| `.PlayButton svg` rule: 24 × 24 px with 16 px before the label (`TargetIcon`, `src/components/WowPlayButton.tsx`) | Sizes and spaces the target's icon like Steam's play and stream glyphs, so the icon is an `<svg>` wrapping an `<image>` | LIVE (2026-11-18, computed style on the Vampire Survivors Stream button) | An `<img>` gets no gap before the label |
| Steam's check component, source names `SVGIcon_DialogCheck` and `highlightColor` (`SteamMenuCheck`, `src/steamIcons.tsx`) | Marks the selected menu row with Steam's blue gradient check | LIVE (2026-11-18, exported, used by the "Play from" menu) | A plain check (`FaCheck`) |
| Steam's arrow component, prop `direction`, down path `M17.98 26.54` (`SteamChevronDown`, `src/steamIcons.tsx`) | Draws our chevron as Steam's filled triangle | LIVE (2026-11-18, exported, the same SVG as Steam's own chevron) | A thin chevron (`FaChevronDown`) |
| `SteamClient.Apps.SetStreamingClientForApp(appId, clientId)` (`setSteamStreamingClient`, `src/steamLaunchActions.ts`) | Points Steam's Play back at this Deck when a WoW row is picked | Steam's own rows calling it is LIVE. WoWDeck's call is INFERRED | Play keeps Steam's selected client. WoWDeck logs a warning if the call throws |

## 8.4f Two Steam clients: webpack and Vite (2026-11-22)

Steam's beta client (CLSTAMP 11255874 on the owner's Deck) is built with
Vite instead of webpack. It needs Decky 4 (4.0.0-pre1). Stable Steam keeps
the webpack client and Decky 3. WoWDeck supports both through
`src/steamLookup.ts`: each lookup asks the webpack-era way first, then the
Decky 4 way. Read on the Deck over CDP that day (LIVE), these changed:

- Components and renderers Steam used to export now often live in module
  scope only. `findModuleExport` and `findModuleByExport` miss them, and
  Decky 4's `findVar` and `findModuleScopeByVar` find them. This hit the
  Quick Access Menu renderers (the wide-QAM slide), the Play button
  wrapper, and the controller glyph settings hook.
- CSS module keys are obfuscated, so `findClassModule` by readable keys
  finds nothing. Decky 4 maps class names per Steam build into its named
  tables. `quickAccessMenuClasses` has `ViewPlaceholder`, `Expanded` and
  `QuickAccessMenuEmbeddedContainer`. `appActionButtonClasses` has the
  Play button keys except `CheckContainer`. An unmapped key reads `""`.
- Still found the old way: Steam's check and arrow icons, the controller
  button enum, the jsx runtime, `appDetailsClasses.InnerContainer`, the
  game page's `renderFunc` and `overview`, and the Play button class's
  method names.

### Controller glyphs

The webpack settings hook names `GamepadUI_KeyboardNavGlyphsDisabled`.
Its module exports the glyph and the footer legend. The legend takes
`rgButtons` and `description` and renders nothing without a description.
WoWDeck keeps using those exports on webpack.

On Vite, the scope with that hook held 21,225 bindings, including unrelated
React contexts (DEVICE, CDP, 2026-11-22, CLSTAMP 11255874). Steam's tab bars
called the same memo component twice. Each call passed `bAllowKeyboard: true`
and a `button` from the controller enum, once for `LeftBumper` and once for
`RightBumper`. WoWDeck finds the paired JSX calls in the hook's scope and
checks that their target is a memo component. The enum also has `QuickMenu`
and `HomeMenu` keys. WoWDeck shows text if the calls or enum are missing,
or if the calls identify multiple components.

After deployment, a CDP probe found two loaded 32 px images in the
WoWDeck nav bar and no text fallbacks (DEVICE, 2026-11-22).

When a lookup finds nothing on either client, its feature falls back as
its row in §8.4e or its source file's header describes. Decky's tables
follow Steam builds, so a Steam update can blank a class until Decky ships
a new table. Once Decky 3 is gone, delete the webpack half of each lookup.

## 8.4g Leaving Steam's browser (2026-11-26)

`Navigation.NavigateToExternalWeb` opens Steam's browser over the main
window and closes the QAM. B in the browser goes back to the Steam page
that was behind it. The QAM stays closed, so a plugin that opened the page
loses the player unless it opens the QAM again itself.

Steam's main window keeps its route history at
`window.SteamUIStore.WindowStore.GamepadUIMainWindowInstance.m_history`.
It is React Router's history object, and `listen` receives each location
and its action. A listener in SharedJSContext recorded one Wowhead visit
(DEVICE, CDP, 2026-11-26, the owner's Deck). Opening the page pushed
`/externalweb`, and Steam then replaced that route three times while the
page loaded. B popped back to `/library/app/<id>`, the page behind it.

`src/steamDom/externalWebReturn.ts` watches that history. The Ledger uses it
to open the QAM again on the item the player opened (S21). Without the
history object, the player opens the QAM themselves, and entering the
TradeSkillMaster destination lands on the item once.
