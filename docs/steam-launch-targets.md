# Steam game page launch targets

The chevron opens the client picker even while WoW is running. Up and Down
move through the choices. A selects one. B closes the picker.
Both actions return focus to the chevron. Steam Play keeps initial focus.
The launch button shows the selected client and its executable icon. WoWDeck
uses its own glyph when the icon is missing, unreadable or fails to render.

The picker lists Battle.net first, then up to three WoW rows: Retail,
Classic and Forever ([ADR 0017](adr/0017-one-classic-launch-row.md)).
Battle.net is selected until the player picks another row. Starting it
starts the Steam entry and sends Battle.net no launch command, as Steam's own
Play does. Its icon comes from the launcher executable.

| Row | Shown when Battle.net lists | Command | Icon |
| --- | --- | --- | --- |
| Battle.net | Always | None: Steam's own start | The launcher's |
| Retail | `wow` | `launch WoW` | `_retail_` |
| Classic | `wow_classic`, `wow_classic_era` or `wow_classic_anniversary` | `launch WoWC` | `_classic_`, else `_classic_era_`, else `_anniversary_` |
| Forever | `wowf` | `launch WoWF` | `_forever_` |

The Classic row reads "World of Warcraft Classic" in the menu and "Classic"
on the Play button, whichever versions are installed. PTRs, betas, Titan
Reforged and China Beta get no row. Battle.net's own Play starts them.

A Classic launch counts as started when Mists of Pandaria Classic, Classic
Era or Anniversary starts in the prefix. The completion names the version
that ran. When Battle.net takes the request but no client starts within the
launch window, WoWDeck shows "Battle.net didn't start Classic. Press Play in
Battle.net." Retail and Forever get the same notice with their own names.
Battle.net stays open.

A choice is saved per Steam shortcut. Picking a row never changes My Addons'
active installation, and changes in My Addons leave the saved launch target
in place. Choices saved by earlier builds keep working: a saved Mists,
Classic Era or Anniversary installation selects Classic, and a saved
version that has no row any more falls back to Battle.net.
An attempt already in progress keeps its original target.

Options → Steam library → **Play starts WoW** turns off
WoWDeck's Play button and menu rows. Steam's own Play button and "Play
from…" menu come back, and the WoW addons section drops its launch lines.
Each shortcut keeps its saved choice, and turning the option back on
restores it ([ADR 0016](adr/0016-patch-steams-play-button.md)).

The picker lists only the WoW clients Battle.net has installed in the
shortcut's prefix. It reads Battle.net's own install list,
`drive_c/ProgramData/Battle.net/Agent/product.db`, and matches each entry's
folder to a detected installation. A WoW folder Battle.net doesn't list is
left out, even when WoWDeck detected it. That covers leftover folders,
copies and other prefixes' installs. Without a readable list, or with no matching
client, the page keeps Steam's plain Play button. The shortcut still needs a
WoWDeck link to an installation.

The prefix is the one Proton uses: `<library>/steamapps/compatdata/<app id>/pfx`,
or `<path>/pfx` when the launch options set `STEAM_COMPAT_DATA_PATH=<path>`.
Some installers also write `WINEPREFIX=` into a Battle.net shortcut's launch
options. Proton replaces WINEPREFIX with its own prefix, so WoWDeck ignores
it there too. A shortcut run through a native wrapper such as `umu-run` keeps
its WINEPREFIX for installation discovery.

Replay uses the running Steam shortcut's runtime and Proton. When Steam runs
in separate user and mount namespaces, as on NixOS, WoWDeck enters those
namespaces with `nsenter` and preserves the caller's credentials before
starting replay. It keeps direct replay when the user namespace is shared.
Missing runtime tools and namespace-entry failures produce a request-delivery
error, rather than a notice that Battle.net did not start the client.

## DroidDeck

On DroidDeck, WoWDeck leaves Play to DroidDeck. DroidDeck adds one Steam
game per WoW version, and each game's launch options carry
`--exec="launch <code>"`. When Steam starts one, DroidDeck's Proton wrapper
hands the start to its store launcher, `droiddeck-store-launch`. The store
launcher matches Battle.net in prefix `2596113170` and runs DroidDeck's
Battle.net driver as `droiddeck-battlenet launch <code>`. The driver waits
until Battle.net is ready, then asks it for that game's version up to
three times, 15 seconds apart. It closes Battle.net 20 seconds after the
game is up. Nothing outside DroidDeck can stop or delay that ask, so a
WoWDeck pick of another version would race it.

The engine looks for `/usr/local/bin/droiddeck-store-launch` once at
startup. DroidDeck counts as present only when that file exists and is
executable. While it is present:

- Every linked game's page keeps Steam's own Play button and "Play from…"
  menu. The WoW addons section stays and has no launch lines.
- Options › Steam library shows **Play starts WoW** greyed out, with
  "Not available on DroidDeck. DroidDeck launches game directly" under it.
- `launch.state` and `launch.icon` answer null for every app id.
  `launch.start` starts nothing and never asks Battle.net.
- `launch.select` is refused with the error code `play_left_to_droiddeck`.
- `linkedGames.get` and `linkedGames.changed` carry `playOwner:
  "droiddeck"`. Elsewhere they carry `"wowdeck"`.

The check covers the whole machine. It doesn't look at single shortcuts,
so a Battle.net shortcut made by hand on DroidDeck gets Steam's Play too.
**Play starts WoW** and each shortcut's saved launch target stay as they
are. WoWDeck doesn't rewrite or clear them, so settings moved to a Steam
Deck work there as before.

To open Battle.net without starting a game, use DroidDeck's Battle.net
tile on its Desktop tab. DroidDeck's own code is the evidence: its
Battle.net runtime, `steam-compatibility` wrapper, `droiddeck-store-launch`
and `droiddeck-battlenet` on the `main` branch of Droid-Deck/DroidDeck, read
2026-11-21. [ADR 0016](adr/0016-patch-steams-play-button.md) has the
decision.

## Battle.net commands

Battle.net starts a game with `--exec="launch <code>"`. WoW has three codes:

| Client | Command | In WoWDeck |
| --- | --- | --- |
| Retail | `launch WoW` | Retail row |
| Mists of Pandaria Classic, Classic Era, Anniversary | `launch WoWC` | Classic row |
| Forever | `launch WoWF` | Forever row |
| Titan Reforged, Retail PTR, Retail XPTR, Retail Beta, Classic PTR, Classic Era PTR, Forever Beta | `launch_uid <uid>` only. This selects the version in Battle.net and doesn't start it | No row |
| China Beta | None known | No row |

Each client's code and row live in the client table,
`backend/src/wow/clients.ts`. The [launch code report](hardware/2026-11-19-battle-net-launch-codes/README.md)
has every code tried, on the Deck and on a Linux PC, with the log lines.
In short:

- With Mists installed, `launch WoWC` started Mists of Pandaria Classic
  (`wow_classic`) every time. Selecting Classic Era or Anniversary first
  with `launch_uid` didn't change that. Without Mists installed (the
  Deck), `launch WoWC` switched Battle.net to Classic Era and started
  nothing. WoWDeck still offers one Classic row on `WoWC` and covers a
  failed start with its notice ([ADR 0017](adr/0017-one-classic-launch-row.md)).
- Battle.net's own Play button starts the selected version, Classic Era
  included. No `--exec` command does the same from outside.
- `launch_uid <uid>` only selects a version. A following `launch WoW`,
  `launch WoWC` or `launch WoWF` replaces the selection with that code's
  own client.
- Battle.net looks up any other `launch` code as a game family and finds
  none. That includes `WoWB`, `WoWT`, `WoWE`, `WoWPTR` (it selects Retail),
  the `WoWX` codes from Battle.net's product catalogue, lower-case codes
  and version UIDs.
- Battle.net 2.53.8 doesn't recognise `wow_classic_titan` in the EU
  region.

Battle.net 2.53.8's own command list, read from `battle.net.dll`, has no
other way in. `--exec` takes `launch`, `launch_uid`, `launch_register`,
`focus`, `handle_uri`, `install`, `repair`, `modify`, `login`, `logout` and
a few more. Only `launch` starts a game (`LaunchGameByProduct`). A
`battlenet://` link can also start one (`LaunchGameByUri`), but only with a
token, account id and timestamp that Blizzard's website signs for the
signed-in account. Without them it only focuses a game. WoWDeck can't
build those links. Battle.net starts a client as
`<client>.exe -launcherlogin -uid <uid>` and hands it a launch token.
Running the client with the same arguments doesn't sign it in.

See also Skip Game Launcher's
[version command notes](https://github.com/voc0der/Skip-Game-Launcher/blob/master/CONTRIBUTING.md#battlenet-game-versions).

## Device checks

The [launch delivery spike](hardware/2026-11-18-steam-launch-delivery/README.md)
and [started-entry run](hardware/2026-11-18-steam-started-entry/README.md)
record the earlier Forever results on Steam Deck. Those builds preceded
the picker. Verify Retail and the picker on device before release. The
steps below don't apply on DroidDeck, where WoWDeck leaves Play to
DroidDeck. The DroidDeck device check for #296 is regression case L-29.

| Step | Expected |
| --- | --- |
| Open the chevron while WoW runs. Check the list and press B. | Battle.net, then Retail, Classic and Forever, each only when Battle.net has it installed in the entry's prefix. No other version has a row. B returns focus to the chevron. |
| Reopen the picker and select another row. Check My Addons and then reopen the game page. | My Addons keeps its installation. The game page shows the chosen row's name and icon or WoWDeck glyph. |
| With only Classic Era installed, select Classic and press Play. | Classic Era starts, or WoWDeck says Battle.net didn't start Classic and Battle.net stays open. |
| Stop the existing client. Select the client in the Play button's menu and press Play with Battle.net running, then repeat with the Steam entry stopped. | The chosen client starts in the linked shortcut's prefix. |
