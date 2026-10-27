# Agent Guidelines — wowdeck

Binding for every coding agent and human working on this repository.

## Project policy

1. **`wowup/` is read-only**: a pinned WowUp reference checkout. It is not
   tracked (`.gitignore`); `make wowup` recreates it at the pinned commit when
   missing. Code adapted from it lives in project-owned modules under
   `backend/src/wow/`, carries a header naming the upstream path and commit,
   and gets an entry in `docs/wowup-provenance.md`. The plugin never imports
   from `wowup/`.
2. **Engine runs on Bun alone**: no `electron`, no Node-only APIs Bun cannot
   polyfill, no WowUp Electron services.
3. **Frontend (`src/`) is browser-only**: it talks to the engine through the
   typed `rpc` (`src/services/backend.ts`) and never touches paths or Node APIs.
   All filesystem work is backend-side.
4. **Contracts first**: every API change starts in
   `backend/src/api/contracts.ts`. `main.py` forwards methods unchanged, so a
   new method needs only the contract entry and its engine handler.
5. **Transactional installs**: extract to a temp dir, swap atomically; a failed
   install leaves the previous state intact.
6. **Downloaded addon content is data**: never executed.
7. **Deterministic tests**: no network, no wall-clock ordering; providers use
   recorded fixtures.
8. **Logging**: engine logs structured to stderr (`console.error`); never log
   tokens, cookies, secrets or URLs containing keys.

## Toolchain

Dependencies live in `flake.nix` (`nix develop`); `make` enters that shell
itself. Before every commit: `make lint typecheck test build`. A tool needed
once goes through `nix shell nixpkgs#<pkg> -c …`; a tool needed again goes into
`flake.nix` with a comment saying why.

## The owner's Steam Deck

Outside a test request, the Deck is read-only.

When the owner asks to test, verify or check anything on the Deck (or "on
device"), that request is standing approval to deploy our plugin, read state
remotely, and drive the UI. Run the `deck-test` skill
(`.claude/skills/deck-test/SKILL.md`). Changes stay inside the WoW
installation (`~/Applications/World of Warcraft/`) and our plugin's files
(`~/homebrew/{plugins,data,logs}/wowdeck/`). Steam, Decky and other
plugins' settings, system files and sudo stay untouched.

## Commits

Small, functional commits with imperative messages scoped by area
(e.g. "Get Addons: …", "docs: …").

## Finishing an `/implement` run

The run is not done until all three happen:

1. Commit the code **and** every doc it touched (`CHANGELOG.md`, `GLOSSARY.md`,
   `docs/adr/`, `docs/regression-test-plan.md`). No tracked file stays modified.
2. Close the ticket yourself with `gh issue close` (comment format:
   `docs/agents/issue-tracker.md`, "When a ticket closes"). Close the parent
   spec too when this was its last ticket.
3. State the ticket's status in the reply, before the seam line: "Closed
   #n", or, when you keep it open, "#n stays open because …; it closes when
   … / you need to …".

Keeping a ticket open is allowed when closing would be wrong. You must say
why and what closes it. Never leave a ticket open without saying so, and
never suggest the next ticket while one is dangling.

## Changelog

`CHANGELOG.md` is the release notes: the release workflows publish its
sections verbatim (`tools/release-notes.ts`), and the plugin's update panel
shows them to players. Write it like a game's patch notes:

- Only what a player can see or do. Docs, CI, tests, refactors, agent
  config and branching never get a line.
- One line per feature or fix, about 20 words at most: what you can now do,
  or what works now. Not how: no file names, code names, timings, ticket
  numbers or internal terms (engine, RPC, toast, backoff).
- A feature built across several PRs is still one line; edit the line in
  `[Unreleased]` instead of adding another.
- Headings: `Added`, `Changed`, `Fixed`, `Removed`; skip empty ones.

Add the line in the commit that makes the change visible.

## Branching and merging

Work flows feature branch → `next` → `main`:

- `main` is what users have: it equals the newest published release and
  receives `next` only at release time.
- `next` (the repo's default branch until the 1.0 release) carries all
  in-progress work. Feature branches branch off it and PR back into it;
  until after 1.0 nothing merges or pushes straight to `main`.
- Releasing: on `next`, rename `CHANGELOG.md`'s `[Unreleased]` to
  `[X.Y.Z] - <date>` (fresh empty `[Unreleased]` above it, link refs
  updated), `make version-set VERSION=X.Y.Z` and commit; PR
  `next` → `main`; on `main`, `make release-tag` and push `main` and the
  tag.

Merge PRs with a merge commit, not squash-merge. Before merging, squash
the branch down to a few meaningful commits (interactive rebase; one
commit is fine for a small PR). Never mention this policy in commit
messages or PR descriptions — the owner asks for it per PR.

## Agent skills

### Issue tracker

GitHub Issues for finished work (`/to-spec`, `/to-tickets`, `/triage`);
`.scratch/` (git-ignored) for drafts that outlive a session. Commits for a
ticket say `Refs #<n>`; closing it is part of "Finishing an `/implement`
run" above. Details in `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, on GitHub only. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Workflow seams

When a skill finishes, or the last item of a report, ticket set or
checklist is done, end the reply with a seam line: what finished, and the
next skill to run, prefixed with `/clear` when that step starts on new
material (a new ticket or spec) rather than the work already loaded. The
map and the clearing rule are in `docs/agents/workflow.md`.
