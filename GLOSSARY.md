# wowdeck

## Contents

- [Language](#language)
- [Get Addons rework](#get-addons-rework)
- [WoW clients](#wow-clients)
- [Addon archives](#addon-archives)
- [Addon recovery](#addon-recovery)

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
One of the Get Addons lists: Search, Latest, Popular, Manual Install, and
the TradeSkillMaster destination while that source is on.
_Avoid_: browse tab, sub-tab, category

**Catalogue**:
What the addon sources offer, as opposed to what is installed: search, the
Latest and Popular lists, an addon's details and categories, resolving a
pasted link, and finding a source for a folder. Read-only: asking the
catalogue never changes an installed addon. When several sources are asked
at once, one failing never stops the others; its failure is reported beside
their results.
_Avoid_: browse service, store

**Manual Install**:
The fourth destination: installing by hand instead of searching a catalogue.
Its pane holds two labeled paths — From a link (a pasted URL) and From a
file (a local .zip/.rar/.7z picked with Steam's file picker). Distinct from
a *manual installation*, which is a WoW install added by hand in Options.
_Avoid_: From URL (the pre-2026-10-24 name), Install from URL, install from file

**TradeSkillMaster**:
An addon source like the others, for the TradeSkillMaster addon and its
TradeSkillMaster_AppHelper library (the source lists the library as required
by the addon). Shown in Options' addon sources, off until the user turns it
on, and usable only while the user is also signed in to a TradeSkillMaster
account. Turning it on starts sign-in; successful sign-in turns the source
on. While usable it owns the
TradeSkillMaster and TradeSkillMaster_AppHelper folders: no other source
can claim or take them. A source left on while its session ended elsewhere
(revoked, password changed) is **signed out**: a blue dot on Options and on
its source row asks the user to sign in again, and its destination offers an
Options jump to that row.
_Avoid_: TSM app, TSM provider (in UI text), logged out

**Developer addon**:
A TradeSkillMaster or TradeSkillMaster_AppHelper folder that is a git
checkout or carries a development version instead of a release. WoWDeck
never matches or replaces it, whether the TradeSkillMaster source is on or
not. Other addons' git checkouts are left alone as ignored addons.
_Avoid_: dev build, dev copy

**TradeSkillMaster destination**:
The destination listed after Manual Install, present only while the
TradeSkillMaster source is on, whether usable or signed out. It installs
the addon for the active installation and shows the state of its auction
data; while signed out it offers the way back to signing in instead.
_Avoid_: TSM page, TSM tab

**Auction data**:
The price data TradeSkillMaster publishes per auction house and per region,
written where the AppHelper library hands it to the addon. It belongs to the
followed realms of the signed-in account.
_Avoid_: TSM data, AppData, price strings

**Followed realm**:
An auction house on the signed-in TradeSkillMaster account's list: a realm,
or one faction's house on a realm with separate faction houses. The list is
the account's, shared with TradeSkillMaster's own app on other computers,
and its length is capped by the account's tier.
_Avoid_: tracked realm, subscribed realm, server

**Library**:
An addon installed only because another addon needs it. An addon needs a
library when its source lists the library as required, or when its TOC
names the library's folder as a dependency, optional ones included. A library
nothing needs is **unneeded**; it is removed only when the user chooses to.
Installing an addon never replaces a library already on disk, whatever its
source (ADR 0009).
_Avoid_: dependency (that is the relation, not the addon), orphan (in UI text)

**Source change**:
Switching an installed addon to another source while it stays the same
addon: Change source, or Manual Install replacing a catalogue addon with an
archive (the takeover). The libraries it needs stay needed.
_Avoid_: provider switch, reinstall

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
destination (Popular → Source, Category; Latest → Source; Search, Manual
Install and TradeSkillMaster have no bar), draws them in the fixed order
Source then Category, and hides
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
ids — it is never a destination.
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

**Update dot**:
A 10 px dot pinned to the top-right corner of a tab pill or button, saying
"news here" in a semantic colour (`UpdateDot`, `updateDot.ts`). Orange, Decky's
own notification-badge colour, marks a WoWDeck update: on the Options tab and
the panel's Update button. Blue marks something the user must do: a signed-out
source, on the Options tab and the source's row. No counts.
_Avoid_: badge (that is the Steam library tile's).

**Update channel**:
Which WoWDeck builds the owner is offered: **Stable** (releases from `main`,
"Recommended for most users.") or **Beta** (builds of every change merged into
`next`, "Built from every merged change. Newer features, may have bugs."), the
two the owner picks, or the **PR channel** of a running PR build.
Beta also offers a stable release when it is newer than the latest beta build;
leaving Beta offers the latest stable even when it is older ("Switch to
stable"). Set under Options › Updates › WoWDeck. Installing a beta selects Beta;
installing a stable zip by hand selects Stable. An in-app stable update keeps
Beta selected unless **Move to Stable after release** is on (off by default;
in the channel picker while Beta is selected), which selects Stable as soon as the stable package is verified and staged. A channel chosen in Options stays selected across
restarts.
A test build (`X.Y.Z-test.N`, made for device testing, never published) is on
no channel: no channel is checked, Check again is hidden, and the channel
picker always offers the chosen channel's newest build ("Switch to beta X",
"Switch to stable X") — the way out of a test build.
_Avoid_: release channel (that is an addon's Stable/Beta/Alpha).

**PR channel**:
The update channel a PR build is on: its own pull request ("PR #210"). The
owner never picks it from the list; installing the PR's build joins it, and
picking Stable or Beta leaves it. It is checked like the other channels, so a
newer build of the same PR is offered with the usual dot and toast; with
nothing newer it reads "Up to date with PR #N". Once a beta contains the
merged PR, the owner is moved to Beta and that beta is offered as the update,
though its version sorts below the PR build's. A PR closed unmerged or no
longer listed says so and offers the chosen Stable or Beta channel's newest
build; the owner stays on the PR channel until pressing it, so a PR listed again
offers its newer build. Nothing installs without the owner's press.
_Avoid_: PR mode, PR track

**Test build**:
A WoWDeck build made by hand on a developer's machine, versioned
`X.Y.Z-test.N`. It sits on no update channel; neither channel offers one.
_Avoid_: PR build (that one comes from CI).

**PR build**:
A WoWDeck build CI made from an open pull request a maintainer labeled
`pr-build`, versioned `X.Y.Z-pr.N` (`X.Y.Z` is the release it is based on, `N`
the PR number; a rebuild adds a counter, `-pr.117.2`). It sits on its PR
channel. Options › Updates › WoWDeck › channel picker › "PR builds…" lists the
open, labeled PRs; installing one asks the owner to confirm first. A new commit
rebuilds it when a maintainer pushed it; a push by anyone else removes the
label and the PR leaves the list until a maintainer labels it again.
Once the PR is merged and no beta contains it yet, the update panel says one
is still building.
_Avoid_: test build (that one is built by hand), preview.

**Release notes**:
What the offered WoWDeck build brings, written for players from our
`CHANGELOG.md`. Y on the Update button, or on the WoWDeck row under
Options › Updates, opens them in a modal that also offers Update. Neither
shows them inline.
_Avoid_: changelog (that is an addon's, in its Details modal).

**Check again**:
A WoWDeck update check the owner starts by hand (X on the Update button or
on the WoWDeck row under Options › Updates). Unlike the automatic checks, it
asks GitHub right away, even when the daily check already ran or a failed
check is waiting to retry.
_Avoid_: refresh, force check (in the UI).

**Status tag**:
A small uppercase chip on an addon row stating its state at a glance
(`wowdeck-status-tag`). My Addons rows show Ignored, Unmanaged, Library,
Updated, Paused and the release channel; Get Addons results and their details
modal show Installed or Update available, and Updated, on their own line under
the name. A result counts as installed when My Addons has an addon with the
same provider and id in the active installation.
_Avoid_: badge, pill, label

**Funding link**:
One platform where players can fund WoWDeck (Ko-fi, Patreon, PayPal, …): its
URL and the QR code a phone scans to open it. A Bitcoin address is a Funding
link too, with a QR code for wallet apps. Shown under Options › About.
_Avoid_: donation link, sponsor link

**Supporter**:
Someone who funded WoWDeck and asked to be credited by name. Credit is
opt-in only: a name with no link, amount or tier.
_Avoid_: donor, backer, patron, sponsor

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

## WoW clients

**Forever**:
The live World of Warcraft: Forever client, installed in `_forever_`. It runs
the Retail game binary; only its folder tells it apart from Retail.
_Avoid_: Forever Live, WoW Forever (in the UI)

**Forever Beta**:
The World of Warcraft: Forever beta client, installed in `_classic_beta_`.
Called plain "Forever" before Forever launched (until 2026-10).
_Avoid_: Forever (beta), Classic Beta

**Settings copy**:
Restoring one WoW version's WTF (its current settings or one of its backups)
into another version's installation. The source is only read; nothing moves.
_Avoid_: migrate, transfer, cross-flavor restore

## Addon archives

**Addon folder**:
A folder containing at least one `.toc` file directly inside it. Its TOC's
presence alone does not establish compatibility with a particular WoW client.

## Addon recovery

**Previous version**:
A saved addon version available through Roll back.
_Avoid_: "recovery copy", which belongs to an unfinished addon operation.

**Recovery copies**:
Addon folders preserved to recover from an incomplete addon operation. They
are distinct from the previous version offered through Roll back.
_Avoid_: "kept files", which also describes the previous version.

**Recovery required**:
The state of a WoW installation whose unfinished addon operation leaves its
addon state uncertain. Further addon changes pause until recovery resolves it.
_Avoid_: "broken installation", which suggests WoW itself cannot run.
