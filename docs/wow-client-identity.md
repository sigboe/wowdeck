# WoW client/installation identity

## Contents

- [1. The canonical client-type list](#1-the-canonical-client-type-list)
  - [Where each column lives](#where-each-column-lives)
  - [§4 — deliberate gaps](#4--deliberate-gaps)
- [2. The `.build.info` / `.flavor.info` bug (found during this investigation)](#2-the-buildinfo--flavorinfo-bug-found-during-this-investigation)
- [3. P0-1: CurseForge category mapping (the "WoW Forever" bug)](#3-p0-1-curseforge-category-mapping-the-wow-forever-bug)
  - [Reproduction](#reproduction)
  - [Root cause](#root-cause)
  - [Classification](#classification)
  - [Fix](#fix)
  - [Re-verification procedure (for the next time this goes stale)](#re-verification-procedure-for-the-next-time-this-goes-stale)
  - [Tests](#tests)
- [4. P0-2 audit: no display strings used as identity](#4-p0-2-audit-no-display-strings-used-as-identity)

Full trace of `filesystem detection` → `installation type` → `WoW
client/flavor` → `provider game/category` → `CurseForge API parameters` →
`search results`.

## 1. The canonical client-type list

Source of truth: `backend/src/wow/types.ts`, `WowClientType` enum (numeric,
hand-written, extracted from WowUp's `WowClientType` — see
`docs/wowup-provenance.md`). **This is the only internal identity.** Every
lifecycle path (search/install/update/scan) takes the full `WowInstallation`
object, which carries `clientType: WowClientType`; nothing downstream
compares display strings.

| `WowClientType` | Folder (filesystem detection) | Display label (`getClientTypeLabel`) | Wire `GameType` (manual add / diagnostics) |
| --- | --- | --- | --- |
| `Retail` | `_retail_` | "Retail" | `retail` |
| `RetailPtr` | `_ptr_` | "Retail PTR" | `ptr` |
| `RetailXPtr` | `_xptr_` | "Retail XPTR" | *(not exposed — see §4)* |
| `Beta` | `_beta_` | "Retail Beta" | `beta` |
| `Classic` | `_classic_` | "Classic" | `classic` |
| `ClassicPtr` | `_classic_ptr_` | "Classic PTR" | *(not exposed)* |
| `ClassicBeta` | `_classic_beta_` | "Classic Beta" | `classic_beta` |
| `ClassicEra` | `_classic_era_` | "Classic Era" | `classic_era` |
| `ClassicEraPtr` | `_classic_era_ptr_` | "Classic Era PTR" | *(not exposed)* |
| `Anniversary` | `_anniversary_` | "Anniversary" | *(not exposed)* |
| `None` | *(no match)* | "Unknown" | — |

### Where each column lives

- **Folder → `WowClientType`**: `backend/src/wow/toc/toc.ts`,
  `getClientTypeForFolderName` — a pure switch on the literal folder name,
  hardcoded (ported from WowUp's own folder constants). This is **filesystem
  detection only**; it has no knowledge of providers or CurseForge.
- **Display label**: `backend/src/wow/utils/gametype.ts`,
  `getClientTypeLabel` — hardcoded, one function, single source of truth
  on the backend.
- **Wire `GameType` (manual-add dropdown)**: `backend/src/api/contracts.ts`
  (`export type GameType = "retail" | "classic" | "classic_era" |
  "classic_beta" | "ptr" | "beta"`), converted to `WowClientType` by
  `getClientTypeForGameType` (same file as the label). The frontend mirrors
  this list by hand in `src/components/SettingsView.tsx`
  (`CLIENT_TYPE_OPTIONS`) because the JSONL bridge means frontend and
  backend TypeScript can't share a module — this is a **documented,
  deliberate duplication**, not drift; keep both lists in sync by hand when
  either changes.
- **Automatic detection**: `backend/src/wow/installation/InstallationDetector.ts`
  walks candidate WoW roots (Lutris, Steam Proton prefixes, removable
  media, custom paths), finds flavor dirs by name, and classifies each by
  evidence tier (`confirmed` / `likely` / `addon-data` / `invalid` — see
  `docs/installation-detection.md`). Only `confirmed`/`likely` auto-register.
- **Manual selection**: Settings → Add Installation. The user either points
  at a real flavor dir (client type inferred from the folder name, "Auto")
  or a non-standard path with an explicit `GameType` from the dropdown
  above (`InstallationService.addManual`, `backend/src/main.ts`
  `installations.add`).

### §4 — deliberate gaps

`GameType` (and the manual-add dropdown) intentionally excludes `RetailXPtr`,
`ClassicPtr`, `ClassicEraPtr`, `Anniversary` — PTR/anniversary installs are
rare enough on Steam Deck that we didn't wire a manual-add path for them.
Automatic detection still recognizes their folders correctly (full
`WOW_FLAVOR_FOLDERS` list in `toc.ts`); only the manual-override UI is
narrower than the internal enum. This is a scope choice, not a bug — revisit
if a tester reports a PTR-only installation that needs manual add.

## 2. The `.build.info` / `.flavor.info` bug (found during this investigation)

Original assumption (wrong): `.build.info` lives *inside* each flavor
directory, comma-delimited. **Verified against the real reference Deck**:

```
World of Warcraft/
  .build.info          <- shared, ONE level above every flavor dir
  _classic_era_/
    .flavor.info       <- per-flavor, says which .build.info row is "mine"
  _classic_beta_/
    .flavor.info
```

`.build.info` is pipe-delimited (`|`), with a header row whose cells are
`Name!TYPE:len` (only the part before `!` is the real column name):

```
Branch!STRING:0|Active!DEC:1|...|Version!STRING:0|...|Product!STRING:0
eu|1|...|1.15.9.70003||wow_classic_era
us|1|...|1.60.1.70245||wow_classic_beta
```

`.flavor.info` is two lines: a header (`Product Flavor!STRING:0`) and the
product code (e.g. `wow_classic_beta`).

This means the original `classifyFlavorDir`/`readFlavorVersion` never
actually found `.build.info` (wrong path, wrong delimiter) — the `"likely"`
tier was silently dead code, and `WowInstallation.version` was always
`undefined` for every real install. Fixed in
`backend/src/wow/installation/InstallationDetector.ts`
(`parseBuildInfo`, `readFlavorBuildInfo`, `readFlavorVersion`): read the
parent dir, parse pipe-delimited rows, match by Product via `.flavor.info`.
Tests: `installation-detector.test.ts`, `installation-validity.test.ts`,
`installation-matrix.test.ts`, `installation-selection.test.ts`, and the
integration suites now all build fixtures in the real layout.

Upstream WowUp does **not** parse `.build.info` at all (it decodes
Battle.net's `.product.db` protobuf instead — see
`docs/installation-detection.md`); this was our own addition, so this was a
pure implementation bug, not a porting error.

## 3. P0-1: CurseForge category mapping (the "WoW Forever" bug)

### Reproduction

On the reference Deck, `_classic_beta_` has no game executable (only the
crash-reporter stub) but is actively managed by Battle.net
(`.build.info` row: `Product=wow_classic_beta`, `Version=1.60.1.70245`).
Selecting it and searching CurseForge returned results scoped to the wrong
game version.

### Root cause

`backend/src/wow/providers/curseforge/CurseForgeProvider.ts`'s
`GAME_TYPE_LISTS` (ported verbatim from WowUp's `curse-addon-provider.ts`)
mapped `WowClientType.ClassicBeta` to CurseForge's "WoW Mists of Pandaria
Classic" category (typeId `79434`), alongside `Classic`/`ClassicPtr`.

Verified live against `GET https://api.curseforge.com/v1/games/1/version-types`
(2026-10-08, response saved out-of-band — **not** committed, since every
provider's live response is incidental test data, not fixture material we
want to maintain):

```
79434  WoW Mists of Pandaria Classic   wow-mists-of-pandaria-classic
67408  WoW Classic                     wow-classic
517    WoW Retail                      game
77522  WoW Cataclysm Classic           wow-cataclysm-classic
73713  WoW Wrath of the Lich King Classic  wow-wrath-classic
81212  WoW Wrath Titan Reforged        wow-wrath-titan
73246  WoW Burning Crusade Classic     wow-burning-crusade-classic
88568  WoW Forever                     wow-forever
```

CurseForge has a **distinct "WoW Forever" category (88568)** that didn't
exist (or wasn't noticed) when the upstream table was last written. Mists
Classic has already shipped and is the correct category for the plain
`Classic` flavor; the beta slot has moved on to test something else
entirely — version `1.60.1` doesn't correspond to Mists (5.4.8-era) at all.
"World of Warcraft Forever" — the in-game name of the current Classic
Beta build — matches this new category name exactly.

### Classification

This is a **provider mapping bug inherited from upstream** (upstream has the
identical table, verified in `wowup/wowup-electron/src/app/addon-providers/curse-addon-provider.ts`),
not our porting error, not installation-detection, not CurseForge
misbehaving. It is also an inherently **recurring** staleness mode: Blizzard
reuses the `_classic_beta_` slot for whatever Classic-flavor beta is
*currently* running (today: whatever "WoW Forever" turns out to be; next
year: something else), and no static table can stay correct forever. The
same risk exists for the `Anniversary → wow-burning-crusade-classic` entry,
which we did **not** change — we have no device evidence either way for
that mapping (no Anniversary install to test against), and an upstream
bug should never be "fixed" without evidence it's actually wrong here
too, so it was left alone and is recorded as a known re-verification
candidate.

### Fix

`GAME_TYPE_LISTS` now has a dedicated entry:
`{ flavor: "wow-forever", typeId: 88568, matches: [WowClientType.ClassicBeta] }`,
removed from the Mists entry. `Classic`/`ClassicPtr` keep the Mists mapping
(correct — that's the released, non-beta track). See the code comment at
the top of `GAME_TYPE_LISTS` for the full citation.

### Re-verification procedure (for the next time this goes stale)

1. `GET https://api.curseforge.com/v1/games/1/version-types` with a valid
   key (never commit the response or the key).
2. Read `.build.info` in the WoW root (or ask a tester) for the
   `_classic_beta_` row's `Version`.
3. Cross-reference against CurseForge's category names/known WoW patch
   ranges to find which category it now represents.
4. Update the `wow-forever`-equivalent entry in `GAME_TYPE_LISTS`, and
   update `gameVersionTypeIdFor` test expectations in
   `backend/tests/curseforge-provider.test.ts`.

### Tests

`backend/tests/curseforge-provider.test.ts`: `gameVersionTypeIdFor` is
asserted for every matched `WowClientType`, plus a dedicated assertion that
`ClassicBeta` maps to `88568` and is distinct from `Classic`'s `79434`.

## 4. P0-2 audit: no display strings used as identity

Audited every consumer of the selected installation
(`src/index.tsx`, `AddonService.search/scan/refresh/install/updateAddon`,
`CurseForgeProvider`, `WowUpHubProvider`, `TukUiAddonProvider`): all take
the full `WowInstallation` object or its `clientType`/`id`, never a label
string. One naming footgun found and fixed: `AddonService.installationSummary()`
(diagnostics only) had a field literally named `gameType` holding a
*display label* ("Classic Beta") rather than the wire `GameType` identity —
harmless today (diagnostics text is never parsed back), but a landmine for
the next change. Renamed to `clientLabel` throughout the stack
(`contracts.ts`, `AddonService.ts`, `src/types.ts`, `SettingsView.tsx`).
