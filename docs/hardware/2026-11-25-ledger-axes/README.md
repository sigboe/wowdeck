# Ledger gold axes, line colour and trend arrows (PR #318)

## Build and fixture

The brief named no target, so the run used the default, the owner's Steam
Deck. The build was the uncommitted working tree of `feat/308-ledger` on
HEAD `058320d`. The change is frontend only. `deck up` also rebuilt and
deployed the engine from that HEAD, because the Deck's engine reported
`1.3.1-pr.318` and the local one `1.3.0`. The deployed `dist/index.js`
SHA-256 matches the local build, both before and after the run:
`ea3540f95e4203ad2f2e968929e171a4c52b5979ff38ead0d2663272f1e327b2`.

Fixtures:

- Forever `5e80311f078e`: one account, realm Normal, three characters and
  the Warband bank. Gold rises from 0g to 4g over about two weeks.
- Classic Era `032c354a655f`: two realms and eight characters. Gold rises
  from 0g in May 2026 to 1,074g. Totals reach 1,618g.

Nothing was installed and no WoW file was changed. Neither installation
has a selection whose gold ended lower than it started (checked over RPC
for every character and period). The run therefore tested red with an
in-memory hook in SharedJSContext. The hook wrapped `DeckyBackend.call`
and reversed the gold values of a 1M `tradeskillmaster.ledger` result. The run
removed it afterwards and reloaded the plugin to drop the cached data.
The run left the Deck on Forever with the tested build installed,
autoUpdate back on and the tunnel closed.

Screens are in the session scratchpad `shots/`, numbered 01 to 09.

## Results

DEVICE, 25 November 2026. The method is UI: D-pad and CDP focus, DOM
geometry probes in the 854 × 454 QAM document, and screenshots. In the
QAM the plot is 438 px wide on Forever and 413 px on Classic Era, and
96 px high.

| Claim | Result | Evidence |
| --- | --- | --- |
| 1. Axes, All / 1W / 1D | partial | Gold labels sit left of the plot. Gridlines are `#67707b` at opacity 0.5. No label overlaps another, and none crosses the graph or plot edges, in every period probed. Forever All and 1M: 0g, 2g and 4g with the peak (4g, the 52-week high) on the 4g line and the plot top at 5g. The x axis reads 10 Nov, 14 Nov, 18 Nov and 22 Nov. Forever 1W: Thu, Sat, Mon and Wed. Forever 1D: 3g, 4g and 5g, the top line above the 4g balance. Classic Era All and 1Y: 0g, 400g, 800g and 1.20kg above the 1,074g peak; the x axis reads May 2026, Jul 2026, Sep 2026 and Nov 2026. Classic Era 1W and 1D (flat at 1,074g): 1.07kg and 1.08kg. **Failed part: 1D shows one weekday ("Wed" at midnight), not hours, on both installations.** `goldXAxis` switches to two-hour marks only when one label's spacing (92 px) covers 4 hours or less. That needs a plot wider than 552 px for a day, and the QAM plot is 413 to 438 px. |
| 2. Green / red | passed | Real data is all rising: stroke and both gradient stops are `#59bf40` (STEAM.positive) on Forever All/1W/1D and Classic Era All/1Y/1W/1D, including the flat lines. With the hook reversing Forever 1M (4g down to 0g), stroke and stops are `#ef806c` (STEAM.danger), shot 04. The run saw red only on altered data, never on a real falling selection. |
| 3. Trend arrows, no cut-off | passed | Forever 1W: Sales, Expenses and Profit each have the arrow beside Total and Per day. Classic Era 1Y: the same, with Sales at 1,618g 48s 44c. Expenses' up arrow is red (shot 09). `scrollWidth` never exceeds `clientWidth` on any value cell. Forever 1D and Classic Era 1Y showed down and up arrows. All shows no arrows; that period has no previous period. |
| 4. One focus stop | passed | From Period 1M, Down on the pad moved to Gold, then to the averages grid. Up moved back to Gold, then to 1M. |
| Retail rounding | pending | No Retail installation on the Deck (Classic Beta, Classic Era, Forever). Retail gold history is needed. |

During the run, a stray Enter on "All characters" opened the
Character menu. CDP `seek` jumps then moved focus out of it while it stayed
drawn over the graph (shots 03 to 05). B from inside the menu closed it.
This is a test-driver artefact; pad navigation alone would not leave the
menu.

## 1D recheck

DEVICE, 25 November 2026, method UI. The build is the uncommitted working
tree of `feat/308-ledger` on HEAD `23700e8`, a frontend change to
`src/tsmGoldAxes.ts` that gives a day or less hour labels whatever the plot
width. `deck up` deployed only `index.js`. The deployed `dist/index.js`
SHA-256 matches the local build:
`b10542ad5ceaaeb66a5ac09ee7986f26768f1cea40b1805a0af4d02d5a59dc86`.
The fixtures and the narrow QAM are the same as above. The run chose each
period from the Period menu and measured the x-axis labels with a DOM probe
in the QAM document.

| Installation | Period | x-axis labels (left to right, px) | Overlap | Past an edge |
| --- | --- | --- | --- | --- |
| Forever (plot 392 to 830) | 1D | 18:00 (392 to 426), 00:00 (510 to 545), 06:00 (620 to 654), 12:00 (729 to 764) | no | no |
| Forever | 1W | Thu, Sat, Mon, Wed | no | no |
| Forever | All | 10 Nov, 14 Nov, 18 Nov, 22 Nov | no | no |
| Classic Era (plot 417 to 830) | 1D | 18:00 (417 to 451), 00:00 (527 to 562), 06:00 (630 to 665), 12:00 (734 to 768) | no | no |
| Classic Era | 1W | Thu, Sat, Mon, Wed | no | no |
| Classic Era | All | May 2026, Jul 2026, Sep 2026, Nov 2026 | no | no |

Result: **passed.** 1D now labels every six hours on both installations, the
failed part of claim 1 above. 1W and All match the first run. Screenshots
of the two 1D graphs are in the session scratchpad `1d/`. The run left the
Deck on Forever with Period All on both installations, the tested build
installed, autoUpdate back on and the tunnel closed.
