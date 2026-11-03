# Installation Detection & Validity (SteamOS)

## Contents

- [Upstream comparison (WowUp @ 4fdae600)](#upstream-comparison-wowup--4fdae600)
- [Evidence from a real Steam Deck](#evidence-from-a-real-steam-deck)
- [Validity tiers](#validity-tiers)
- [Candidate model](#candidate-model)
- [Prefix registry](#prefix-registry)
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

with `detectionSource ∈ { custom, prefix-registry, steam-shortcut, lutris, steam, removable, known-path }`
(priority order for dedup when the same path is found twice). Sources:

- `custom` — user-configured paths (settings `customWowPaths`), incl.
  `drive_c`/`Program Files (x86)` prefix layouts
- `prefix-registry` reads Blizzard WoW paths recorded in Wine prefixes.
- `steam-shortcut` reads program and start folders from Steam shortcuts.
- `lutris` — `~/Applications`, `~/Games`, Lutris `system.yml` game_path
- `steam` — every Steam library (from `libraryfolders.vdf`) →
  `steamapps/compatdata/*/pfx/drive_c`
- `removable` — `/run/media/<user>` mounts (SD cards), one level deep
- `known-path` — reserved for future well-known locations

`detect()` = candidates filtered to `confirmed`/`likely`, converted to
installations. Detection **adds/updates, never removes** (WowUp
`importWowInstallations` semantics) — removal is an explicit user action.

## Prefix registry

The detector reads `system.reg` in each Steam compatdata `pfx`, Lutris
prefix and custom path that contains a `system.reg`. Lutris prefixes include
`battlenet`, `world-of-warcraft` and `world-of-warcraft-classic` below
`~/Games` and the configured `game_path`. It also visits bottle folders in
`~/.local/share/bottles/bottles` and
`~/.var/app/com.usebottles.bottles/data/bottles/bottles`.

The reader streams the file line by line and retains only these values:

- `InstallPath` under
  `Software\Wow6432Node\Blizzard Entertainment\World of Warcraft`
  and its subkeys, including `Beta`.
- `InstallLocation` under
  `Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\World of Warcraft*`.

It strips trailing backslashes. When an `InstallPath` ends in a known flavor
folder, it uses the parent WoW root. An `InstallLocation` already names the
root. The usual flavor search then finds every sibling, including Retail
when only another flavor has a registry entry.

Drive letters resolve through `dosdevices/<letter>:`. This supports `C:`
inside the prefix, `D:` on an SD card and `Z:` outside the prefix. Raw device
entries such as `d::` are ignored. An unmapped letter is skipped and logged.
The translated path is tried exactly first. If it is missing, each segment
uses its exact spelling if present, or its single case-insensitive match.
Missing or ambiguous segments are skipped and logged.

Registry candidates use the same validity tiers as other sources. During
deduplication, `custom` outranks `prefix-registry`, which outranks
`steam-shortcut`, `lutris`, `steam`, `removable` and `known-path`.
Existing installations keep their ids.
Stale paths and private-server roots without supported flavor folders yield
no candidates. A missing or unreadable registry cannot stop other discovery.
Diagnostics contain fixed reason codes, without paths or registry values.
The detector never reads `user.reg`, `product.db` or Battle.net account data.

Detector tests use temporary homes and real drive-mapping symlinks. The
fixtures in `backend/tests/fixtures/installation-registry/` reconstruct the
sanitized registry values quoted in spec #74, with `<user>` in place of the
username. They are not copies of device files. Synthetic variants cover
other drive letters, case matching, launcher prefixes and failure isolation.

## Steam shortcuts

The detector reads `userdata/*/config/shortcuts.vdf` for every Steam user
under `~/.local/share/Steam` and `~/.steam/steam`. A project-owned binary
KeyValues reader extracts each shortcut's unsigned `appid`, `Exe` and
`StartDir`. Nested fields such as tags do not affect discovery. Missing,
truncated and malformed files are skipped independently of other users.

Quoted absolute program and start paths become candidates. A known WoW
executable contributes its containing folder. A flavor folder or WoW root
uses the existing flavor search. No shortcut program is executed. Validity
tiers and automatic registration follow the same rules as other sources.

Before reading compatdata registries, the detector collects live shortcut
appIds across all users and installed Steam appIds from
`steamapps/appmanifest_*.acf` across all libraries. A compatdata registry is
read only when its folder's appId is in that set. Prefixes belonging to
deleted shortcuts are skipped. Existing directory probes inside compatdata
continue as before, and Lutris, Bottles and custom prefixes are unaffected.
Disabling Steam scanning disables both shortcut discovery and Steam prefixes.

Detector tests construct synthetic binary `shortcuts.vdf` fixtures in
temporary homes. They cover multiple users, both Steam locations, executable
and folder paths, validity tiers, source priority, live appIds and broken files.

## Identity

`installationIdFor(location)` = md5(lowercased, forward-slashed flavor
path) truncated to 12 hex chars — stable across re-detections and engine
restarts; the id is decoupled from the client type.
