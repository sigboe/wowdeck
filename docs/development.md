# Development environment

## Contents

- [Pinned references](#pinned-references)
- [Toolchain](#toolchain)
- [Common tasks](#common-tasks)
- [Testing on a real Steam Deck](#testing-on-a-real-steam-deck)
- [Checklists](#checklists)
  - [Add an RPC method](#add-an-rpc-method)
  - [Add a setting](#add-a-setting)
  - [Add an addon provider](#add-an-addon-provider)

## Pinned references

| Component             | Version / commit                                              |
| --------------------- | ------------------------------------------------------------- |
| WowUp reference       | `4fdae600d94ad7dd187a6bc93b517e657100b01a` (master, 2.23.1) — untracked, `make wowup` |
| Decky plugin template | `90d0780e882a17f5714fc6de044c645f22608290` (2026-04-10)       |
| `@decky/ui`           | ^4.11.0                                                       |
| `@decky/api`          | ^1.1.3                                                        |
| Node.js (build)       | v22.23.3 (nixpkgs nodejs_22)                                  |
| pnpm (build)          | 12.9.0 (nixpkgs)                                              |
| Bun (engine build)    | 1.4.2 (nixpkgs)                                               |
| Python (host)         | 3.14.7                                                        |
| Python (SteamOS)      | 3.13.5 — `main.py` must stay 3.11+ compatible                  |

## Toolchain

`flake.nix` lists every development dependency, each with the reason it is
there. With Nix, `nix develop` enters the shell, and `make` enters it on its
own. Without Nix, install those packages from your distro and run
`make USE_NIX=0 …`.

## Common tasks

```bash
make setup     # install frontend + backend dependencies
make build     # build frontend (rollup) and backend (bun compile)
make test      # frontend, engine and packaging tests
make lint      # eslint + prettier + tsc
make package   # build distributable plugin zip in build/
make clean
```

## Releases

`main` always equals the newest published release; a release is the act of
merging `next` into `main` (`AGENTS.md` "Branching and merging"). One
version lives in `package.json`, `plugin.json` and `backend/package.json`,
written and checked by `tools/version.py`:

```bash
# on next — CHANGELOG.md: [Unreleased] becomes [1.0.0] - <date>, a fresh
# empty [Unreleased] goes above it, link refs updated; then bump, commit,
# PR next → main, merge:
make version-set VERSION=1.0.0
# on main, after the merge:
make release-tag                 # refuse dirty/mismatched tree, create v1.0.0
git push origin main v1.0.0      # .github/workflows/release.yml publishes
```

The tag-triggered workflow reruns the CI checks, packages the zip (with the
bundled CurseForge key) and attaches it to a GitHub Release whose notes are
the version's `CHANGELOG.md` section (`tools/release-notes.ts`; no section,
no release). Those notes are what players read in the update panel, so the
changelog follows `docs/changelog.md`. The asset keeps
the zip's plugin-name filename on purpose — Decky's install-from-URL derives
the plugin name from the last URL segment (`tools/package.py` documents the
update-hang that any other name causes).

### Betas

Every push to `next` that changes more than docs (`*.md`, `docs/`) is
published by `.github/workflows/beta.yml` as a beta pre-release for the Beta
update channel; nobody runs anything. It calls `ci.yml` with the beta
version, so the same gates must pass before anything is published; then it
tags the merged commit `v<version>`, attaches the same `WoWDeck.zip`, uses
`CHANGELOG.md`'s `[Unreleased]` section as the notes ("Small fixes and
improvements." when it is empty), and deletes all but the
newest three beta releases together with their tags.

The version is `<last stable tag, patch+1>-beta.<run number>`
(`0.3.1-beta.57` after `v0.3.0`). `tools/version.py stamp` writes it into
the CI checkout only; it is never committed, so `next` keeps the last
stable version and the release steps above are unchanged. The version and
prune choices are `tools/beta-release.ts` (tests beside it); pruning only
ever matches `v*-beta.*`, and `release.yml` ignores those tags.

## Testing on a real Steam Deck

Decky plugins are best verified on real hardware. SSH is enabled by default
on SteamOS (`deck@<device-ip>`); `docs/steam-deck.md` has device notes.
Inspect the UI with the Chrome DevTools MCP over an SSH tunnel
(`docs/remote-browser.md`). Deck rules: `AGENTS.md` ("The owner's Steam
Deck"); the test procedure is the `deck-test` skill
(`.claude/skills/deck-test/SKILL.md`).

## Checklists

### Add an RPC method

1. Declare it in `backend/src/api/contracts.ts` (`MethodMap`: `params` and
   `result`; an engine-pushed event goes in `EventMap`).
2. Handle it with `server.on("area.method", …)` in the matching
   `backend/src/api/handlers/<area>.ts`; a new service goes into
   `HandlerDeps` (`handlers/deps.ts`) and is built in `main.ts`. The
   integration test "every declared method has a handler" fails until it is.
3. Call it from the UI with `rpc("area.method", params)`
   (`src/services/backend.ts`), typed from `MethodMap`. `main.py` forwards
   every method unchanged; it needs no edit.

### Add a setting

1. Add the field to `PluginSettings` in `backend/src/api/contracts.ts`.
2. Add its rule to `RULES` in `backend/src/wow/storage/settings.ts`
   (default, normalizer, `userWritable`); TypeScript refuses a missing rule.
   Stored files are normalized through it on load.
3. In the UI, read it from `settingsStore` (`src/settings.ts`) and save it
   with `settingsStore.save({ key: value })` (optimistic, rollback, toast) or
   `write()` when the engine validates first. Extend the "settings.set, key
   by key" integration test.

### Add an addon provider

1. Implement `AddonProvider` (`backend/src/wow/providers/addon-provider.ts`)
   in `backend/src/wow/providers/<name>/`; code taken from WowUp gets a
   provenance header and an entry in `docs/wowup-provenance.md`.
2. Add its id to `AddonProviderType` (`wow/types.ts`) if new, and to
   `PROVIDER_ID` and the display names in `backend/src/api/providers.ts`.
3. Register it in `backend/src/main.ts` (`registry.register(…)`) and add
   `backend/tests/<name>-provider.test.ts` against fixtures.
