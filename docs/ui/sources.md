# Sources, version assumptions and maintenance

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Reference implementations, licensing posture, how to maintain this guide, and its known gaps.

## 11. Sources, version assumptions and maintenance

## 11.1 Comparison of reference implementations

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

## 11.2 Non-UI note: Decky plugin store policy

OFFICIAL (Decky wiki "submitting plugins"): the plugin-store PR template
requires a checkbox that generative AI was not used to write a majority of the
code. If this plugin is ever submitted to the store, discuss this with the
maintainer; it is unrelated to UI quality.

## 11.3 Licensing posture

Other plugins' licenses are mixed (GPL-3.0, BSD-3-Clause, or unclear).
Treat the table above as a description of ideas. Do not paste their code.

## 11.4 Maintenance procedure

Update this guide when:

- `@decky/ui`, `@decky/api`, Decky Loader or SteamOS/Steam client versions change.
- A UI commit adds a workaround or changes a rule here.
- A backlog item is implemented, rejected or disproved.

Procedure:

1. Re-run T1–T3 ([§8.1](verification.md#81-tooling-that-exists-verified-by-running)) and correct [§8.1](verification.md#81-tooling-that-exists-verified-by-running) where the tooling changed.
2. Re-check version-sensitive claims against the installed types:
   `Focusable`/`FooterLegend` props, `NavEntryPositionPreferences`,
   `ConfirmModal`, `useQuickAccessVisible`, deprecations.
3. For each LIVE-tagged claim, either have a human re-confirm on hardware and
   add the date/device, or leave it labelled as historical.
4. Move resolved backlog items to a "Resolved" note with the commit hash.
5. Never delete a case study; mark it "superseded" with the new commit.
6. When you add, change or supersede a rule, update its row in the rule
   index in [README.md](README.md#rule-index), and the task router when a new
   kind of change needs it. A MUST rule that caused rework belongs in
   `src/AGENTS.md` too.

Staleness signals: a `docs/` claim mentions a file that moved (e.g. CSS in
`index.tsx`); a commit message says "confirmed" without naming a device; a
`@decky/ui` major version bump.

## 11.5 Known gaps in this guide

- No real-controller verification: the only device contact was the owner-
  authorized SSH + CEF session in [§8.4a](device-notes.md#84a-device-observations-2026-10-13) (reads plus synthetic keyboard events).
  No visual, audio or physical-gamepad behavior was tested.
- Device observations ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)) are one LCD Deck, one session.
- Official docs/wiki were read through a subagent using raw GitHub/npm
  sources; the wiki may have changed.
- `AddonPortabilityModal.tsx` and `markdown.ts` were only skimmed.
- No screenshot tooling exists, so layout claims rely on recorded
  measurements ([§5.3](design-language.md#53-the-steam-deck-design-language-device-derived) and [§8.4a](device-notes.md#84a-device-observations-2026-10-13) of this guide).
- Whether Steam OLED, other scale factors or Desktop Mode differ is unknown.
