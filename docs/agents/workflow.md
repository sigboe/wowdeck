# Workflow seams

A **seam** is the moment one stage of work ends and the next could begin: a
skill finishes, or the last item of a report, ticket set or checklist is
done. At every seam, end the reply with a seam line:

> **Done:** <what finished, with counts: "all 7 tickets closed">.
> **Next:** `/<skill> <args>`: <one-line reason>. _(Or: `/<alt>` when <condition>.)_

The owner decides; the seam line only proposes. Give one suggestion, plus at
most one alternative when the branch below genuinely forks. A seam line is
the reply's last line, after any summary.

## The map

Pick the row matching what just finished.

| Just finished | Next | Alternative |
| --- | --- | --- |
| A new idea, still foggy, more than one session of work | `/wayfinder` (map in `.scratch/`) | `/grilling` when it fits one session |
| A plan or design worth stress-testing | `/grilling` | `/grill-with-docs` when glossary terms or ADR-level decisions are in play |
| `/grilling` or `/grill-with-docs`, decisions settled | `/to-spec` | `/research` or `/prototype` for a question the grilling left open |
| `/research` or `/prototype` | back to the grilling or wayfinder ticket it answered | `/to-spec` when it was the last open question |
| `/wayfinder` map, destination clear (no fog left) | `/to-spec` | |
| `/to-spec` (spec issue `#n` published) | `/to-tickets #n` | `/implement #n` when the spec fits one session |
| `/to-tickets` (tickets published) | `/implement #<first frontier ticket>` | `/implement-spec #<spec>` to run the whole set |
| `/implement` of a ticket | the next frontier ticket, or `/pr` into `next` when the set is done | `deck-test` first when the change touches UI or device behaviour |
| `/pr` opened | owner review and merge | `/retro` after a long or bumpy session |
| A bug report or failing behaviour | `/diagnosing-bugs` | `/triage` when it arrived as a GitHub issue |
| `/diagnosing-bugs` fixed it | commit with `Closes #n` when an issue exists | `deck-test` to confirm on device |
| `/improve-codebase-architecture` report or any multi-item report, every item done | `/retro` | the report's follow-up items, if it lists any |
| `/triage` queue empty | `/implement #<a ready-for-agent issue>` | |
| A session ending with work unfinished | `/handoff` | |
