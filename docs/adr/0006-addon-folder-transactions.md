---
status: accepted
---

# Addon folder transactions

Owner decisions from the design interview on 2026-11-03. The owner confirmed
the complete design at the end of the interview.

Install and update, removal, and rollback will share an addon-specific
transaction boundary that coordinates folder changes and addon records.
Today these operations own separate move and undo sequences. They can report
failure after changing live folders, discard copies after restoration fails,
or fail to notice that a record write did not reach disk. Moving their
existing helpers behind a common interface would preserve those problems.
WTF recovery remains separate.

## Commit and failure

An operation commits only when its folder changes and an acknowledged addon
record write both succeed. It keeps recovery copies until then. A failed
record write triggers restoration of the previous folders and leaves the
previous record unchanged. The record write must acknowledge commit evidence
at the same time, including operations that create no record or remove one.
This lets recovery distinguish an unfinished operation from a committed one
whose cleanup failed.

If restoration fails, the engine preserves every remaining copy and marks
the installation as recovery required. It blocks further addon mutations and
automatic record reconciliation for that installation. The guard applies
across engine entry points, including cache clearing and installation removal.
Other installations remain usable, subject to the shared state storage
being available.

An update may still succeed when it cannot retain an optional previous
version for Roll back. It reports the actual availability of that version.
A rollback must preserve the outgoing version as part of its transaction.
Failure to complete the exchange triggers restoration of its starting state.

Failure to delete disposable temporary files after commit leaves the operation
successful with a cleanup warning. Confirmed committed leftovers are eligible
only for cleanup, never restoration. Files needed for unresolved recovery
remain protected.

## Restart and recovery

Before changing live folders, the engine writes a transaction marker and
collects the evidence needed for recovery. An unresolved marker blocks the
installation across restarts. Writing the marker only after failed restoration
would be unreliable when disk or permission errors also prevent that write.
An unreadable marker is not an absent marker.

A restoration that finished but couldn't clear its marker leaves nothing to
recover. The engine writes a note into the transaction's work folder in the
installation's AddOns folder. After a restart, a marker with that note counts
as restored, and the engine only cleans up its leftovers. Without the note, or
with the drive missing or replaced, the marker stays unresolved. A marker that
names no installation blocks every installation. A state file that exists but
can't be read may hold markers, so the engine blocks every installation and
doesn't write over the file. A damaged file that never named a marker starts
afresh, as before.

This work handles caught failures and detects unresolved operations after
restart. It provides no automatic startup repair, crash-atomic multi-folder
swap, or power-loss durability guarantee.

Retry recovery runs only on explicit request and only when the recorded
evidence establishes a safe restoration of the pre-operation state. The
engine refuses conflicting or unverifiable external changes and preserves
the block and remaining copies. Content evidence is required because paths,
folder identities, and TOC versions cannot establish that files are unchanged.
The owner accepts the extra disk-reading time before mutation and recovery.

When retry is unsafe, recovery details support manual repair. Verify recovery
unblocks the installation only after it establishes the recorded original
folder arrangement and addon record, including paths or records that were
originally absent. It does not rewrite evidence to make a repair match.
Adopting a different manually chosen state and clearing the block without
verification are outside this design.

An unavailable or unverifiable installation drive leaves recovery pending.
The engine never recreates a missing installation root. The owner reconnects
the original drive before rechecking recovery.

Retry recovery needs readable recovery information. A marker this build can't
read, a marker that names no installation, or a state file that can't be read
doesn't offer it. The details view says why and says to put the kept files
back by hand. For an unreadable state file, it says to repair or restore the
file and restart. A retry that finds the files as the stopped operation left
them puts them back, then puts the original record back, and clears the
marker last. If any step fails, the marker stays, so the installation stays
blocked, and the next retry starts from where that one stopped.

## Operation groups and visibility

Each addon commits separately, including dependencies, orphan removal, and
bulk operations. Completed operations remain committed, and results identify
partial completion. Ordinary failures may allow later operations. Recovery
required stops further changes in the affected installation.

My Addons, Get Addons, and Options show a persistent installation-level
recovery notice with a shared recovery-details action. Stored addon information
is visibly unverified until recovery completes. Browsing and switching to
other installations remain available.

The specification will define the ledger, commit evidence, typed contracts,
verification mechanism, and exact UI. They must preserve these rules rather
than expose folder coordination to callers again.
