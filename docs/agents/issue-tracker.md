# Agent skills configuration — issue tracker, triage labels, domain docs

Configured 2026-10-22 by the owner's instruction: "default matt-pocock markdown way".

## Issue tracker

Local markdown, as described in the `setup-matt-pocock-skills` skill's
`issue-tracker-local.md` template:

- Issues and specs for this repo live as markdown files in `.scratch/`.
- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a
  single combined tickets file.
- Triage state is a `Status:` line near the top of each issue file.
- Comments and conversation history append to the bottom of the file under a
  `## Comments` heading.

Rationale: issues and specs stay machine-local by owner policy — `.scratch/`
is git-ignored and ships with nothing, so the public repo carries no planning
debris. The GitHub remote exists for code and releases; GitHub Issues is not
the tracker. The repo's working plan document stays `ActionItems.yaml`
(untracked by policy); `.scratch/` is where agent-facing feature specs live.

## Triage labels

Defaults, unchanged:

| Label             | Meaning                                  |
| ----------------- | ---------------------------------------- |
| `needs-triage`    | Maintainer needs to evaluate this issue  |
| `needs-info`      | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human` | Requires human implementation            |
| `wontfix`         | Will not be actioned                     |

## Domain docs

Single-context layout (already in place): `GLOSSARY.md` at the repo root and
`docs/adr/` for decision records. ADR 0001 covers the Get Addons widened QAM,
ADR 0002 the Get Addons browse bar.
