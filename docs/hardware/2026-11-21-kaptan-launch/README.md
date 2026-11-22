# Kaptan launch verification

DEVICE 2026-11-21, Kaptan, Jovian NixOS in Steam Game Mode. The owner
authorized a temporary non-Steam shortcut to cover the outstanding launch
checks without DroidDeck. This is Kaptan evidence. It does not establish a
Proton Experimental launch on the Steam Deck.

## Build and fixture

The runner deployed frontend, bridge and engine from `next` at `704f0d5`.
The engine reported version 1.2.1 and PID 4865 after deployment. Installed
hashes were:

| File | SHA-256 |
| --- | --- |
| `dist/index.js` | `fdffe406b80490fbccb7770bfe933c3e822cec242891fddedc7fbd5ae59ca8c9` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `d07ec5a9f2474a438a4f42136c6750455db90b6039aaf72dcb9b3f7f90a1e3e3` |

The engine hash is the deployed copy with Kaptan's Nix loader set by
patchelf. No engine code changed for this run.

The temporary shortcut was **WoWDeck Temporary Launch Test**, app ID
`3615058702`, game ID `15526558898243764224`, using Proton Experimental
and SteamLinuxRuntime_4. Existing playable installations were Retail
`ba050940595a`, Classic `7c627346a452` and Forever `cc51e128ca14`.
My Addons started on Forever.

The first fixture reused the original prefix, `compatdata/3332867997`.
Its launcher lives outside that prefix at
`~/Applications/Battle.net/Battle.net.exe`. WoWDeck rejects that launcher
for replay. The runner then copied the stopped prefix and launcher under
`/var/lib/decky-loader/data/wowdeck/test-backups/2026-11-21-kaptan-launch/compatdata/`.
The copy's launcher was inside `pfx/drive_c/Program Files (x86)/Battle.net`.
Only the temporary shortcut was repointed. Neither fixture installed a game
or changed the existing shortcut's configuration.

## Results

| Claim | Result | Evidence |
| --- | --- | --- |
| Menu and installed clients | Passed, UI and RPC | The temporary page showed Play over Battle.net, a chevron and the addon band. The menu listed Battle.net, Retail, Classic and Forever. `launch.state` listed the same targets. |
| Switching playable targets and persistence | Passed for selection, UI and RPC | Selecting Retail and Forever changed the Play label without starting the shortcut. Reopening the page kept Retail. Selecting Retail during the pending Forever attempt also worked. My Addons stayed on Forever throughout. |
| Launch from rest with the external launcher | Failed, UI and RPC | Controller A started Steam's entry once, but no client appeared. The engine cleared busy and showed one "Couldn't launch Forever / WoWDeck couldn't send the request to Battle.net" notice. The launcher was outside the prefix, which replay's path guard rejects. |
| Launch from rest with the isolated prefix | Failed to launch, UI, RPC and SSH | Steam started the isolated launcher under Experimental. No WoW executable appeared. The attempt ended after about 150 seconds, busy cleared, and Battle.net stayed open. Exactly one plugin notice read "Battle.net didn't start Forever / Press Play in Battle.net". Changing the saved target to Retail during the attempt did not change the completion's Forever name. |
| Retail with Battle.net already running | Passed for entry reuse, failed to launch, UI and RPC | Controller A on Play Retail started a busy attempt with Battle.net already open. The RunGame recorder stayed at three calls for the whole run, so this attempt started no second Steam session. After about 150 seconds, busy cleared, Battle.net remained open, and exactly one plugin notice read "Battle.net didn't start Retail / Press Play in Battle.net". No WoW client appeared. |
| Direct WoW executable with a trailing-slash StartDir | Passed, UI and RPC | After stopping the launcher, the temporary shortcut was repointed at Retail's `Wow.exe`. `launch.state` returned null. The page showed Steam's plain Play button and kept the addon band. Detection kept the original World of Warcraft shortcut linked to all three installations. The direct executable was not launched. |
| Runtime preflight | Failed, SSH | A harmless invocation of the same runtime entry point with replay's `/usr/bin:/bin` PATH and `/usr/bin/true` as the command exited 127. Stderr said `_v2-entry-point: line 6: readlink: command not found`. No Battle.net request was sent by this diagnostic. |

The isolated launcher's current log had no matching received-command or
game-family-selection lines. The no-start notice proves completion behavior,
but it does not prove Battle.net received and refused a launch request.
The current replay failure detector recognizes one bwrap diagnostic. It does
not recognize this missing `readlink` failure, so an expired attempt can
report "Battle.net didn't start" when replay never reached Battle.net.

Keyboard Enter opened and selected menu rows but did not activate Play in
the initial probe. A real virtual controller did activate Play. One early
navigation probe opened Steam's Stop confirmation, and Down then A closed
it without stopping. Later cleanup used A on Confirm and checked that the
reaper exited. No result relies on the ineffective keyboard Play press.

## Remaining coverage

- #280 still needs an Experimental Steam-to-client launch on the Deck.
  Kaptan's current plugin replay also needs its NixOS runtime failure fixed
  before it can supply a successful substitute test.
- #281 has a live Kaptan no-start completion and notice. It still lacks a
  known request reaching Battle.net followed by a launcher-side refusal.
- #283 has live switching and persistence between playable targets, but
  successful launches through the picker and DroidDeck remain unverified.
- #285 was already closed. Its direct-entry fallback is covered by the
  earlier Deck report and this Kaptan run.

## Cleanup

Steam's Stop confirmation ended the temporary session. No reaper or WoW
client remained. The runner cleared the temporary compatibility override,
removed shortcut `3615058702`, and deleted the copied prefix and launcher.
The parsed original shortcut records matched the pre-test backup exactly:
Project Ebonhold `2552495226` and World of Warcraft `3332867997`.

The runner restored the original launch-target map and active installation
in WoWDeck's state file, then reloaded the plugin. The RunGame wrapper and
all toast observers were removed. The original launcher and prefix stayed
in place. The tested build remains installed. Backups of the pre-test state
and shortcut file remain in WoWDeck's test-backups directory.

## Local checks

`make lint typecheck test build` passed. The frontend and tool suites passed
1,363 tests. The backend passed 1,817 tests and skipped five, including RAR
fixtures and the absent WowUp reference. All four Python suites passed.

## Replay diagnosis and fix

DEVICE 2026-11-21, follow-up on `fix/257-proton-replay`, based on `704f0d5`.
The frontend and bridge stayed unchanged. The deployed engine's SHA-256 was
`248dbffabf6d94c7b6c996c02bf7bef1ba85b022eb0ccc5999ece65c818264fb`.
The final reload changed the engine PID to 10839.

Three separate checks identified the failures:

1. The real spawner and diagnostic reader returned `startupFailed: false`
   for the captured missing-readlink error. A deterministic regression test
   failed in 18 ms. It now returns true.
2. Adding NixOS's system profile to PATH passed readlink but failed the
   runtime's bwrap preflight. Entering Steam's user and mount namespaces
   with `--preserve-credentials` let the same harmless runtime command
   exit zero. Mount-only entry and entry without preserved credentials
   both failed.
3. Decky's service PATH did not contain nsenter. The first patched live
   attempt correctly reported request-delivery failure. A regression test
   reproduced the missing service-PATH case. Lookup now also checks the
   standard system locations and NixOS's system profile.

Replay now enters the reaper's namespaces only when both user and mount
namespaces differ. A shared user namespace keeps direct replay. The tests
exercise a real spawned runtime through a fixture namespace helper, missing
helper discovery, shared-user direct replay and recognized startup errors.
Generic launcher errors and unknown exits remain uncertain.

The follow-up used a new temporary shortcut, app ID `2911057484`, and a
fresh copy of the prefix and launcher under WoWDeck's
`test-backups/2026-11-21-replay-fix/compatdata` directory. Steam's normal
Battle.net target opened the launcher. Picking Forever through the real
controller menu, then pressing Play with Battle.net open, kept the RunGame
count at one.

The fixed replay reached Battle.net. At 09:18:35 UTC, the replayed instance
logged "Leaving because another instance of battle.net is running", and
the running instance logged "Received IPC Message: IPC_COMMAND". This is
new delivery evidence. A private screenshot then showed the isolated
launcher waiting for sign-in. No successful client launch can be inferred
from that state. The screenshot is not published because it contains the
account's sign-in name.

The signed-out attempt ended after 150.5 seconds. Busy cleared, Battle.net
stayed open, and the captured notices included exactly one plugin notice,
"Battle.net didn't start Forever / Press Play in Battle.net". The known
sign-in screen and received-command log make this a real refusal-path
check on Kaptan. Successful client launches still require sign-in.

Regression row L-28 in `docs/regression-test-plan.md` covers replay across
Steam namespaces and the request-delivery failure notice. The new code
needs a SteamOS check in addition to Kaptan's namespace-entry result.

The owner signed in to the temporary launcher. The same deployed build then
passed the original client-launch checks:

| Claim | Result | DEVICE evidence |
| --- | --- | --- |
| Forever through the already-open launcher | Passed, UI, RPC and SSH | Controller selection chose Forever. Play started no additional Steam session, and the engine confirmed the client and cleared busy after 20.2 seconds. SSH showed `_forever_/Wow.exe -launcherlogin -uid wowf`. No plugin error notice appeared. |
| Choosing Retail while Forever runs | Passed, UI, RPC and SSH | The controller menu saved Retail while Steam kept Resume and Stop. Forever kept the same PID, 12080. Reopening the page preserved the choice. My Addons stayed on Forever. |
| Retail from rest | Passed, UI, RPC and SSH | After Steam stopped the temporary session, Play read Retail on the reopened page. One press started Steam once. The engine confirmed Retail running with busy false after 23.3 seconds. No plugin error notice appeared. |

Both successful attempts used the assertions in the original live feedback
loop, not only the minimized process tests. The runner confirmed that the
final local build matched the deployed engine before the signed-in runs.

The follow-up cleanup stopped Retail through Steam, removed temporary app
`2911057484` and its compatibility override, and deleted the copied prefix
and private screenshot. The original launch-target map was restored to
empty, My Addons remained on Forever, and the plugin was reloaded. The
original shortcut records matched their pre-test backup. No test game or
reaper remained. The RunGame hook and toast observers were removed, and
`deck down` closed the owned tunnel. The fixed build stays installed.

The final `make lint typecheck test build` passed. Frontend and tool tests
passed 1,363 cases. Backend tests passed 1,819 cases with five skips. The
Python suites passed. The fast launch regression loop passed all 21 tests,
including the namespace and captured-diagnostic checks. No debug logging
was added to production code.

The remaining-coverage list earlier in this report describes the first
audit. After the fix and owner sign-in, client switching and successful
launches pass on Kaptan, and the signed-out refusal path is verified.
The later [Deck production-plugin run](../2026-11-18-steam-launch-delivery/README.md#production-plugin-verification-on-deck)
verifies GE and Experimental on the Deck and completes #280. The owner later
waived the remaining DroidDeck launch verification because DroidDeck has a
similar feature and its WoW update bug blocks the test. See the
[DroidDeck disposition](../2026-11-21-droiddeck-launch/README.md#owner-decision-and-cleanup).
