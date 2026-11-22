# Steam Deck launch delivery spike

Delivery is now verified on the Deck under GE-Proton and Proton Experimental.
The [2026-11-21 production-plugin run](#production-plugin-verification-on-deck)
completes #280's remaining hardware check. The earlier sections record the
original spike. The separate control and legacy insertion work were later
superseded by #285 and ADR 0016.

## Build and fixture

DEVICE 2026-11-18. The Deck test runner deployed the frontend from
`14533b5102800d8ee101de392a6cdf981eb7b745` on the ticket branch. It reloaded
WoWDeck 1.2.1 with the existing engine. There were no engine changes.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `aa3d5615636ce36a1d752ba1c04402af5d6bca31e5d17df93e625705575a6633` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `f8ddedcf64da14ffd857ee3451e00812607e2c69cd29ef29527b86fde30222cd` |

The existing World of Warcraft shortcut had app ID `4221385996`.
`installations.list` returned that link for the three detected clients.
The run used the existing Forever installation under
`~/Applications/World of Warcraft/_forever_/`. The shortcut already
ran `launch-forever.py` with the Battle.net target and Forever launch
option. No game or compatibility tool was installed for this test.

## GE-Proton result

DEVICE 2026-11-18, Steam UI context and SSH process observation. In CEF's
`SharedJSContext`, with WoWDeck loaded, the probe called
`SteamClient.Apps.RunGame("18130714796645941248", "", -1, 0)`.
`GetGameID()` returned that exact string. This call ran as a probe in the
plugin's Steam context. A deployed WoWDeck control has yet to call it.

The shortcut ran GE-Proton11-12-x86_64 with `SteamLinuxRuntime_4`. The
first run reached `_forever_/Wow.exe`, and the original wrapper could
have sent its own ask. In the second run the observer paused only the
wrapper process once its reaper child was visible. It resumed the wrapper
after recording the result. Times below are seconds since the SSH observer
started.

| Time | Observation |
| --- | --- |
| 1.58 | The wrapper (PID 49911) and its reaper child (PID 49912) were visible. The observer paused the wrapper. |
| 6.88 | The first Battle.net process appeared in the shortcut prefix (PID 50110). |
| 16.63 | A Battle.net process in that prefix had `--type=renderer` (PID 50340). |
| 21.65 | The probe spawned the replay (PID 50420) after 5.02 seconds of renderer presence. |
| 24.82 | `Z:\home\deck\Applications\World of Warcraft\_forever_\Wow.exe` appeared in the prefix (PID 50535). The observer resumed the wrapper. |

The WoW process appeared 3.17 seconds after replay. Executable appearance
was the observation point. The run ended before gameplay.

## Delivery route

Use Proton replay as the candidate for the engine, with Experimental
verification still required. On GE, the reaper's NUL-delimited
`/proc/<pid>/cmdline` exposed the complete command from
`_v2-entry-point` onward even after the renderer came up. The inner
Proton Python process retained the Proton path and verb but lacked the
outer runtime entry point. Match the shortcut's `STEAM_COMPAT_DATA_PATH`
and the Battle.net processes' `WINEPREFIX` before relying on either.
The reaper's argv and environment were readable as the Deck user over
SSH. Confirm access from the engine when wiring the spawner.

Drop Steam's reaper prefix from argv. Replace both
`--verb=waitforexitandrun` and the separate Proton verb
`waitforexitandrun` with their `run` forms. Remove the previous
`--exec=` argument and append the single argument `--exec=launch WoWF`.
The probe passed an argv array directly to the spawner. The space belongs
inside the argument and the surrounding shell quotes do not belong in it.

Use the environment of the process that supplied the command. The probe
kept `STEAM_COMPAT_*`, `Steam*`, `PROTON_*`, and an allowlist of
user, locale, display and session variables. `STEAM_COMPAT_TOOL_PATHS`
named both the chosen GE tool and the runtime. Replay needed no direct Wine
loader lookup. `WINELOADER` was absent in the sampled Battle.net
environment. The executable symlink for the main Battle.net process
pointed under the GE tool to `files/lib/wine/i386-unix/wine-preloader`.

Earlier scratch evidence covers two different setups.
`deck-bnet/launch-forever.py` replayed argv inherited inside the
shortcut. `deck-bnet/game-output` records the Forever executable from
the earlier Deck investigation. `battlenet-headless-install.md` section
6 records Experimental's namespace route on another machine. That run
used `nsenter` and a known Wine loader to open an install dialog. The
namespace route still lacks a Deck WoW launch result.

## Experimental and legacy coverage

- **Proton Experimental, pending (unavailable).** The tool was installed,
  but the only matching shortcut exposed in Steam used GE. The second
  Battle.net prefix on disk, `2272143408`, recorded GE-Proton10-15 and
  had no corresponding live shortcut. An isolated invocation outside
  that shortcut could test delivery, but would not establish the
  Steam-to-client path required by #280. Repeat with an already prepared,
  signed-in Experimental shortcut. This run left compatibility tool
  settings alone.
- **Modern game page, partial (UI).** On
  `/routes/library/app/4221385996`, `DFL.findModule` found the
  40-key module with `PlaySection`, `ActionRow`,
  `ActionButtonAndStatusPanel`, `AppActionButton` and `AppButtons`.
  Both `DFL.appActionButtonClasses` and `DFL.playSectionClasses`
  existed and were separate modules. The live row rendered, in order,
  the Play group, status and stats, and Steam's buttons. The prototype
  returned no insertion when given the live section's React props,
  because its children include an opaque component that renders the
  action row. Feeding the locator the rendered row props under the
  section returned index 3 in a three-child array, after `AppButtons`.
  Patch the render that exposes the row's children. A control and its
  Right-button focus order were not exercised.
- **Legacy game page, pending (unavailable).** The prototype returned
  no insertion on a synthetic tree with the legacy `ActionSection`
  anchor and without the modern `PlaySection` anchor. Only the modern
  layout was observed in the active Steam UI. Repeat on a live legacy
  page and verify that the existing addon section still appears.

## Cleanup

Steam's `TerminateApp` stopped both test sessions. The final process
check found no Battle.net, Wow.exe or wineserver process. `deck down`
restored WoWDeck auto-update and closed both forwarded ports. The tested
frontend remained installed. The runtime probes left no hooks or probe
files on the Deck.

The probes made no direct Steam file or settings edits. Between the
pre- and post-launch checks for the controlled run, Steam's `config.vdf`
hash was unchanged and its `shortcuts.vdf` hash changed. The check
recorded only hashes, so it did not identify the field Steam wrote.

## Replay failure reporting

The engine can prove that replay failed to start if the executable checks or
spawn fail. For a replay that spawns and exits with an error, it recognizes
the pressure-vessel `bwrap` preflight failure recorded in the
[#257 Kaptan exploration](https://github.com/sigboe/wowdeck/issues/257).
It reads a bounded prefix of replay stderr and discards it without logging.
The engine keeps the usual retry schedule for spawned replays. If every
replay has a proven startup failure, the attempt ends with one failure notice.
An exit code, a signal, an unclassified runtime diagnostic or silence cannot
establish whether Battle.net got the request. If any replay may have reached
Battle.net, the attempt can end silently. The ld cache diagnostic from
Kaptan can accompany a runtime failure, but the diagnostic alone does not
prove pressure-vessel stopped before invoking Proton.

## Production plugin verification on Deck

DEVICE 2026-11-21, docked Steam Deck LCD, SteamOS 3.9.5, build
`20261023.100`. The owner reported that the Deck was awake and docked and
requested this run. The runner deployed the engine from `dabb7a0` on
`fix/257-proton-replay`, including the namespace and failure-reporting fix.
Frontend and bridge matched the local build and needed no deployment.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `fdffe406b80490fbccb7770bfe933c3e822cec242891fddedc7fbd5ae59ca8c9` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `928da2ee3378a804fac2acf667d53b0ab07623ab1533b994f1aa7d8188a9c768` |

The installed engine hash is the local binary with the SteamOS ELF loader
set by patchelf. Deployment reloaded the plugin and changed its engine PID
from 3225 to 8755.

The existing World of Warcraft shortcut, app ID `4221385996`, used
GE-Proton11-12-x86_64 and SteamLinuxRuntime_4. Its target was the installed
Battle.net executable inside that prefix, with no launch options or retry
wrapper. Forever was the saved target and My Addons' active installation.
The runner left the shortcut's configuration unchanged.

For Experimental, the runner copied the stopped prefix under
`~/homebrew/data/wowdeck/test-backups/2026-11-21-deck-replay-fix/compatdata`.
It created **WoWDeck Experimental Test**, app ID `2806629262`, pointing at
the copy's Battle.net executable, with `STEAM_COMPAT_DATA_PATH` selecting
the copy and `proton_experimental` as its compatibility tool. No game or
compatibility tool was installed. The copied launcher retained sign-in.

| Claim | Result | DEVICE evidence |
| --- | --- | --- |
| GE launch from rest | Passed, UI, RPC and SSH | Controller A on Play Forever called RunGame once with string game ID `18130714796645941248`. The engine observed the stopped entry become running and then confirmed Forever with busy false after 28.4 seconds. SSH saw `_forever_/Wow.exe -launcherlogin -uid wowf`, PID 9708. The launcher's current log recorded one received command and one LaunchBinary event. No plugin error notice appeared. |
| Native replay after the fix | Passed, SSH and process tests | Engine PID 8755 and GE reaper PID 8913 shared mount namespace `4026531832` and user namespace `4026531837`. The fixed engine therefore used direct replay. The signed-in launch confirms that the NixOS namespace correction leaves this path working. |
| Experimental selection and launch | Passed, UI, RPC and SSH | Controller Right and A opened Steam's Play from menu on the temporary page. Down twice and A selected Forever without launching. Reopening preserved Play Forever. A then called RunGame once with string game ID `12054380892320169984`. SSH confirmed the reaper used `Proton - Experimental/proton`, SteamLinuxRuntime_4 and the copied prefix. The engine confirmed Forever with busy false after 33.4 seconds. SSH saw `_forever_/Wow.exe -launcherlogin -uid wowf`, PID 11064. The current launcher log recorded one received command and one LaunchBinary event. No plugin error notice appeared. |
| Steam page and controller access | Passed, UI | Both pages kept the addon section and Steam's initial Play focus. The temporary page offered Battle.net, Classic and Forever in Steam's own menu. Each active game showed Steam's Resume and Stop controls. |

The RunGame recorder captured two calls in total, one per launch. Both were
the string form of the shortcut game ID. Neither attempt used a manual
delivery probe, inherited exec argument or retry wrapper. Replay timing and
argument boundaries remain covered by the deterministic launch tests.

### Cleanup and remaining coverage

Steam's Stop confirmation ended both test sessions. The runner removed
temporary shortcut `2806629262` and its compatibility override, deleted the
copied prefix, and restored the original launch-target map. The original
shortcut configuration remained on GE, and My Addons remained on Forever.
The original shortcut records were checked against the pre-test backup.
The runner removed its RunGame and toast observers, restored autoUpdate,
and closed its owned tunnels with `deck down`. The fixed build stays
installed. Pre-test state and shortcut backups remain in plugin data.

Regression rows L-15 and L-28 cover these launches. The earlier Kaptan
report covers the different-namespace path and signed-out refusal. With
Deck Experimental verified, #280 has no remaining coverage gap. The owner
later waived the remaining DroidDeck verification because it has a similar
feature and its WoW update bug blocks the test. See the
[DroidDeck disposition](../2026-11-21-droiddeck-launch/README.md#owner-decision-and-cleanup).

`make lint typecheck test build` passed before the evidence commit. Frontend
and tool tests passed 1,363 cases. Backend tests passed 1,819 cases with five
skips, and all four Python suites passed. No code changed during this Deck
run.
