# Started-entry WoW launch on Steam Deck

DEVICE 2026-11-18, SteamOS, WoWDeck 1.2.1. The deployed build came from
`feat/281-started-entry-t3` and included the engine change.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `7ceacfe93095507e541e54e3c5e257363264d2b00d7d08d724029eb35cc6c8cf` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `dfdb4568aa08e2c8b92b8653dc5850eef1da7f6241a30b7662243d27278c5f4e` |

The existing World of Warcraft shortcut (app ID `4221385996`) ran
GE-Proton11-12-x86_64 through SteamLinuxRuntime_4. The engine selected the
existing Forever installation. The test started the shortcut through
Steam's `RunGame` API in CEF, then returned to its game page. An SSH
observer paused the shortcut's pre-existing retry wrapper once the
Steam reaper appeared. The observer resumed it after Forever appeared
or the observation window expired. The plugin and probes issued no writes to Steam files or shortcut settings.

| Claim | Result | Evidence |
| --- | --- | --- |
| Placement and controller order | Passed (UI) | The addon section remained visible. On the stopped modern page, Play held initial focus. Three Right presses reached Configure Controller, Manage, and Forever in order. On the running page, Right from Manage reached the enabled Forever control. |
| Launch with the shortcut already running | Passed (UI and SSH) | A on Forever made the engine report busy. The page was closed while the observer saw the renderer at 16.06 s, the plugin's replay at 28.91 s, and the linked `_forever_/Wow.exe` at 30.83 s. The retry wrapper stayed paused until the game appeared. |
| Disable during play | Passed (UI and RPC) | On returning to the page, the engine reported `gameRunning: running` and `busy: false`. The page showed "WoW is already running" beside Forever and disabled the control. |
| Replay cleanup after stopping the shortcut | Passed (RPC and SSH) | After Steam stopped the shortcut, the engine reported the entry stopped and WoW idle. The recorded reaper, replay helper, renderers and game PIDs had all exited. |
| Silent Battle.net refusal | Pending (unavailable) | The signed-in GE fixture launched successfully. A launcher-side refusal fixture is still needed. The typed frontend and manual-clock tests cover the silent result. |
| Direct WoW and legacy pages | Pending (unavailable) | This run used the modern Battle.net shortcut. The legacy-layout check remains under #280. |
| Proton Experimental and other product tokens | Pending (unavailable) | The GE fixture exercised Forever. Experimental still needs the fixture described under #280. |

The successful launch showed only the test controller's system notice in
the captured toast history. The test stopped its Steam session. The deck-test
runner restored the plugin's auto-update setting and closed its tunnels.

Cleanup was observed with the engine still running. An engine restart during a
live replay has no device result.
