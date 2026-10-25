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
 ↓ stdin/stdout JSONL
wowdeck engine (backend/) standalone Bun-compiled binary
 ↓
AddonService (backend/src/wow)
 ↓
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
spawns `bin/wowdeck`, a self-contained executable produced by
`bun build --compile` (SteamOS ships no Node/Bun runtime, so the engine must
be self-contained; glibc x86_64 target matches SteamOS).

```
Decky React plugin
      │ decky RPC (@decky/api)
      ▼
main.py ── spawn/supervise ──► bin/wowdeck
      │        JSONL stdin/stdout
      ▼
addon engine (installations, scanner, TOC, providers, downloads, installer)
```

Protocol: newline-delimited JSON requests/responses plus engine-initiated
events (see `backend/src/api/contracts.ts`). The frontend calls every engine
method through one typed `rpc(method, params)` (`src/services/backend.ts`),
which `main.py` forwards unchanged; `main.py` keeps only its own methods
(`get_status`, clipboard, text files). Events are relayed to the frontend as
`backend_event` via `decky.emit`.

## Engine layout

```
backend/src/
├── main.ts              composition root: builds the services, registers the handlers
├── api/
│   ├── contracts.ts     wire protocol (MethodMap, EventMap) — single source of truth
│   ├── handlers/        RPC handlers per area (system, installations, addons,
│   │                    providers, settings, wtf, notifications) + deps.ts
│   ├── gameTypes.ts     game types offered for manual installs, and their labels
│   └── providers.ts     provider ids and display names
├── bridge/jsonl.ts      JSONL RPC dispatcher
├── diagnostics/         recent-errors buffer for Diagnostics
└── wow/                 project-owned addon domain (extracted from WowUp)
    ├── models.ts, types.ts, errors.ts
    ├── fs/              safe filesystem primitives
    ├── installation/    detection, manual adds, the active installation
    ├── addons/          AddonService, addon records, scanner, installer,
    │                    rollback cache, portability (import/export), wire mappers
    ├── toc/             TOC parser
    ├── providers/       provider abstraction, registry + implementations
    ├── downloads/       download service
    ├── archives/        safe extraction
    ├── net/             HTTP client
    ├── storage/         state file and the settings rules table
    ├── notifications/   update check, update toast gate, WowUp companion data
    ├── wtf/             WTF backups: zip writer/reader, jobs, game guard
    └── utils/           game type, game version, TOC and string helpers
```

Addon records are read and written only through `AddonRecords`
(`store.addons`). A record read from it is read-only (a deep `Readonly`
type); a change is a patch, persisted before the call returns, and a patch
merges into the stored record, so two writers never overwrite each other's
fields. The installer returns its changes instead of writing them, and
`AddonService` writes them only when the install succeeded: a failed
install, update or channel switch leaves the record as it was.

The frontend's Steam DOM reach (QAM widening, QAM visibility, the home
badge, the Details modal chrome) lives in `src/steamDom/`, one file per hack,
each stating what it depends on, how it fails and its kill switch.

## WowUp relationship

`wowup/` is a pinned WowUp checkout used as a read-only reference during
development; it is untracked and `make wowup` recreates it at the pinned
commit. Code is *extracted* into project-owned modules under
`backend/src/wow/` with provenance headers and entries in
`docs/wowup-provenance.md`. The finished plugin has no build- or runtime
dependency on the checkout: a distribution zip contains only `dist/`,
`bin/`, `main.py`, `plugin.json` and assets.
