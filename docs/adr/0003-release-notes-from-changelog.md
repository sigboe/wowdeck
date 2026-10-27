# Release notes come from CHANGELOG.md, written for players

Owner decision, 2026-10-27, made while the Update channel shipped (#19,
#25). Once the update panel showed the offered build's release notes, the
GitHub release body stopped being a page only maintainers read: players see
it on the Deck before they press **Update**. Bodies generated from PR titles
read like a review queue (ticket numbers, internal terms, refactors), so
both release workflows now publish a section of `CHANGELOG.md` instead
(`tools/release-notes.ts`):

- **Stable** (`v*` tag on `main`): the version's `## [X.Y.Z]` section. A tag
  without a non-empty section fails the workflow before anything is
  published; a release never goes out without notes.
- **Beta** (every non-docs push to `next`): the `[Unreleased]` section, so a
  beta's notes cover everything it has over the latest stable, not only the
  PRs since the previous beta. With nothing player-visible unreleased, the
  body is "Small fixes and improvements."

The changelog is written like a game's patch notes (`docs/changelog.md`),
and a feature's line lands in the commit that makes it visible.

This **overrides two lines of the Update channel spec (#19)**: its Out of
Scope ("Any change to the stable release flow") and story 7 ("beta release
notes generated from the PRs merged since the previous beta"). The version
and tagging steps (`make version-set`, `make release-tag`) are unchanged;
what is new is that cutting a release includes writing its changelog
section.
