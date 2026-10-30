# Documentation index

What each document covers and when to read it. Start at the top of each
group; within a group the order matches typical use. `wowup/` (the pinned
WowUp reference checkout, fetched with `make wowup`) has its own READMEs and
is read-only.

## Start here

| File | Purpose |
| --- | --- |
| [../README.md](../README.md) | What the plugin is, how to build, install and test it. |
| [../AGENTS.md](../AGENTS.md) | Binding policy for all coding agents (and humans). Read first. |
| [../CLAUDE.md](../CLAUDE.md) | Pointer to `AGENTS.md` with a short summary. |
| [../GLOSSARY.md](../GLOSSARY.md) | The project's fixed vocabulary (QAM, destination, focus memory, …). |
| [../CHANGELOG.md](../CHANGELOG.md) | What shipped in each release. |
| [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Third-party licenses, written for players. The plugin ships it and shows it in Options › About. |

## Architecture and engine

| File | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | Process model, dependency direction, engine layout. |
| [wow-client-identity.md](wow-client-identity.md) | How flavor/client type flows from the filesystem to provider API calls. |
| [installation-detection.md](installation-detection.md) | What counts as a valid WoW installation on SteamOS, and why. |
| [addon-list-format.md](addon-list-format.md) | The WowUp-compatible addon-list export/import string, libraries included. |
| [addon-lifecycle-correctness.md](addon-lifecycle-correctness.md) | The false-update bugs, their root causes and the invariants that prevent them. |
| [wtf-backup.md](wtf-backup.md) | WTF (settings) backup/restore: format, algorithms, recovery, safety. |
| [curseforge-api-key.md](curseforge-api-key.md) | How the bundled CurseForge key is provisioned and when it is not used. |

## Development and testing

| File | Purpose |
| --- | --- |
| [development.md](development.md) | Toolchain, pinned versions, everyday tasks, step-by-step checklists for common changes. |
| [UI_DEVELOPMENT_BEST_PRACTICES.md](UI_DEVELOPMENT_BEST_PRACTICES.md) | The UI guide: Decky/Steam Deck principles, project conventions, device-verified patterns, case studies. Read before touching `src/`. |
| [regression-test-plan.md](regression-test-plan.md) | Full manual test plan for a build before it is called good. |
| [steam-deck.md](steam-deck.md) | Device runtime facts and access notes (SSH, deploy rules). |
| [remote-browser.md](remote-browser.md) | Inspecting the on-device UI with the Chrome DevTools MCP. |
| [../tools/deck-ui/README.md](../tools/deck-ui/README.md) | CDP/controller scripts behind the UI guide's measurements. |

## Provenance and decisions

| File | Purpose |
| --- | --- |
| [wowup-provenance.md](wowup-provenance.md) | Which WowUp components were extracted where, commit by commit. |
| [development.md](development.md#third-party-code) | Third-party code in the repo: where it lives, its commit and what changed. |
| [adr/0001-get-addons-widened-qam.md](adr/0001-get-addons-widened-qam.md) | Decision record: Get Addons moves into a widened QAM (Steam Friends pattern). |
| [adr/0002-get-addons-browse-bar.md](adr/0002-get-addons-browse-bar.md) | Decision record: the browse bar — one picker row above the results, enablement lives in Options. |
| [adr/0003-release-notes-from-changelog.md](adr/0003-release-notes-from-changelog.md) | Decision record: release notes come from `CHANGELOG.md`, written for players. |
| [adr/0004-release-notes-are-plain-text-from-the-engine.md](adr/0004-release-notes-are-plain-text-from-the-engine.md) | Decision record: release notes are plain text, made in the engine. |

## Upstream contributions (WowUp)

| File | Purpose |
| --- | --- |
| [upstream/README.md](upstream/README.md) | Briefs for contributing fixes back to WowUp, in order. |
| [upstream/wowup-issue-library-tracking.md](upstream/wowup-issue-library-tracking.md) | Issue text: library tracking. |
| [upstream/wowup-pr1-dependency-handling.md](upstream/wowup-pr1-dependency-handling.md) | PR brief: dependency handling in WowUp. |
| [upstream/wowup-pr2-addon-list-dependency-mark.md](upstream/wowup-pr2-addon-list-dependency-mark.md) | PR brief: carry the library mark in the addon-list string. |

## Fixture notes

- [../backend/tests/fixtures/archives/README.md](../backend/tests/fixtures/archives/README.md) — how the
  RAR/7z addon archives were produced.
- [../backend/tests/fixtures/wtf/README.md](../backend/tests/fixtures/wtf/README.md) — the upstream-format
  WTF backup fixture.
