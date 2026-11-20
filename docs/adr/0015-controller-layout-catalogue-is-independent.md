# Publish the controller-layout catalogue independently

Owner decision during the controller-layout design interview, 17 November
2026. Keep reviewed layout metadata and approved revisions in a separate
public GitHub repository,
[sigboe/steam-input-layouts](https://github.com/sigboe/steam-input-layouts).
It holds one catalogue folder per game, and WoWDeck reads `wow/`. Each
folder keeps its own history, and `CODEOWNERS` can give it its own
reviewers. Publish catalogue updates independently of WoWDeck
releases so layout submissions have their own review history and permissions.
WoWDeck reads the catalogue as a static file from that repository, which
costs nothing. How an approved layout reaches Steam remains undecided until
Steam integration testing establishes what works.

The launch catalogue contains two layouts in maintainer-chosen order. It
needs no search, sorting controls or browse bar. Catalogue growth can add
those controls later without changing layout identities. Options uses the
section title Sources and the short toggle label Controller layouts. The
layout catalogue remains separate from addon search and installation.

Only layouts already published on Steam are eligible. A future public intake
endpoint receives nominations of those items for maintainer review. Authors
publish through Steam; nominating an item does not establish authorship or
approve its revisions. WoWDeck need not receive uploaded VDFs or maintain
author accounts for this workflow.

Browsing, previewing and applying layouts require no additional WoWDeck
account. Nominations must not require GitHub login on the Deck. Steam
authentication through WoWDeck is out of scope. In a device experiment, a
server-side public Steam details request resolved a known item and its file
URL without a player's login or an API key. This observation does not grant
permission to report playtime or perform other authenticated actions.

The first public release has no user-submission feature. Maintainers curate
the initial catalogue. If the UI mentions future submissions, use a small
noninteractive note with no release date rather than a disabled button.
Aim for free hosting initially. Plan for email verification if it
enables useful submission updates, but defer that capability too.

Future nomination intake, validation and moderation need a proven workflow
before submissions ship. Steam-link nominations replace the proposed ZIP
upload and Deck-to-phone file server. Keep published-item identity separate
from approved content identity because a Steam item can change after review.

The first release may offer curated discovery, native preview and explicit
application without every requested popularity metric. This does not waive
planning for later capabilities. Catalogue evolution must account for older
clients, and publishing catalogue changes must not silently change players'
controls. Research all requested metrics and show only those whose meaning
and provenance we can establish.

The owner set a US$5 monthly planning ceiling for paid hosting. This is not
purchase approval. Present any higher-cost option with its justification.
