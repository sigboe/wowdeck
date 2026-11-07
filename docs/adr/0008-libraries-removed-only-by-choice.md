# Libraries are removed only when the user chooses to

Owner decision, triage of #135, 2026-11-07.

Until now, every Remove ended with an apt-style autoremove (WF-22): any
library that nothing needed was deleted, whichever addon was removed. The
dialog named only the libraries tied to that addon. When a source change cut
the link between an addon and its library, the next Remove of an unrelated
addon deleted the library without naming it.

We changed two things. First, an addon needs a library when its source lists
the library as required or when its TOC names the library's folder as a
dependency, optional ones included. Folder names stay the same whatever the
source, so the link survives a source change in either direction. Second, a
Remove only considers the libraries that this removal leaves unneeded,
including libraries only those libraries need. The dialog names all of them
and offers "Remove [addon] only", selected when the dialog opens, and
"Remove both" ("Remove all" when there are several). A library the user keeps stays a library, unneeded until
something needs it again.

We rejected keeping the global sweep with a fuller dialog, because removing
one addon should not delete libraries unrelated to it. We also rejected
storing each dependency list with the provider it came from. That list would
survive a source change, but only CurseForge supplies these lists, and an
addon installed from a file can never refresh one. The cost is that unneeded libraries can now
build up. A separate ticket marks them in My Addons so the user can remove
them.
