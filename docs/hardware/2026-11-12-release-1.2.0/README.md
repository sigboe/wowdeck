# Release 1.2.0 Deck continuation, 12 November 2026

This records the original partial release-candidate run. Read the readiness continuation below for later results. The full requested checklist remains unfinished. No product fix was made. The remaining failed observation is the stale deployed manifest. The continuation reproduced installation details with the intended Y action. Menu was the wrong test input, not a demonstrated product regression.

## Build and scope

PR https://github.com/sigboe/wowdeck/pull/223, branch `release/1.2.0`, head `207651be259abf3ee7b449d52aa010ce83f64e71`. Target is `deck`. Source worktree is `/home/sigurdb/project/wowdeck-release-1.2.0`. The parent `tools/deck-runner-polish` checkout was preserved. No worktree was created or changed.

The scratch runner copies the parent's newer tooling into the release worktree's ignored `.scratch/deck-ui/`. Its root points at the release worktree. In the first pass, both `up --engine` and a later `up --engine --no-build --reload` ran. The first deployed the engine; frontend and bridge already matched. The second reloaded without artifact changes. Engine PID changed from 152774 to 153893, then 154269. The engine reports 1.2.0. The installed manifest still reports 1.1.2-pr.211.4, also visible in Diagnostics. It could not be overwritten by the deck user. Its backup was copied successfully before the denied write.

| Artifact | Matching local and deployed SHA-256 |
| --- | --- |
| Frontend | `92318163134a75e74eca541d24dbaf2a776bcc6aa2c47489deb1ae61375f1d61` |
| Python bridge | `f6debcaabe498035aba0a3d573838e9b6f7f71bb250ee9bd7470832542a3d27f` |
| Patched engine | `727be29088edca784d05e0c8d53965c8ed5ba8541d8ff4af7edbf774fb8e4e8d` |

## Coverage

Checklist sources were the origin/main-to-head diff, CHANGELOG.md 1.2.0, docs/regression-test-plan.md, and earlier hardware reports for PR116, spec140 and PR211. Earlier results are not counted as passes here. The checklist below covers the changed-flow groups; it does not claim every regression-plan case ran.

28 passed, 4 partial, 1 failed, 2 pending, across 35 claims. The third pass completed the isolated software fixtures listed below. Native installer and external prerequisites still prevent full release approval.

All UI, RPC and SSH evidence is DEVICE 2026-11-12. STATIC rows are local checks. UI uses rendered controls with synthetic controller/CDP navigation; RPC establishes engine behavior only. Evidence files are under [evidence](evidence/). No screenshot-based visual claim is made except the version tags inspected in details.png.

| Claim | Result | Method | Evidence and remaining work |
| --- | --- | --- | --- |
| Release worktree identity | passed | STATIC | Clean before testing; HEAD matches requested SHA. No tracked source edits. |
| Release manifest versions | passed | STATIC | All three local manifests say 1.2.0. static.txt. |
| Skill symlinks and YAML | passed | STATIC | Both symlinks resolve; PyYAML parses names and string descriptions. static.txt, yaml.txt. Does not prove Codex selector UI. |
| Deployed executable identity | passed | SSH + RPC | All three hashes match; engine reports 1.2.0. deployed.txt, initial.txt. |
| Deployed plugin version | failed | SSH + UI | plugin.json and Diagnostics report 1.1.2-pr.211.4. File and directory are root-owned; write denied. No sudo attempted. |
| Frontend/bridge/contract consistency | passed | STATIC | methods.txt has no missing bridge methods or unknown RPC methods. |
| Tab navigation | passed | UI | My Addons to Get Addons to Options and back via focused tab and arrow keys. get-addons.txt, options2.txt. |
| Installation details controller entry | passed | UI + STATIC | continuation-entry.txt. Options → focused installation → Y opens details. InstallationsSection.tsx binds onOptionsButton, the Y action. PR211 also specifies Y. Menu is not bound here; the earlier result used the wrong button. |
| Hide preferences and pickers | passed | UI + RPC | continuation-hide.txt. Hidden active fixture offers only Unhide in My Addons and Get Addons. Unhide preserves Auto updates off, and a second hide/unhide preserves on. Initial hidden-inactive picker coverage remains in the first pass. |
| Per-installation automatic updates | passed | Isolated device engine fixture + UI | third-engine.txt. Global off, hidden, installation auto-off and game-running skip paths passed. Eligible automatic acquisition and explicit update-all while hidden/auto-off passed using generated archives and a deterministic provider. These are direct release-module calls in an isolated device process, not a live wake/startup scheduler trigger. |
| Preferences survive restart/detection | passed | RPC | continuation-persistence-before.txt and continuation-persistence-after.txt. Hidden true and autoUpdateEnabled false survive detect and plugin/engine restart, PID 155281 to 155309. Newly added fixture defaults were true/false in continuation-entry.txt. |
| My Addons library/unneeded tags | passed | Isolated device engine fixture + UI fixture | third-engine.txt. A required dependency archive was installed, marked as a library with neededBy, then became unneeded after real parent removal in the isolated directory. Earlier continuation-tags.txt covers rendering. Owner addons were not involved. |
| Updated tag invalidation | passed | Isolated device engine fixture + UI fixture | third-engine.txt. Acquisition sets Updated; provider discovery clears it; restart preserves clear state; failed acquisition, withdrawn offer and channel changes do not restore it. continuation-tags.txt covers rendering. The provider is deterministic, not a live remote catalogue. |
| Manual file selection focus | passed | UI | Clean second picker round returned directly to Install. install-fixture.txt. |
| Manual archive installation | passed | UI + RPC | continuation-delayed.txt. Alternate-sort archive installed through UI into fixture; addons.list and delayed My Addons text both show RC Fixture 1.0. Earlier immediate probe was not sufficient. |
| Manual picker sort-order focus | passed | UI | continuation-sort.txt and continuation-sort-install.txt. Z–A lists ZZZ before AAA; selecting AAA returns directly to Install. One alternate order tested. |
| Get Addons popular catalogue | passed | UI | Popular returned real CurseForge results for fixture Retail. catalogue.txt. |
| Details multi-client version tags | passed | UI + screenshot | Details! includes Cataclysm, Wrath, MoP, Anniversary, Classic Era, Titan Reforged, Midnight and Forever. details-preferences.txt, details.png. |
| Titan Reforged and China Beta detection | passed | RPC | continuation-inspect.txt and continuation-persistence-after.txt. installations.inspect identifies _classic_titan_ as classic_titan / Titan Reforged and _cn_beta_ as cn_beta / China Beta. Folder recognition only, no actual client launch. |
| TSM signed-in source and destination | partial | UI | Owner session already signed in; destination shows account, follows and price-update state. tsm.txt. Fresh authentication, source disable and reconnect not exercised. |
| TSM Manage return focus | passed | UI | Manage opens; B returns focus to Manage. tsm-cancel.txt. No account follows changed. |
| TSM uninstall cancel return focus | passed | UI | Uninstall dialog lists Uninstall both and Cancel; B returns to Uninstall. tsm-cancel.txt. |
| TSM install/uninstall state matrix | passed | UI fixture + isolated device engine fixture | third-tsm-progress-full.txt records Working across actual component unmount/remount, followed by install failure and usable action. third-engine.txt verifies protected developer copies survive grouped TSM removal. third-tsm-failure-full.txt records partial removal/error UI. Real TSM download/install and protected-copy takeover were not attempted against owner state. |
| TSM account cleanup consent and failures | passed | UI fixture | third-consent.txt covers failed preview, no eligible follows and eligible preview. third-tsm-protected.txt records explicit cleanupFollows true with the shown preview; third-tsm-failure-full.txt records consent off by default and partial removal/account failure with follows left behind. RPC responses were simulated and every account mutation stayed intercepted. No real account cleanup is claimed. |
| TSM local character and cross-flavor data | passed | Isolated device engine fixture + UI | third-engine.txt. Retail WTF portal/account folders and Classic SavedVariables yield realm, region and faction. Auction data prunes an unfollowed faction key, preserves unknown lines, replaces managed data and preserves the previous file after a staging-write failure. Live socket/account routing and in-game prices remain outside these isolated file checks. |
| Diagnostics modal and return focus | passed | UI | Opens with readable probe rows; B returns to Diagnostics. options-modals.txt. Visual alignment not assessed. |
| Previous versions modal and return focus | passed | UI + UI fixture | third-previous.txt records failed load and successful Try again, changing to None kept. The wait for numeric 0 was a test expectation error, since the UI says None kept. third-touch.txt records CDP touch opening the real modal and B returning focus. No rollback data was cleared. |
| Other Options modals and right/left update jump | passed | UI + UI fixture | third-navigation2.txt records Previous versions → right → Update → left → Previous versions with an injected offer. third-key.txt records built-in key recheck from invalid to working, with no save/clear request. third-touch.txt covers synthetic touch dispatch. Earlier continuation-modals.txt covers the other modal entries. No credentials changed. |
| Companion notification setup | partial | UI | Existing companion reported in diagnostics; notification row reachable. flows.txt. Fresh companion install and in-game notification not exercised. |
| Update channel modal | passed | UI | Stable, Beta and PR Builds available; B returns to Update channel. options-modals.txt. |
| PR-build picker | partial | UI | Opens and reports No PR builds right now; B returns. flows.txt. No selectable PR build to test install/follow/closed/merged transitions. |
| Self-update progress, cancel and return | partial | Device store fixture + isolated device engine fixture | third-self.txt covers accept/decline adapter outcomes and cancel before any progress event, with no installer handoff on cancellation. third-stable.txt covers stable-after-beta preference on/off and restart persistence. Native Decky confirmation and real download/install remain blocked at the installer boundary; the fixture adapter deliberately cannot invoke it. Live identity-dependent offers also remain blocked by the root-owned stale manifest. |
| Non-maintainer push/label trust test #165/#158 | pending | unavailable | Explicit owner todo before main merge. No accounts created, labels mutated, issues closed or PR merged. Not a device failure. |
| Physical controller/touch, TV and in-game checks | pending | unavailable | Synthetic input used. Physical feel, touch, alternate display and WoW launch remain owner/hardware checks. |
| Fixture cleanup and runner down | passed | SSH + RPC | Original active Forever restored, fixture removed, autoUpdate restored on, owned tunnel closed. cleanup.txt, fixture-cleanup.txt, down.txt. |

## Fixtures, backups and cleanup

The isolated installation was `/home/deck/Applications/World of Warcraft/wowdeck-rc-120-fixture/_retail_`, id `d8949b548cca`, named RC 1.2.0 fixture. Its local RCFixture.zip contained one toc, Title RC Fixture, Version 1.0, Interface 110200. No downloaded Lua ran. Manual Install installed it into this isolated installation. The fixture registration and directory, including archive and installed addon, were removed. Forever `5e80311f078e` is active again. Owner addon installations were not install/remove targets. No TSM account follows or credentials were changed.

Runner backups remain under `/home/deck/homebrew/data/wowdeck/test-backups/2026-11-12-220642-1111888/` and `/home/deck/homebrew/data/wowdeck/test-backups/2026-11-12-220932-1112901/`. The first includes pre-run state, logs, replaced engine and plugin manifest backup. The runner disabled autoUpdate and down restored it on. Background account/update timestamps and addon metadata may have refreshed; an exact owner-addon content comparison was not captured. No backup restoration was attempted because that would overwrite current state.

The UI was returned to `/routes/library/home`. The first pass installed no in-memory test hooks or toast observer. The continuation hooks and their cleanup are described below. Down closed only the owned SSH tunnel, with ports 18080 and 9222 free afterward. Tested executable files remain installed. Steam, Decky, other plugins and system settings were not changed; no sudo ran. The report and evidence are uncommitted for parent review. The report received an unslop pass for plain wording and unsupported claims.

## Continuation pass and remaining work

DEVICE 2026-11-12. The continuation used the same ignored runner and target executables. The root-owned manifest is still stale. SSH stat returned root/755 for both plugin directory and plugin.json, and the plugins parent was not writable. The bridge has no plugin-local manifest-write method. The runner deployment route already failed its write. No alternate authorized route was found. Decky's installer would replace the tested files, so it was not used. This is a deployment identity blocker, not evidence of a source regression.

The UI tag fixture changed only the active fixture session snapshot and then reloaded its real addon list. A later temporary in-memory bundle exposed stores and wrapped RPC for isolated TSM and self-update checks. TSM account mutations and addon install/remove through the hook were rejected. The self-update test used a separate store with a forbidden installer adapter. The original dist bundle was restored, the continuation globals were deleted in SharedJSContext. The earlier QuickAccess session reference was deleted by the tag fixture, and the plugin backend restarted. No executable on disk changed during these fixture checks. The fixture scripts are local temporary files; evidence records their states and limitations.

The Z–A picker fixture used AAA-RCFixture.zip and ZZZ-RCFixture.zip under the same isolated WoW test root. AAA installed RCFixture 1.0. The continuation also created empty client folders and a fixture WTF folder. Cleanup removed the entire isolated root and its registration, restored Forever selected, and preserved the owner's installation preferences. No owner addon was an install/remove target. Backup 2026-11-12-222116-1117016 records the second up. Down restores the autoUpdate guard and closes only its owned tunnel.

STATIC supplemental verification ran 124 tests across seven files with 2621 assertions and no failures. See continuation-local-tests.txt. These cover libraries, installation matrix/registry, TSM addon RPC and auction file behavior, self-update store and installation preferences. They do not turn unfinished device cases into passes.

Real external blockers remain the unavailable selectable PR build, the explicitly deferred non-maintainer trust test, physical controller/touch and alternate display assessment, and in-game behavior requiring WoW. Real account cleanup requires an isolated account or fixture, because the owner's follows must remain unchanged. The stale manifest needs a deployment route with permission to write that plugin file, without sudo or permission changes in this task.

The third pass below supersedes this continuation's unfinished-software list. No new product defect was established; the Menu failure was corrected as a test-input error.

The report received an unslop pass. No source fix, commit, push, issue mutation or PR mutation was made. See pr-state-continuation.json for the final GitHub read.

Final device state: Forever selected; Beta remains hidden with automatic updates enabled, Era visible with automatic updates disabled, Forever visible with automatic updates enabled. Global autoUpdate is on again. The isolated fixture root and registration are gone. The original frontend bundle and target executables remain installed, with engine version 1.2.0 and stale plugin manifest 1.1.2-pr.211.4. Both owned tunnel ports are free. The final cleanup UI seek failed before closing QAM, so the plugin may remain open on My Addons; the underlying route is /routes/library/home. This is not a device-state mutation outside the plugin.

GitHub remains OPEN at the requested head, with no review decision. Frontend, Backend engine, Package plugin zip and Decide succeeded; Release gate, Strip the label, Build and Publish were skipped.

## Third pass, isolated software coverage

DEVICE 2026-11-12. The existing scratch runner opened an owned tunnel and found the tested executables already installed. It did not deploy or restart the backend. Its first down had nothing to restore because this up did not change global autoUpdate. A final up/down verified state and closed the new owned tunnel too.

The separate engine fixture executable compiled the release worktree's unmodified AddonService, installation service, scanner, installer, persistence, character discovery and auction file modules with a deterministic provider and generated ZIPs. It ran on the Deck under `/home/deck/homebrew/data/wowdeck/rc-third/`, with TMPDIR inside that directory. It used no owner state, account credentials or network provider. The stable-channel fixture used the release PluginUpdateCheck with an in-memory recorded source and state. The copied fixture sources explain the construction; their relative imports refer to the release source tree, not their evidence directory. These checks establish module behavior on SteamOS. They do not claim the installed engine handled these cases over its live RPC connection. Local test results were not counted as device passes.

The UI fixtures loaded a temporary bundle in memory, exposing the release stores/components and intercepting only fixture RPC paths. TSM consent, preview, partial-removal error and remount checks ran in the actual release components. Credential save/clear and real account mutations were blocked. An initial plain TsmAddon modal wrapper lacked its own cancel handler; B therefore did nothing in that test wrapper. The test removed those three fixture modals using their own modal objects, then repeated remount checks with saved Close handles. This is a fixture construction error, not a product defect. third-modal-cleanup.txt records removal to QuickAccess. The final component pass records error text and state without the probe's truncation.

The self-update adapter fixture treats accept and decline as injected outcomes. It verifies store reset and handoff count, not the loader's native confirmation. Cancelling before the first byte event sends system.cancelDownload and never reaches the adapter. Stable-after-beta on/off behavior and persistence passed in the isolated engine fixture. No download, installer call or published replacement ran.

Synthetic CDP touchStart/touchEnd at the Previous versions control opened the modal on QuickAccess. This covers event dispatch and entry only. It does not establish physical touch feel. Options right/left navigation passed with an injected offer. The key modal recheck fixture changed invalid bundled access to working; the recorded RPC calls contain no credential save/clear.

Several runner attempts failed because of quoting, the wrong CEF evaluation context, a cached instrumentation module or a test method name. The corrected attempts and their observed states are retained. No product defect was reproduced. The only failed checklist row remains the already-known deployed manifest identity.

Remaining software limits are explicit. Native self-update confirmation/cancel requires crossing the real Decky installer boundary with a staged artifact. The fixture attempt stops at requestUpdate and cannot establish native prompt behavior; invoking installation would risk replacing the executables this task requires preserving. Live identity-dependent leave-test/update cases also read the root-owned stale manifest, which this task forbids replacing through sudo, permission changes or a published installer. PR build transitions require a selectable PR build; the picker has none. Fresh sign-in/reconnect and real account cleanup require an isolated account or owner action, since the owner's credentials and follows must remain unchanged. Companion delivery requires WoW running. The non-maintainer trust test, physical input feel, TV and in-game assessment remain explicitly deferred. No feasible isolated fixture case from this pass is left pending solely because it needed fixture construction.

The report received an unslop pass. No source fix, commit, push, GitHub mutation, sudo or permission change was made. third-engine.txt and third-stable.txt contain the final successful device fixture results. The local fixture executable and its entire remote directory were removed. The original frontend bundle was reloaded in memory; temporary globals and modal wrappers were removed. The tested executable files remain installed. Final preferences, global setting, UI route and tunnel cleanup are recorded in third-final-state.txt and third-down.txt. The final GitHub read is pr-state-third.json.

Final device state after the third pass: Forever selected; Beta hidden with automatic updates enabled, Era visible with automatic updates disabled, Forever visible with automatic updates enabled. Global autoUpdate is true. QAM is closed and the route is `/routes/library/home`. Engine PID remains 155309 and reports 1.2.0. The stale plugin manifest remains 1.1.2-pr.211.4. The fixture root is absent and both owned tunnel ports are free.


## Readiness continuation, 13 November 2026

The original observations above remain historical evidence. Subsequent native
Decky installation replaced the stale root-owned manifest without sudo or
permission changes. The installed PR build manifest, frontend, bridge and
engine matched the published ZIP, and the engine reported its PR version.
The earlier deployed-identity failure no longer blocks the release.

The live PR-build run subsequently verified initial installation, contributor
push revocation, reviewed relisting, maintainer-push approval retention, native
follow-update installation and merge cleanup. The merged PR correctly waited
for a containing beta with no Update button. See
[the PR-build report](../2026-11-13-pr-builds/README.md) for the claims,
evidence and pending beta-return checks. The tested build was left installed
for that continuation.

Physical input feel, alternate-display assessment, fresh authentication with
an isolated account and in-game Companion delivery remain human checks.
The report does not count simulated account operations as real account
cleanup or claim physical-device input coverage from synthetic events.


The readiness pass installed `1.1.2-beta.52` through Decky's real native
confirmation from `1.1.2-pr.225.3`. GitHub's comparison established that the
beta contains merge `d61ad5c`. UI Check again selected Beta, cleared the
active PR and offered the lower-version beta with an Update button and
orange dots. The engine classified the offer as `prMergedBeta`. The panel
said "WoWDeck 1.1.2-beta.52 available", reflecting the current wording rather
than the older regression row's "Switch to beta" text.

This resolves the earlier native-install boundary and containing-beta
prerequisite. The installed-beta identity and persistence evidence is
recorded in the PR-build continuation. A later beta is still needed to
verify normal subsequent Beta updates.


The subsequent-beta check also passed: Beta .52 offered and installed .53
through the normal Beta update path and Decky confirmation. The engine
reported .53, Beta remained saved, the active PR remained cleared and
diagnostics reported no errors. The linked PR-build report contains the
final identity hashes and native-install evidence. This completes the
software continuation for the merged-PR return path. The stated human
input, display, account and in-game limits remain.
