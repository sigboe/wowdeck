# Development environment

## Contents

- [Pinned references](#pinned-references)
- [Third-party code](#third-party-code)
- [Toolchain](#toolchain)
- [Common tasks](#common-tasks)
- [Branches and worktrees](#branches-and-worktrees)
- [Testing on a real Steam Deck](#testing-on-a-real-steam-deck)
- [Fixture installations](#fixture-installations)
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
make tidy      # list merged branches, worktrees and stashes; APPLY=1 removes them
make clean
```

## Branches and worktrees

Feature branches start from `next` and come back to it through a PR
(`AGENTS.md`, "Branching and merging"). Make a worktree by hand beside the
main checkout, named for its ticket or topic:

```bash
git worktree add ../wowdeck-190 -b tools/190-tidy origin/next
```

Don't put one in `/tmp` or `.scratch/`. Claude Code and T3 Code keep their
own worktrees in `.claude/worktrees/` and `~/.t3/worktrees/`; leave those
where the tools put them. Worktrees already share their dependencies.
pnpm and bun hardlink packages from their stores, so a second
`node_modules` takes almost no disk space. A worktree's real cost is its
build output, about 200 MB, most of it `backend/out`.

After a PR merges into `next`, run `make tidy`. It fetches `origin`, asks
`gh` for the open PRs, and prints every local branch, worktree and stash
with a verdict:

- `in next`: merging the branch into `origin/next` changes nothing.
- `in PR #n`: the same against an open PR's head branch, so a pre-squash
  backup of that PR's branch counts.
- `landed (squashed)`: the merge conflicts, but at least 80% of the
  branch's added lines (longer than 25 characters) are in `origin/next`.
  Lines the branch only moved don't count. The other 20% leaves room for
  lines rewritten in review, so check the branch first if that matters.
- `unmerged`: everything else.

Don't use `git branch --merged` for this. Squashing a branch before its
PR merges gives it new commits, so git reports it as unmerged.

`make tidy` only reports. `make tidy APPLY=1` removes the worktrees and
branches marked `rm`, and prints each deleted branch's SHA with the command
that restores it. It never removes `main`, `next`, the current branch,
branches of open PRs, unmerged branches, locked worktrees, worktrees with
uncommitted changes, or worktrees holding `.scratch/` notes. Removing a
worktree deletes its ignored files with it: build output, `node_modules`,
and any local `.env`. It lists stashes but never drops them.

## Releases

`main` always equals the newest published release. Merging `next` into
`main` publishes the release and creates its tag. Nothing needs to run
after the merge. One version lives in `package.json`, `plugin.json` and
`backend/package.json`, written and checked by `tools/version.py`.

Prepare the release on a `release/X.Y.Z` branch off `next`, and push it
once it has a commit. Never keep release prep in a stash. A stash stays
on one machine and nobody else sees it, and the 1.2.0 version bump once
sat in one unnoticed.

1. In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - <date>`, put a
   fresh empty `[Unreleased]` above it and update the link references.
2. Run `make version-set VERSION=X.Y.Z` and commit both.
3. Merge `release/X.Y.Z` into `next` through a PR, then open the PR
   `next` → `main`.

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
dev-only files (`.claude/`, `deck-debug/`, `tools/deck-ui/`, the
`Makefile`, `make tidy`) is published by `.github/workflows/beta.yml` as a
beta pre-release for the Beta update channel; nobody runs anything.

To merge a PR without a beta, put `[skip actions]` in the merge commit's
subject (`gh pr merge <n> --merge --subject "… [skip actions]"`). GitHub
then starts no workflow for that push. Use it when nothing in the PR
reaches players, such as comment-only edits in `src/`. It calls `ci.yml` with the beta
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

### PR builds

A maintainer who wants players to try an open pull request puts the
`pr-build` label on it. `.github/workflows/pr-build.yml` then builds the PR
and publishes the zip to GitHub Pages. Owners install it from Options ›
Updates › WoWDeck › channel picker › "PR builds…". Label a PR only after you
have reviewed its head commit, because the build ships the bundled
CurseForge key and runs on owners' devices. GitHub lets only people with
triage access or higher add labels. `GLOSSARY.md` ("PR build") and ADR 0010
explain why the builds are hosted this way.

The workflow runs on the label going on or off, on every push to the PR, and
on the PR closing or reopening:

- Adding the label builds the PR. A push by a maintainer (triage access or
  higher) rebuilds it, and so does a maintainer reopening it.
- A push by anyone else removes the label and takes the build off the list.
  Review the new commits, then label the PR again. Only a push does this.
  If someone else reopens the PR, the label stays on and the PR stays
  unlisted.
- Removing the label, merging the PR or closing it takes the build off the
  list and deletes its zip.

The version is `<last stable tag, patch+1>-pr.<PR number>`, and each
rebuild adds a counter (`1.1.2-pr.117`, then `1.1.2-pr.117.2`).
`index.json` remembers the last version published for every PR, so a PR
that left the list and is labeled again counts on (`1.1.2-pr.117.3`)
rather than starting over. A version never names two different builds.
`tools/version.py stamp` writes it into the build's checkout only. A PR
branched from a `next` older than the `-pr` versions fails at that step.
Rebase it onto `next`.

The bot keeps one comment on the PR and edits it on each build. It shows
the version, the commit, the zip's size and sha256, and a download link
that works without a GitHub login. Pages holds at most 10 PR builds, about
73 MB each. Publish refuses an 11th and says so in the comment. Remove the label
from a PR nobody needs any more, then label the new one again.

`tools/pr-build.ts` makes every choice (tests beside it). The workflow
reads the PR's state from GitHub, passes it in and carries out the answer.
Its four jobs hold different permissions:

- `decide` runs the default branch's `tools/` with a read-only token. It
  picks the action and the version.
- `strip-label` can only edit the PR's labels.
- `build` checks out the PR's head commit and builds it with a read-only
  token and the CurseForge key. It uploads the zip as an artifact.
- `publish` runs no code from the PR. It takes only the zip from `build`,
  computes its sha256, writes `pr/<number>/WoWDeck.zip` and `index.json` to
  the `pr-builds` branch, and edits the PR comment. It is the only job that
  can push.

None of these jobs restores an Actions cache, and neither do the beta and
release builds. A read-only token doesn't stop the PR's code in `build`
from writing cache entries into the base branch's scope, and runs on
`next` and `main` would restore them. Keep `cache:` off `setup-node` and
`no-cache: true` on `setup-bun` in any job that publishes or holds a write
token. `ci.yml` drops its caches only when `beta.yml` calls it with a
version.

The `pr-builds` branch is the Pages site and holds a single commit. Each
publish clones it without file contents, replaces that commit and
force-pushes, so it uploads only the new zip. `index.json` lists every PR
build. Its format is in the header of `tools/pr-build.ts`. Each publish
also drops builds whose PR has closed, lost its label or moved past the
built commit. GitHub keeps only one publish waiting and cancels an older
one that is still waiting. The next publish removes whatever that run
would have taken off the list. Rerun a cancelled build from the Actions
tab.

The owner sets up the repository once, by hand:

1. Create the `pr-build` label.
2. Create the `pr-builds` branch with an empty `index.json`
   (`{"builds": []}`) as its only commit, and no ruleset on it.
3. Turn on Pages, deploying from the `pr-builds` branch, root folder.

Until the branch exists, a build fails at publish and nothing is written.
Until Pages is on, a build fails at publish before it pushes anything.

### Branch protection

The repository deletes a PR's head branch after merging it. On
2026-10-31 that deleted `main`: a PR merged `main` back into `next`, and
GitHub then removed its head branch. Two rulesets now stop that from
happening again:

- The `main: releases only` ruleset blocks deleting or force-pushing
  `main`. `main` changes only through a PR that passes the Release gate
  and merges with a merge commit.
- The `next: no deletion or force push` ruleset blocks the same two
  things on `next`.

GitHub doesn't auto-delete a protected head branch, so a PR from `main`
into `next` is now safe. A hotfix still goes on its own `hotfix/X.Y.Z`
branch off `main`. Merge it into `main`, then into `next`. Don't remove
or loosen either ruleset to get a release through. When the gate is red,
fix the release.

## Testing on a real Steam Deck

Decky plugins are best verified on real hardware. SSH is enabled by default
on SteamOS (`deck@<device-ip>`); `docs/steam-deck.md` has device notes.
Inspect the UI with the `tools/deck-ui/` scripts over an SSH tunnel
(`tools/deck-ui/README.md`). The Chrome DevTools MCP (`docs/remote-browser.md`)
covers console and network history and views no script reaches. Deck rules:
`AGENTS.md` ("The owner's Steam Deck"); the test procedure is the `deck-test`
skill (`.claude/skills/deck-test/SKILL.md`).

## Fixture installations

`tools/wow-fixtures.sh` builds fake WoW installations, one per client folder,
so every client type can be tested without the real game. The executables
are empty files; each fixture reports game version `1.0.0.99999`.

```sh
tools/wow-fixtures.sh                       # all clients under ~/wowdeck-fixtures
tools/wow-fixtures.sh --only wow_cn_beta,_classic_titan_
tools/wow-fixtures.sh --root DIR --clean    # rebuild from scratch
```

Fixtures live in their own root, apart from any real install. Register that
root with `installations.add {"path": "<root>"}`; `installations.remove`
takes each one out again. On a device, run the script there, with the root
inside the plugin's data directory:
`ssh <host> 'bash -s -- --root ~/homebrew/data/wowdeck/fixtures' < tools/wow-fixtures.sh`.
A new client folder goes into the script's `CLIENTS` list too; the test
`backend/tests/wow-fixtures-script.test.ts` fails until it does.

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
