# Development environment

## Contents

- [Pinned references](#pinned-references)
- [Third-party code](#third-party-code)
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
| WowUp reference       | `89a0981ad00290d40368bf2a9f60209a40198502` (v2.24.1) — untracked, `make wowup` |
| Decky plugin template | `90d0780e882a17f5714fc6de044c645f22608290` (2026-04-10)       |
| `@decky/ui`           | ^4.11.0                                                       |
| `@decky/api`          | ^1.1.3                                                        |
| Node.js (build)       | v22.23.3 (nixpkgs nodejs_22)                                  |
| pnpm (build)          | 12.9.0 (nixpkgs)                                              |
| Bun (engine build)    | 1.4.2 (nixpkgs)                                               |
| Python (host)         | 3.14.7                                                        |
| Python (SteamOS)      | 3.13.5 — `main.py` must stay 3.11+ compatible                  |

## Third-party code

`THIRD_PARTY_NOTICES.md` is written for players: the plugin zip ships it
and Options › About shows it. Keep repository paths, commits and make
targets out of it. They go here.

- **WowUp.** `wowup/` is a read-only reference checkout, untracked.
  `make wowup` recreates it at the commit in the table above. Code adapted
  from it lives in `backend/src/wow/`, and `docs/wowup-provenance.md`
  records where each part came from.
- **Decky plugin template.** The project started from the commit in the
  table above. These files come from it: the `plugin.json` structure,
  `rollup.config.js`, the `tsconfig.json` base, `src/types.d.ts`,
  `decky.pyi`, the Deck Debug settings in `deck-debug/`, and the
  `backend/out` build convention. Its BSD-3-Clause text is appended to
  `LICENSE`.
- **fflate.** The npm package, 0.8.x. `backend/src/wow/archives/ArchiveExtractor.ts`
  checks every entry for path traversal before it extracts.
- **xclip.** `backend/vendor/xclip` is a prebuilt, unmodified binary,
  copied from the installed Decktation plugin, which bundles the same
  upstream binary. Its license is `backend/vendor/xclip-LICENSE.txt`.
  `tools/package.py` copies it into the zip's `bin/`, and `main.py` runs it
  as a subprocess for Copy diagnostics.
- **The `unslop` skill.** `.claude/skills/unslop/SKILL.md` is
  `pstack/skills/unslop/SKILL.md` from commit
  `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`. Only the frontmatter
  changed: the description names this repo's docs, and
  `disable-model-invocation` is gone so agents load it themselves. Its
  license is `.claude/skills/unslop/LICENSE`.
- **README glyphs (`docs/glyphs/`).** These are the paths the UI draws,
  recoloured grey so they read on light and dark GitHub themes.
  `button-x.svg`, `button-y.svg` and `button-qam.svg` are Steam's
  `ABXYButton` X and Y cases and its `Dots` icon, copied from `steamui/sp.js`
  of the Steam Deck stable client, version `1792618285`.
  `decky-settings.svg` is the gear on Decky Loader's settings button
  (Decky v3.3.1), which is `BsGearFill` from Bootstrap Icons.
  `wowdeck-box.svg`, `ellipsis.svg` and `options.svg` are `FaBoxOpen`,
  `FaEllipsisH` and `FaCog` from `react-icons` 5.7.0.

## Toolchain

`flake.nix` lists every development dependency, each with the reason it is
there. With Nix, `nix develop` enters the shell, and `make` enters it on its
own. Without Nix, install those packages from your distro and run
`make USE_NIX=0 …`.

### Workflow skills

The agent guidelines reference two skill sets. The project's own skills
(`deck-test`, `unslop`) live in `.claude/skills/`. The `mattpocock/skills`
set (`to-spec`, `to-tickets`, `triage`, `implement`, `writing-for-agents`, …)
is vendored into `.agents/skills/` and tracked by `skills-lock.json` so
OpenCode can load it too. OpenCode cannot use Claude Code plugins, and Claude
Code users get this set from the `mattpocock-skills` plugin. To update the
vendored copy, run `npx skills@latest update` at the repo root and commit the
result. Pick one install path per agent. The plugin and a copy in the same
agent would list every skill twice.

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

`main` always equals the newest published release. Merging `next` into
`main` publishes the release and creates its tag. Nothing needs to run
after the merge. One version lives in `package.json`, `plugin.json` and
`backend/package.json`, written and checked by `tools/version.py`.

On `next`, before opening the PR into `main`:

1. In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - <date>`, put a
   fresh empty `[Unreleased]` above it and update the link references.
2. Run `make version-set VERSION=X.Y.Z` and commit both.
3. Open the PR `next` → `main`.

The PR's "Release gate" check (`ci.yml`, `tools/release-check.ts`) fails
while the version is already tagged, its changelog section is missing, or
anything is left under `[Unreleased]`. Work that lands on `next` after
step 1 adds to `[Unreleased]` and fails the gate again, so fold it into
the version's section before merging. Never merge with the gate red.

The merge pushes to `main`, which starts `.github/workflows/release.yml`.
It repeats the gate and reruns the CI checks. Then it packages the zip
with the bundled CurseForge key and creates GitHub Release `vX.Y.Z`,
with its tag on the merge commit. The release notes are the version's `CHANGELOG.md` section
(`tools/release-notes.ts`). A push whose version is already released
publishes nothing. If the run fails, fix the cause on `next` and merge
into `main` again, or rerun the workflow on `main` (`workflow_dispatch`). Those notes
are what players read in the update panel, so the
changelog follows `docs/changelog.md`. The asset keeps
the zip's plugin-name filename on purpose — Decky's install-from-URL derives
the plugin name from the last URL segment (`tools/package.py` documents the
update-hang that any other name causes).

### Betas

Every push to `next` that changes more than docs (`*.md`, `docs/`) and
dev-only files (`.claude/`, `deck-debug/`, `tools/deck-ui/`) is published by `.github/workflows/beta.yml` as a beta pre-release for the Beta
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
   handler only forwards: the engine module returns the contract type
   itself, and a method that never throws for an expected failure answers
   through `settle()` (`bridge/jsonl.ts`). The integration test "every
   declared method has a handler" fails until it is.
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
3. Register it in `backend/src/main.ts` (`registry.register(…)`).
4. Give it a scenario in `backend/tests/providers/scenarios.ts`: its
   capabilities, a search text or link, a known id and a missing one. Record
   its cassette with `make record-provider-fixtures PROVIDERS=<name>`; the
   contract suite (`backend/tests/provider-contract.test.ts`) then replays it.
   CurseForge needs `CURSEFORGE_API_KEY` or `CURSEFORGE_API_KEY_FILE`, GitHub
   takes an optional `GITHUB_TOKEN`; neither ever reaches a cassette.
5. Test what only this provider does (fallbacks, odd responses) in
   `backend/tests/<name>-provider.test.ts`.
