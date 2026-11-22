# One Classic row in the Play menu, and picking leaves My Addons alone

Accepted 2026-11-19. Reworks the client rows of PR #284 (#257).

Until this change, the Play menu's "Play from…" list had one row per WoW
client Battle.net has installed. Retail, Mists of Pandaria Classic and
Forever could be picked. Classic Era, Anniversary, the PTRs and the betas
showed as greyed-out rows. Picking a WoW row also switched My Addons to
that installation.

The menu now has these rows, each shown only when Battle.net lists a
matching install in the shortcut's prefix:

| Row | Battle.net lists | Command |
| --- | --- | --- |
| Battle.net | Always shown | None, Steam's own start |
| Retail | `wow` | `launch WoW` |
| Classic | `wow_classic`, `wow_classic_era` or `wow_classic_anniversary` | `launch WoWC` |
| Forever | `wowf` | `launch WoWF` |

The Classic row reads "World of Warcraft Classic" in the menu and "Classic"
on the Play button. It doesn't name a version.

Rows for other versions are gone, not greyed out. That covers the PTRs,
the betas, Titan Reforged and China Beta. Battle.net's own Play still
starts them.

Picking a row changes only what Play starts. My Addons keeps its
installation for every row, Retail and Forever included. The owner ruled
out switching My Addons from the Play menu. A player may manage one
version's addons while starting another.

## Classic and `WoWC`

The owner expects `launch WoWC` to start whichever Classic version is
active in Battle.net. The recorded evidence is narrower
([launch code report](../hardware/2026-11-19-battle-net-launch-codes/README.md)):

- On a Linux PC with Mists installed, `launch WoWC` always started Mists,
  even after `launch_uid` had selected Classic Era or Anniversary.
- On the Deck, with Classic Era and Forever Beta but no Mists,
  `launch WoWC` made Classic Era active but didn't start it, in four
  tries. Battle.net's own Play started Classic Era at once.

External `WoWC` has only ever been seen starting Mists. WoWDeck accepts
that risk. A Classic launch succeeds when any of Mists, Classic Era or
Anniversary starts in the prefix, and the completion names the version
that ran. If none starts within the launch window, WoWDeck shows
"Battle.net didn't start Classic. Press Play in Battle.net." WoWDeck
leaves Battle.net open, so the player can press Play there.

The notice follows a general rule. A launch that Battle.net accepted but
that started no client within the window is "not started". Retail and
Forever get the same notice with their own names.

## Saved choices

Choices stay saved per Steam shortcut under the row's id: `battlenet`,
`classic`, or the Retail or Forever installation id. Earlier builds saved
an installation id. A saved Mists, Classic Era or Anniversary installation
now selects the Classic row. A saved id whose row is gone falls back to
Battle.net.

## Consequences

- The Classic icon is `WowClassic.exe` from `_classic_`, else from
  `_classic_era_`, else from `_anniversary_`.
- Players without Mists may get the notice in place of a running game.
  If a later Battle.net build makes `WoWC` start the active Classic, the
  notice stops showing with no change in WoWDeck.
- A row that isn't installed never shows, so no row in the menu can be
  greyed out.
