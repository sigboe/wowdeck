# Release notes are plain text, made in the engine

Owner decision, architecture review 2026-10-27 (#29, implemented in #32);
builds on ADR-0003.

The update panel shows the offered WoWDeck build's release notes. Those
notes are the GitHub release body, and both release workflows write that
body from `CHANGELOG.md` (`tools/release-notes.ts`: the version's section
for a stable release, `[Unreleased]` for a beta). So the notes are our own
text, written for players, not arbitrary downloaded content.

That makes them **trusted text**, and the engine turns them into plain text:
system.updateCheck's offer carries `releaseNotes` already stripped of
Markdown (`backend/src/wow/plugin/ReleaseNotesText.ts`), and the frontend
renders it as is. Before this, the frontend treated the body as untrusted
download and stripped it itself, which meant the panel, the dot and the
toast each decided parts of the offer on their own. With the engine owning
the offer's wording, all three render the same field.

"Trusted" does not mean "rendered as HTML": the panel still puts the text in
a text node, never `innerHTML`, and the converter drops HTML tags. If the
release body ever stops coming from `CHANGELOG.md`, this decision has to be
reopened.
