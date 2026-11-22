# Writing the changelog

`CHANGELOG.md` is the release notes: the release workflows publish its
sections verbatim (`tools/release-notes.ts`), and the plugin's update panel
shows them to players. Write it like a game's patch notes:

- Only what a player can see or do. Docs, CI, tests, refactors, agent
  config and branching never get a line.
- One line per feature or fix, about 20 words at most: what you can now do,
  or what works now. Not how: no file names, code names, timings, ticket
  numbers or internal terms (engine, RPC, toast, backoff).
- One feature is one line, however many tickets, commits or PRs build it.
  A ticket that adds a detail to a feature (an option, another case, a
  fix to something not yet released) edits that feature's line in
  `[Unreleased]` instead of adding another. A PR that ships one feature
  adds one line.
- Headings: `Added`, `Changed`, `Fixed`, `Removed`; skip empty ones.
- A stable release needs a non-empty `## [X.Y.Z]` section, or its workflow
  fails; a beta publishes `[Unreleased]` as it stands.
