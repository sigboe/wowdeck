# Play artwork on the Deck

DEVICE, SteamOS x86_64, 27 Nov 2026. Automated SSH, engine RPC, Steam CEF DOM observations
and screenshots through `tools/deck-ui`. No human controller verification.

## Original pass build and scope

Branch `t3/classic-forever-launch-icons`, based on integration tip
`75ef84941dca5b82eef39742db56dfdccbf23d83`, with the #349 changes in this
commit. The engine changed. `git merge` of the required integration tip
reported "Already up to date".

Installed SHA-256 hashes after deployment:

| File | SHA-256 |
| --- | --- |
| Engine, with SteamOS interpreter | `a724992f440f13168aff31da8a5744b3986e5c903aa92c600a2c697c194e843a` |
| Frontend bundle | `2c8ac0e72b52c6f0b75c57e22a6661289782e542cdec8d70d6d04792e43f0917` |

The owner's existing Classic Era and Forever installations supplied the
executables. Battle.net's existing local catalogue supplied artwork. No game
or addon fixture was installed. Retail is absent from the launch menu on this
Deck. Forever Beta is hidden and is not an offered target.

## Results

| Claim | Result and evidence |
| --- | --- |
| Classic's own preferred SVG, one Classic row | Passed. DEVICE UI/RPC. The target remained `classic`; `launch.icon` returned an SVG data URL of 36,354 characters. The Play label read Classic. [Screenshot](classic.png). |
| Forever's own preferred SVG | Passed. DEVICE UI/RPC. The Forever target returned an SVG data URL of 6,518 characters, distinct from Classic. [Screenshot](forever.png). |
| Battle.net retains its ICO | Passed. DEVICE UI/RPC. Returned `data:image/x-icon`, 12,909 characters, before and after restart. [Screenshot](battlenet.png). |
| Retail artwork | Unavailable on this device. Retail is not an eligible launch target. Deterministic real-engine tests cover its artwork, fallback, restart and cache wipe. |
| First-population fallback and visible replacement | Passed for Classic and Forever. DEVICE UI. After deleting only `launch-icons`, reloading the plugin and reopening the game page, a DOM observer recorded ICO followed by SVG without another page navigation. The runner reported focus on Play Classic and Play Forever. No game was started. |
| Existing dimensions | Passed. DEVICE UI. ICO and SVG image attributes stayed 24 by 24. Settled measured dimensions were 23.999 by 23.999 CSS px. Measurements during Steam's page entrance animation were smaller. |
| Populated restart | Passed. DEVICE RPC. Engine PID changed from 114812 to 114984. Classic, Forever and Battle.net all returned their saved formats. The new engine logged only persistent reads, with no discovery or executable extraction. |
| Cache-only wipe preserves selections | Passed. DEVICE RPC and saved-state comparison. Classic stayed selected through its wipe; Forever stayed selected through its wipe. My Addons stayed on Forever throughout. After restoring the original Battle.net target and running `down`, every setting and the complete installation records matched the first deployment's saved state. |
| Source removed across restart | Automated coverage passed for all three WoW products. Not attempted on device: the source cache is outside the allowed WoW/plugin write paths. The populated device restart establishes the complete-entry path through stage logs. |
| Missing artwork retries, corruption and write failures | Deterministic engine tests cover these cases. No source corruption or write-failure injection was performed on the owner's Deck. |

## Integrated timings

These are actual installed-engine measurements, not the standalone spike.
Each wipe removed only WoWDeck's icon directory. OS filesystem-cache
conditions were uncontrolled; no OS cache was flushed. The tests made no
timing assertions.

The engine logs `launch-icons` stage durations without paths or image bytes.
The UI observer used `performance.now()` on changes to the rendered image's
data-URL format. Visible replacement below measures ICO appearance to SVG
appearance on the same open page. It excludes the preceding navigation,
engine restart and Steam page entrance.

| Measurement | Classic wipe | Forever wipe |
| --- | --- | --- |
| Executable extraction | 56.48 ms | 91.34 ms |
| Catalogue discovery | 266.77 ms | 273.76 ms |
| SVG persistent read after notification | 0.735 ms | 0.448 ms |
| ICO to SVG in the open page's DOM | 277.30 ms | 252.80 ms |
| Page image absent to ICO | 660.40 ms | 619.10 ms |

The last row includes Steam's navigation, RPC and rendering work; it is not
an extraction measurement. The first deployment's Battle.net extraction took
6.32 ms and discovery took 479.09 ms. That slower pass is retained here.

After the final populated restart, persistent reads took 1.554 ms for Classic,
0.432 ms for Forever and 0.428 ms for Battle.net. Browser-to-engine RPC totals
were 13.5, 6.1 and 6.5 ms respectively. The preceding restart's RPC totals
were 8.5, 5.6 and 5.8 ms.

The earlier spike reported 258 to 280 ms for discovery and saving, about
61 ms for Classic Era and Forever extraction, and about 0.5 ms for cached
SVG reads. Two integrated discovery runs were close to that range, while the
first was slower. Different workload and uncontrolled OS caches prevent a
controlled comparison. Background discovery kept the executable fallback
available in both observed wipe runs.

## Cleanup and limits

Every attempted `up`, including the failed one, was followed by `down`.
The failed attempt exhausted the local machine's `/tmp` before deployment;
the retry used the worktree's ignored scratch directory. No device storage
or system setting was changed to resolve it.

The tested build remains installed. Original automatic updates and the saved
Battle.net target are restored. My Addons remains on Forever. The in-memory
observer was disconnected and removed, and the owned SSH tunnel was closed.
Backups remain in the plugin's `test-backups` directory. No Steam or Decky
settings, source cache, game files or other plugin files were changed.

`make lint typecheck test build` passed. Frontend and tool tests passed
1,482 cases; backend tests passed 1,975 cases, with five existing skips for
unavailable RAR fixtures/tools and the WowUp reference checkout. All four
Python suites passed. The focused launch suites passed 35 engine cases and
16 Play integration cases. T1 through T3 passed.
Screenshots and DOM observations cover the available device icon paths.
Physical-controller operation, absent Retail, an ordinary published plugin
update, and hardware fault injection remain untested. The deterministic
tests cover version changes, removed sources, multiple prefixes and failure
recovery through `launch.icon`, plus target changes and image failure through
the Play integration fixture.

## Final review-fix verification

DEVICE, SteamOS x86_64, 27 Nov 2026. This pass tested
`07a9dff6447e47eed584f370b08f50712defa7ef`, fast-forwarded from
`3754ccd`. It includes the registration lifecycle fix. The engine changed;
the frontend bundle stayed the same. The earlier results above remain evidence
for the original pass.

Installed SHA-256 hashes for the final build:

| File | SHA-256 |
| --- | --- |
| Engine, with SteamOS interpreter | `3b36763e81b705181e62f171e544bbc75fb3ba1095f331e2ade584d1364145b5` |
| Frontend bundle | `2c8ac0e72b52c6f0b75c57e22a6661289782e542cdec8d70d6d04792e43f0917` |

Deployment changed the plugin engine PID from 114984 to 115361. The last
cache-wipe reload ran PID 115612. Version 1.3.0 alone does not distinguish
these builds.

| Claim | Final result and evidence |
| --- | --- |
| Existing target artwork | Passed. DEVICE RPC through the installed plugin. Classic returned SVG, 36,354 characters; Forever returned SVG, 6,518 characters; Battle.net returned ICO, 12,909 characters. The launch menu still offered Battle.net, one Classic row and Forever. |
| Classic cache-only wipe and visible replacement | Passed. DEVICE UI. After removing only WoWDeck's `launch-icons` directory, reloading the plugin and opening the game page, a DOM MutationObserver recorded ICO at `performance.now()` 82884541.1 and SVG at 82884898.3. The page stayed open between observations, a 357.2 ms replacement. Focus settled on Play Classic. |
| Forever cache-only wipe and visible replacement | Passed. DEVICE UI. A second cache-only wipe and reload recorded ICO at 82902274.1 and SVG at 82902619.0 on the same open page, a 344.9 ms replacement. Focus settled on Play Forever. |
| Dimensions after both wipes | Passed. DEVICE UI DOM. Both ICO and SVG images retained width and height attributes of 24. Settled SVG bounds measured 23.999 by 23.999 CSS px. |
| New source resolved after prior population, without restarting the engine | Passed. DEVICE RPC through a separate instance of the deployed binary, PID 115444. A synthetic prefix first listed `_classic_`. After its SVG was populated, the fixture's product.db changed to list `_classic_era_`. Calling `launch.state` resolved the new directory. The same process emitted a second `launch.iconChanged` for app 42, target `classic`, and `launch.icon` returned the expected SVG. Two SVG manifests identified the separate Classic directories. No retry, scan or engine restart was requested between populations. |
| Settings and selection preservation | Passed. DEVICE saved-state comparison. After cleanup, every setting and every installation record equalled the deployment backup. The original Battle.net target and automatic updates were restored; My Addons remained on Forever. Seven addon records changed only their `updatedAt` timestamps during normal engine activity. No addon was installed or removed. |

The late-source fixture lived entirely under
`~/homebrew/data/wowdeck/test-final-late-source/`. It contained an isolated
HOME, synthetic Steam shortcut metadata, two empty client executables,
Battle.net product.db and a content-addressed SVG catalogue. The separate
engine used that HOME and its own data directory. Only the fixture's
product.db changed during the test. The owner's Steam metadata, real source
cache and installations stayed untouched. The fixture process exited with
code 0 and the complete fixture directory was removed. This establishes
engine behaviour through public RPC; it does not establish a second visible
UI update for a real newly installed game. Registration during active
discovery remains covered by the deterministic real-engine tests.

The first deployment attempt failed before deployment because this checkout
lacked backend dependencies. After `down`, installing the locked dependencies
allowed the retry to deploy. Every attempted `up` had a matching `down`.
All observers were disconnected and removed from both inspected CEF contexts.
The owned tunnel closed, and the final page showed Play Battle.net. No game
was started. The final build remains installed. Its backup is
`~/homebrew/data/wowdeck/test-backups/2026-11-27-180807-1978044/`.

`make lint typecheck test build` passed for the final commit. Frontend and
tool tests passed 1,482 cases. Backend tests passed 1,978 cases with five
existing skips. All four Python suites passed, with 33, 17, 31 and 6 tests.
The existing limitations above still apply, including absent Retail,
physical-controller operation, source removal on device and hardware fault
injection. The final pass used DOM observations rather than new screenshots.
