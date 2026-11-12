# UI improvement backlog

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Known UI improvements not yet done. Check here before re-attempting a rejected approach.

## Contents

- [10. Initial UI improvement backlog](#10-initial-ui-improvement-backlog)

## 10. Initial UI improvement backlog

Not implemented in this work. Each item: **Screen**, **Issue**, **Evidence**,
**Recommendation**, **Status** (CONFIRMED = verified by reading code/types;
SUSPECTED = plausible, not observed), **Risk**, **Verification**.

**U-1 Remove has no confirmation and is icon-only.**
Screen: My Addons. Evidence: `InstalledView.tsx` calls `api.removeAddon`
directly from the trash icon, no `ConfirmModal`. Recommendation: add
`ConfirmModal` (example [§3.3](general.md#33-compilable-examples-general)) or a two-step button. Status: CONFIRMED (code);
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
Evidence: COMMIT 4eb1029 message vs 21 uses at HEAD; device check [§8.4a](device-notes.md#84a-device-observations-2026-10-13)
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
measured 7.14:1 against the QAM background on a Deck (DEVICE, [§8.4a](device-notes.md#84a-device-observations-2026-10-13)). Remaining
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

SUPERSEDED (2026-10-15): help text moved into row descriptions; [§5.3](design-language.md#53-the-steam-deck-design-language-device-derived) of this guide is the sizing rule now.

**U-11 Obsolete/stale comments and a possible simplification.**
- `navEntry.ts` and `focusScrollWatcher.ts` comments say the enum / typed
  `onGamepadFocus` are not available in `@decky/ui`; 4.12.1 types have both.
  (The runtime lookup itself still works on Decky 3.2.10, [§8.4a](device-notes.md#84a-device-observations-2026-10-13).)
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
Screen: Details modal (Description/Changelog). Evidence: DEVICE ([§8.4b](device-notes.md#84b-steam-news-view-reference-design-2026-10-13-read-only)) Steam's
own news view has the same property: a YouTube `iframe` with no `tabindex`, and
anchors in article text, are reached by touch/mouse/trackpad, not by the D-pad.
Decision (owner): accepted for now; the planned redesign does **not** add a
links `ButtonItem` row. Revisit if Valve changes its news UI. Status: KNOWN
WEAKNESS, accepted. Risk: users without a pointer cannot open links or press
play. Note: F5 describes the previous workaround (up to 6 link buttons), which
the redesign removes.
