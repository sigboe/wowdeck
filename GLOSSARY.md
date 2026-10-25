# wowdeck

## Contents

- [Language](#language)
- [Get Addons rework](#get-addons-rework)

A Decky plugin that manages World of Warcraft addons on the Steam Deck. This
glossary fixes the language used across UI, engine and docs.

## Language

**QAM**:
Steam's Quick Access Menu: the overlay panel on the right edge of the screen,
hosting Valve's sections and this plugin.
_Avoid_: quick menu, side panel

**QAM section**:
One of Valve's tabs in the QAM's icon rail (Friends, Notifications, …). The
plugin occupies one section.
_Avoid_: QAM tab

**Plugin tab**:
One of the plugin's three top-level tabs: My Addons, Get Addons, Options.
_Avoid_: section, page

**Nav bar**:
The plugin tab bar (My Addons, Get Addons, Options) rendered by Decky at the
top of the QAM section. Navigation is clamped: L1/R1 never wrap past the first
or last plugin tab.
_Avoid_: tab row, pill row, browse nav bar

**Destination**:
One of the four Get Addons lists: Search, Latest, Popular, Manual Install.
_Avoid_: browse tab, sub-tab, category

**Manual Install**:
The fourth destination: installing by hand instead of searching a catalogue.
Its pane holds two labeled paths — From a link (a pasted URL) and From a
file (a local .zip/.rar/.7z picked with Steam's file picker). Distinct from
a *manual installation*, which is a WoW install added by hand in Options.
_Avoid_: From URL (the pre-2026-10-24 name), Install from URL, install from file

**Destination list**:
The vertical list of destinations in the collapsed Get Addons tab, drawn in
the visual language of the Friends favorites list (icon + label, focused row
highlighted).
_Avoid_: nav bar, menu, sidebar

**Widened mode**:
The Get Addons state in which the QAM widens beyond its standard column so the
selected destination's pane can sit beside the destination list. Otherwise the
tab is collapsed at the standard width.
_Avoid_: expanded, slid-out

**Pane**:
The right-hand area of widened mode holding the focused destination's browse
UI (search field, result lists, URL form) — the "chat" of the Friends analogy.
Addon details are not a pane; they open in the existing details modal.
_Avoid_: detail pane, chat pane, sidebar

**Browse bar**:
The single picker row of the pane: one self-contained component rendered above
the result lists. It decides which of its segments exist for the active
destination (Popular → Source, Category; Latest → Source; Search and Manual
Install have no bar), draws them in the fixed order Source then Category, and
hides
whatever the current sources cannot act on — disappearing entirely when
nothing can be chosen. There is at most one bar row, ever; entering a
destination lands focus on the first result row, never the bar.
_Avoid_: picker row, filter row, toolbar, Source menu

**Segment**:
One of the browse bar's items: the Source segment (switches catalogue) or the
Category segment (narrows the active source's list). Segments close up to the
left when one of them is hidden. A segment's choices open in an in-pane menu
(a list inside the pane, never a Steam popup — ADR 0002 revision 2026-10-24).
A category is the active source's content grouping with provider-specific
ids — it is never one of the four destinations.
_Avoid_: menu, picker, dropdown row, tab

**Options jump**:
Navigation from Get Addons to Options' Addon sources section carrying a set of
marked provider ids. Their rows blink briefly, then focus lands on the first
marked row that can take focus; the jump never enables or disables anything.
_Avoid_: deep link, shortcut, quick toggle

**Full-screen route**:
A plugin page rendered by Steam at viewport size (e.g.
`/wowdeck/get-addons`) instead of inside the QAM. _Avoid_: full-screen
modal
_Retired_ (2026-10-18): the plugin no longer renders one — Get Addons became
the widened QAM tab (ADR-0001, `docs/adr/0001-get-addons-widened-qam.md`);
the word stays for Steam-surface talk.

**Status tag**:
A small uppercase chip on an addon row stating its state at a glance
(`wowdeck-status-tag`). My Addons rows show Ignored, Unmanaged, Library,
Updated, Paused and the release channel; Get Addons results and their details
modal show Installed or Update available, and Updated, on their own line under
the name. A result counts as installed when My Addons has an addon with the
same provider and id in the active installation.
_Avoid_: badge, pill, label

## Get Addons rework

**Title bar**:
The plugin heading Decky renders at the top of the QAM section, with Decky's
own back button on its left. The title text is left-aligned and vertically
aligned with the button; there is no second, in-content title bar.
_Avoid_: header, title float, Browse title bar

**Details modal**:
The existing addon details dialog (identity header, description, changelog,
screenshots, install controls). It is the only details surface in Get Addons;
A on a result row opens it, X installs.
_Avoid_: detail pane, details pane

**Focus memory**:
The plugin restores where you were on each plugin tab. One exception: entering
Get Addons always lands collapsed on the nav bar and never restores the
slid-out state; widened mode is entered only by focusing a destination.
_Avoid_: state restore
