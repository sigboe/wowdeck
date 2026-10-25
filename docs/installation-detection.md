# Installation Detection & Validity (SteamOS)

## Contents

- [Upstream comparison (WowUp @ 4fdae600)](#upstream-comparison-wowup--4fdae600)
- [Evidence from a real Steam Deck](#evidence-from-a-real-steam-deck)
- [Validity tiers](#validity-tiers)
- [Candidate model](#candidate-model)
- [Identity](#identity)

How the engine decides that a directory is a usable World of Warcraft
installation. Implementation:
`backend/src/wow/installation/InstallationDetector.ts`.

## Upstream comparison (WowUp @ 4fdae600)

WowUp only supports installations it finds via the **Battle.net Agent
`product.db`** protobuf (Windows/macOS) or **Lutris' `system.yml`
`game_path`** (Linux). A product entry is considered valid when its
executable resolves (`warcraft.service.ts` `isWowApplication`); the
executable whitelist lives in `warcraft-platform.win.ts:15-45` (the Linux
platform reuses the same names because the Windows client runs unchanged
under Wine/Proton). WowUp never reads `.build.info`. WowUp's Linux support
knows nothing about SteamOS/Proton compatdata — that probing is ours.

Manual add in WowUp = pick the executable via a file dialog filtered to
`.exe` (options-wow-section.component.ts:56-75); there is no
directory-based manual add.

## Evidence from a real Steam Deck

`~/Applications/World of Warcraft/` (Lutris-style layout):

| flavor | executables | .build.info | Data/ | Interface/ | WTF/ | in use |
|---|---|---|---|---|---|---|
| `_retail_` | none | no | no | yes | no | yes (addons present) |
| `_classic_era_` | `WowClassic.exe`, `BlizzardError.exe` | no | no | yes | yes | yes (101 addons) |
| `_classic_beta_` | `WowB.exe`, `BlizzardError.exe` | no | no | yes | yes | yes |

Key observations:

1. **Requiring an executable is not safe**: the actively used Retail
   flavor has no `.exe` and no `Data/` — only `Interface/`. A rule copied
   from WowUp's Windows implementation would drop it.
2. **`.build.info` is absent** in real Lutris-installed flavors here, so it
   cannot be required either (WowUp agrees: it never uses the file).
3. `WowB.exe` (not `WowClassicB.exe`) is what a `_classic_beta_` flavor
   actually contains — the client type must come from the **folder name**
   (both we and WowUp resolve folder names, not executable names, for
   non-retail disambiguation).

## Validity tiers

`classifyFlavorDir` assigns exactly one tier, strongest evidence first:

| tier | rule | meaning | auto-registered |
|---|---|---|---|
| `confirmed` | any executable from the WowUp whitelist is present | definitely a game install | yes |
| `likely` | `.build.info` present **or** `Data/` directory present | Battle.net-managed (streamed/partial) | yes |
| `addon-data` | only user data (`Interface/`, `WTF/`, DLLs, `.mfil`, …) | may be a streamed install whose data lives elsewhere, **or** leftovers of an uninstalled game | no — user must confirm |
| `invalid` | nothing recognizable | not an installation | no |

Rationale for the `addon-data` tier: it is the only honest answer for a
directory like a real device's `_retail_` flavor above — we cannot
distinguish "real streamed install" from "old addon leftovers" from disk
contents alone, so we surface it as a candidate and let the user decide
(manual add flow). A leftover-files directory must never become a
*selectable* installation automatically.

Executable names are matched exactly (case-sensitive, as Battle.net ships
them); unrelated executables (`Agent.exe`, …) do not confirm anything.
The whitelist is WowUp's (`warcraft-platform.win.ts:15-45`), covering
`Wow.exe`, `WowT.exe`, `WowB.exe`, `WowClassic.exe`, `WowClassicT.exe`,
`WowClassicB.exe` and the `-arm64` variants — matching WowUp's own
`_validWoWExecutable` model (specific known names, never "any .exe"),
with tests for each name, for unrelated executables and for the no-exe
case.

## Candidate model

`detectCandidates()` returns `InstallationCandidate` records:

```
{ location, clientType, validity, detectionSource }
```

with `detectionSource ∈ { custom, lutris, steam, removable, known-path }`
(priority order for dedup when the same path is found twice). Sources:

- `custom` — user-configured paths (settings `customWowPaths`), incl.
  `drive_c`/`Program Files (x86)` prefix layouts
- `lutris` — `~/Applications`, `~/Games`, Lutris `system.yml` game_path
- `steam` — every Steam library (from `libraryfolders.vdf`) →
  `steamapps/compatdata/*/pfx/drive_c`
- `removable` — `/run/media/<user>` mounts (SD cards), one level deep
- `known-path` — reserved for future well-known locations

`detect()` = candidates filtered to `confirmed`/`likely`, converted to
installations. Detection **adds/updates, never removes** (WowUp
`importWowInstallations` semantics) — removal is an explicit user action.

## Identity

`installationIdFor(location)` = md5(lowercased, forward-slashed flavor
path) truncated to 12 hex chars — stable across re-detections and engine
restarts; the id is decoupled from the client type.
