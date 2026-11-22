# Combined WoW launch on Steam Deck

DEVICE 2026-11-18. The deck-test runner deployed merge
`2d0960e1872424a218ddf07bcf0b40ee6863450c` on `feat/257-wow-launch`,
including the engine change, and reloaded WoWDeck 1.2.1. The installed
files matched the deployment artifacts.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `847b19b5ae21cf91716ddb27d105908c847485a44936e82472066e58c1276d76` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `e13ae8acffdecff7913ac1e8c3124b5307a5eb80f7cb3c8d52fb8339ea514444` |

The run reused the existing World of Warcraft shortcut (app ID
`4221385996`) and Forever client. The shortcut reaper used
GE-Proton11-12-x86_64 with SteamLinuxRuntime_4. The runner installed no
game or compatibility tool. The SSH observer matched the shortcut's
prefix and paused only its existing retry wrapper after the reaper
appeared. It held the wrapper until it saw the Forever executable or
the observation window expired. See the earlier
[delivery](../2026-11-18-steam-launch-delivery/README.md),
[started-entry](../2026-11-18-steam-started-entry/README.md) and
[stopped-entry](../2026-11-18-steam-stopped-entry/README.md) runs.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Stopped page and launch | Passed (UI, RPC, SSH) | Play had initial focus. Three Right presses reached Forever and the addon band remained visible. A moved Steam to its running-app screen. RPC reported the attempt busy. With the game page closed, the observer saw a replay with `--exec=launch WoWF` at 30.05 s and `_forever_/Wow.exe` at 31.97 s. Times are relative to the SSH observer's start. Back on the page, RPC reported `busy: false` and `gameRunning: running`. The page said "WoW is already running." Toast capture showed only controller notices. |
| Launch after Steam starts the shortcut | Partial (UI, RPC, SSH) | The runner used Steam's `Apps.RunGame` for the same shortcut, as in the prior started-entry run. Three Right presses from Resume did not reach Forever. The runner used `seek Forever` to focus it, then pressed A on the virtual controller. The page said "Starting…" and RPC reported busy with the entry already running. With the page closed, replay appeared at 40.20 s and the Forever executable at 42.59 s. On return, the Forever control had Steam's `Disabled` class and said "WoW is already running." RPC reported the attempt finished and WoW running. The only toast was a controller notice. D-pad navigation from Resume and activation during Steam status `1` still need a device check. |
| Picker focus, Back and icon | Passed (UI, Steam CEF) | Right from Forever reached the chevron. A opened the list on the checked Forever row. Down stayed on the last row and Up reached Classic Era. B closed the list, retained Forever and restored focus to "Choose WoW client." The screenshot showed the selected client's icon beside Forever and the DOM reported a decoded 20 × 20 px image. |
| Picker layout | Failed (UI screenshot) | The menu opened below the chevron and aligned to its right edge. At the 800 × 500 capture size, Steam's footer covered most of the selected Forever row, including its label and check mark. |
| Supported tokens | Partial (UI, RPC, SSH) | Forever was the only launchable client and `WoWF` reached the Forever executable. The picker listed Forever Beta with no launch command and Classic Era with instructions to press Play in Battle.net. Neither row was launchable. The Deck had no existing Retail fixture for `WoW`. |
| Live Steam Launching status | Passed (Steam CEF) | The local app overview went from `11` to `1` to `4` on both starts. At 40 ms sampling intervals, the first observed `1` preceded the first observed `4` by about 390 ms on the stopped-entry run and 350 ms on the Steam-initiated run. The after-Play activation happened after the reaper appeared. |
| Silent Battle.net refusal | Pending (unavailable) | The existing signed-in GE fixture provided no known launcher-side refusal. A safe refusal fixture is needed to observe the launcher message and the absence of a WoWDeck notice through completion. |
| Experimental and legacy | Pending (unavailable) | Proton Experimental and older Steam Linux Runtime directories were present. Steam exposed one matching Battle.net or WoW shortcut and its reaper used GE with SteamLinuxRuntime_4. There was no linked Experimental or legacy-runtime fixture. The live game page used the modern PlaySection and ActionRow layout. A live legacy page and linked direct-WoW page were unavailable. |

## Cleanup and local checks

The observer resumed the retry wrapper in each run. Steam's
`TerminateApp` stopped both test sessions. The final RPC returned
`busy: false`, `entryRunning: false` and `gameRunning: not_running`.
The final SSH check found none of the observed test PIDs and no
Battle.net, Wow.exe or wineserver process. The toast observer removed
itself, and `deck down` restored WoWDeck auto-update and closed its
tunnels. The merged build stayed installed. The run made no direct writes
to Steam files or settings.

`make lint typecheck test build` passed in a temporary copy of the merge
because the checkout's filesystem was nearly full. The frontend suite
passed 1,313 tests. The backend suite passed 1,757 tests and skipped four
archive tests. The Python suites passed.

## Play row and picker retest

DEVICE 2026-11-18. On the Steam Deck LCD with SteamOS 3.9.5, the runner
deployed the frontend fix on `feat/257-wow-launch` based on `908dc6f`.
The installed `dist/index.js` matched SHA-256
`070d12eada043d2a87b0c02a692105accc958af18fc6e20830fe7b836a5178b7`.
The bridge and engine hashes matched the first run. The test reused the same
GE-Proton11-12 and Forever fixture.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Running-row navigation | Passed (UI) | With the wrapper paused and Forever enabled, the original build stopped at Manage. Changing the ActionRow layout to a horizontal row in a live probe let the next Right reach Forever. On the deployed fix, four real Right presses from Resume reached Forever, with Configure Controller and Manage as the second and third stops. The runner used no focus seek. |
| Launch after Steam starts the shortcut | Passed after Resume (UI, RPC, SSH) | The runner invoked Steam's `Apps.RunGame` for the linked shortcut. A on Forever after the Right presses changed `busy` from false to true with `entryRunning: true` and `gameRunning: not_running`. The SSH observer saw the mapped `_forever_/Wow.exe` while the retry wrapper was paused. On return, RPC reported `busy: false` and `gameRunning: running`. Steam marked Forever disabled and the control said "WoW is already running." |
| Launch from the stopped page | Passed (UI, RPC, SSH) | A on Forever opened Steam's running-app screen. RPC changed from a stopped entry to `busy: true` with `entryRunning: true`. The SSH observer saw the mapped `_forever_/Wow.exe` while the wrapper was paused. On return, RPC reported `busy: false` and `gameRunning: running`. |
| Play and addon focus | Passed (UI) | Returning to the stopped page focused Play. Up reached Check for updates in WoW addons and Down returned to Play. Three Right presses reached Forever and one more reached Choose WoW client. |
| Picker layout and Back | Passed (UI, Steam CEF) | At an 800 × 500 screenshot size, the picker opened above and aligned with the chevron. The entire Forever label and check mark were visible. CEF hit tests at the top, middle and bottom of the selected row reached the row. A opened on Forever, Down stayed there, Up reached Classic Era and B returned to the chevron with Forever still selected. The same sequence passed while WoW was running. |

The observer resumed each paused wrapper. Steam stopped both launches. The
final RPC reported `entryRunning: false`, `gameRunning: not_running` and
`busy: false`. The final process check found no Battle.net, Wow.exe or
wineserver. `deck down` restored auto-update and closed both test ports.
The fixed frontend stayed installed.

`make lint typecheck test build` passed. The frontend and tool suite passed
1,313 tests. The backend suite passed 1,757 tests with four RAR tests skipped.
All four Python suites passed, with 83 tests in total.

The earlier pending checks for activation during Steam status `1`, a silent
Battle.net refusal, other launch tokens, Proton Experimental, legacy and
direct-WoW pages, and DroidDeck remain open. The picker fixture offers only one
enabled client, so switching between two enabled clients remains unverified.

## Activation during Steam's Launching status

DEVICE 2026-11-18. The Steam Deck runner matched the installed frontend,
bridge and engine against `ddbc7629457a83468dbf576c8d82d97b8a3ee1b3`.
The frontend hash matched the Play row retest above. The bridge and
engine hashes matched the combined run.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Activate Forever during status `1` | Passed (Steam CEF, RPC, SSH) | Three real Right presses from Play focused Forever. A CEF probe called Steam's `RunGame` once and sampled the live app status every 10 ms. It saw `11 → 1 → 4` and clicked the connected, enabled Forever button during `1`. The probe counted one `RunGame` call for the shortcut through the 3.5 s sample. RPC reported `busy: true` after activation. The SSH observer saw the mapped Forever executable while the retry wrapper was paused. Back on the game page, RPC reported `busy: false` and `gameRunning: running`. The button was disabled and said "WoW is already running." |
| Direct WoW, legacy layout and Proton Experimental | Pending (unavailable) | Steam exposed one matching shortcut and its page used the modern layout. The installed fixture used GE-Proton. Repeat with a linked direct-WoW entry, a live legacy page and a signed-in Experimental shortcut. |
| Silent Battle.net refusal | Pending (unavailable) | The GE fixture launched successfully. Repeat with a known launcher-side refusal and observe Battle.net's message, the button returning to rest and the plugin's toast stream. |
| Retail and switching enabled clients | Pending (unavailable) | The linked installations were Forever, Forever Beta and Classic Era. Only Forever had a playable executable. Repeat with Retail and Forever installed under the same linked Battle.net root. |
| DroidDeck | Pending (unavailable) | ADB reported `No route to host` and listed no device at the configured phone serial. Restore wireless ADB before checking the Steam session and running the combined arm64 flow. |

The CEF probe restored Steam's original `RunGame` function. The observer
resumed the retry wrapper before Steam stopped the test session. The
engine returned to idle and no Battle.net, WoW or wineserver process
remained. The runner closed its tunnel and found no auto-update override
to restore. The matched build stayed installed.

## Steam Play button rework (#285)

DEVICE 2026-11-18, Steam Deck, `deck up --engine` from PR #284 head
`10906d1517c89927c88ab7456fc2f2eae33b3fa1`. The installed `dist/index.js`
(`75f7e2ea06b4c0d0aa2a74fc514be14e3edbc2a5efbab88a9db027a32502fe3b`) and
`main.py` (`fbe53d74…`) matched the local build. The installed engine
(`f5ba1156…`) is the patchelf'd copy of the local `f1710704…`. Same
shortcut (`4221385996`) and Forever fixture as above. No saved launch
choice existed (`steamLaunchTargets: {}`); the active installation was Forever.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-13 Patched Play button | Failed (UI, Steam CEF) | Both after the reload with the page open and after leaving and reopening the page, Steam showed its plain "Play" with its play glyph, no chevron and no Battle.net icon or label. The addon band showed. The Play button CSS module and the forwardRef wrapper were found. The wrapper's `render` carried `__deckyPatch` and the class element carried the composed ref, so `patchInstance` ran. But the instance's own `render` is mobx-react's reactive render, defined `writable: false, configurable: false` (the prototype's `render` defines it on first render). `wrapRender`'s assignment cannot replace it, so `WowPlayButton` never renders. |
| L-14 to L-19, L-21, L-24 | Pending (blocked) | Need the patched button and menu from L-13. |
| L-15/L-16 engine part | Passed (RPC) | `launch.select` Forever returned `Forever`, launchable; Classic Era was refused with "This client can't be launched from this Steam game page"; `launch.select battlenet` saved `{"4221385996":"battlenet"}` and left `selectedInstallationId` at Forever. Battle.net is the default target with an icon. |
| L-20 Direct and unlinked pages | Pending (unavailable) | No direct `WoW.exe` fixture. Unlinked pages are unchanged trivially, since no page is patched. |
| L-23 Fallback | Passed in effect (UI) | With the patch unable to take, Steam's plain Play button stayed usable and the WoW addons section still showed. The one-time console warning was not captured (CEF console attached after it would have fired). |

The run left the saved choice at Battle.net, restored auto-update and
closed the tunnel. The tested build stayed installed.

## Steam Play button rework, second run (#285)

DEVICE 2026-11-18, Steam Deck, `deck up --engine` from the worktree at
`5c6f894` (PR #284 head `6abbb83` plus a docs commit). Only the frontend
changed since the first rework run. The installed `dist/index.js`
(`5429324f6809e7488f3566320548c41c4cdce26957d1b3edebd6926af5eb212b`) and
`main.py` (`fbe53d74…`) matched the local build. The engine was unchanged
(installed `f5ba1156…`, the patchelf'd copy of local `f1710704…`), so
`up` deployed only the frontend. Same shortcut (`4221385996`), GE-Proton
fixture and installations: Forever (launchable), Forever Beta and
Classic Era (both disabled). The saved choice was Battle.net at the start.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-13 Patched Play button | Passed (UI, Steam CEF) | After opening the page with the plugin loaded, Play read "Play" over "Battle.net" with a decoded 256 × 256 icon. Steam's chevron sat beside it. Play had first focus and the row had no second launch button. The screenshot showed the green Play button with the Battle.net icon. `deck up --reload` with the page open (engine pid 72982 → 73075) gave the same row with focus still on "Play Battle.net", so the remount works. |
| L-14 Menu and navigation | Passed, with one note (UI, Steam CEF) | Right then A on the chevron opened "Play from" with Battle.net, Classic Era ("Battle.net can select this version. Press Play there to start it."), Forever Beta ("WoWDeck has no launch command for this client") and Forever, in client table order, then Steam's "Change Artwork..." and "Cancel". Steam's checkmark marked the saved choice (Battle.net, later Forever). The disabled rows carry `contextMenuItem disabled`, and D-pad focus skips them (Down from Battle.net lands on Forever), so A cannot reach them. Up from Battle.net wraps to Cancel, Down from Cancel back to Battle.net. B closed the menu and focus returned to the chevron, with the choice unchanged. Note: the menu always opens with focus on the first row (Battle.net), not on the checked row. |
| L-15 Pick Forever, then Play | Passed (UI, RPC, SSH) | A on Forever closed the menu and started nothing (`entryRunning: false`). Play read "Play" over "Forever" with Forever's icon. Settings kept `selectedInstallationId: 5e80311f078e` (Forever, already active) and saved `steamLaunchTargets: {"4221385996": "5e80311f078e"}`. A on Play moved Steam to its running-app screen and RPC reported `busy: true`. SSH showed one `reaper SteamLaunch AppId=4221385996`, then `Battle.net.exe --exec=launch WoWF` and `_forever_\Wow.exe -launcherlogin -uid wowf` about 20 s later. RPC then reported `gameRunning: running`. Run twice. Toasts: only a controller notice. |
| L-16 Pick Battle.net, then Play | Passed (UI, RPC, SSH) | After picking Battle.net, settings saved `"battlenet"` and kept `selectedInstallationId` at Forever. A on "Play Battle.net" opened Steam's running-app screen. 45 s later SSH showed one reaper and Battle.net with its helpers, with no `--exec` argument and no `Wow.exe`. RPC reported `busy: false`, `gameRunning: not_running`. Toasts: only a controller notice. |
| L-17 Running game | Passed (UI, RPC, SSH) | With Forever running, the row showed Steam's Resume, Stop (X) and chevron (screenshot). In the menu the checkmark was on Forever. Picking Battle.net changed the saved target to `battlenet`. The row stayed Resume / Stop and the same `Wow.exe` pid kept running. Runner error, recorded here: on the first attempt one Right from Resume reached Stop rather than the chevron, and A then A confirmed Steam's stop dialog, which ended that session. The test was repeated after a fresh launch. |
| L-18 Unreadable icon | Passed (UI, RPC) | `chmod 000` on `_forever_/Wow.exe`, then reopening the page: `launch.state` returned Forever without an `icon`, and Play showed WoWDeck's box glyph (SVG) with no `<img>` and no broken image on the page. The mode was restored to 755. The engine caches the failed read by path, size and mtime, so the icon came back only after a plugin reload (engine 79007 → 79143). A file that gets readable again without changing does not get its icon back until the engine restarts. |
| L-19 Launch errors | Pending (unavailable) | No fixture makes Steam report a launch error or keeps Battle.net from becoming ready. |
| L-20 Direct and unlinked pages | Partial (UI) | Vampire Survivors (1794680, unlinked) kept Steam's own Play button and menu ("This Steam Deck", "Stream from: kaptan", "Cancel") with no WoW rows. The second "World of Warcraft" shortcut (3332867997) is a remote shortcut from Kaptan: Steam's "Stream from kaptan" button, no WoW rows and no addon section. No direct `WoW.exe` shortcut exists on this Deck, so the direct-entry half is untested. |
| L-21 Fake remote client | Partial (UI, Steam CEF) | In SharedJSContext, a fake entry (`clientid 7777777777777777`, `client_name FakePC`) appended to the WoW overview's `per_client_data` added "Stream from: FakePC" after the WoW rows. Picking it went through Steam's own handler and closed the menu, but Steam's backend then replaced `per_client_data` with its single local entry and kept `selected_clientid "0"`, since FakePC does not exist. Setting `selected_clientid` to the fake id in memory as well made Steam's button read "Connect" (Steam's own label and glyph, no PC name, with display status 4 or 11). WoWDeck did not override it. The checkmark sat on the stream row and on none of the WoW rows. Picking Forever from that menu called `SetStreamingClientForApp(4221385996, "0")` once. `selected_clientid` went back to `"0"` and Play read "Play" over "Forever" again. A second injection appended to data that still held the first fake, so that menu showed the stream row twice. That came from the fixture, not the plugin. A real second PC is needed to see Steam's "Stream" label with a PC name. The fake entry and the `SetStreamingClientForApp` recorder were removed; the overview ended with one client (`"0"`, selected). |
| L-22 Row markup against Steam's menu | Partial (UI, Steam CEF) | Vampire Survivors' menu, with Kaptan on, and the WoW menu use the same row classes: `contextMenuItem`, Steam's check container and the target-label class. Disabled rows add Steam's description class. Up, Down and B move focus the same way. The checkmark differs: Steam's is its blue `SVGIcon_Button` gradient check, while WoWDeck's rows draw a plain white check (`svg`/`path`). |
| L-23 Fallback | Passed (UI, Steam CEF) | A local copy of the bundle with the wrapper's `"navigator:"` probe changed was loaded with `reload-frontend --file`, with a `console.warn` recorder in SharedJSContext. The WoW page showed Steam's plain green Play with no chevron, and the WoW addons section still showed. The only WoWDeck warning was `wowdeck: WoW client choice not shown on Steam's Play button (no Play button wrapper)`. The recorder was removed and `deck up --reload` restored the installed bundle. |
| L-24 Battle.net already open | Passed (UI, RPC, SSH) | Battle.net was running from L-16 with WoW closed and Battle.net chosen. The row showed Steam's Resume and Stop. After picking Forever, the row read "Play" over "Forever" with Forever's icon, next to Steam's Stop and the chevron. A on Play stayed on the game page. SSH showed the same reaper (pid 77615), no new Steam start, then `--exec=launch WoWF` and `_forever_\Wow.exe` 14 s later. |

Also seen: on a WoW shortcut Steam's menu adds "Change Artwork..."
before "Cancel"; Vampire Survivors' menu does not. In both menus the
footer reads "B SELECT, A BACK" with Xbox glyphs while the virtual Xbox
360 pad is connected, so that comes from Steam rather than WoWDeck.

Killing `Wow.exe` while Battle.net ran brought down Battle.net and the
Steam entry too, so the "quit WoW, then pick Battle.net" step of L-24
used the state from L-16 (Battle.net open, WoW closed, Battle.net chosen)
rather than a second quit.

Cleanup: Steam's `TerminateApp` stopped the last session. The final RPC
reported `entryRunning: false`, `busy: false`,
`gameRunning: not_running`, and SSH found no Battle.net, Wow.exe,
wineserver or reaper. `_forever_/Wow.exe` is mode 755 again. The saved
choice is back at Battle.net, and Play read "Play" over "Battle.net".
`deck down` restored auto-update and closed the tunnel. The tested
frontend (`5429324f…`) stays installed.

## Steam Play button rework, third run (#285)

DEVICE 2026-11-18, Steam Deck, `deck up --engine` from the worktree at
`f27d3b9` (PR #284 head). Changes since the second run: `52ac220` (Play
icon as an SVG, Steam's chevron and gradient check, 12/16 px reasons) and
`7bdb542` (the engine no longer caches a failed icon read). The installed
`dist/index.js` (`190f3376b80ebd19bf618807abc479f96a234cabb5116da41544732fbdc20025`)
and `main.py` (`fbe53d74…`) matched the local build. The installed engine
(`2fefad96…`) is the patchelf'd copy of the local `f70e07a3…`; `up`
reported engine pid 79753 → 79998. Same shortcut (`4221385996`), GE-Proton
fixture and installations as before. The saved choice was Battle.net at
the start.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-18 Unreadable icon, then readable again | Passed (UI, RPC, SSH) | `launch.select` Forever, then leaving for Vampire Survivors and reopening the WoW page: Play read "Play \| Forever" with an `<svg><image>` holding Forever's icon (713,337-character data URL). `chmod 000 _forever_/Wow.exe` followed by `deck up --no-build --reload` (engine 79998 → 80236), then reopening the page: Play read "Play \| Forever" with WoWDeck's glyph (one-path SVG, no `<image>`, no `<img>`). `chmod 755` and reopening the page with no reload (engine still 80236): Forever's icon was back, the same 713,337-character `<image>`. Size and mtime stayed `80689360` / `1794989869` throughout. |
| L-22 Row markup against Steam's menu | Passed (UI, Steam CEF) | Opened with A on the chevron, read in the menu's document, closed with B. In both menus each target row is `contextMenuItem Panel Focusable` with the same two hashed classes and the same two children: Steam's check container and the label. Disabled WoW rows add `disabled` and a reason line. The selected row's check is the same SVG in both: `SVGIcon_Button SVGIcon_DialogCheck`, a 256 × 256 viewBox, a `linearGradient` from `#00ccff` to `#2d73ff`, and the same stroke path and drop-shadow filter. On the WoW page it sat on Battle.net. On Vampire Survivors it sat on "Stream from: kaptan". Focus opened on the first row in both: "Battle.net" on WoW, "This Steam Deck" on Vampire Survivors. Rows: WoW had Battle.net, Classic, Forever Beta, Forever, "Change Artwork...", "Cancel"; Vampire Survivors had "This Steam Deck", "Stream from: kaptan", "Cancel". |

Finding from the first L-18 attempt: an icon that was read successfully
stays cached after `chmod 000`, because the cache is keyed by path, size
and mtime and a permission change touches none of them. With the engine
already holding Forever's icon, reopening the page after `chmod 000`
still showed Forever's icon (RPC `launch.state` returned it too). The
glyph appears only when the first read in an engine's lifetime fails,
which is why the passing run reloads the plugin after `chmod 000`. This
matches the cache's documented behaviour: only a failed read is
forgotten.

End state: `_forever_/Wow.exe` is mode 755 again. The saved choice is
Battle.net (`launch.state` target `battlenet`, `busy: false`,
`entryRunning: false`). Steam is on the Vampire Survivors page with focus
on "Stream from kaptan", the owner's selection untouched, and no menu
open. `deck down` restored auto-update and closed the tunnel. The tested
build stays installed.

## Direct WoW entry and Battle.net launch commands

DEVICE 2026-11-18, Steam Deck, PR #284 at `9e931bc` on
`feat/257-wow-launch`. `deck up` reported that the Deck already ran this
build, so nothing was deployed. Same WoW shortcut (`4221385996`),
GE-Proton11-12 prefix and installations as above: Forever, Forever Beta
and Classic Era under `/home/deck/Applications/World of Warcraft`. The
saved choice was Forever at the start. Battle.net log times are UTC; the
Deck's file times are UTC+1.

### L-20 with a direct entry

In SharedJSContext the runner added a non-Steam shortcut "WoWDeck L-20
test" (app ID `4124722553`) for `_forever_/Wow.exe`, with
`STEAM_COMPAT_DATA_PATH=…/compatdata/4221385996 %command%` and GE-Proton11-12.
`AddShortcut` quotes the paths it gets, so the first attempt stored
`""…/Wow.exe""` and nothing linked. `SetShortcutExe` and
`SetShortcutStartDir` then set the paths quoted once, as in the WoW shortcut.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| L-20 Direct entry page | Passed (UI, RPC) | After `installations.detect` and a plugin reload (the frontend keeps the installation list it loaded, so a rescan through RPC alone did not show the section), the page showed the WoW addons section ("All addons are up to date", Check for updates, Open) above Steam's plain green Play. Play had no chevron and no client or Battle.net label (screenshot). `launch.state` for `4124722553` returned `{"state":null}`. The unlinked half passed in the second rework run. |
| Direct entry and the Battle.net shortcut's link | Failed (RPC) | With Steam's usual `StartDir` form, a trailing slash (`"…/_forever_/"`), Forever's `steamGames` held only the test entry, and the World of Warcraft shortcut lost its link to Forever. `launch.state` for `4221385996` then listed Battle.net, Classic Era and Forever Beta, with no Forever, and fell back to Battle.net although the saved choice was still Forever. The WoW page read "Play Battle.net". With `StartDir` set without the slash, a rescan gave Forever both entries and the target was Forever again. The cause, read from `InstallationDetector`, is that `findFlavorDirs` keeps the slash on the `StartDir` root `…/_forever_/`, so it becomes a second candidate next to `…/_forever_`. That candidate carries only the direct entry's link and replaces the first one. Fixed on the branch after this run: `findFlavorDirs` strips the slash. |

Cleanup: `SpecifyCompatTool(id, "")` and `RemoveShortcut`. Afterwards
`appStore` had no "L-20" app, `config.vdf` had no `4124722553`,
`shortcuts.vdf` was back at its original size and differed from the
pre-test backup only in the WoW entry's `LastPlayTime`, and every
installation listed only `4221385996` again.

### Battle.net launch commands

The runner set the choice to Battle.net and started the WoW entry with
Steam's `RunGame`. It waited until Battle.net logged in ("Data-sharing
consent fetched"). The runner then sent each command the way WoWDeck does, with the
reaper's runtime, `--verb=run -- proton run Battle.net.exe --exec=<cmd>`
in the same prefix, with the reaper's Steam and display environment.
The evidence is the `[GameController]`, `[GameLaunchController]` and
`[InstallManager]` lines in Battle.net's log, plus the process list.

| Command | Outcome | Battle.net log |
| --- | --- | --- |
| a) `launch wow_classic_era` | Did nothing visible. No selection change, no client | `Selecting game family by id: wow_classic_era`, then nothing |
| b) `launch_uid wow_classic_era` | Selected only | `Selecting game by uid. uid=wow_classic_era prioritizeUpdate=1`, `New selection for product group WoW: account=GameAccount(WoW:wow_classic_era …)` |
| c) `launch_uid wow_classic_era`, then `launch WoW` | Selected Retail, started nothing | `launch_uid` as in b, then `Selecting game family by id: WoW`, `New selection for product group WoW: account=GameAccount(WoW:retail …)`. No `LaunchBinary` |
| d) `launch wow_classic_beta` | Did nothing visible | `Selecting game family by id: wow_classic_beta`, then nothing |
| e) `launch WoWB` | Did nothing visible | `Selecting game family by id: WoWB`, then nothing |
| f) `launch_uid wow_classic_beta`, then `launch WoWF` | Started Forever, not Forever Beta | `New selection … GameAccount(WoW:wow_classic_beta region=EU unbound)`, then `Selecting game family by id: WoWF`, `New selection … (WoW:wowf …)`, `LaunchBinary: uid=wowf`, `Launched Z:/home/deck/Applications/World of Warcraft/_forever_/Wow.exe with args: -launcherlogin -uid wowf`, `Game is now running with game launch behavior set to exit` |

`launch <code>` acts on a game family. `WoWF` selects and starts
`wowf`, `WoW` selects Retail's account (Retail is not installed here, so
nothing starts), and a uid or unknown code only logs the family lookup.
The family's own selection replaces the `launch_uid` selection, so it
cannot steer `launch WoWF` to another uid. The Forever Beta account
showed as `unbound`, so this account may not have beta access. No
command started Classic Era or Forever Beta.

### Running a client directly

Battle.net's own launch (f) ran
`Z:\home\deck\Applications\World of Warcraft\_forever_\Wow.exe -launcherlogin -uid wowf`
(read from `/proc/<pid>/cmdline`). Battle.net logged `Setting launch env
var BDK_LAUNCH_GUID` for its agent. The client's environment held an
extra variable with a 28-character hashed name; its value was not read.
Battle.net exits once it has launched a game.

With Battle.net running and logged in, the runner started each client
in the prefix with `proton run <exe> -launcherlogin -uid <uid>`:

| Client | Outcome | Evidence |
| --- | --- | --- |
| g1) `_classic_era_/WowClassic.exe -uid wow_classic_era` | Did not log in. Exited after 46 s | Battle.net: `Game is running: wow_classic_era`, `Pre-existing game session detected without a pending launch. Not performing game launch behavior.`, then `Game is no longer running` at 22:23:12. `gx.log` showed D3D12 set up. `Connection.log` and `Hotfix.log` stayed empty. No error dump |
| g2) `_classic_beta_/WowB.exe -uid wow_classic_beta` | Did not log in. Exited after 73 s | Same Battle.net lines, 22:25:18 to 22:26:31. The client had a 1280 × 800 "World of Warcraft" window. All its logs, `Connection.log` and `WowConnection.log` included, stayed empty. No error dump |
| Control: `_forever_/Wow.exe -uid wowf` | Did not log in. Exited after 114 s | Same Battle.net lines, 22:27:04 to 22:28:58. `Hotfix.log` restarted at 0 bytes and stayed there; after Battle.net's own Forever launch it reached 8,116,770 bytes |

A direct start with `-launcherlogin -uid` does not log in, even for
Forever, which Battle.net itself starts with the same arguments. The
launcher's own launch has to hand the login over. Battle.net stayed in
front (gamescope's focused window was Battle.net's), so a dialog from the
client could not be seen; screenshots showed only Battle.net's store.

End state: Steam's `TerminateApp` stopped the session, and no Battle.net,
WoW client or wineserver process remained. The saved choice is Forever
again (`steamLaunchTargets {"4221385996":"5e80311f078e"}`, selected
installation Forever). `launch.state` reported target Forever,
`busy: false`, `entryRunning: false` and `gameRunning: not_running`. The
WoW page read "Play | Forever" under the addon section. Steam's "Slow
Charger" notice was up at the start and again after the reload; the
runner closed it with B both times. The probe script was removed from the Deck.
The `shortcuts.vdf` and `config.vdf` backups stay in
`~/homebrew/data/wowdeck/test-backups/l20-231105/`. `deck down` restored
auto-update and closed the tunnel. The tested build stays installed.

## Icons out of the polled launch state

DEVICE 2026-11-19, Steam Deck, `deck up --engine` from the worktree at
`0b221e8` (`feat/257-wow-launch`, "Launch: Read icons on their own, out
of the polled launch state"). It replaced `8a3b202` from `next`. The
installed `dist/index.js` (`cec12693…bb23f3`) and `main.py` (`fbe53d74…`)
matched the local build. The installed engine (`88119a6b…0eed7f98`)
matched a local copy of `backend/out/wowdeck-x86_64` (`aabce8a4…`) after
the runner's `patchelf --set-interpreter` step. `up` reported engine pid
186499 → 187104. Same shortcut (`4221385996`) and installations as
before. The saved choice was Battle.net at the start. A Steam "Slow
Charger" notice was up and the runner closed it with B.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| Payload | Passed (RPC) | `launch.state` from SharedJSContext: 870 bytes, no `data:` URL and no `icon` key. 20 calls: median 5.4 ms, min 5.1, max 7.2. `system.getStatus`: median 1.4 ms (1.3–1.9). Before: 1,624,088 bytes, median 120.7 ms. `launch.icon` returned a single-image ICO for each client: 48 × 48, 32 bpp, 9,662 bytes raw, 12,909 bytes as a data URL. First call per client: battlenet 8.3 ms, Classic Era (`032c354a655f`) 91.6 ms, Forever Beta (`351cab445486`) 114.6 ms, Forever (`5e80311f078e`) 96.8 ms. Repeat calls took 3.7–5.7 ms. Before, the data URLs were 149,649, 23,417, 23,417 and 713,337 bytes. Battle.net and Forever have different icons. Classic Era and Forever Beta share one, as they did before. An unknown id returned `null` in about 4 ms. |
| L-13 Play shows the selected target | Passed (UI, screenshot) | On the linked page Play read "Play \| Battle.net", with an `<svg><image>` holding Battle.net's ICO. It decoded at 48 × 48 and rendered at 24 × 24, with no `<img>`. The chevron sibling was focusable. The screenshot showed Battle.net's icon. Remount: after `deck up --no-build --reload` with the page open (engine 187104 → 187311), Play still read "Play \| Battle.net" with the same icon (the hash matched) and the chevron. |
| L-15 Picking a client switches Play | Passed (UI, RPC) | Battle.net was selected at the start. Right, then A, opened the menu with focus on Battle.net. A on "World of Warcraft: Forever" closed it. Play read "Play \| Forever" with Forever's icon, and `launch.state` target was `5e80311f078e`, `busy: false`, `not_running`. Nothing launched. Afterwards the menu set Battle.net again: Play read "Play \| Battle.net" and the target was `battlenet`. |
| L-18 Unreadable icon, then readable again | Passed (UI, RPC, SSH) | Forever was selected. `chmod 000 _forever_/Wow.exe` changed the mode from 755 to 0, then `deck up --no-build --reload` (engine 187311 → 187570). Leaving for the library home and reopening the page: Play read "Play \| Forever" with WoWDeck's glyph (one-path SVG, no `<image>`, no `<img>`). `launch.icon` returned `null`. After `chmod 755`, leaving and reopening with no reload (engine still 187570), Forever's icon came back: same hash, decoded 48 × 48. Size and mtime stayed at `80689360` / `1794989869`. |
| Icon read only on page open | Passed (UI, Steam CEF) | The runner wrapped `DeckyBackend.call` in SharedJSContext. It left for the library home, reopened the page and watched for 10 s. Calls: `launch.state` × 6 at 2 s intervals, `launch.icon` × 1 (battlenet, 190 ms after the first state), plus `addons.updateSummary` × 3. The runner then removed the wrapper and checked that it was gone. |
| Click guard | Pending (unavailable) | Needs a Steam build without `RunGame`. |

The menu closed with the probe's focus label empty, as with Right onto
the chevron. The chevron has no text label, so the probe can't tell
whether focus went back to it.

End state: `_forever_/Wow.exe` is mode 755 again. The saved choice is
Battle.net (`busy: false`, `entryRunning: false`, `not_running`). Steam
is on the WoW page. No menu is open and no WoWDeck hook remains in
SharedJSContext. `deck down` restored auto-update and closed the tunnel.
The tested build stays installed, engine pid 187570.

## L-19 and L-21 checks

DEVICE 2026-11-19, Steam Deck, PR #284 head `ecd2a29` on
`feat/257-wow-launch`. Its code matches `0b221e8` from the run above:
the two differ only in this file. The installed `dist/index.js`
(`cec12693…bb23f3`), `main.py` (`fbe53d74…`) and engine (`88119a6b…`)
matched the local build, so `deck up --engine --no-build` reported that
the Deck already ran this build and deployed nothing. Engine pid 187570.
At the start the saved choice was Battle.net
(`steamLaunchTargets {"4221385996":"battlenet"}`), the selected
installation was Forever, and `launch.state` reported `busy: false`,
`entryRunning: false` and `not_running`. No Battle.net, WoW, wineserver
or reaper process ran.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-19 Launch errors | Pending (out of scope) | The plan was to swap the shortcut's executable for a stand-in. The shortcut (`shortcuts.vdf`, read only) starts `"/home/deck/.local/share/Steam/steamapps/compatdata/4221385996/pfx/drive_c/Program Files (x86)/Battle.net/Battle.net.exe"` with `StartDir` `"/home/deck/Applications/World of Warcraft"`. That file sits in the shortcut's Proton prefix, outside `~/Applications/World of Warcraft/`, which is the only part of the WoW setup a test may change. The install's own `World of Warcraft Launcher.exe` is not what Steam starts. No file was changed and Play was not pressed. Baseline for a later run: `Battle.net.exe` is 995,536 bytes, mode 775, mtime `1793780569` (2026-11-04 09:22:49 +0100), sha256 `7e7c2501ebe31cfa872e4b97f511ae03fc783b79494c5c840cab8896b07f4a4d`. The prefix has `windows/system32/notepad.exe` for the stand-in. |
| L-21 Real stream row | Not runnable (UI, Steam CEF, read only) | Kaptan did not answer a ping on `kaptan.local`. In SharedJSContext the WoW overview's `per_client_data` held one entry, `clientid "0"`, with `selected_clientid "0"`. No app in `appStore.allApps` had a remote client. Vampire Survivors, which showed "Stream from: kaptan" on 2026-11-18, listed only "This machine". The WoW page's Play from… menu, opened with A on the chevron, read Battle.net, World of Warcraft Classic (disabled), World of Warcraft: Forever Beta (disabled), World of Warcraft: Forever and Cancel. It had no stream row. B closed it. |

The menu had no "Change Artwork..." row this time. The earlier runs saw
it before "Cancel".

A first attempt to reach the chevron by keyboard left focus on the
controller button, and Enter opened Steam's controller layout page. B
went back to the WoW page at once, and nothing in it was changed.

End state: nothing on the Deck changed. The saved choice is Battle.net
(`launch.state` target `battlenet`, `busy: false`, `entryRunning: false`,
`not_running`). Steam is on the WoW page with no menu open. `deck down`
closed the tunnel and found no auto-update override to restore. The
tested build stays installed, engine pid 187570.

### L-21 with Kaptan online

DEVICE 2026-11-19, Steam Deck and Kaptan, same build as above. `deck up
--engine --no-build` reported that the Deck already ran this build. On
the Deck, `dist/index.js` (`cec12693…bb23f3`), `main.py` (`fbe53d74…`)
and the engine (`88119a6b…0eed7f98`) matched. Engine pid 187570. The
run read state only. It opened no menu and pressed nothing.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-21 Real stream row | Not runnable (SSH, Steam CEF, read only) | Kaptan answered ping and SSH. Steam ran there in Game Mode (`steam … -gamepadui`). Of its two `userdata/*/config/shortcuts.vdf` files, one was empty. The other, the account in use today, held a "World of Warcraft" shortcut with app ID `3332867997` (bytes `9d 87 a7 c6`). Its `Exe` is `"/home/sigurdb/Applications/Battle.net/Battle.net.exe"`. No file held `4221385996` (bytes `0c 3d 9d fb`). The Deck's shortcut starts Battle.net from its Proton prefix (`compatdata/4221385996/pfx/…`), so the two app IDs differ. In the Deck's SharedJSContext, 1268 apps in `appStore.allApps` listed client `kaptan` (`8442040337894450816`), so Remote Play discovery worked. Vampire Survivors listed "This machine" and `kaptan`. App `3332867997` ("World of Warcraft") listed only `kaptan`. The WoW page's app `4221385996` listed only client `"0"`, with `selected_clientid "0"`. Steam offers no "Stream from kaptan" row for it. |

The gate failed on one condition: Kaptan has no shortcut with app ID
`4221385996`. Steam ran on Kaptan, the account matched, and Remote Play
discovery worked. The next run, below, shows that Kaptan's Steam picks its own ID
for a new shortcut, so copying the Deck's entry does not help. The Deck
already lists
Kaptan's own WoW shortcut as a separate, stream-only app. The fake
client run above stays the only L-21 evidence.

End state: nothing changed on either machine. No file on Kaptan was
written. On the Deck the saved choice is Battle.net (`launch.state`
target `battlenet`, `busy: false`, `entryRunning: false`,
`not_running`). Steam is on the WoW page with no menu open, and no
Battle.net, WoW, wineserver or reaper process runs. `deck down` closed
the tunnel and found no auto-update override to restore. The tested
build stays installed, engine pid 187570.

### L-21 with the Deck's shortcut copied to Kaptan

DEVICE 2026-11-19, Steam Deck and Kaptan, same build as above, with the
owner's approval to change Steam on Kaptan for this run. The Deck's
shortcut entry for `4221385996` was copied byte for byte into Kaptan's
`shortcuts.vdf` (account `54679723`) as a third entry. Only its index key
changed: same `AppName`, `Exe`, `StartDir` and the stored `appid`
`4221385996`. The repo's `readSteamShortcuts` read the two original
entries unchanged and the new one with app ID `4221385996`.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-21 Real stream row | Not runnable (SSH, Steam CEF) | Kaptan's Steam restarted on the new file, and the file kept its hash. Over 2 minutes the Deck's app `4221385996` listed only client `"0"`, while Kaptan's older WoW shortcut `3332867997` listed `kaptan` throughout. The Deck's `appStore.allApps` then showed a third "World of Warcraft" app, `3917894588`, offered only by `kaptan`. Kaptan's Steam gave the copied entry an ID of its own and ignored the stored `appid`. No CRC of the entry's `Exe` and `AppName`, in either order and with or without quotes, gives `3917894588`. The Deck's own `4221385996` is not such a CRC either. These IDs look assigned when a shortcut is first added, so no shortcut file edit makes Kaptan offer `4221385996`. |

Stopping Steam on Kaptan needs care. `gamescope-session.target` has
`Upholds=steam-launcher.service`, so systemd starts Steam again within
milliseconds of a stop, and a runtime mask did not prevent that. A stop
kills Steam with SIGKILL, so Steam writes nothing on the way down. The
file was therefore replaced and Steam stopped in one command, and the
restart read the new file. Each stopped Steam run lasted over 60 s
(8 m 59 s, 1 m 16 s and several minutes), so Steam's short-session
tracker stayed at zero and its auto-repair never armed.

End state: Kaptan's `shortcuts.vdf` was restored the same way, with the
original hash `b563292d…` and mode 755. The backup copy was removed, no
mask is left, and Steam and `gamescope-session` run. The Deck was only
read: the saved choice is still Battle.net and the tested build stays
installed, engine pid 187570. `deck down` closed the tunnel. L-21 stays
partial: the fake client run above is its evidence.

The owner accepted L-21 on 2026-11-19 as a case that can't occur. If
Steam starts offering a stream row for a non-Steam shortcut from another
PC, L-21 is run again.

## L-19 with a stand-in Battle.net

DEVICE 2026-11-19, Steam Deck, same build as above (engine pid 187570),
with the owner's approval to replace the shortcut's `Battle.net.exe` in
its Proton prefix for this run. The original (sha256 `7e7c2501…`,
995,536 bytes, mode 775) was copied to
`~/homebrew/data/wowdeck/test-backups/2026-11-19-110437-l19/`. Forever
(`5e80311f078e`) was selected, with the entry stopped. Each case pressed
A on Play after a screenshot showed Play focused (green), not the
chevron. A background SSH sampler listed the entry's processes every
10 s.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-19a Battle.net never becomes ready | Passed (UI, SSH) | `Battle.net.exe` was replaced by the prefix's own `notepad.exe` (dereferenced, 329,757 bytes). A on Play started Steam's entry: the reaper `SteamLaunch AppId=4221385996` ran with `C:\Program Files (x86)\Battle.net\Battle.net.exe`, which showed Notepad's window. No Battle.net renderer appeared. The toast observer saw exactly one WoWDeck notice, "Couldn't launch Forever / Battle.net didn't become ready", within 175 s. No sample showed `--exec=launch`, so WoWDeck sent no launch request. `SteamClient.Apps.TerminateApp` stopped the entry afterwards, and `launch.state` read `entryRunning: false`. |
| L-19b Steam reports a launch error | Not producible (UI, SSH) | With `Battle.net.exe` removed, A on Play showed no Steam error and no dialog. Steam started the entry through Proton anyway, and it ended within seconds, before the first 10 s sample. The engine saw the entry start and stop, so the attempt ended `never-ready`: exactly one notice, "Couldn't launch Forever / Battle.net didn't become ready". No `--exec=launch` appeared. Steam's `LaunchApp` error never fired, so WoWDeck's refusal notice could not be shown on the Deck. `src/steamLaunch.test.ts` and the engine's `launch.*` tests cover that path. |

A first attempt pressed A with the chevron focused and opened the Play
from... menu instead. B closed it and nothing started. Focus is easy to
misread here: the chevron focused turns only the chevron white, while
Play focused turns the whole button green.

End state: `Battle.net.exe` is restored with the same sha256, size, mode
and mtime (`1793780569`). The backup stays in `test-backups`. The saved
choice is Battle.net again, and Forever stays the active installation
(`launch.select` for Battle.net leaves it alone). No reaper, Battle.net
or Notepad process runs. `deck down` closed the tunnel. The tested build
stays installed.

## Classic family command after a version selection

DEVICE 2026-11-19, Steam Deck, same build. The WoW entry ran with
Battle.net chosen, started with Steam's `RunGame`. Battle.net logged in
at 10:42:48 UTC. Commands went in the way WoWDeck sends them: the
reaper's runtime, `--verb=run -- proton run Battle.net.exe
--exec=<cmd>` in the entry's prefix, with the reaper's environment.
Each second Battle.net logged `Leaving because another instance of
battle.net is running`, and the main one logged `Received IPC Message:
IPC_COMMAND`. This Battle.net logs no `Selecting game` lines, so
`gamescopectl screenshot` and the process list are the evidence.

| Command | Outcome |
| --- | --- |
| `launch_uid wow_classic_era`, then `launch WoWC` 8 s later | Battle.net showed WoW Classic with Game version "World of Warcraft Classic" (Classic Era, 1.15.9), Launch into "Hardcore", Play focused and a yellow "Unsupported" badge. No `WowClassic.exe` started within 90 s |
| `launch WoWC` again | No client started within 15 s |
| `launch WoWF` (control) | Forever started (`_forever_\Wow.exe -launcherlogin -uid wowf`) and reached character select. It was closed with SIGTERM |

`battle.net.dll` from `Battle.net.17986` (build 2.53.8) has the `--exec`
verbs `launch_register`, `launch_uid`, `focus`, `handle_uri`, `register`,
`disk`, `web`, `torrent`, `install`, `repair`, `modify`,
`set_game_language`, `xbox_comms_opt_in`, `login`, `launch`, `shutdown`,
`dialog` and `logout`. Games start through `LaunchGameByProduct` or
`LaunchGameByUri`. The URI path rejects requests with `Token mismatch.`,
`Account id mismatch.` or `Invalid timestamp.` inside
`LaunchGameByUriValidPeriodSec`, so it needs a link signed for the
account. Without those parameters a URI only focuses a game by uid.

End state: the entry was stopped with `SteamClient.Apps.TerminateApp`.
`launch.state` reads Battle.net, `entryRunning: false`, `not_running`.
No WoW or Battle.net process runs. `deck down` closed the tunnel. The
tested build stays installed.


## Turning WoWDeck's Play button off and on (L-27, #286)

DEVICE 2026-11-20, Steam Deck, `feat/257-wow-launch` at `cfc00d8`
(PR #284), frontend and engine. `deck up --engine` deployed it and
reloaded WoWDeck 1.2.1. The engine pid went from 220431 to 221067. The installed
`dist/index.js` (`bbf0b0f4…bd3915`) and `main.py` (`fbe53d74…`) match the
local build. The engine (`010c8abe…0acf1e2c`) differs from the local
`backend/out/wowdeck-x86_64` (`33258d3f…`), as the deploy patches the
binary with patchelf. The run used the linked Battle.net shortcut
(`4221385996`) and its existing clients; it installed nothing.

To count the plugin's launch calls, the runner wrapped
`WebSocket.prototype.send` in SharedJSContext, where Decky's frontend
talks to `main.py`. The wrapper recorded the time and method of each
message that named a `launch.` method. The runner removed it at the end
of the run, and `window.__l27` read `undefined` afterwards.

| Row | Result | DEVICE evidence |
| --- | --- | --- |
| L-27 Play button off and on | Passed (UI, Steam CEF) | Right from Play to the chevron, A opened Steam's "Play from…" menu on Battle.net, `seek Forever` and A picked World of Warcraft: Forever. The recorder saw one `launch.select`. Play read "Play \| Forever" with Forever's icon (`svg image`) and a "Play from…" chevron. With the setting on, `launch.state` went out every 2 s. In the QAM, Options → Steam library → **Choose the WoW version from Play**, A: `settings.get` read `steamLaunchMenu: false`. `close` returned to the page, which had stayed open, and focus was on "Play". **Off:** the Play row held one button, "Play", with Steam's play glyph and no `svg image`. There was no "Play from…" chevron, so Steam offered no menu, and no context menu was open. The screenshot shows Steam's plain green Play button with nothing under "Play". The WoW addons section read "All addons are up to date \| Check for updates \| Open" with no launch status line. The recorder stayed at 25 messages from the toggle until 22 s after the last `launch.state` (sent 2.6 s before the toggle was confirmed), so no launch call went out while off. **On again:** the same toggle, A, read `steamLaunchMenu: true`. `close` returned to the same page without reopening it. Focus was on "Play Forever", and Play read "Play \| Forever" with Forever's icon and the chevron. Within 7 s the recorder saw one `launch.icon` and `launch.state` every 2 s again. |

The page had no addon updates waiting, so **Update all** was absent both
on and off. L-2 shows it only when updates wait, and the band was the
same in both states. This run didn't check that it shows while off when
updates wait.

End state: **Choose the WoW version from Play** is on. `launch.state`
for `4221385996` targets Forever (`5e80311f078e`), `entryRunning: false`,
`gameRunning: not_running`, `busy: false`. Steam is on the WoW page with
no menu open. The recorder is removed. `deck down` closed the tunnel and
turned autoUpdate on again. The tested build stays installed, engine pid
221067.
