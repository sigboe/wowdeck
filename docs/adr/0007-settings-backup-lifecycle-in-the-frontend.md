# Settings backup coordination belongs to one shared frontend module

Owner decision, design session 2026-11-03.

Options, Manage backups and Settings copy share one frontend module for
requests, operation state, job reconciliation and list freshness. That state
survives modal changes. Views own selection, confirmation and navigation. The
module coordinates backup-folder and retention writes through the existing
settings store, because running jobs read those settings at several stages.

The engine remains authoritative for current activity and action eligibility.
We keep its API unchanged. It exposes the current job but does not retain
terminal outcomes for lookup, so a missed completion or ambiguous transport
failure can leave an operation's result unknown. The module reconciles current
activity and refreshes affected lists without claiming success or failure. It
never retries a mutation automatically, and a cancellation acknowledgement
does not settle the operation.

We accepted unknown historical results to keep this refactor within frontend
coordination. Reliable outcome recovery would require an engine protocol
change. The frontend operation guard coordinates this plugin's requests; it
cannot serialize settings writes from other callers or promise exactly-once
execution after a transport failure.
