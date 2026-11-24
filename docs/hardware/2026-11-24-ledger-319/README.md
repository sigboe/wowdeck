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
Export row and removed the second "TradeSkillMaster" heading. None of
those fixes has been checked on the Deck yet.

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
