# Addon archive fixtures (WF-09)

Archives the host-tool path of `ArchiveExtractor` unpacks. All hold the same
made-up addon, laid out like RestedXP Guides 4.11.26 (a RAR an owner was given
instead of a zip): one top-level folder with several flavor TOCs and a library
with its own TOC below it.

```
RXPLite/RXPLite.toc            ## Interface: 11509, 38002, 50504, 120100 / Title: RXP Lite / Version: 4.11.26
RXPLite/RXPLite_Vanilla.toc
RXPLite/RXPLite.lua
RXPLite/Guides/README.md
RXPLite/libs/HereBeDragons/HereBeDragons.toc
```

- `rar5-addon.rar` — RAR 7.23 `rar a -ma5 -s -rr3% -qo+ -m5`: RAR5, solid, with a
  recovery record and quick-open data, like the real archive (libarchive's
  bsdtar fails at the end of such archives).
- `addon.7z` — 7-Zip 26.04 `7zz a`.
- `symlink.7z` — 7-Zip `7zz a -snl`: `Evil/Evil.toc` plus `Evil/escape`, a
  symbolic link to `/tmp`. 7-Zip recreates the link on extraction, so the
  extractor must reject the archive.
