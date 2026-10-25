# Upstream contributions to WowUp

Task briefs for an agent that opens pull requests against WowUp
(`github.com/WowUp/WowUp`, monorepo: `wowup-electron/` + `wowup-lib/`). This repo
pins WowUp read-only at `wowup/` (commit
`4fdae600d94ad7dd187a6bc93b517e657100b01a`; `make wowup` fetches it). Every
file:line in these briefs is for that commit. Re-check each one on the branch
you work on, and never edit the `wowup/` checkout here: work in a separate
clone of WowUp.

## Library tracking (WF-21), in this order

1. [wowup-issue-library-tracking.md](wowup-issue-library-tracking.md): issue text
   to open first. PR 1 changes what Remove does for every WowUp user, so ask the
   maintainers before writing code.
2. [wowup-pr1-dependency-handling.md](wowup-pr1-dependency-handling.md): finish
   WowUp's dependency handling. Install required dependencies again, remember
   them as libraries, and autoremove them safely.
3. [wowup-pr2-addon-list-dependency-mark.md](wowup-pr2-addon-list-dependency-mark.md):
   carry the library mark in the addon-list export/import string. Needs PR 1.

Background in this repo:

- `docs/addon-list-format.md`: the wire format and the proof that today's WowUp
  accepts it.
- `backend/src/wow/addons/libraries.ts`: the library graph rules (pure
  functions), the reference for both PRs.
- `backend/src/wow/addons/AddonService.ts`: `INSTALL_INTENTS` (flag set / clear /
  keep per install kind), `#installUnlocked` (dependency install), `removeAddon`
  (autoremove), `importAddonList` (flags after an import).
