# Anti-patterns and lessons

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Case studies of past mistakes, reverted attempts and the anti-pattern list. Check here before you "fix" a deliberate workaround.

## Contents

- [9. Anti-patterns and lessons (case studies)](#9-anti-patterns-and-lessons-case-studies)
- [Case 1 — Radio/provider focus highlight shrinks](#case-1--radioprovider-focus-highlight-shrinks)
- [Case 2 — Top navigation: Tabs vs custom row](#case-2--top-navigation-tabs-vs-custom-row)
- [Case 3 — Four actions in a 268 px row](#case-3--four-actions-in-a-268-px-row)
- [Case 4 — Preserving the action column](#case-4--preserving-the-action-column)
- [Case 5 — Details modal and stacked Gallery](#case-5--details-modal-and-stacked-gallery)
- [Case 6 — Toast on entering My Addons](#case-6--toast-on-entering-my-addons)
- [Case 7 — Install from URL](#case-7--install-from-url)
- [Case 8 — Scroll workarounds](#case-8--scroll-workarounds)
- [Case 9 — Ignore/Unignore width and button stacking](#case-9--ignoreunignore-width-and-button-stacking)
- [Case 10 — Other platform limits recorded](#case-10--other-platform-limits-recorded)
- [Case 11 — Looking like Steam (2026-10-15)](#case-11--looking-like-steam-2026-10-15)
- [Case 12 — First device pass of the Steam-native UI (2026-10-15)](#case-12--first-device-pass-of-the-steam-native-ui-2026-10-15)
- [Reverted / superseded attempts (do not repeat blindly)](#reverted--superseded-attempts-do-not-repeat-blindly)
- [Anti-pattern list](#anti-pattern-list)

## 9. Anti-patterns and lessons (case studies)

Evidence: git history. Every "fix" below is cited by commit; claims of live
verification are those recorded by the committers, not re-observed.

## Case 1 — Radio/provider focus highlight shrinks

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

## Case 2 — Top navigation: Tabs vs custom row

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

## Case 3 — Four actions in a 268 px row

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

## Case 4 — Preserving the action column

- **Superseded 2026-10-15**: no action columns remain (S14).

- **Symptom:** Moving between rows landed on the wrong action button.
- **Root cause (LIVE via CDP, 4eb1029):** `navEntryPreferPosition` unset →
  SteamUI uses the node's last active child index.
- **Fix:** `flow-children="row"` + `navEntryPreferPosition=MAINTAIN_X` +
  identical column widths across rows.
- **Type:** Platform workaround relying on **private SteamUI internals**.
- **Lesson:** Keep such code isolated (`navEntry.ts`), make it fail soft.
- **Avoid:** Using it for rows whose columns are not width-aligned.
- **Still resolved?** At HEAD yes. DEVICE ([§8.4a](device-notes.md#84a-device-observations-2026-10-13) part 2): the action row node
  has `layout 2` / `MAINTAIN_X`, and Up/Down kept the column with synthetic
  keys on SteamOS 3.8.28 / Decky 3.2.10. Real-controller behavior not tested.
  Inconsistent `"horizontal"` usage elsewhere (F7).

## Case 5 — Details modal and stacked Gallery

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
- **Still resolved?** Yes for the current carousel design: no edge bell ([§6.4](focus.md#64-details-modal-carousel-and-scrolling-workaround-not-a-pattern)).
  Scroll/focus position is not restored after a panel remount (U-5, suspected).

## Case 6 — Toast on entering My Addons

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

## Case 7 — Install from URL

- **Symptom:** URL import mixed into the search box; modal approach loses
  state on remount.
- **Fix:** Own inline section (4de2067); structured error codes (46e71b9);
  Enter-handling change (6cd6c8d, **cause never confirmed**).
- **Type:** Local design choice driven by G4.
- **Lesson:** Prefer inline flows in the QAM. Record uncertain causes as such.

## Case 8 — Scroll workarounds

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

## Case 9 — Ignore/Unignore width and button stacking

- **Superseded 2026-10-15**: Ignore lives in the context menu.

- **Root cause:** DialogButton `min-width: 160px` (S6), not label width; and a
  label-width estimate that ignores the longest label in a column.
- **Fix:** `fitFixedColumns` over max label; zero out `min-width`.
- **Lesson:** Look at inherited component CSS before editing your own.

## Case 10 — Other platform limits recorded

- `navigator.clipboard` is unavailable, so `copyText` copies through a
  top-window textarea and `execCommand("copy")`, as Steam's UI does (G8).
  DEVICE (2026-10-31): it works from the QAM and from full-screen dialogs, with
  A and with touch.
- Anchors in injected HTML invisible to gamepad → ButtonItems (F5).
- Bare `div`/`pre` invisible to gamepad → wrap in `Focusable` (G3).
- `Spinner` and others may be missing after Steam updates (G6).

## Case 11 — Looking like Steam (2026-10-15)

- **Symptom:** Owner: the plugin looked "beautiful but off" next to Steam; the
  Restore dialog's toggle was cramped; two button rows touched.
- **Root cause:** Valve publishes no UI guideline, so the plugin had grown its
  own conventions: a global `Field` override that removed Steam's row padding,
  multi-button rows, pill tabs of our own, `em` font sizes, our own colours.
- **Fix:** Measured Steam's client (stylesheets, class maps, live computed
  styles; [§5.3](design-language.md#53-the-steam-deck-design-language-device-derived), `tools/steamui_rules.py`), compared every element (review page
  for the owner, 2026-10-15), then applied it in full (dd81038): Steam rows and
  dialog components with no overrides, one focus stop per item with A / X /
  Menu, context menus with tones, Steam tab pills with L1/R1, settings rows,
  progress bars, toasts with an icon, Get Addons as a full-screen route.
- **Type:** Design-language change, owner-approved (decisions: context menu yes,
  full-screen Get Addons yes, X = Update/Install).
- **Lesson:** Read the platform's own implementation before inventing a style;
  overriding platform classes to save space costs more than it saves.
- **Avoid:** Re-adding Steam class overrides or per-row button groups (S3, S14).
- **Still resolved?** Code only. Needs the [§8.6](verification.md#86-regression-checklist-human-on-device) device pass.

## Case 12 — First device pass of the Steam-native UI (2026-10-15)

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

## Reverted / superseded attempts (do not repeat blindly)

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

## Anti-pattern list

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
