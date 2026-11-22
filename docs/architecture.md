# Architecture

## Contents

- [Dependency direction](#dependency-direction)
- [Process model](#process-model)
- [Engine layout](#engine-layout)
- [WowUp relationship](#wowup-relationship)

## Dependency direction

```
UI (src/)                    React, @decky/ui only — no paths, no Node APIs
 ↓ @decky/api callable/emit
main.py                      thin lifecycle + JSONL bridge
recovery_updater.py           engine-independent verified recovery staging
 ↓ stdin/stdout JSONL
wowdeck engine (backend/) standalone Bun-compiled binary
 ↓
AddonService, Catalogue      changes to installed addons; read-only
 ↓                            questions to the sources (backend/src/wow)
Provider / filesystem / archive abstractions
```

Never:

```
UI → WowUp internals
UI → filesystem
engine → electron
```

## Process model

The Decky loader runs `main.py` (Python 3.13 on current SteamOS). The plugin
spawns the engine built for its machine, `bin/wowdeck-<uname -m>` (today only
`bin/wowdeck-x86_64`), a self-contained executable produced by
`bun build --compile` (SteamOS ships no Node/Bun runtime, so the engine must
be self-contained; glibc x86_64 target matches SteamOS). The plugin log names
the machine and the engine it chose.

```
Decky React plugin
      │ decky RPC (@decky/api)
      ▼
main.py ── spawn/supervise ──► bin/wowdeck-x86_64
      │        JSONL stdin/stdout
      ▼
addon engine (installations, scanner, TOC, providers, downloads, installer)
```

Protocol: newline-delimited JSON requests/responses plus engine-initiated
events (see `backend/src/api/contracts.ts`). The frontend reaches both
processes through one engine link (`src/engineLink.ts`). It calls every engine
method through the typed `rpc(method, params)`, which `main.py` forwards
unchanged. `main.py` answers a few methods itself (`get_status`,
`read_text_file`, `save_text_file`). The contract declares them in
`BridgeMethodMap`, and the frontend calls them through the typed
`bridge(method, ...args)`. Engine events reach the frontend as `backend_event`
via `decky.emit`, declared in `BridgeEventMap`. `tools/test_main_bridge.py`
fails when `main.py`'s methods or events stop matching the contract.

The plugin connects Decky's adapter (`src/services/backend.ts`) once, when it
loads. Tests connect the typed fake (`src/testSupport/fakeEngine.ts`), which
answers each call at once or holds it until the test answers. Stores take
`engine.rpc` when they are built and register for events with the link's one
router, so an event reaches its store while the panel is closed. Components
read stores and never subscribe to events.

## Engine layout

```
backend/src/
├── main.ts              entry point: maps the environment to the engine config, runs it
├── engine.ts            assembly: builds the services, registers the handlers, and
│                        runs startup (detect, then WTF recovery, then serve);
│                        tests build the same engine in-process
├── api/
│   ├── contracts.ts     wire protocol (MethodMap, EventMap, BridgeMethodMap,
│   │                    BridgeEventMap) — single source of truth
│   ├── handlers/        RPC handlers per area (system, installations, addons,
│   │                    providers, settings, wtf, notifications, about) + deps.ts;
│   │                    index.ts merges them into one table that must cover
│   │                    every MethodMap entry, and its keys are the method list
│   ├── gameTypes.ts     game types offered for manual installs, and their labels
│   ├── providers.ts     provider ids and display names
│   ├── version.ts       WoWDeck's version forms, their order and which build
│   │                    Stable and Beta offer; the engine, the frontend and the
│   │                    release tools in tools/ share it
│   └── version-table.json  valid and invalid versions; every version reader
│                        and writer, Python included, tests against it
├── bridge/jsonl.ts      JSONL RPC dispatcher
├── diagnostics/         recent-errors buffer for Diagnostics
└── wow/                 project-owned addon domain (extracted from WowUp)
    ├── models.ts, types.ts, errors.ts
    ├── fs/              safe filesystem primitives
    ├── installation/    the installation list: detection, manual adds, selection
    ├── addons/          AddonService, AddonUpdates, addon records, scanner,
    │                    installer, rollback cache, portability, wire mappers
    ├── catalogue/       Catalogue: search, Latest/Popular, details, finding sources
    ├── toc/             TOC parser
    ├── providers/       provider abstraction, registry + implementations
    ├── downloads/       download service: one folder per file
    ├── archives/        release archives, safe extraction, Addon folder check,
    │                    TOC metadata
    ├── net/             HTTP client
    ├── storage/         state file and the settings rules table
    ├── notifications/   update toast gate, WowUp companion data, check cadence
    ├── wtf/             WTF backups: zip writer/reader, jobs, game guard
    └── utils/           game type, game version, TOC and string helpers,
                         SingleFlight
```

The installation list is read only through `InstallationService`
(`installation/`); other modules, the TradeSkillMaster data included, get
it from there. Every method that acts on one installation takes its
`installationId`, and the frontend sends the one it means: an addon's own
installation, or the active one for Get Addons. A missing id is refused,
never read as the selected installation.

Handlers only map params to calls. A reaction to a change is a subscription,
wired in `engine.ts`: a settings write (`store.settingsListeners`) refreshes
provider defaults and rechecks a new CurseForge key, a source turned on or
off (`registry.enabledListeners`) regenerates the companion data, and a
detection or manual add (`installationService.foundListeners`) starts an
update check. A provider that needs more on the way on or off overrides
`onEnable` and `onDisable`, which the registry runs on every path: the
TradeSkillMaster source resumes or pauses its session there, whether the
Sources toggle or a sign-in flipped it.

Addon updates live in one module, `AddonUpdates` (`addons/`): the update
check, which addons have an update on offer, Update all, the update summary
and automatic updates. The toast, the companion data and the handlers ask
it, never `AddonService`. Checks share one pass: a check that starts while
another runs joins it, then checks only the installations that pass left
out. `AddonService` keeps the gate turns the check runs: the scan, the
provider metadata sync and updating one addon. `SingleFlight` (`utils/`)
is the engine's one guard for joining a run already in flight.

Addon records are read and written only through `AddonRecords`
(`store.addons`). A record read from it is read-only (a deep `Readonly`
type); a change is a patch, persisted before the call returns, and a patch
merges into the stored record, so two writers never overwrite each other's
fields.

The Addon view (`addons/AddonView.ts`) builds each addon row from the
installation's records and one AddOns scan. It reads the main folder's TOC,
works out who needs whom (`libraries.ts`) and picks the game version the
installation runs. `addons.list` returns its rows. Install, update, Roll
back and every other addon method return the changed addon's row from it at
the end of their gate turn, so the answer equals that addon's list row and
the frontend puts it in place of the row unchanged.

A release archive (`archives/ReleaseArchive.ts`) is one downloaded archive,
or one copy of a picked file. It reads the hash, the inspection and the
record the archive installs into. The preview of a picked file, the archive
match before an install and the installer each acquire one, and the code
that acquires it disposes of it, whether the call succeeds or fails. The
preview and the install read the same match, so the Install label says what
Install does. Each archive has its own folder, so a preview never touches
the file of an install running beside it.

Install and update change folders and the record through one addon
transaction (`addons/AddonTransaction.ts`, ADR 0006). The installer
stages the release's archive, and the transaction does the rest. It
stores a marker with content evidence before the first live change, moves
folders with renames inside `AddOns/.wowdeck/tx-<id>/`, and commits the
record and its commit evidence in one write. If that fails, it moves
everything back. A failed install, update or channel switch leaves the
folders and the record as they were. Tests fail the transaction's steps by
name through `fs/StageFs.ts`.

Every record change runs in `AddonService`'s gate (`addons/AddonGate.ts`),
one at a time: the gate holds the writable `AddonRecords`, and the service
and `InstallationService` only see the lookups and the settings. Ignore,
Pause, an import's library flags and removing an installation wait for a
running install instead of racing it, and Update all and automatic updates
check each addon again when its turn comes.

A gate turn names its installation, or the addon it changes, and the gate
applies the recovery guard (ADR 0006) before the turn runs. No entry point
calls the guard itself. The list opts out with a read-only answer for a
recovery-required installation, and Retry and Verify recovery have their
own unguarded turn. A step later in the same turn, such as a dependency or
a library, is refused by the transaction itself. A table test runs every
mutating entry point on a recovery-required installation, and a second test
fails when a new `AddonService` method is in neither that table nor the
allowed list.

`engine.ts` builds `InstallationService` and hands it to `AddonService`.
Removing an installation calls back into the service's gate. Removing
TradeSkillMaster's addons follows TradeSkillMaster's own folder rules
(`tsm/TradeSkillMasterFolders.ts`) and runs through `AddonService.removeEach`,
so the checks and the removals share one turn.

The frontend's Steam DOM reach (QAM widening, QAM visibility, the home
badge, the Details modal chrome) lives in `src/steamDom/`, one file per hack,
each stating what it depends on, how it fails and its kill switch.

Settings backups have one frontend owner, `src/wtfLifecycle.ts` (ADR 0007).
It holds the backup lists and copy sources that Options, Manage backups and
Settings copy show, the actions that change them, and the one operation
slot. Lists are per-installation resources from `src/keyedResource.ts`,
which handles viewers, shared polling and stale answers.
Components read every engine value this way (`src/useResource.ts`):
previous versions' space, the TradeSkillMaster reads (`src/tsmReads.ts`),
recovery details, CurseForge's access status and the import preview each
have one resource, and none keeps a request counter of its own.
`src/wtfAffected.ts` decides which lists each change makes stale.
`src/wtfSession.ts` connects the lifecycle to the engine and gives views
their hooks. The lifecycle reads time through `src/clock.ts`, so tests drive
it through the typed RPC with a manual clock and a deferred transport
(`src/testSupport/`).

TradeSkillMaster has one frontend module, `createTsmModule` in
`src/tsmReads.ts`, constructed with the typed RPC and clock. Options, the
nav badge, Get Addons and the sign-in browser share its status resource and
one poll loop. The browser remains a viewer while the QAM is closed.
The module reloads sources on status transitions and invalidates status,
account, destination and cleanup reads on `tradeskillmaster.changed`.
The Manage dialog reads the same account resource as the destination.
TradeSkillMaster installs and removals use the addon session's operation
guard, so installation switching waits and recovery answers refresh the
session's recovery state.

## WowUp relationship

`wowup/` is a pinned WowUp checkout used as a read-only reference during
development; it is untracked and `make wowup` recreates it at the pinned
commit. Code is *extracted* into project-owned modules under
`backend/src/wow/` with provenance headers and entries in
`docs/wowup-provenance.md`. The finished plugin has no build- or runtime
dependency on the checkout: a distribution zip contains only `dist/`,
`bin/`, `main.py`, `plugin.json` and assets.
