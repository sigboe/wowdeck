# Battle.net launch codes on Steam Deck and Kaptan

DEVICE 2026-11-19. This report records which `--exec` commands start which
WoW version. The runs used a signed-in Battle.net 2.53.8.17986 on two
machines.

| Machine | Proton | Battle.net's installed WoW versions (`product.db`) |
| --- | --- | --- |
| Steam Deck, shortcut `4221385996` | GE-Proton11-12, SteamLinuxRuntime_4 | `wow_classic_era`, `wow_classic_beta`, `wowf` |
| Kaptan (Linux PC), shortcut `3332867997` | Proton Experimental, SteamLinuxRuntime_4 | `wow`, `wow_classic`, `wowf` |

The Deck's WoW folder also holds a `_retail_` folder. Battle.net doesn't list
it, and before this change it showed up in the Play menu.

Each command went to the running Battle.net the way WoWDeck sends it: the
shortcut's runtime and Proton, `run Battle.net.exe <args>`, in the same
prefix. Battle.net's main log (`AppData/Local/Battle.net/Logs/battle.net-*.log`)
recorded what it did, and the process list showed which client started.
The runner closed each client before the next command. Times below are UTC.

Kaptan runs NixOS. There, the runtime's bwrap preflight fails outside Steam's
container (`bwrap: execvp true: No such file or directory`), as WoWDeck
already expects. These runs entered the namespace of the shortcut's reaper with
`nsenter` first. Only the test setup did this. WoWDeck doesn't.

## Codes that start a client

| Machine | Command | Battle.net's log | Started |
| --- | --- | --- | --- |
| Kaptan | `launch WoW` | `Active product set to: WoW_retail`, `LaunchBinary: uid=wow` | `_retail_/WoW.exe -launcherlogin -uid wow` |
| Kaptan | `launch WoWF` | `Active product set to: WoWFNoUpgrade_wowf`, `LaunchBinary: uid=wowf` | `_forever_/Wow.exe -launcherlogin -uid wowf` |
| Kaptan | `launch WoWC` | `Active product set to: WoW_wow_classic`, `LaunchBinary: uid=wow_classic` | `_classic_/WoWClassic.exe -launcherlogin -uid wow_classic` |
| Kaptan | `launch_uid wow_classic_era`, then `launch WoWC` | The first selects `wow_classic_era`. The second switches back to `WoW_wow_classic` and logs `LaunchBinary: uid=wow_classic` | Mists of Pandaria Classic |
| Kaptan | `launch_uid wow_classic_anniversary`, then `launch WoWC` | Same as above | Mists of Pandaria Classic |
| Kaptan | `launch_uid wow_classic_titan`, then `launch WoWC` | `Failed to select game by uid because it is unrecognized. uid=wow_classic_titan`, then `LaunchBinary: uid=wow_classic` | Mists of Pandaria Classic |

The Forever and Retail rows match the Deck runs of 2026-11-18 (see the
[Steam launch report](../2026-11-18-steam-launch-integration/README.md)).

## Classic without Mists of Pandaria Classic

The Deck has no `wow_classic`. There:

| Command | Battle.net's log | Started |
| --- | --- | --- |
| `launch WoWC` (16:51:15) | `Selecting game family by id: WoWC` | Nothing |
| `launch_uid wow_classic_beta` (16:51:56) | `Active product set to: WoW_wow_classic_beta` | Nothing |
| `launch WoWC` (16:52:36) | `Active product set to: WoW_wow_classic_era` | Nothing |
| `launch_uid wow_classic_era` (16:53:16), then `launch WoWC` (16:53:56) | `Selecting game by uid. uid=wow_classic_era`, `Selecting game family by id: WoWC` | Nothing |
| Enter on Battle.net's own Play button (16:56:43), Classic Era selected | `Selecting game family by id: WoWC`, `LaunchBinary: uid=wow_classic_era`, `Launched …/_classic_era_/WoWClassic.exe with args: -launcherlogin -uid wow_classic_era -initialgamemode=c…` | Classic Era (Hardcore) |

Battle.net's page showed Classic Era with an "Unsupported" badge, but its Play
button still started it. So `launch WoWC` from outside starts only
`wow_classic`. Without it, the command moves the Classic selection to an
installed Classic version and stops there. Only Battle.net's own Play starts
the selected version. After the start, Battle.net closed itself: its
"when a game launches" setting was set to exit.

## Codes that start nothing

Deck, 12:05 to 12:39 the same day, each sent alone. Battle.net logged
`Selecting game family by id: <code>` and nothing else for:
`WoWB`, `WoWT`, `WoWX2`, `WoWX9`, `WoWX10`, `WoWX12`, `WoWE`, `WoWCE`, `WoWCA`,
`WoWA`, `WoWTitan`, `wowc`, `wow`, `wowt`, `wow_classic`, `wow_classic_era`,
`wow_beta`, `wow_ptr`, `WoW_wow_classic_era` and `WoW_retail`.

`launch WoWPTR` selected Retail (`Active product set to: WoW_retail`) and
started nothing. The `WoWX` codes come from Battle.net's cached product
catalogue, where they carry beta and retail types of the `WoW` product.

## product.db

Battle.net's Agent lists installs in `drive_c/ProgramData/Battle.net/Agent/product.db`,
a protobuf message. Decoding it on both machines showed the layout. Each
repeated field 1 is one install, with the UID in field 1, the install path in field 3.1 (for example
`Z:/home/deck/Applications/World of Warcraft`) and the flavor folder in field
3.13 (`_classic_era_`). Battle.net's own entries (`agent`, `battle.net`) have
no flavor folder. WoWDeck reads only these fields.

## WoWDeck on the Deck

The deck-test runner deployed `41b2582` with the engine change. On the
shortcut's game page, `launch.state` and the "Play from…" menu listed
Battle.net, Classic Era (disabled), Forever Beta (disabled) and Forever.
The leftover `_retail_` folder had no row. Down from Battle.net skipped both
disabled rows. Picking Forever and pressing Play started the Steam entry,
then `Battle.net.exe --exec=launch WoWF`, then
`_forever_\Wow.exe -launcherlogin -uid wowf`. The engine reported
`busy: false` and the game running about 43 s after the press.
