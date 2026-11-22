# DroidDeck launch verification

Status: closed by owner decision. Remaining DroidDeck launch verification waived.

DEVICE 2026-11-21, unavailable. The owner requested the remaining DroidDeck
launch test for #283. The configured wireless ADB endpoint,
`10.10.1.31:5555`, returned "No route to host". `adb devices -l` listed no
device. The DroidDeck control tool could not query session state because
the selected serial was unavailable. No phone state was changed.

The owner then provided the current Wireless debugging endpoint. The
follow-up below records the successful connection and preparation.

## Prepared build

The universal package was built from `2065096`, including replay fix
`dabb7a0`, in the throwaway `test/283-droiddeck-launch` checkout. The package
version is `1.2.1-test.283`. The three version files were restored after
packaging, so the test stamp is not committed.

| Artifact | Value |
| --- | --- |
| Package | `build/WoWDeck.zip` in the DroidDeck test checkout |
| SHA-256 | `1377bef47c7934254dbfa47ad6e2845620735f9bdbd8962da93fc56aa2efa911` |
| x86-64 engine | ELF machine 62, 81,876,448 bytes |
| arm64 engine | ELF machine 183, 81,840,424 bytes |

Both architecture headers were verified inside the zip. The authorized
bundled provider key was included without printing its value. The package
was verified again after copying it to the phone's plugin data. The transfer server and ADB reverse mapping were removed after preparation
and again after deployment. The test build was subsequently installed as
recorded below.

## Connected follow-up

DEVICE 2026-11-21, ADB connected at the owner-provided
`10.10.1.53:36993`, then pinned to `10.10.1.53:5555` for this run.
DroidDeck 0.7.0 reported runtime `ubuntu-r1-rc5`, Steam READY, not suspended,
with debugging access enabled. SharedJSContext was reachable.

Before deployment, the installed plugin was `1.0.2-test.155.1`, running its native aarch64
engine. The installed plugin folder and state were backed up under
`/root/homebrew/data/wowdeck/backups/2026-11-21-launch/` before deployment.
The prepared zip was copied there and its SHA-256 matched the local build.

The phone has Forever at
`/root/Games/Stores/Battle.net/World of Warcraft/_forever_`, including
`Wow-ARM64.exe`. Its Steam app ID is `3249681327`. The shortcut starts
Battle.net inside prefix `2596113170` with `DroidDeck-Proton-11-12.1`.
Battle.net's product database exists in that prefix.

The new arm64 engine ran from the backup directory without replacing the
installed plugin. Its method listing exited zero and included `launch.state`
and `launch.start`. A second probe used a copy of the saved state in an
isolated data directory. It reported version `1.2.1-test.283`, offered
Battle.net and Forever, and returned not running with busy false. No launch
was requested by either probe.

## Deployment and observed behavior

The owner approved one Steam stop/start cycle, then granted wide allowance
to continue independently. Decky's installer installed `1.2.1-test.283`.
The arm64 binary matched SHA-256
`c0046a8abc5534d8e477d1bafefa1f4a20207ae126ee152de42878c941bdecc2`.
The installed frontend and bridge matched the package too.

The approved restart moved session `2026-11-21-01-steam` through IDLE to a
READY `2026-11-21-02-steam`. The plugin list and engine both reported
`1.2.1-test.283`, with native engine PID 4407. Live `launch.state` offered
Battle.net and Forever, with neither entry nor game running and busy false.

Controller Right and A opened Steam's Play from menu on the linked game
page. It listed Battle.net, World of Warcraft: Forever and Cancel. The
page showed Play over Battle.net and kept the WoW addons section. These
are observed UI and RPC results. Successful game launches, full picker
persistence and icon behavior were not established before the owner ended
the test requirement.

Local `make lint typecheck test build` passed before committing this report.
Frontend and tool tests passed 1,363 cases; backend tests passed 1,819 with
five skips; all four Python suites passed. Phone behavior remains
unverified.

## Owner decision and cleanup

The owner chose to waive the remaining DroidDeck verification and close
#283 and parent #257. The stated rationale is that DroidDeck already has a
similar feature, and a DroidDeck bug prevents WoW from updating successfully.
The update bug was reported by the owner, not diagnosed in this run. The
waiver is a scope decision, not a passing launch test or a claim of verified
feature equivalence.

At cleanup, DroidDeck reported no active Steam session. The session had
already ended, so its in-memory probes were gone. No new session was started
for cleanup. The ADB reverse mapping was removed and no local transfer
server remained. No Steam shortcut or compatibility configuration was
changed during this phone test. The test build was left installed after our restart; no rollback was
performed. The pre-test plugin/state backups remain in plugin data. Any picker selection
saved during testing was not reset after the session ended.

The Deck and Kaptan launch evidence remains in their reports. The unverified
DroidDeck cases are explicitly accepted as omitted by the owner; they are
not release blockers for this spec.
