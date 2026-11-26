# Ledger title row, menus, coins and Wowhead links (#319)

## Build and fixture

Target was the owner's Steam Deck; the brief named `deck`. Build was
`feat/308-ledger` at `c92c0e7` (PR #318, ticket #319), frontend and engine.
`deck up --engine` reported that the Deck already ran this build. The
deployed `dist/index.js` SHA-256 matches the local build:
`be306e7763f1953af866333a986ac54e31e2f48d2b82497092f0abeb8cef1834`. The
version string `1.3.1-pr.306` is ambiguous. The engine binary hash differs
from the local one because deployment patches it, so the engine was
identified by behaviour instead: `tradeskillmaster.ledger` returned
`"wowhead":"forever"`.

Fixture: the Forever installation `5e80311f078e`, with the addon's own
records for one account, realm Normal, three characters and the
Warband bank, and 107 items. Nothing was installed or changed. Export was
never pressed and no file was written. The filters were left at All realms,
All characters and All. Afterwards the Wowhead browser was closed, the QAM
was closed, autoUpdate was restored, the tunnel was closed and the build
stayed installed.

Screens are in the session scratchpad `shots-319/`, numbered 00 to 22.

## Results

DEVICE, 24 November 2026, method UI (pad presses, CDP geometry probes,
screenshots) unless stated otherwise. All positions are CSS px in the
854 × 454 QAM document.

| Claim | Result | Evidence |
| --- | --- | --- |
| 1. One floating title row | passed | Bar `[373,0,830,50]` in both panes. "TradeSkillMaster" `y 13–37` and the pills `[636,8,830,42]` are both centred at y 25, with the pills flush with the bar's right edge (0 px). The bar stays at y 0 at scrollTop 0, 110.7 (Auction data), 130 and 282 (Ledger). A hit-test grid (8 × 2 px) from the scroller top to the bar bottom found no element outside the bar at any scroll position, and shots 02, 09b and 10 show nothing above the pills. The fade `::after` (20 px) has opacity 0 at the top and 1 once scrolled. |
| 2. Ledger order | passed | One account, so there is no Account row. Rows: Export ledger `[50–110]` with "All realms · every character and period" and Export `[733,60,830,100]` on the right; Realm, Character and Period `[110–178]`; the recorded line `[178–198]` in `rgb(184,188,191)` with no focusable ancestor. Picking Realm Normal changed the description to "Normal · every character and period", and picking All realms changed it back. At scrollTop 130 and 282, all of these had scrolled under the title row. |
| 3. Measurements | partial | Period: segment `[726,110,830,170]`, button `[726,130,830,170]`, `min-width: 0`. It ends at the pane's 830 px content edge, 24 px inside the screen, with "All" and the chevron in view. Title-row content bottom (42) to the Export row (50): 8 px. Period/filter buttons bottom (170) to the recorded line (178): 8 px. Export row bottom (110) to the filter row top (110): 0 px. Only the Field's own padding separates them (Export button bottom 100 to the REALM caption 110 = 10 px), and Export's focus highlight ends against the REALM caption (shot 04). |
| 4. Open menus | passed, with notes | All five menus (Realm `[373,176,537,264]`, Character `[549,176,714,384]`, Period `[726,…,830]`, Get Addons Source `[373,74,595,162]`, Category `[607,74,830,356]`) give every item `padding-left: 24px`, with the label 24 px from the item's left edge. The check is 24 px from the item's right edge and 12 px past the label text. B closed each menu and focus went back to its button. Notes: Character labels are cut with an ellipsis (for example "All charact…") because the menu is the segment's 165 px wide. The Period items are whole horizontally, but the list is 328 px in a 282 px box: opened on All, 1D is scrolled out of view above (shot 07); Up ×7 brings it in (shot 07b), and the menu box then ends at y 458, 4 px past the 454 px screen. |
| 5. Coin colours | passed | Computed colours of all 11 Ledger amounts: g `rgb(255,215,10)` = #ffd70a, s `rgb(199,199,207)` = #c7c7cf, c `rgb(237,165,95)` = #eda55f, with lowercase letters. The Ledger graph's Daily change was +1g, so the losses were checked in All items instead: Net "-34s" (Tin Ore), "-4s 61c", "-2s 90c" and "-99c" (Mild Spices, page 2) have their minus in `rgb(239,128,108)` = STEAM.danger #ef806c, and the coins keep their colours. |
| 6. Table and graph | passed | `.wowdeck-ledger-flows`: the caption row "TOTAL PER DAY" is not focusable; Sales, Expenses and Profit are one focus stop each (Down moves from Sales to Expenses, then Profit, then All items (107)). Each has "Top item · …" in `rgb(184,188,191)` under it. The graph is a polygon filled with a `#1a9fff` gradient (0.35 → 0) under a `#1a9fff` polyline. |
| 7. All items | failed | See below. |
| 8. Focus | passed | Right from the destination landed on Export both times. Up from Gold went to All realms (skipping the recorded line), then Export, then LEDGER. Left went from Period to Character, to Realm, to the TradeSkillMaster destination. Entering Auction data landed on Manage. |

### Claim 7 in detail

Everything in claim 7 passed except the Wowhead round trip:

- Column labels: `position: sticky`, 12 px, uppercase. They stay at y 64 at
  scrollTop 0, 234 and 1984 and are topmost there.
- New finding: the dialog's scroller (`[40–492]`) has `padding-top: 24px`,
  so the labels stick 24 px below its top. Scrolled rows show through that
  strip: hits at y 40–62 landed on the rows "Wooden Mallet" and "Bard's
  Cloak", and shots 12 and 13 show a light band above ITEM. This is the same
  defect the pane bar had before this commit.
- "–": 40 per page, for example Tin Ore's Earned.
- Unnamed items: page 1 shows "Item 286742", "Item 282064", "Item 246265"
  and "Item 3455"; page 2 shows "Item 5941" and "Item 3454". No `i:` labels
  remained.
- Paging: the page 1 footer shows "RT Next page". R2 opened page 2, with
  focus on its first item and "LT Previous page" and "RT Next page" in the
  footer (shot 14). L2 went back to page 1, with focus on its first row.
- Wowhead URLs, read from the CDP target list: A on Rough Bronze Leggings
  opened `https://www.wowhead.com/forever/item=2865/rough-bronze-leggings`,
  and A on "Item 286742" opened
  `https://www.wowhead.com/forever/item=286742/riptears-cleaver`. Wowhead
  added the name slug.
- **Failed:** the All items dialog stays on top of Steam's browser and keeps
  focus. After A, the route is `/routes/externalweb` but the navigation tree
  is still `ModalDialogOverlay_Modal_144`, and shots 16 and 22 show the
  dialog with only the browser's URL bar above it. The player never sees the
  page. B then closes the All items dialog (tree `QuickAccess-NA`, focus
  "All items (107)"); it does not come back from the browser. This happened
  on both tries (Modal_144 and Modal_145). To leave the browser, the QAM had
  to be closed and B pressed on the browser page.
- Untested: battle pets (no `p:` items in this fixture).

### Other observations

- The Auction data pane still shows TsmAccount's own `<h2>` "TradeSkillMaster"
  with the TSM icon (`src/components/TsmAccount.tsx:180`) right under the
  new title row, so the name appears twice (shots 01 and 03). The file is
  unchanged by `c92c0e7`.
- After Up left Auction data for the QAM's back button, the pane rested at
  scrollTop 0.67. `data-wowdeck-scrolled` was then set, so the fade showed
  at the top.
- Steam's footer shows OK actions on a red "B" glyph and Back on a green "A"
  glyph (Xbox glyph set, probably the test pad's), while a pressed A did
  confirm. This is likely a test-rig artifact and not ours.

After this run, the next commit closed All items before opening Wowhead,
painted the 24 px strip above the column labels, added 8 px under the
Export row and removed the second "TradeSkillMaster" heading. The two
rechecks below cover those fixes.

## Regression rows

| Row | Result |
| --- | --- |
| LEDGER-311-1 | Passed (Deck, 2026-11-24) |
| LEDGER-312-1 | Passed (Deck, 2026-11-24) |
| LEDGER-312-2 | Partial: Up and Left order, B on the menus, and the Realm pick passed. Picking another Character or Period, and the Period list's full contents, were seen but not picked. |
| LEDGER-319-1 | Partial: Period fits. The gap between Export and the filter row is 0 px between the row boxes (10 px of Field padding). Character labels are cut, and Period shows 7 of 8 items until scrolled. |
| LEDGER-319-2 | Passed |
| LEDGER-319-3 | Passed |
| LEDGER-319-4 | Failed: the dialog covers the Wowhead page, and B closes the dialog. There is also a 24 px strip of rows above the sticky labels. Battle pets are untested. |
| LEDGER-319-5 | Partial: the descriptions for All realms and Normal passed. A on Export was not pressed (brief), and the no-records state is untested. |

## Recheck at 248678a

Target was the owner's Steam Deck; the brief named `deck`. Build was
`feat/308-ledger` at `248678a`, frontend only; the engine stayed the one
from `c92c0e7`. `deck up` deployed `dist/index.js` and reloaded the plugin.
The deployed file's SHA-256 matches the local build:
`fea7fc64f8658f03378a097250547dfb8e766d5880e856f900475227ca956e0e`.
Fixture as above: Forever, one account, 107 items. Export was never pressed
and no file was written. Afterwards the QAM was closed, Steam's browser was
already gone (no Wowhead target left), autoUpdate was restored, the tunnel
was closed and the build stayed installed. Screens are in the session
scratchpad `shots-319b/`, numbered 00 to 12b.

DEVICE, 24 November 2026, method UI (pad presses, CDP probes, screenshots).
Positions are CSS px.

| Claim | Result | Evidence |
| --- | --- | --- |
| 1. Wowhead round trip | passed | R2 opened page 2 on "Item 5941"; Down ×2 reached its 3rd item, Hunting Cloak. A: the tree went from `ModalDialogOverlay_Modal_147` to `GamepadUI_Full_Root`, route `/routes/externalweb`, no modal. Six seconds later the QAM was still closed. The browser target was `https://www.wowhead.com/forever/item=4689/hunting-cloak` (Wowhead added the slug). In that target `visibilityState` was `visible` and `document.hasFocus()` true, while Steam's own window had lost focus; Steam's URL bar showed "Use touch" and the footer "B Back" (shot 08). The page's own screenshot shows Wowhead with its consent dialog (shot 09). B left the browser for the game page. Opening the QAM landed on "All items (107)" (shot 10); A reopened the list on page 2 with focus on Hunting Cloak and the LT/RT footer (shot 11). B, then A again, opened page 1 on its first item, Rough Bronze Leggings. |
| 2. Column labels | failed | Paint: at scrollTop 340, the strip from the scroller top (40) to 62 is solid `#0e141b` (pixel scan of the 1.5× shot 05). Two bands remain wrong. (a) At 62–64, across the labels' width, a scrolled row shows through as a 2 px `rgb(35,38,46)` line: the labels are 22 px tall and the `box-shadow: 0 -24px` is the labels' own size, so it covers only 40–62. (b) Hit-tests still land on rows: 1128 samples (8 × 2 px) between 40 and 64 all hit row elements (Stonewood Hammer, Heavy Linen Bandage), because a box-shadow takes no hits. New regression: at scrollTop 0 the same shadow paints 128–152 and covers the lower half of the dialog header (114–142), so "All items · All realms · All characters · All" is cut through (shots 11, 12, 12b). |
| 3. Export gap | passed | `.wowdeck-ledger-export` `[373,50,830,110]` has `margin-bottom: 8px`; its Field (the focus highlight's box) is `[357,50,846,110]`. The REALM caption starts at 118: 8 px. With Export focused, the highlight band ends at 110 and the REALM caption sits clear of it (shot 03). |
| 4. Auction data heading | passed | One element in the pane has the text "TradeSkillMaster": the title-row span `[373,13,495,37]`. The pane has no `h1`–`h3`. Under the title row comes the sign-in line, with no TSM icon (shot 01). |
| Ledger top, Auction data top | passed | Title row, pills, Export row, filters and recorded line as in the first run (shots 01, 02). |

Remaining for LEDGER-319-4: one painted strip of 24 px above the labels
that takes hits and does not paint over the header when the list is at the
top. A `::before` that is 24 px tall and sits above the labels would cover
the 2 px line and take hits, but would still cover the header at
scrollTop 0. Battle pets remain untested.

## Recheck of the column labels

Target was the owner's Steam Deck; the brief named `deck`. Build was
`feat/308-ledger` at `248678a` plus an uncommitted change in
`src/sharedStyles.ts`: `.wowdeck-ledger-items-labels` lost its
`box-shadow` and now uses `position: sticky; top: -24px`. Frontend only;
the engine stayed the one from `c92c0e7`. `deck up` built and deployed
`dist/index.js` and reloaded the plugin. The deployed file's SHA-256
matches the local build:
`439b8e28f8d05be3be3071613261140df62837d8c3dbf25ff319ccd0c64df7e5`, and
it contains `top: -24px; z-index: 1; background: #0e141b`. Fixture as
above: Forever, one account, 107 items. Export was never pressed.
Afterwards the Wowhead browser was gone (no `wowhead.com` target left),
All items and the QAM were closed, autoUpdate was restored, the tunnel
was closed and the build stayed installed. Screens are in the session
scratchpad `shots-319c/`, numbered 01 to 06.

DEVICE, 24 November 2026, method UI (pad presses, CDP probes, a pixel scan
of the 1.5× screenshots). Positions are CSS px in the 854 × 534 modal
document. The scroller spans 40 to 492 with 24 px of top padding.

| Claim | Result | Evidence |
| --- | --- | --- |
| a. List at the top | passed | At scrollTop 0 the dialog header "All items · All realms · All characters · All" is `[50,114,804,142]`. 560 hit-tests across it all land on the header or its ancestors, none on the labels. Its glyph pixels run from 120 to 137 with `#0e141b` above and below, so nothing cuts through it (shot 01). The labels sit at 152 to 174, 10 px under the header, computed `box-shadow: none`. The first row, Rough Bronze Leggings, starts at 174. |
| b. Scrolled | passed | At scrollTop 340 and at the end of page 1 (scrollTop 2012 of 2012), the labels are at 40 to 62, flush with the scroller's top edge. From 40 to 61 every pixel across the labels' width is `#0e141b` or label text (ITEM, EARNED, SPENT, NET); the first row colour `#23262e` starts at 62. Hit-tests every 1 px from 40 to 62, every 8 px across (2068 samples per position), all land on the labels: no row hits (shots 02, 03). Focus walk: Down ×52 from Rough Bronze Leggings through the 40 rows to Next page and Close (11 presses of no change at Close), then Up ×52 back to the first row (11 of no change there). After each of the 104 presses the focused row's top was at or below the labels' bottom. While the labels were stuck, the closest the focused row came was 140 px below them (Up keeps it at y 202). |
| c. Wowhead | passed | Down ×3 to Heavy Linen Bandage, A: tree `GamepadUI_Full_Root`, route `/routes/externalweb`, no modal. The browser target was "Heavy Linen Bandage - Item - WoW Forever" at `https://www.wowhead.com/forever/item=2581/heavy-linen-bandage`. B went back to the game page. `open` landed on "All items (107)"; A reopened the list with focus on Heavy Linen Bandage. Done twice, same result both times. |

LEDGER-319-4's column-label part passes with this change. Battle pets
remain untested.
