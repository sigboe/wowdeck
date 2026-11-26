# Ledger All items: sortable header, Sold and Bought, rarity colours (#323)

## Build and fixture

The brief named no target, so the run used the default, the owner's Steam
Deck. The build was `feat/323-ledger-sort` at `e96241e` (based on
`feat/308-ledger` `55c2f0c`), frontend and engine. `deck up --engine`
deployed both. The deployed `dist/index.js` SHA-256 matches the local build:
`2c450bc4e4530293a00dcd37c9e312cae7419297b431ea19367115161ce7e55b`. The
engine binary hash differs from the local one because deployment patches
it, so the engine was identified by behaviour instead:
`tradeskillmaster.ledgerItems` accepted `sort` and `descending` and returned
`sold`, `bought` and `quality`.

The Deck was docked: Big Picture was 1500 CSS px wide and the All items
dialog's inner width was 1364 px, not the handheld ~806 px. The run
measured at 1364 px and again with the dialog held at 806 px inner width by
an in-memory style. It removed that style afterwards.

Fixtures, nothing installed or changed:

- Forever `5e80311f078e`: 148 items. Qualities: 59 poor, 50 common, 21
  uncommon, 1 rare (Axe of Orgrimmar), 17 unnamed (no quality). No epic,
  legendary, artifact or heirloom.
- Classic Era `032c354a655f`: 1,886 items, 48 pages. Every quality is null:
  the installation stores the older names-only list, which has no quality
  (`ItemNames.ts`), so every name keeps the row's text colour. This is the
  widest-row fixture: Spent up to 78g, Sold up to 2,385, names up to 49
  characters.

The run left the Deck on Forever with the tested build installed,
autoUpdate back on, the QAM closed and the tunnel closed. It reloaded the
plugin to drop data cached under the quality hook described below.

Screens are in the session scratchpad, `s01` to `s12`.

## Results

DEVICE, 25 November 2026. The method is UI: pad presses, DOM probes in the
modal's navigation document, and screenshots.

| Claim | Result | Evidence |
| --- | --- | --- |
| 1. All items header | partial | See below. Passed: focus stops, Up and Down, Left/Right stops, Y, the A cycle, Item sort, L2/R2, sticky header. Failed: focusing the header from a scrolled list jumps the list to the top. Pending: the bell (audio). |
| 2. Wowhead round trip keeps the sort | passed | Forever, Sold ▼, R2 to page 2, Down ×2 to "Scroll: KWYJIBO". A: route `/routes/externalweb`, no modal. B returned to the game page. `open` landed on "All items (148)". A reopened the list with header "Sold ▼", Previous page shown (page 2), and focus on ROW2 "Scroll: KWYJIBO". B, then A: page 1, no arrow, focus on Rough Bronze Leggings (usual order). |
| 3. Widest row, colours, white on focus | partial | Fit and wrapping passed at both widths. The rarity colours show, and poor, rare, epic and legendary turn white on focus. **Failed: rare and epic names reach only 3.7:1 on an unfocused row**, see below. Epic, legendary, artifact and heirloom were seen only through an in-memory quality hook. |

### Claim 1 detail

Forever, page 1 in the usual order unless stated.

- **Focus stops:** the header holds six cells, Item, Sold, Earned, Bought,
  Spent and Net. Up from the first item gave focus "ITEM". Right ×5 went
  Sold, Earned, Bought, Spent, Net. A sixth Right, Left on Item and Up on
  Net each printed `no change`.
- **Down:** Down from the header went to the first item (page 1). On page 4
  it went to Previous page. Up from the first item on a later page went to
  Previous page, and Up from there to the header.
- **Y:** Y on row 9 with Earned ▼ gave "EARNED ▼". Y on rows 12 and 15
  in the usual order or with Item ▲ gave "ITEM" or "ITEM ▲". Y on a header
  cell does nothing. The footer reads Y "Sort", R2 "Next page", A "Open on
  Wowhead" and B "Back". The run's virtual pad sometimes draws Xbox-style
  glyphs, where the same north button shows as X.
- **A on Earned:** three presses gave "EARNED ▼", "EARNED ▲", then
  "EARNED". ▼ starts Rough Bronze Leggings 69s 24c, Plaguefang 24s 47c, The
  Stitcher 23s 66c. ▲ starts with the items that earned nothing (Tin Ore,
  Murloc Eye, Lesser Healing Potion), then rises to Item 3833 at 24c on the
  page's end. Off restores the usual first rows. Focus stayed on the cell
  every time. From page 3, A on Item went back to page 1 (no Previous page)
  at scrollTop 0. scrollTop was already 0 before that A, because focusing
  the header had scrolled the list (see the failure below). So the run did
  not see A's own scroll reset on its own.
- **A on Item:** "ITEM ▲" sorts A to Z: page 1 ends with Heavy Copper Maul and
  Heavy Hammer, page 4 starts with Withered Staff and ends with i:3273 …
  i:286742. All 17 unnamed items come last, in
  item ID order (checked over RPC for the whole page). The second A gives
  "ITEM ▼", Z to A (Worn Mail Belt, Worn Leather Vest, …).
- **L2/R2 from the header:** R2 on "ITEM ▲" loaded page 2 and focused its
  first row. L2 on the header on page 4 loaded page 3.
- **Sticky header, focus never under it:** at scrollTop 138 to 505 the
  header sits at y 40 to 66, the top of the scroller. Walking Up 20 rows
  from row 18 at scrollTop 505, the focused row's top stayed between 50 and
  612 px below the header's bottom. It never went under it.
- **Failed: focusing the header jumps the list to the top.** On row 15 at
  scrollTop 241, Y focused "ITEM ▲". A scroll listener on the dialog
  scroller recorded one scroll event, from 241 to 0, with no animation. Row 12 at
  scrollTop 138 did the same. The item the player was on leaves the
  screen, and Down then goes to the list's first stop, not back to that
  item. Up from the first stop is not affected, since the list is already at
  the top. The brief's fallback for this case is a single "Sort: Volume ▾"
  menu stop.
- **Pending: the bell.** The edge presses all printed `no change`, and the
  header's handler passes those buttons on, so Steam's navigation runs. No
  path records the sound. Hooks on `AudioBufferSourceNode.start` and
  `HTMLMediaElement.play`, in SharedJSContext and QuickAccess, recorded
  nothing, even for an ordinary move. To test it, the owner listens on the
  Deck: Left on Item, Right on Net and Up on any header cell should each
  ring once.
- Note: the column widths change as the sorted cell gains its arrow and
  as pages change. For example, Earned's track is 98 px or 87 px, and
  Earned's left edge moves from 1135 to 1122 when ▼ appears.

### Claim 3 detail

**Fit (Classic Era, widest pages).** The run probed Earned ▼, Spent ▼, Sold
▼, Net ▲ and Item ▲ page 10, which holds the longest names. At 1364 px:
the tracks are at most `minmax(0,1fr) 59 98 66 98 105` px, and the Item
column is 852 to 870 px. No cell's `scrollWidth` exceeds its
`clientWidth`, and every amount is on one line. The widest amount set is
Silk Cloth: 890, 23g 38s 6c, 831, 48s 57c, 21g 89s 49c (323 px of content).
At 806 px inner width (simulated): the Item column is 305 to 327 px, there
is still no overflow, and every amount stays on one line. Five
"Formula: Enchant …" names wrap to two lines (45 px rows), shot `s12`.

**Colours.** Forever names show WoW's colours: poor `#9d9d9d`, common
white, uncommon `#1eff00`, rare `#007cf4`. With an in-memory hook in
SharedJSContext that set four rows' quality (Plaguefang epic, Tin Ore
legendary, The Stitcher artifact, Pyrite heirloom), they showed `#ae4df0`,
`#ff8000`, `#e6cc80` and `#00ccff`. The run removed the hook and reloaded
the plugin afterwards. On the focused row, poor (Chipped Quarterstaff),
rare (Axe of Orgrimmar), epic and legendary turned `#ffffff`. Uncommon,
artifact and heirloom kept their colours.

**Backgrounds measured.** An unfocused row paints its own background,
`rgb(35,38,46)` = `#23262e`. The focused row is `rgb(56,58,65)` =
`#383a41`. Both values come from computed style and from screenshot pixels.
The dialog behind the rows is `#0e141b`. `src/itemQuality.ts` assumes rows
on `#0e141b` and focus `#3d4450`.

| Quality | Colour | On row `#23262e` | On dialog `#0e141b` | Focused, as shown, on `#383a41` |
| --- | --- | --- | --- | --- |
| Poor | `#9d9d9d` | 5.58 | 6.82 | white 11.35 (own colour would be 4.19) |
| Common | `#ffffff` | 15.13 | 18.51 | 11.35 |
| Uncommon | `#1eff00` | 11.06 | 13.54 | 8.30 |
| **Rare** | `#007cf4` | **3.74** | 4.57 | white 11.35 |
| **Epic** | `#ae4df0` | **3.69** | 4.51 | white 11.35 |
| Legendary | `#ff8000` | 6.01 | 7.35 | white 11.35 (own colour would be 4.51) |
| Artifact | `#e6cc80` | 9.59 | 11.73 | 7.20 |
| Heirloom | `#00ccff` | 7.98 | 9.77 | 5.99 |

**Failed part:** rare and epic names sit on `#23262e`, not the dialog
background, so they reach 3.74:1 and 3.69:1, under 4.5:1. The lightening
in `itemQuality.ts` was computed against `#0e141b`. Every other colour
passes on both backgrounds, and every name shown on the focused row
passes.

## Known limitations

- The Deck was docked. Handheld 806 px was simulated by width alone; font
  scale and line height were those of the 1500 px layout. The owner checks
  handheld resolution.
- No real epic, legendary, artifact or heirloom items on the Deck. Classic
  Era has no qualities at all.
- No battle pets (`p:` items) in either fixture.

## Recheck at 0f8dfc8

### Build and fixture

The brief again named no target, so the run used the owner's Steam Deck.
The build was `feat/323-ledger-sort` at `0f8dfc8`, a frontend-only change
since `e96241e`. `deck up` deployed `dist/index.js` and kept the engine from
the first run. The Deck's `dist/index.js` SHA-256 matches the local build:
`f1ccbbccf1502d6420966360e3f9d0f41eb8f02af42d8d5371d0a208460977f5`.

The Deck was still docked (Big Picture 1500 px, table 1365 px wide). The
fixtures were the same, and nothing was installed or changed. The run left
the Deck on Forever with the tested build installed, the QAM closed,
autoUpdate back on and the tunnel closed. It removed every in-memory hook
and checked afterwards that none remained (`__rc`, `__wdQ` and `__wdSim`
undefined, `scrollIntoView` native).

To catch a scroll that jumps and comes back, the run used a recorder in the
dialog's document. It logged every `scrollTop` write on the list's scroller,
`scrollTo`, `scrollBy` and `scrollIntoView` calls, and scroll events. It
also logged every animation frame where `scrollTop` had changed. On each
`focusin` it sampled `scrollTop` at once (0 ms, inside the focus call) and
again at 16, 50, 100, 200 and 400 ms.

Screens are in the session scratchpad, `rc/colours.png`,
`rc/ce806-item-p10.png` and `rc/ce806-net.png`.

### Results

DEVICE, 25 November 2026. The method is UI: pad presses, DOM probes in the
dialog's navigation document, and screenshots.

| Claim | Result | Evidence |
| --- | --- | --- |
| 1. LEDGER-323-1, header focus from a scrolled list | passed | The list keeps its place. Focusing the header still jumps it to 0 inside the focus call, and the fix restores the old place before the next frame. No frame was drawn at another position. See below. |
| 2. LEDGER-323-3, rare and epic contrast | passed | Rare `#178dff` 4.53:1 and epic `#ba67f2` 4.55:1 on the row's `#23262e`. Poor, rare, epic and legendary show white on the focused row. |
| 3. Columns hold when the arrow appears | passed | Sold, Earned, Bought, Spent and Net keep the same x and width before and after A on Earned, on the same page. |
| Amounts on one line at 806 px | passed | No overflowing cell and no amount on two lines on five of Classic Era's widest pages. |
| The bell | pending | No path records the sound. The owner listens on the Deck: Left on Item, Right on Net and Up on any header cell should each ring once. |

### Claim 1 detail

Forever, usual order unless stated.

- **Y from a scrolled list (page 1).** Row 15, Staunch Hammer of Magic,
  at scrollTop 244. Y gave focus "ITEM", drawn at y 40 to 60 in the stuck
  header (40 to 66). Samples: 0 at 0 ms, then 244 at 16, 50, 100, 200 and
  400 ms. Log: the restore wrote 244 at 1 ms, one scroll event at 9 ms read
  244, and the 60 ms timer wrote 244 again at 62 ms. The frame watcher saw
  no frame at any position but 244. So the result is a jump then a restore,
  not "no change at all". Both happen in the task that moves focus, so the
  player never sees the jump. `scroll-margin-top: -24px` does not stop the
  jump; the restore in `focusHeader` undoes it. The margin was removed
  after this run, since it had no effect.
- **Y from a scrolled list (page 2).** Row 15, Vile Fin Oracle Staff, at
  scrollTop 294. Same result: 0 at 0 ms, 294 from 16 ms on, no frame at
  another position.
- **Up from the first item on page 2.** The run went Down ×10 (scrollTop
  83), then Up ×10 back to the first item. Steam scrolled smoothly to 33,
  with Previous page still in view under the header. Up gave Previous page
  and Steam's smooth scroll took the list from 33 to 0 over about 400 ms.
  Up again gave "ITEM" at scrollTop 0 with no scroll at all. Previous page
  is the list's first stop, so focusing it always brings the list to the
  top. This path never reaches the header from a scrolled list.
- **Left and Right along the header at scrollTop 244.** Right ×5 went Item
  to Net and Left ×5 came back. Each of the ten moves showed the same
  pattern as Y: 0 inside the focus call, 244 written back at 0 to 1 ms, 244
  at every sample. Steam also calls `scrollIntoView` on the new cell during
  the move. No frame was drawn at another position, and the list stayed at
  244 throughout.
- **A on a header cell from a scrolled list.** Page 2 at scrollTop 294, Y,
  Right to Sold, A: page 1 (no Previous page, first row Heavy Linen
  Bandage), scrollTop 0, focus "SOLD ▼". No focus event fired, so focus
  stayed on the cell.
- **Down from the header.** Page 1 at 244: Rough Bronze Leggings, one
  instant scroll to 0, row at 184 to 231 under the header's bottom at 184.
  Page 2 at 294: Previous page, one instant scroll to 0, at 184 to 228.
  After A on Sold: Heavy Linen Bandage at 184 to 231. Focus was visible
  every time and never under the header.

### Claim 2 detail

Forever has one real rare item and nothing above it, so an in-memory hook
in SharedJSContext set the quality of page 1's first eight rows by
position: poor, rare, epic, legendary, uncommon, artifact, heirloom and
common. The names don't match their real quality (Plaguefang shows as
rare, for example). Colours and backgrounds come from computed style.

| Quality | Colour | Unfocused, on `#23262e` | Focused, as shown, on `#383a41` |
| --- | --- | --- | --- |
| Poor | `#9d9d9d` | 5.58 | white 11.35 (own colour 4.19) |
| Common | `#ffffff` | 15.13 | 11.35 |
| Uncommon | `#1eff00` | 11.06 | 8.30 |
| **Rare** | `#178dff` | **4.53** | white 11.35 (own colour 3.40) |
| **Epic** | `#ba67f2` | **4.55** | white 11.35 (own colour 3.41) |
| Legendary | `#ff8000` | 6.01 | white 11.35 (own colour 4.51) |
| Artifact | `#e6cc80` | 9.59 | 7.20 |
| Heirloom | `#00ccff` | 7.98 | 5.99 |

Every name passes 4.5:1 on its row. Rare and epic pass with little margin.

### Claim 3 detail

Forever, page 1 in the usual order. Header cells (left edge + width, px):
Sold 1035+59, Earned 1106+76, Bought 1194+79, Spent 1285+66, Net 1363+63.
After A on Earned ("EARNED ▼"), and after A on Sold ("SOLD ▼"), every
value was the same, and so was the track list `minmax(0, 1fr) 59px 76px
79px 66px 63px`. In the first run, Earned moved 13 px left when ▼
appeared.

Widths still follow each page's content: page 2 gives Net 59 px, and
Classic Era's sorts give Earned 87 or 98 px and Spent 87 or 98 px. The
claim covers the same page with the same content, and that held.

**Amounts at 806 px.** The dialog was held at 894 px by an in-memory style,
which makes the table 807 px wide. On Classic Era (Sold ▼, Earned ▼,
Spent ▼ and Net ▲ page 1, Item ▲ page 10), no cell's `scrollWidth`
exceeded its `clientWidth`. No amount ran onto a second line (lines counted
from each cell's text rectangles). The Item column was 296 to 314 px. Six
names wrap on Item ▲ page 10 and none on the other pages. An earlier pass
with the dialog at 806 px (a 718 px table) also found no overflowing
cell. Its line count used a faulty test, so this report does not use it.

### Known limitations

- The Deck was still docked. Handheld width was simulated by width alone.
  The owner checks handheld resolution.
- Epic, legendary, artifact and heirloom were again seen only through the
  quality hook.
- The bell remains for the owner.
