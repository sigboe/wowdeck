# Stopped-entry WoW launch on Steam Deck

DEVICE 2026-11-18. The deck-test runner used the default Steam Deck target and
deployed WoWDeck 1.2.1 from `feat/282-steam-rungame-t3`, with the engine change.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `705f5292e66d644089ab7748a520249f37790e360d00d68cd9fe7596954eddc3` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `296b14efa460f72e71dcd94442d13b42efd1a7417ea8e434386ba9c35269926a` |

The existing World of Warcraft shortcut, app ID `4221385996`, used
GE-Proton11-12-x86_64 and SteamLinuxRuntime_4. Its Steam game ID was
`18130714796645941248`. The engine selected the existing Forever client.
See the [launch delivery report](../2026-11-18-steam-launch-delivery/README.md)
and the [started-entry report](../2026-11-18-steam-started-entry/README.md)
for the fixture and earlier runs.

| Claim | Result | Evidence |
| --- | --- | --- |
| Control on the stopped game page | Passed (UI) | Play had initial focus. Three virtual D-pad Right presses reached the Forever button. |
| Launch from rest and leave the page | Passed (UI, RPC, SSH) | The engine reported the entry stopped and WoW idle. A on Forever moved Steam to its running-app screen and the engine reported busy. The runner navigated to Library Home. The SSH observer saw the engine replay and the Forever executable while the game page was closed. |
| Attempt ends after WoW starts | Passed (RPC) | On returning to the game page, the engine reported `busy: false` and `gameRunning: running`. Toast capture contained only Steam's controller-connected notice. |
| Launch after Play | Prior build (UI, RPC, SSH) | The started-entry report records a successful launch. The current manual-clock tests also cover pressing the control while Steam is starting the entry. |
| Missing Steam API and explicit Steam refusal | Pending (device) | The installed Steam client exposes the API. The signed-in fixture launched successfully. The typed tests cover the unavailable API, a matching launch error, and a Steam start with no observable result. |
| Silent Battle.net refusal | Pending (device) | A launcher-side refusal fixture is still needed. The typed tests cover a completed attempt with no confirmation and no failure notice. |

The SSH observer measured these times from its own start. It reused the
started-entry procedure and paused only the existing retry wrapper after
the Steam reaper appeared.

| Time | Observation |
| --- | --- |
| 15.56 s | Steam reaper PID 58706 appeared. The observer paused wrapper PID 58705. |
| 31.23 s | Battle.net renderer PID 59140 appeared. |
| 37.84 s | Replay PID 59311 appeared with `--exec=launch WoWF`. |
| 39.76 s | `_forever_/Wow.exe` PID 59322 appeared. The observer resumed the wrapper. |

The test ended at executable appearance. The plugin and test made no direct
edits to Steam files or shortcut settings. Steam's termination API stopped
the test session. The engine reported the entry stopped and WoW idle, and
the recorded PIDs had exited. The runner restored WoWDeck auto-update
and closed its tunnel. The tested build stayed installed.

T1–T3 ran through the repository checks. The Deck evidence comes from
remote UI navigation, RPC and process observation. Visual layout and
physical controller use remain outside this run.
