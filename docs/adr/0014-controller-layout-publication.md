# Controller layouts require review and explicit application

Owner decision during the controller-layout design interview, 17 November
2026. Maintainers approve every submitted layout revision before WoWDeck
offers it. An author's later changes require another review. WoWDeck credits
the author, retains revision history and provides a way to report problems.
The catalogue and submission policy are recorded in ADR-0015. Delivery
remains undecided.

Approval makes a revision available in the catalogue. Applying it requires
the player's explicit choice, including when a newer approved revision
exists. Personal edits must survive an offered update. Author updates must
not silently change a player's controls.

When maintainers withdraw a revision, clients that receive the withdrawal
stop offering it for new applications and warn affected players. Preserve
their existing controls. Applying a replacement or restoring earlier
controls still requires the player's choice.

This decision defines the publication and application policy for the planned
feature. The [device experiments](../hardware/2026-11-17-controller-layouts/README.md)
established local snapshot application and recovery of decoded mappings on
one controller. Restart and cloud durability remain untested. Identically
named shortcuts shared a selection, so choosing a different app ID alone
does not establish isolation.

Steam share links identify mutable items rather than approved content
revisions. Source research does not establish whether applying one freezes
a local copy or follows later author changes. Establish how to deliver and
preserve an approved revision before claiming review guarantees for native
preview or application. Keeping the old selection URL alone does not prove
that the player's previous bindings can be restored.
