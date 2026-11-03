---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets. A direct
user request can be the spec; a generic task does not require an issue.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Before implementation, capture the starting HEAD with `git rev-parse HEAD`
and note existing working-tree changes so the review can distinguish them
from this task's work.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work. Hand it
the starting HEAD SHA, ticket/spec content and source (including a direct
user request), and the exact scope: task changes from that baseline through
the current working tree, explicitly including staged, unstaged and untracked
files. List any pre-existing changes excluded from the task. Request a separate
branch merge-base review only when the whole branch is in scope.

Commit your work to the current branch.
