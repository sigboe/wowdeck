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

## Branching and merging

Work flows feature branch → `next` → `main`:

- `main` is what users have: it equals the newest published release and
  receives `next` only at release time.
- `next` (the repo's default branch until the 1.0 release) carries all
  in-progress work. Feature branches branch off it and PR back into it;
  until after 1.0 nothing merges or pushes straight to `main`.
- Releasing: on `next`, `make version-set VERSION=X.Y.Z` and commit; PR
  `next` → `main`; on `main`, `make release-tag` and push `main` and the
  tag.

Merge PRs with a merge commit, not squash-merge. Before merging, squash
the branch down to a few meaningful commits (interactive rebase; one
commit is fine for a small PR). Never mention this policy in commit
messages or PR descriptions — the owner asks for it per PR.

## Agent skills

### Issue tracker

GitHub Issues for finished work (`/to-spec`, `/to-tickets`, `/triage`);
`.scratch/` (git-ignored) for drafts that outlive a session. `/implement`
closes its own ticket: commits say `Refs #<n>`, and once the commit and
review are done the agent closes the issue by hand. See
`docs/agents/issue-tracker.md` (closing comment, the one exception).

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
