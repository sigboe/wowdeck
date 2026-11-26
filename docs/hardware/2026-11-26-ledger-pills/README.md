# Dashboard and Ledger pills (PR #318 review)

## Build and fixture

The brief named no target, so the run used the default, the owner's Steam
Deck. The build was `feat/308-ledger` at `98bc53a`, a frontend-only change.
`deck up` found the build already installed. The Deck's
`dist/index.js` SHA-256 matches the local build, before and after the run:
`c89d1733094e85736161dd36a81dfbc01fef98e5d8c55e11ca68709466b9bc62`. The
engine stayed as it was (backend 1.3.0).

The Deck was docked: Big Picture was 1500 CSS px wide. The QAM page is
855 CSS px wide either way, and the widened QAM shows all of it, so the
Get Addons pane was 507 px wide (348 to 855), the width it has on the
handheld screen. That equivalence is inferred from the QAM page width, not
seen on the handheld screen. The owner checks handheld resolution.

Fixture: Forever `5e80311f078e`, account SIGURDJNB, realm Normal, 179
traded items (5 pages). The brief asked to reuse a temporary Forever
fixture of 55 items from `docs/hardware/2026-11-25-ledger-323/`. That
report describes no temporary fixture, and Forever already holds more than
40 items, so the run installed and changed nothing.

The run left the Deck on Forever with the tested build installed, the QAM
closed, autoUpdate on and the tunnel closed. The Ledger keeps the session
state the run set: realm Normal, Sold ▼, page 2. In-memory hooks (a
`DeckyBackend.call` wrapper in SharedJSContext, scroll and mutation
recorders in the QAM page) were removed and checked gone afterwards.

Screens are in the session scratchpad
(`/tmp/claude-1000/-home-sigurdb-project-wowdeck/9df6d87a-51b1-4af9-9954-485d9615a391/scratchpad/lp/`):
`l-top.png` (Ledger at the top), `l-stuck2.png` (header stuck),
`dash1.png` (Dashboard), `wowhead.png`, `resume.png`.

## Results

DEVICE, 26 November 2026. The method is UI: pad presses, DOM probes in the
QAM page, and screenshots. LEDGER-PILL-2's reads were seen by wrapping
`DeckyBackend.call` in SharedJSContext.

| Claim | Result | Evidence |
| --- | --- | --- |
| LEDGER-PILL-1, three pills fit the title row | passed | "TradeSkillMaster" 373 to 495 px, not cut. Auction data 536 to 651, Dashboard 652 to 752, Ledger 754 to 831, all at y 8 to 42, none overflowing, inside the 831 px bar. From Export, Up gave "LEDGER". Right printed `no change`. Left went Dashboard, Auction data, then "TradeSkillMaster" in the destination list. Focusing a pill switches the view. |
| LEDGER-PILL-2, Dashboard and Ledger content, no read on switching | failed | Content passed: the Dashboard shows Realm, Character and Period, "Recorded at last logout · 4 minutes ago", the gold graph and the figures, with no Export and no All items. Realm Normal picked there; the Ledger shows Normal, then Export ("Normal · every character and period"), "179 items" and 40 rows. **Failed: every switch reads again.** See below. |
| LEDGER-PILL-3, columns, header, stuck header, fade | failed | Passed: no cell overflows and no amount runs onto a second line (40 rows). The header sticks right under the title row (gap 0.01 px, no row between), and its fade shows only once rows scroll under it. **Failed: the labels don't line up with the values, and Item breaks names mid-word.** See below. |
| LEDGER-PILL-4, Up, sort, page, Wowhead round trip | passed | Up from the first item (scrollTop 0) gave "ITEM", with no scroll event or changed frame. Right, A: "SOLD ▼", page 1 starting Heavy Linen Bandage 77, Linen Bandage 40, Linen Cloth 36. R2: page 2, focus Ornamental Mace, Previous page shown. Up, Up: Previous page, then "SOLD ▼", no scroll. Down to Compact Shotgun, A: route `/routes/externalweb`, `wowhead.com/forever/item=4577/compact-shotgun`. B returned to the game page. Open, back to Get Addons, TradeSkillMaster, Right: focus "Compact Shotgun", header "Sold ▼", page 2. Left, then Right again: focus "Export". |
| LEDGER-PILL-5, Y and Left along the header | passed | Page 2 sorted by Sold, an item 15 stops down at scrollTop 598 with the header stuck. Y gave "SOLD ▼". Left gave "ITEM", Left again gave "TradeSkillMaster" in the destination list. scrollTop stayed 598 at focus and at 16, 50, 100, 200 and 400 ms after each move, with no scroll event and no frame at another position. |

### LEDGER-PILL-2 detail

Engine calls per switch, with the 1 s `tradeskillmaster.status` poll and
`launch.state` left out. Twice in each direction:

- Ledger to Dashboard: `tradeskillmaster.ledger` (Normal, All, plotWidth
  440), about 0.5 s after the press.
- Dashboard to Ledger: `tradeskillmaster.ledgerItems` (offset 0) and
  `tradeskillmaster.ledger`, about 0.5 s after the press.

The Dashboard showed its figures at once. The Ledger's list showed
"Reading Ledger items…" in place of the rows for about 100 ms on every
switch to it (mutation observer: 7660443 ms "Reading Ledger items…",
rows 0; 7660545 ms rows 40), so the list flickers.

Likely causes, from the code: `useTsmLedgerItems` forgets its page when it
unmounts (`src/tsmReads.ts:222`), so the list reads from empty each time.
The `ledger` read is the keyed resource's own rule, "returning to a key
revalidates it" (`src/keyedResource.ts:174`); it reads silently.

### LEDGER-PILL-3 detail

Ledger, page 1, usual order, then Sold ▼ page 2. Tracks
`minmax(0, 1fr) 59px 76px 79px 66px 63px`; the Item column is 56 px wide.

- **Labels 12 px off.** The header text sits 12 px inside the row text in
  every column: the Item label starts at 385 px, the names at 373. The
  numeric labels end 12 px before the values do (Sold label ends at 488,
  values at 500; Net 819 and 831). Same on all 40 rows. The labels row is
  inset by its own padding (6 px) plus each header cell's (6 px), while
  the rows' text starts at the header's left edge (373 px).
- **Item breaks words.** At 56 px, 23 of 40 names on page 1 break inside a
  word: "Leggin|gs", "Plaguef|ang", "27987|4", "Waylai|d", "Chippe|d
  Quarte|rstaff", "Cauldr|on". The longest name takes 6 lines. No value is
  hidden, but the names read badly.
- **Stuck header.** At scrollTop 0 the header is in the flow at 206 px and
  neither fade shows. At scrollTop 30 the title row's fade shows and the
  header's does not. From scrollTop 295 on, the header sits at 49.99 to
  75.95 px under the title row (0 to 49.98), gap 0.01 px, no row box
  between them, both fades on. The focused row stayed 243 px or more below
  the header. A screenshot taken while Steam's smooth scroll ran showed a
  few faint marks at the seam; settled screenshots and clipped shots of
  the title row and header are clean.

## Known limitations

- The Deck was docked. The pane width matches the handheld one by
  inference; the owner checks the handheld screen.
- Up from the first item was seen only with the list at the top (page 1
  and page 2), since the first item is always near the top.
