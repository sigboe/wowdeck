# DroidDeck Play check

DEVICE 2026-11-22. The run used the owner's DroidDeck phone over wireless
adb and `droiddeckctl`. It covers #297 and #298 (spec #296) and regression
row L-29.

## Build

- Integration branch `feat/296-droiddeck-play` at `9e9f199`.
- `make package` built it as `1.2.1-test.296`. The version stamp is not
  committed.
- Decky's installer put it over `1.2.1-test.283`. The owner approved one
  Steam session restart afterwards.
- The installed arm64 engine matched the zip (SHA-256
  `3832d8a42f690c19ebd25c76911a08fd9cc7cbd89326608077cf53b116ab8c23`).
  Decky listed `WoWDeck 1.2.1-test.296`, and the native engine was running.
- DroidDeck 0.7.1, runtime `ubuntu-r1-rc5`.
- `/usr/local/bin/droiddeck-store-launch` was present and executable.

A backup of the plugin folder and `state.json` from before the install is in
`/root/homebrew/data/wowdeck/backups/2026-11-22-296/`.

## Engine answers

Read from the live engine through Decky:

- `linkedGames.get` listed World of Warcraft: Forever (app id `3249681327`,
  found automatically) and `playOwner: "droiddeck"`.
- `launch.state` and `launch.icon` answered null for that game.
- A probe of `launch.select` was refused with `play_left_to_droiddeck`. Its one
  `[rpc] … failed` line is the only launch line in the plugin log.

## Game page

- Forever's page showed Steam's plain green Play button, with no "Play from…"
  arrow.
- The WoW addons section read "All addons are up to date" with Check for
  updates and Open, and no launch lines.

The first Play press reached Battle.net, but its sign-in had expired
(BLZBNTBGS80000023). The owner signed in, and the run
closed the game through Steam.

Second Play press:

- `droiddeck-store-launch` ran `droiddeck-battlenet launch WoWF`.
- About 45 seconds later
  `_forever_\Wow-arm64.exe -launcherlogin -uid wowf` was running.
- WoWDeck showed no toast, and its log gained no lines during either press.
- Battle.net was still open about 40 seconds after the game started. When it
  closes is DroidDeck's choice, so this check doesn't cover it.

## Options › Steam library

- With Show in Steam on, Check for updates and Tile badge are live.
- Play starts WoW has a grey toggle and reads "DroidDeck starts each WoW
  version from its own Steam game".
- Pressing A on it changed nothing, and `steamLaunchMenu` stayed `true`.
- With Show in Steam off, all three rows grey out and the Play row keeps the
  DroidDeck line. Turning it back on restored the first state.

Focus does not skip greyed-out rows on this client. Down stopped on Play
starts WoW, and it stopped on Check for updates and Tile badge too while Show
in Steam was off. The DroidDeck row moves like the other greyed-out rows, as
the spec asks. #298's "the controller skips it" doesn't hold for any of them
here, so L-29 now records what the phone does.

The tested build showed the row's earlier wording. The owner then changed it
to "Not available on DroidDeck. DroidDeck launches game directly" and waived a
retest for that change.

## Afterwards

- Show in Steam was back on.
- `state.json` matched the backup except Decky's
  `pluginUpdateLastRunVersion`. `steamLaunchMenu` and `steamLaunchTargets`
  were unchanged.
- The run removed the adb reverse mapping and stopped the local server.
- The test build stays installed.
