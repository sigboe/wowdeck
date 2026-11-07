# Dependencies never replace an installed library

Owner decision, triage of #137, 2026-11-07.

An install, update, reinstall, channel change, adopt or source change also
installs the addon's required dependencies. That step skipped a dependency
only when a record from the same provider had the same id. A library the
user had installed from a file or another source did not match, so the
dependency step installed the CurseForge copy over its folder without
asking. The user lost the source they had chosen for the library.

The dependency step now skips a dependency when any of the folders its
release installs is already on disk. That includes folders another source
installed and unmanaged folders that have no record. It never overwrites an
installed folder. The skip is silent: the toast says nothing and the result
does not list the dependency as missing. The kept library's record, flags
and source stay as they were. This applies the rule from ADR 0008, where
folder names identify a library whatever its source, to installs.

A dependency's folders are known only from its release, so the step reads
the dependency from its provider before deciding. When that read fails, the
dependency is reported missing, as before.

We rejected keeping the replacement, because it undoes a choice the user
made. We rejected asking the user, because no install flow stops for a
question halfway through. We rejected installing a dependency when only some
of its folders are present: the install would still overwrite the ones that
are, and Update or Reinstall of the library repairs a partial copy.

A direct install of a library already on disk, picked by the user in Get
Addons, is not covered here.
