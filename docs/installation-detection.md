# Installation Detection & Validity (SteamOS)

## Contents

- [Upstream comparison (WowUp @ 4fdae600)](#upstream-comparison-wowup--4fdae600)
- [Evidence from a real Steam Deck](#evidence-from-a-real-steam-deck)
- [Validity tiers](#validity-tiers)
- [Candidate model](#candidate-model)
- [Prefix registry](#prefix-registry)
- [Steam shortcuts](#steam-shortcuts)
- [Automatic Steam links](#automatic-steam-links)
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

Client executable names are matched without case sensitivity, including
`Wow-ARM64.exe`; unrelated executables (`Agent.exe`, …) do not confirm anything.
The client whitelist in `WowExecutables.ts` starts with WowUp's (`warcraft-platform.win.ts:15-45`), covering
`Wow.exe`, `WowT.exe`, `WowB.exe`, `WowClassic.exe`, `WowClassicT.exe`,
`WowClassicB.exe` and the `-arm64` variants. We also accept `Wow-ARM64.exe`,
as shipped on DroidDeck. Tests cover specific known names, unrelated
executables and the no-exe case.

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
KeyValues reader extracts each shortcut's unsigned `appid`, `Exe`,
`StartDir` and `LaunchOptions`. Nested fields such as tags do not affect discovery. Missing,
truncated and malformed files are skipped independently of other users.

Quoted absolute program and start paths become candidates. A known WoW
executable contributes its containing folder. A flavor folder or WoW root
uses the existing flavor search. No shortcut program is executed. Validity
tiers and automatic registration follow the same rules as other sources.

Detection runs in this order:

1. Registry discovery across every prefix in known Steam libraries, Lutris
   and Bottles locations, plus explicit custom and shortcut prefix references.
2. Non-Steam shortcuts pointing at game clients, supported launchers or WoW
   folders. Registry results retain priority when both find the same install.
3. Known game-folder locations and removable media, only when the first two
   passes and explicit custom paths find no confirmed or likely installation.

Steam prefixes do not need to match a live shortcut appId. Shared and named
prefixes, including symlinks, are searched too. Physical prefixes are read
once. System grep first returns filenames containing `World of Warcraft`;
only those registries reach the existing section parser and drive mapping.
Arguments are batched, output is NUL-delimited, and a missing or failed grep
falls back to Bun. At most four registries are parsed concurrently. Registry
values and personal paths are never logged.

Literal leading `STEAM_COMPAT_DATA_PATH` and `WINEPREFIX` assignments locate
prefixes outside Steam's libraries. Quoted values and `env` are supported;
shell expressions are never evaluated. The former names the parent of
`pfx`, the latter the prefix itself. Executable and start paths inside `pfx`
also locate it. Disabling Steam scanning disables Steam shortcut and prefix
discovery, while Lutris, Bottles and custom paths remain available.

Supported launchers are `World of Warcraft Launcher.exe`, `Battle.net.exe`
and `Battle.net Launcher.exe`, observed on the reference Deck. They help
locate installs but never confirm one. The running-game guard uses only
client executable names, so a running Battle.net does not count as WoW.

## Automatic Steam links

Registry and shortcut evidence links every matching WoW or Battle.net Steam
entry to the discovered installations. A shared Battle.net prefix does not
link shortcuts explicitly launching another Blizzard product. Wrappers with
an explicit WoW product command and prefix can link through registry evidence.
Executable ancestry is a discovery hint; without an explicit environment
override, Steam's appId prefix determines the runtime association. A known-folder
fallback alone never links an unrelated Steam entry. Each scan refreshes
these links and removes stale ones without deleting installations.

Discovery runs at engine startup and through Find WoW. The game-page section
and home-tile badge use all detected links, alongside the existing manual
picker. Options can disable automatic linking. Linking never changes
`autoUpdate`, `steamAutoCheck` or `steamBadge`; automatic addon updates stay
opt-in, and existing user choices remain in effect.

Detector tests construct synthetic binary `shortcuts.vdf` fixtures in
temporary homes. They cover multiple users, both Steam locations, executable
and folder paths, validity tiers, source priority, live appIds, shared and
external prefixes, literal overrides, symlinks and broken files.

## Identity

`installationIdFor(location)` = md5(lowercased, forward-slashed flavor
path) truncated to 12 hex chars — stable across re-detections and engine
restarts; the id is decoupled from the client type.
