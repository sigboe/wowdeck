# Ledger figures follow the in-game Dashboard

Owner decision during the Ledger design interview, 24 November 2026. The
Ledger calculates its figures the way the TradeSkillMaster addon's own
Dashboard does (addon 4.15.9, `App/MainUI/Dashboard/Core.lua`), not the way
the community desktop clients tsm-app-linux and Wuild's TSM-App do. Players
compare the Ledger with what they see in game. The community clients
disagree with the addon and with each other, so neither can serve as the
reference.

The rules this pins down:

- Earned, spent and profit count sales and purchases only, from every source
  (Auction, COD, Trade, Vendor). Income and expense records never count.
  That includes Money Transfer, Postage, Repair Bill, Garrison and Crafting
  Order. Gold mailed between your own characters therefore never inflates
  the totals.
- Average per day divides by the selected period: 1, 7, 30, 91, 183, 365 or
  730 days. For All, it divides by the whole days from the first point of
  the selected gold logs to now, at least 1. A period counts the records
  strictly after its start and strictly before now, so a record at either
  edge falls in neither period.
- Average daily sales and purchases count items sold or bought, not records.
- Top sale and top purchase are the highest price per item.
- The graph shows the 52-week high and low and the change over the last 24
  hours. It also shows a trend against the previous period of the same
  length, except for All. It sums the character, Warband bank and guild gold
  logs and carries each balance forward. The addon logs a guild only while
  one of the player's characters leads it.
- The graph treats each log as the addon loads it. A log counts as zero
  before its first point. A period's graph starts at the selection's first
  point when that is later than the period's start. Like the addon, the
  graph drops misread balances from character and Warband bank logs. A guild none of
  the player's characters is in, last logged more than 30 days ago, counts
  only until its last entry.

Two additions have no in-game equivalent, and the community clients set
their pattern. The Ledger picks one WoW account at a time, as every
reference app does. It lists totals per item as Earned, Spent and Net. Net is
earned minus spent; the addon reserves "profit" for an item's resale profit.

The Dashboard shows a top item for sales and expenses and an average of
daily sales only. The Ledger also shows average daily purchases, counted
the same way, and a top item for profit: the item with the highest earned
minus spent in the period, or none when no item comes out ahead. A Realm
filter is a Ledger addition too.

The in-game graph ticks characters, guilds and the Warband bank on and off
in one list. The Ledger's Character filter picks one of them, or all. The
Warband bank and each guild with a gold log are choices of their own. Picking
one shows its gold, and the trading figures show zero, because neither one
trades.

All realms counts every realm with records, in full. The Dashboard counts
fewer records. It covers the realm you are logged in on and its connected
realms, or every realm when TradeSkillMaster's region-wide option is on. For
another realm whose sales and purchases together pass 4,000,000 characters,
it loads only the last 180 days. All realms, and a realm other than the one
you play, can therefore show other figures than the Dashboard. One realm's
figures match the Dashboard viewed while logged in on that realm, as long as
no connected realm adds records of its own.

## Considered options

- **tsm-app-linux.** It counts income and expenses in its totals, so mail
  between alts counts twice. It divides by the span of the shown data and
  counts records instead of items. Its graph adds every realm's guild and
  Warband bank logs.
- **Wuild's TSM-App.** Its totals match the addon's sales-and-purchases rule,
  but its averages and graph differ, and it has no export.
