# Get Addons browse bar: the picker layer is one bar, enablement lives in Options

Owner decision, grilling session 2026-10-22
(`.scratch/get-addons-filter-bar/spec.md`). The widened pane had accreted
picker chrome the way browser toolbars once did: in Popular, Source and
Category were two stacked selector rows above the results, every newly invented
picker earnt itself another row, and with a single enabled provider Latest and
Popular still led with an entire menu of "(off)" entries that existed to feed
turn-on offers. The decision replaces all of it with at most one row: a single
self-contained **browse bar** above the results owns the pane's picker layer.

The bar derives its items from a per-destination item registry — Popular →
Source, Category; Latest → Source; Search and From URL have no bar — renders
them in the fixed order Source (left), Category, and hides whatever the current
sources cannot act on: with one valid discover source there is no Source
segment, with a source that has no categories there is no Category segment, and
nothing to choose means no bar at all; remaining segments close up to the left.
The bar is one component whose decision layer is pure and centralised in the
existing shared source-access helper module, derived from engine capability
flags (discover-capable, searchable by name) so a new provider appears
correctly without UI changes; no provider name is hardcoded in logic — vendor
names appear only in copy. Source picks are remembered per list destination,
kept while the pick still exists, and fall back silently to the first valid
discover source otherwise; category ids are provider-specific and never cross
providers, so switching source inside the bar resets the category to that
source's "all" option, with category data from the engine's per-provider
category lookup, fetched only for a category-capable source.

**Enablement contract.** Options' sources settings is the only surface that
enables, disables or advertises setup for a source. Picker menus list only
valid sources — no "(off)" or "(not set up)" entries anywhere. The one in-pane
remnant of provider state is the zero-capability screen (one shared component,
parameterised by capability — lists vs name-search — with icon, title, body and
status all derived), whose button opens the Options sources section and
blink-highlights the compatible sources' rows, first focus on the first of
them; nothing is toggled. This deliberately **reverses the in-pane turn-on
offers shipped in dfc422d** ("feat: Get Addons lists per source, with turn-on
offers"): those offers are removed everywhere above zero-source and are not to
be rebuilt — availability is now checked once, in the bar's decision layer,
instead of independently in the Source row, the Category row and the offers.

The bar is a change inside the pane, not a redesign of it: the widened-QAM
mechanism, destination list and modal details of ADR-0001
(`docs/adr/0001-get-addons-widened-qam.md`) are unchanged. Entry focus gains no
new stop: entering a destination lands focused on the first result row, the bar
and its segments are reachable with focus movement after entering, and modal
round trips keep behaving per ADR-0001's PC-09 exception.

_Before acceptance_ two things still need the Deck: the inline two-segment
geometry at the measured pane size (the same component with stacked slots is
the fallback shape if inline dropdown behaviour fights platform focus
handling), and the blink attention effect — the one brand-new presentation
pattern in this feat, per the UI guide's device rule. Vocabulary: "bar" and
"segment" are fixed in `GLOSSARY.md`; a destination stays one of the four Get
Addons lists (Search, Latest, Popular, From URL) and is never conflated with a
category.

**Revision (2026-10-24, PC-20).** The segments' menus no longer open as
Steam context-menu popups (`@decky/ui` `Dropdown`): they open as a list
inside the pane (`SegmentMenu`). Measured on device, every Steam popup (and
every modal) hides the QAM BrowserView entirely, and its close replays
Steam's QAM entrance — placed 300 px right of the target, then a ~300 ms
slide back — which over the widened pane read as the QAM contracting
part-way and widening again on every pick (the `showWithoutClosing` fix
kept the session alive across the popup but could not keep the view on
screen). The in-pane list keeps the QAM visible, the panel mounted (no G4
round trip and focus restore) and focus inside the pane; the picker
vocabulary stays Valve's — caption over a value button, the context-menu
column with the current choice checked, A picks, B cancels. Other popups
(the installation pickers, the row choice menus, details) stay Steam's for
now; the same treatment is the agreed follow-up if their entrance replay
bothers in use.
