# Spec 229 final-build device continuation

2026-11-16. This is an incomplete hardware verification pass. It does not clear the full spec checklist. No commits, pushes, issue closures, PR changes or code fixes were made in the pass.

## Build and deployment

Requested and local HEAD was `arch/review-229`, commit `2d253431e68a450d87a2784c0f46c004e95ca432`. Engine changes were included with `DECK_TEST_TARGET=deck tools/deck-ui/deck up --engine`. The supplied full gate was not rerun. The Deck was reachable over isolated SSH at the configured Wi-Fi address without waking in this pass. The primary target defaults to Deck because no target field was supplied; DroidDeck ran its read-only TLS probe separately.

The deployed frontend hash was `6c8537b237b7869df2873e7cd34539912a8aedcca39e3dd9ac72f95861893019`. The restored bridge hash was `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7`. Local engine hash was `db61c48d35a542427685600ab7116a4944a6fbd0d15f1de54224a238ce076f58`; the SteamOS interpreter-patched local copy and installed engine both hashed `b60c6b8b86b0c71f7b05eeaffeee48f0b08b700aff1efe9e385fff14bfc3a11e`.

The deploy runner copied the changed frontend and reloaded version 1.2.1. The engine and bridge already matched the requested build. It does not deploy `recovery_updater.py`; that module was absent remotely, and an attempted copy failed because the plugin directory belongs to root. No permissions or ownership changed. The TLS probe therefore executed the exact local module source, hash `ab4ad054a47b87c858310ebd714947d63199850edd802e50d3473be1028ff1e6`, in a temporary module from a short-lived appended bridge hook. This verifies the module's TLS context in actual Decky Python, not packaging or recovery-stage integration. A new thread performed two bounded HTTPS requests and wrote only sanitized status/error types. No authentication values or signed URLs were inspected.

## Installation and cleanup

The existing selected Forever installation at `/home/deck/Applications/World of Warcraft/_forever_` was used. No fixture installation or new addon was added. Baganator, sourced from CurseForge, was updated through Details X from 860 to 861. What The Whisper still had an available update at the end. Refresh read all nine selected-installation addon records. The generated addon export in the WoW folder was removed after import verification. Account and follow selections were left unchanged.

The original `main.py` was restored byte-for-byte and reloaded. The temporary TLS output was copied to local evidence and removed remotely. No new recovery module file was created. Render and capture hooks report cleanup, toast observers report removal, and no phone hook was installed. The runner's backup is `/home/deck/homebrew/data/wowdeck/test-backups/2026-11-16-161721-1850598`. `final-down.log` records autoUpdate restoration and closure of the owned tunnel. The tested frontend and engine remain installed. Steam, Decky settings, other plugins, system files and existing SSH masters were untouched.

## Current claim results

All evidence is DEVICE, 2026-11-16. UI means live controls; RPC establishes engine behavior only. Controlled responses are named explicitly. Counts describe checklist groups, not atomic assertions.

The original matrix has 24 groups and remains incomplete. The pass 3 assertion table below supersedes its rows for the assertions tested again.

| Requested claim | Result | Evidence and remaining work |
| --- | --- | --- |
| #242: install/update toasts still appear. | passed | UI continuation-update-executed.log captured "Updated 1 addon"; continuation-install-toast.log captured "Installed Bagnon". These supersede the earlier captures that ended before a success notice appeared. |
| #250: deck-ui film/capture get real screencast frames+acks; profile returns a real profile; render mounts a real @decky/ui component; capture works on Big Picture. | passed | film.log recorded one frame from each target; capture.log recorded seven pad/window events and one frame from each target. Frame handlers acknowledge received frames. profile.json contains actual samples. render.log reports a mounted ProgressBarWithInfo and cleanup. Its trial props overflowed by 120 px; this passes tool execution, not component layout. |
| #230: panel opens (get_status); Export Addon List "Save to file" and Import "Load from file" work; `deck methods-check` reports get_status, read_text_file, rpc, save_text_file. | passed | final-methods.log has all four bridge methods, no missingBridge or unknownRpc. final-ui.log reports get_status ok. export-import.log records Export code saved. import-result.log shows all nine exported addons as Already installed after Load from file. |
| #231: Stable and Beta update offers unchanged (newest by shared channel rule). | pending | No Stable/Beta offer comparison performed. Resume with controlled version/channel fixtures and restore channel afterwards. |
| #239 TSM via network client: sign-in → account name; Decky restart restores session; sign out. Follow list loads (multi-page), follow/unfollow, "realm limit" text. AppData.lua written for followed realms (gzip blob decodes). Logs hold no tokens/signed URLs. (TSM-174/175 rows.) | partial | tsm-ui.log shows existing signed-in account, installed addons, followed Forever-EU region data, and recent data timestamp. manage.log opens follows twice. Fresh sign-in, restart persistence, sign-out, multi-page follow list, follow/unfollow, realm limit, gzip decode and secret-safe log audit remain untested. Owner must complete fresh browser authentication when requested; do not supply credentials to the agent. |
| #234: engine starts and lists installations. | passed | final-baseline.log records engine pid 203515, version 1.2.1 and three installations. final-ui.log records healthy bridge status after restoration reload, pid 203768. |
| #235: `tools/deck-ui/deck rpc system.getStatus` works on Deck. | passed | final-baseline.log contains successful DEVICE RPC system.getStatus, protocolVersion 1 and homeDir /home/deck. |
| #240 (M-46): two installs, second selected → check/Update all, Folders/Find source/Remove on unmanaged, Search/Latest/Popular+category, install from results and file all act on the second only; Update all installations, game page, TSM realms still work. No-install My Addons shows empty list without toast. | partial | DEVICE 2026-11-16 continuation. UI Search Bagnon and row X installed into fixture B; RPC File install left A empty and B populated, continuation-isolation.log. Curse Latest/Popular each returned two results, continuation-discover-corrected.log. Unmanaged Folders/Find source/Remove, category UI, all-install update and zero-installation state remain untested. An empty registered installation A did show No addons yet with no error, continuation-stale-diagnose.log; this is not the zero-installation case. UI exhaust-unmanaged-folder2.log opened Syndicator folders, exhaust-unmanaged-source.log found its CurseForge source, exhaust-deps-rebuild.log confirmed Delete. exhaust-category-conflict.log selected Bags & Inventory. exhaust-noinst.log used a controlled empty installations response and showed Find WoW/Add WoW folder with zero notices; this did not unregister real installations. All-install/game-page assertions remain untested. |
| #241: TSM Sources toggle off keeps account; on again resumes without browser sign-in; on with no account → "Sign in to TradeSkillMaster first"; sign-in turns source on, sign-out off. Saving CurseForge key enables it + verified. Detect/add installation still finds updates. | partial | RPC exhaust-fixtures.log used actual auth fields: disabled source returned state off/accountPresent true, enabled returned signedIn/accountPresent true. Bounded signed-out response showed Sign in in exhaust-signedout.log. Exact signed-out refusal toast, sign-in/out source transitions, key-save verification and detect/add update discovery remain unverified. Real auth was preserved. |
| #236: game-page Check for updates updates summary + toast; Update all installations shows progress; auto-update reports via addons.autoUpdated. | partial | RPC addons.refresh returned updated 9, failed 0 and two offers in update-details.log. This is engine evidence only. Game-page check, all-install progress and closed-QAM automatic-update event remain untested. Update all seek did not start an observed operation, and wait failed with Update all (1), in update-all.log. |
| #237: TSM "Remove addons" (git checkout refused, left in place); remove an installation; clear Roll back cache. | passed | DEVICE 2026-11-16 continuation. RPC continuation-operations.log records TSM git-checkout removal refused with Cannot remove a developer addon; AppHelper removed. Both disposable installations were removed successfully, continuation-cleanup-rpc.log. Global Roll back cache clearing remains untested because it includes the owner's 46 retained addons; a separate engine/data fixture or complete cache backup is needed to preserve them. DEVICE RPC exhaust-cache.log ran the pinned binary with isolated HOME/data and only one disposable installation: rollback.status reported 24 bytes/1 entry, rollback.clear and subsequent status reported 0/0. The owner cache was outside that engine scope. |
| #238: Manual Install from file: preview label matches Install for new/update/reinstall; plugin `downloads/` and `inspect/` empty afterwards incl. after refused conflict. | passed | UI exhaust-preview.log showed Install for a new archive. exhaust-manual-update.log showed Updates Review229 Fixture for an overlapping archive. Earlier continuation-picker-fixture.log showed Reinstall. exhaust-category-conflict.log showed two matched addons and removal guidance; earlier RPC conflict refusal passed. exhaust-temp-clean.log found downloads/inspect empty. All archives were disposable. |
| #233 (M-34b): after Ignore/Pause/Reinstall/Update on Baganator, its and Syndicator rows keep "needed by"/"missing" text; Details lists TOC deps. | partial | Baganator was opened and updated to 861. Dependencies field was not found in the broad active-document text probe; this does not establish TOC dependency rendering. Ignore/Pause/Reinstall and dependency-row retention remain untested. UI exhaust-deps-details.log opened Details. Ignore and Pause badges were observed. After rebuilding Syndicator as a managed dependency and reinstalling Baganator, exhaust-deps-library.log showed LIBRARY and needed by Baganator. Full before/after action matrix, missing-dependency rendering and TOC dependency section remain unverified. |
| #243 (M-47): plugin loads and calls engine; auto-update with QAM closed shows new version when My Addons opens; TSM destination/account views reload on change; WTF backup progress + toast arrive. | partial | Plugin loaded and engine calls succeeded. TSM destination showed existing account/follows. Closed-QAM automatic update, account/destination invalidation and WTF progress/toast remain untested. UI exhaust-backup.log created a disposable WTF backup and captured Backup created. Intermediate progress and closed-QAM auto-update remain unverified. |
| #247: remounted views show last answer immediately then re-read; Manage follows focus returns to Manage on remount; TSM Sources sign-in row polls 1/s via resource. | partial | QAM close/open retained My Addons and showed Update all (2) in remount.log. Manage modal twice returned focus to Manage in manage.log. Immediate stale answer followed by reread, sign-in polling and all other view remounts remain untested. |
| #244: with two installations, start a TradeSkillMaster install, a Manual Install from file, an addon-list import and the companion offer; the installation picker says "Wait for addon installs to finish" while each runs, then My Addons shows the result. A recovery-required installation's rescan shows the recovery state with no error toast. | partial | DEVICE 2026-11-16 continuation. UI Manual Install Reinstall and TSM install both showed Wait for addon installs to finish, continuation-switch-lock.log and continuation-tsm-install.log. Manual final list was deliberately held for 12 seconds; remote marker confirmed final list held. After completion the picker reopened, continuation-final-list.log. Injected recovery refusal showed retained list/recovery notice with zero error toasts, continuation-recovery.log. Import and companion-offer switching locks remain untested. UI exhaust-companion-lock.log showed Wait for addon installs to finish during a bounded companion install. Import completed, but exhaust-import-lock2.log did not establish the outer picker lock because focus remained in the import modal. Recovery and final-list claims retain their earlier evidence. |
| #246 (M-48): on an addon with an update, My Addons Details X reads Update and runs it; while the row works X reads "Update…" and ≡ Release channel is off; on a recovery-required installation Details offers neither X nor the channel menu. | partial | remount.log shows Baganator 860 to 861 with UPDATE in the footer. update-action.log shows X closed Details, selected Baganator UPDATED 861, and reduced Update all (2) to (1). Busy Update… label, disabled release channel and recovery-required controls remain untested. |
| Deck #232 actual Python TLS | passed | DEVICE RPC/plugin-context probe, final-tls.json. Frozen /home/deck/homebrew/services/PluginLoader, Python 3.14.8. api.github.com returned HTTP 200; self-signed.badssl.com raised SSLCertVerificationError. check_hostname true, verify_mode 2, 120 CAs. Exact recovery_updater.py source was executed in a temporary module inside the plugin process. Default store was populated, so certifi fallback was not exercised. |
| DroidDeck #232 actual Python TLS | passed | Actual frozen Decky Python 3.14.8 returned HTTP 200 over HTTPS and rejected the self-signed certificate with SSLCertVerificationError. Default trust store had 120 CAs, check_hostname true, verify_mode 2. Two owner-approved stop/start cycles restored the original main.py hash, mode and ownership. Steam remains running. Source: .scratch/arch-review-229/phone-tls-followup.md, Completed two-cycle probe. No phone actions in this continuation. |
| #245 shared TSM session and keyed addon resource | partial | UI tsm-ui.log and manage.log show existing account, follows and installed state, retained on reopening. Browser return, remote revocation, live followed-realm change, removal across QAM teardown and installation-key/event invalidation remain untested. These need controlled service responses and disposable installation fixtures. |
| Review #244 switching through final list and stale previous answer | passed | DEVICE 2026-11-16 continuation. UI/RPC continuation-switch-lock.log and continuation-final-list.log cover lock through held final list. continuation-stale-event.log triggers an addon-change read on A, holds its captured answer 12 seconds, then switches to B. B retained five addons before and after A completed; engine selection remained B. Two immediate successive selections were correctly serialized and the second ignored, continuation-stale-diagnose.log; those attempts are not stale-read failures. |
| Review #244 newly discovered recovery refusal | passed | DEVICE 2026-11-16 continuation. UI bounded bridge injection returned recovery_required for B refresh, then recoveryRequired from recoveryStatus. continuation-recovery.log shows B needs recovery, retained Review229 Fixture and no error toast. This verifies frontend refusal handling with a controlled response, not real interrupted-transaction repair. |
| Review #247 retained follows with refresh failure and Retry | passed | DEVICE 2026-11-16 continuation. UI bounded account RPC fault after QAM teardown. continuation-tsm-error3.log shows three retained follows beside Couldn't load followed realms and Retry. Removing fault and activating Retry cleared the error, retained all follows, and closing returned focus to Manage, continuation-tsm-retry.log. |
| Review #245/#247 installation-keyed TSM reads | partial | DEVICE 2026-11-16 continuation. UI continuation-tsm-keys.log shows B Uninstall with retained git checkout and A Install TradeSkillMaster with no TSM addons. Account/follows remain shared. Destination RPCs were made for both fixtures in continuation-matrix.log, but its printed output was truncated. Direct engine mutation emitted addon-change events; dedicated TSM out-of-order and unverified-data views remain untested. UI exhaust-unverified3-final.log showed recovery/unverified warning beside retained TSM controls. exhaust-unverified-action.log attempted Uninstall and it stayed inert. Native disabled=false did not mean the Steam action was enabled. Trace confirms fixture addon reads under the unverified response. Delayed destination reads were attempted, but the view reset on selection; exhaust-stale-after.log does not establish final destination rendering. Event invalidation remains unverified. |

## Evidence history and cleanup

The initial 2026-11-16 pass established deployment, bridge, capture tools and Deck TLS. Its missing-toast captures were inconclusive. The first fixture continuation captured install/update notices and established final-list locking, stale addon-list handling, recovery refusal and retained-follows Retry. Those later results supersede the initial toast concern. The completed phone probe supersedes both earlier phone connectivity and execution-capability blockers. Earlier raw evidence stays in `.scratch/arch-review-229/`.

This continuation reused commit 2d25343 and restored the archived disposable A/B folders. Raw logs and driver/hook sources have the `exhaust-` prefix. It added actual TSM auth-field toggle evidence, isolated rollback clearing, manual new/update/conflict UI, unmanaged folder/source/removal UI, category selection, controlled no-install UI, companion switching lock, backup completion/toast and managed dependency rendering. The report does not equate these results with complete checklist acceptance.

Repeated bridge reloads briefly produced a startup error and RPC timeouts. Restoring the bridge and reopening recovered engine RPC and the panel. No persistent product bug was confirmed. The suspected unverified TSM action failure was disproved by activation remaining inert. The delayed TSM attempt and import-lock capture were inconclusive, not passes.

The pre-existing automatic updater recorded an update to What The Whisper at 17:42. This run did not request that update; `up` returned already-runs-this-build without installing an auto-update guard. Auto-update was subsequently guarded explicitly and restored to true at cleanup. The report cannot claim all owner addon bytes stayed unchanged across that automatic run.

Cleanup restored original main.py SHA256 fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7 and removed fault/trace files. `exhaust-cleanup.log` confirms the original three registrations and Forever selected. hideLibraries was restored to true. Disposable files were archived as test-backups/review229-exhaust-fixtures.tar.gz and removed from WoW. The test-created 523-byte backup was moved from the active backup list to test-backups/review229-created-wtf.zip. The isolated cache engine exited and retained its own test evidence under test-backups/review229-cache-isolated. The owner cache was never passed to rollback.clear. `exhaust-down.log` confirms owned tunnel ports 18080 and 9222 closed. No phone, product source, ADR, commit, push, PR or issue changes were made.

## Remaining assertions and blockers

Fresh real TSM browser authentication is the only identified owner-dependent prerequisite. It is still needed for a fresh sign-in/account result and genuine browser-return behavior. The existing account was preserved. Controlled responses can cover signed-out/revoked UI without erasing it.

The following work remains unexecuted or inconclusive. No owner authorization blocker was identified for these Deck checks; this continuation did not exhaust the requested feasible matrix:

- Stable/Beta newest-offer comparison with controlled response/version fixtures.
- TSM restart persistence, real or controlled sign-out/source transitions, multi-page follows, follow/unfollow, realm-limit text, decoded AppData gzip and scoped secret-safe log audit.
- Exact signed-out source refusal, CurseForge key-save enable/verify and detect/add update discovery.
- All-install update progress, game-page check summary/toast and closed-QAM auto-update/event invalidation.
- Dependency text after each Ignore/Pause/Reinstall/Update, missing-dependency state and the TOC dependency section.
- Intermediate WTF progress, account/destination invalidation, stale-then-reread view timing, and 1-second TSM sign-in polling.
- Import outer installation-picker lock through completion and companion final My Addons result/toast.
- Details busy Update label, disabled release channel and recovery-required Details controls.
- TSM delayed destination answer after a confirmed switch, live followed-realm/account revocation invalidation and removal across QAM teardown.

No assertion should be marked passed from code inspection or from an earlier report saying the remaining fixtures were feasible. The added prose was checked against the local unslop rules.


## Pass 3, Deck follow-up

This pass tested HEAD `0df8df8` on `arch/review-229`. Target was explicitly
Deck. It did not access the phone. This is an incomplete test pass, not
acceptance of spec #229. No product code changed and no product bug was
confirmed. Checks that were not executed stay unchecked below.

Evidence is DEVICE, 2026-11-16. Links point to retained command output.
Controlled responses establish frontend behavior only.

### Cleanup and installed build

[Deployment](pass3/pass3-up.log) rebuilt and checked the engine, replaced the
hooked main.py and reloaded 1.2.1. [Hashes](pass3/pass3-hashes.log) match the
local main.py and frontend. main.py is
`fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7`;
the frontend is
`6c8537b237b7869df2873e7cd34539912a8aedcca39e3dd9ac72f95861893019`.
The deployed engine hash is
`b60c6b8b86b0c71f7b05eeaffeee48f0b08b700aff1efe9e385fff14bfc3a11e`,
recorded in [remote state](pass3/pass3-remote-state.log). Its interpreter is
patched for SteamOS by the deployment runner.

[Cleanup RPC](pass3/pass3-cleanup.log) removed Review229 Pass2 A and B and
selected Forever. The three original registrations remain. The subsequent
command in that log failed because the run string lost its JSON quotes;
the removal RPC had already succeeded. A remote search found no review-named
folder within two levels of the WoW root.

[Addon restoration](pass3/pass3-restore-addons.log) updated Baganator from 860
to 861 and Syndicator from 290 to 291. Both updates returned complete addon
rows. Forever then reported All up to date. This restores the versions
rolled back by pass 2 rather than leaving its two artificial update offers.

A temporary copy of the existing bounded pass2 bridge hook was used again.
It held updates for at most 18 seconds and substituted addon/recovery
responses. No update in the controlled busy test reached the engine.
The original main.py was restored afterwards and the real build was
[redeployed and reloaded](pass3/pass3-real-redeploy.log). An initial reload
returned RPC timeouts; the subsequent clean deployment answered 1.2.1 and
restarted the engine. These transient reload results do not establish a
product defect.

### Assertion results

| Ticket and assertion | Result | Evidence or reason |
| --- | --- | --- |
| #243 intermediate WTF backup progress and completion | passed | UI spot-check of [pass2 capture](pass3/pass2-243-wtf-progress.log). After Back up now, Backup progress appears at 125 through 240 ms and Backup created at 281 ms. The 9 ms completion notice predates those progress samples and is not the completion evidence used here. The retained log is truncated after the relevant samples. No new backup was created in pass 3. |
| #236 game-page Check for updates summary and toast | passed | UI [pass2 capture](pass3/pass2-236-gamepage.log) records activation of Check for updates, the final 1 addon update in Forever summary and Checked for addon updates 1 addon update in Forever toast. The observer reports removal. |
| #246 busy Details Update… label | passed | UI with held update, [clean busy capture](pass3/pass3-246-cleanbusy.log). React action props from the active modal all show onSecondaryActionDescription Update…. This reads modal actions, not the page footer. |
| #246 release channel disabled while busy | passed | Same capture. The modal action props have no onMenuActionDescription or onMenuButton, and Menu leaves ModalDialogOverlay_Modal_19 active. |
| #246 recovery-required Details has neither update nor channel action | passed | UI with controlled recovery response, [recovery capture](pass3/pass3-246-recovery.log). Active modal action props contain only View on CurseForge. Menu leaves the same modal active. |
| #233 missing-dependency row and header | passed | Controlled UI [capture](pass3/pass3-233.log) shows missing Review229Missing in the row and Requires Review229Missing / Missing: Review229Missing in Details. |
| #233 TOC relationship content | partial | Active modal [DOM capture](pass3/pass3-tabs.log) contains Relationships, Required, From the addon's own files; it doesn't load without them, Review229Missing and MISSING. The section exists in the modal DOM, but seeking Relationships failed and shoulder presses did not establish that section becoming visible. Visible TOC section navigation remains unchecked. |
| #233 dependency text after Ignore, Pause, Reinstall and Update | unchecked | Full before/after matrix was not executed in this pass. Earlier managed-library evidence remains partial. The controlled missing-dependency response is not evidence of mutation retention. |
| #231 newest-offer comparison across Stable and Beta | unchecked | Pass2 channel RPCs returned current with null offers. No controlled release-list fixture was executed at the selection boundary. Substituting a final offer would not test the comparison. |
| #236 Update all installations progress | unchecked | No all-install operation and progress capture completed in this pass. Pass2's Update all seek remains inconclusive. |
| #244 import picker lock through completion | unchecked | No new import lock test completed. Earlier capture stayed inside the import modal. |
| #244 companion offer final result in My Addons | unchecked | Earlier lock evidence is retained, but no new final result capture completed. |
| #243/#247 stale answer immediately on remount, then reread | unchecked | No timed retained-answer/reread capture completed. Existing QAM reopen evidence does not establish the two phases. |
| #243/#247 account and destination invalidation | unchecked | No event-controlled account/destination capture completed. Real account and follows were preserved. |
| #245/#247 destination switch with delayed old response | unchecked | No replacement for the earlier inconclusive delayed destination run. It needs confirmed switch plus before/after destination captures. |
| #245/#247 removal across QAM teardown | unchecked | No controlled removal/teardown run completed. Existing TSM installation evidence does not cover it. |
| #239 fresh TSM sign-in | unchecked | Owner step. Complete browser authentication, then verify account result and browser-return behavior. |
| #241 CurseForge key save | unchecked | Owner step. Save a real key and verify source enabled and key verified without exposing it in evidence. |

Other assertions in the original matrix retain their original result and
limitations. In particular, this pass does not add closed-QAM auto-update,
TSM restart/session/follow pagination, or certifi fallback evidence.

The remaining agent checks above are unfinished work, not owner-dependent
blockers. No issue was closed and no PR was merged. Prose was checked using
the repository's unslop rules.

[Final health](pass3/pass3-clean-health.log) confirms engine 1.2.1, pid
211099, the original three registrations, Forever selected and All up to
date. [Final hash](pass3/pass3-final-hash.log) confirms original main.py and
zero occurrences of review.control. [Down](pass3/pass3-down.log) closed the
owned tunnel on ports 18080 and 9222 and reported nothing to restore.
The tested real build remains installed. The ignored local HANDOFF.md was
updated for the next test driver.

Before committing, `nix develop -c make lint typecheck test build` completed
with exit status 0. No product source was modified.


## TSM sign-in follow-up

2026-11-16. Target Deck, branch `arch/review-229`, based on `48f73c0`.
Frontend-only fix. No phone access, issue closures or merges.

### Reproduced defect

A typed-fake test holds the status read sent before sign-in. Starting sign-in
publishes `signingIn`, which supersedes that read. The shared resource still
counted the obsolete request as in flight, so the next poll never ran until
it settled. The test failed with one pending status request instead of two.
This prevents timely completion detection and therefore browser close.
A second defect left obsolete explicit reads holding `loading` after an
action published its result, including cancellation.

The resource now tracks pending request identities. Only the newest request
blocks polling. Publishing an action result clears superseded loading state.
Late replies still cannot overwrite newer state. Tests cover browser close
once, panel teardown, shared cancellation across three viewers, stopped
watching, and late answers. The original device request trace was not
captured, so this reproduces a concrete failure path rather than proving it
was the only cause of the owner's symptoms.

The backend contract and sign-in/status/cancel handlers were read through
`TradeSkillMasterAuth`. Status and cancellation are immediate local actions;
completion polling does not await token exchange or account catalogue reads.
The existing recorded-token callback and network-client tests passed in the
[targeted run](tsm-fix/tsm-targeted.log). No backend change was needed.

### Device results

DEVICE, 2026-11-16, SSH and Steam CEF with synthetic navigation. The
[deployment](tsm-fix/tsm-deploy.log) installed the fixed frontend. Local and
installed frontend SHA-256 both equal
`eae7377798adeec8a7d7d43da099101f946520e5a83a072f3e44da6ef33f5fda`.
[Restored file hashes](tsm-fix/tsm-restored-state.log) identify the original
bridge. The engine binary was unchanged.

| Claim | Result | Evidence and limit |
| --- | --- | --- |
| Signed-in state reaches Options | passed | UI [Options probe](tsm-fix/tsm-final-options.log) shows Signed in as the real account. Account text is redacted. |
| Cancel reaches the engine promptly | partial | RPC [final probe](tsm-fix/tsm-final-device.log) returns `signedIn` immediately. The login had already completed; this preserves that session and does not test an active attempt. |
| Fresh sign-in detection and browser close | pending | Needs owner authentication. Automated tests pass, but the controlled device attempt did not complete. |
| Active login cancellation and watcher teardown | partial | Deterministic fake-engine tests pass. No completed active-login UI test on hardware. |

A temporary bridge fixture intercepted sign-in without starting real
authentication. After reload, CEF evaluations timed out, as recorded in the
[diagnostic](tsm-fix/tsm-fixture-diagnose.log). No controlled completion or
browser-close assertion was reached. The original bridge was copied back
and [reloaded](tsm-fix/tsm-restore-reload.log). Final real RPCs reported
`signedIn` and the UI showed the real account. No token or key was cleared.
The fixture expired after ten minutes and the clean reload removed it from
memory. [Down](tsm-fix/tsm-down.log) closed the owned tunnel and reported the
auto-update restoration state. The fixed build remains installed.

The first final UI attempt sought the row while the QAM was closed. A later
navigation attempt opened Steam's Settings route without changing settings.
The final successful probe selected Options using the plugin tab bar.
These failed navigation attempts establish no product failure.

### Remaining owner checks

Complete a fresh TSM browser sign-in and confirm that it returns to Options
promptly, with the account visible in Options and Get Addons. Start another
attempt and use Cancel sign-in; confirm the action returns and the attempt
stays cancelled after reopening the QAM. Existing authentication was kept
for this pass; the owner decides when to start a fresh sign-in.

The owner could not test the CurseForge first-key save flow because their
build already has a key. A safe follow-up is to back up only the original
`settings.curseApiKey` to a mode-0600 file in our plugin's data/test-backups
directory, then temporarily clear it through `settings.set`. Test saving a
valid key through the modal. A `finally` cleanup must restore the saved
value through `settings.set`, re-read the authentication status, compare
key values in memory without logging them, and delete the private backup
only after that comparison succeeds. Restore only that field, so other
settings and addon changes survive. Preserve any built-in key file; if
built-in access hides the first-key row, use a test-only auth-status response
to expose it. On interruption, retain the private backup and restore it
before further testing. None of these key changes were performed here.

### Validation

`nix develop -c make lint typecheck test build` exited 0. The
[gate summary](tsm-fix/gate-summary.log) records 1,294 frontend/tool passes,
1,723 backend passes, 4 skips, and Python suites of 33, 17, 27 and 6 tests.
Lint, formatting, both typechecks and both builds passed. An earlier gate
stopped at a test's unsupported `Array.at` call; it was corrected before
this complete successful run. UI tiers T1–T3 passed. Hardware observations
above cover signed-in rendering and RPC responsiveness, not fresh browser
completion or human controller verification. Prose was checked with unslop.

## Keyboard fix and Deck continuation, 2026-11-16

Build `4c2a7c3` on `arch/review-229`, PR #258. Target Deck. No phone
access, issue closures or merge. This pass adds evidence, not full acceptance
of spec #229. Controlled responses below test the installed frontend, not
real addon writes or remote account changes.

### Owner observations

Owner-observed 2026-11-16, supplied by the owner for this continuation:
CurseForge key save works. TradeSkillMaster sign-in is recognised, its
browser closes, and cancellation works. These supersede the corresponding
pending owner checks above. The owner also reported that Steam's keyboard
remained open. The new keyboard fix still needs a human check on the Deck.

### Keyboard regression and validation

The pre-#245 `tsmSignIn.ts` polled status and called the browser adapter's
`close` on success. That adapter navigated back and reopened Options.
Neither that flow nor `69244c3`/`2df2b84` explicitly dismissed the keyboard.
Steam opens it for its text controls. Our existing `virtualKeyboard` helper
already closes it for Search, URL lookup and Filter.

The new deterministic tests failed before the fix with zero dismissals
instead of one, [red run](keyboard-fix/keyboard-red.log). Terminal sign-in
states now dismiss it before browser return. Plugin unload releases the
watcher and dismisses it, while Options teardown keeps polling alive.
CurseForge key entry dismisses it on save/close and unmount. No backend
contract changed. [Targeted tests](keyboard-fix/keyboard-green.log) pass,
22 tests. [Full gate](keyboard-fix/gate-summary.log) passed lint, formatting,
both typechecks, tests and builds. Frontend/tools: 1,300 passes. Backend:
1,723 passes, 4 skips. Python: 33, 17, 27 and 6 passes.

The first broad gate overlapped addition of the teardown test and failed
on its not-yet-added export. The completed, unchanged source passed the
subsequent full run. This was test sequencing, not a passing gate.
PR CI is not green. On `4c2a7c3`, [CI run 43961705220](https://github.com/sigboe/wowdeck/actions/runs/43961705220)
failed five frontend Deck-tool runner tests reporting no compiled engine
binary. The preceding `2df2b84` [run 43956250558](https://github.com/sigboe/wowdeck/actions/runs/43956250558)
failed the same five tests. Backend CI and the PR build passed. This
continuation leaves that existing CI problem unchanged, under the instruction
to fix only the keyboard bug. [CI summary](keyboard-fix/ci-summary.log).

UI tiers T1-T3 pass locally. Remote UI observations use synthetic input and React
handlers. They are not human controller or keyboard verification.

### Assertion results

All DEVICE observations below are 2026-11-16, through SSH and Steam CEF.

| Ticket and assertion | Result | Evidence and limit |
| --- | --- | --- |
| #231 newest offers on Stable and Beta | passed | [Isolated Deck executable](keyboard-fix/keyboard-newest-device.log) compiled the real PluginUpdateCheck with controlled release lists. Stable offered 0.2.0; Beta chose beta.12 over beta.9; newer Stable 0.3.0 beat beta.40 on Beta. [Driver](keyboard-fix/newest-device.ts). No owner channel changed. This tests engine selection, not a new UI offer capture. |
| #236 Update all installations progress | passed | UI [capture](keyboard-fix/keyboard-all-progress2.log), the real toolbar Menu action with a held updateAll answer and injected progress event. It showed UPDATING 2 OF 3, 33%, Review229 progress, then cleared. No real addons updated. The first attempt could not reach the component's Menu handler; the successful attempt found it through React. |
| #233 visible TOC navigation | passed | After shoulder navigation, [viewport rectangles](keyboard-fix/keyboard-visible-toc.log) put Relationships, Required and Review229Missing inside the active modal. The runner's no-change summary describes its navigation snapshot, not the page's visibility. |
| #233 dependency text after Ignore, Pause, Reinstall and Update | partial | [Action matrix](keyboard-fix/keyboard-matrix.log) called the installed session's four real action handlers. Each complete fixture answer retained dependencies and missingDependencies, and My Addons retained missing Review229Missing. The responses kept the original flags. Actual flag transitions and a Details header capture after every action remain unchecked. Menu navigation to Ignore was inconclusive. |
| #243/#247 account and destination invalidation | passed | One controlled tradeskillmaster.changed event changed both account and realm/region labels in the [mounted UI](keyboard-fix/keyboard-invalidation.log). Real account/follows were preserved. |
| #243/#247 retained answer immediately on remount, then reread | passed | [Timed capture](keyboard-fix/keyboard-stale-timing.log) shows the retained account and realm labels at 0 ms, then both replacement labels at 3,400 ms. The new reads were held five seconds, with sampling beginning after the view opened. |
| #245/#247 delayed old destination answer after switching | passed | [Switch](keyboard-fix/keyboard-switch2.log) selected Classic Era while Forever's replacement destination read was held eight seconds. The new selection first showed Loading auction data, then the Classic fixture. [Later capture](keyboard-fix/keyboard-switch-final.log), after the old answer could return, still showed the Classic answer and confirmed Classic selection. |
| #245/#247 removal across QAM teardown | passed | [Repeated isolated capture](keyboard-fix/keyboard-remove-repeat.log) confirms removal, closes and reopens QAM while pending, retains the install lock, releases it and ends with enabled Install TradeSkillMaster. The original attempt's final content overlapped the next invalidation fixture, so that attempt is not the final-result evidence. No real removal reached the engine. |
| #244 import outer installation-picker lock | passed | [Held import](keyboard-fix/keyboard-import-lock.log) closed its modal and found all three outer selectors disabled. [Final result](keyboard-fix/keyboard-import-final.log) shows them enabled afterwards. The stronger [final-list test](keyboard-fix/keyboard-import-final-lock.log) returned the import immediately and held only addons.list for 15 seconds. The remounted selectors stayed disabled, then re-enabled and emitted Nothing new to install. |
| #244 companion final My Addons result and toast | passed | [Capture](keyboard-fix/keyboard-companion-final.log) held installation and the final list, retained Wait for addon installs to finish, then showed WowUp Companion fixture in My Addons and captured Installed WowUp Companion In Classic Era. The observer was removed. No real install occurred. |
| #239 session persists through plugin reload | passed | The normal fixed deployment restarted the engine. [Real RPC](keyboard-fix/keyboard-real-tsm.log) returned signedIn and three follows. The unrelated nav-r1 commands in that log were mistaken navigation attempts, not TSM evidence. |
| #239 follow result and realm-limit text | passed | Controlled [UI responses](keyboard-fix/keyboard-follow.log) changed Follow to Followed and displayed the friendly realm-limit error on refusal. These verify rendering, not a live account write. |
| #239 large follow list and unfollow result | partial | [Controlled UI](keyboard-fix/keyboard-unfollow-result.log) rendered 30 Unfollow actions, confirmed the account-wide warning, then showed 29 of 30 realms followed, removed the first realm and retained the last. This does not test API pagination. |
| #239 AppData contents and gzip transport | partial | [Read-only audit](keyboard-fix/keyboard-appdata-audit.log) found eight managed entries in Forever and fifteen in Classic Era. Files contain the unpacked Lua data; no downloaded code executed. Fresh compressed-response decoding and comparison with followed realms remain unchecked. |
| #239 secret-safe logs | partial | [Scoped audit](keyboard-fix/keyboard-log-audit.log) scanned five plugin log files, 26,016 characters. No configured key/token value or credential-query URL matched. It checked secrets in memory without printing them. The engine's in-memory access token was unavailable, and historical/rotated files outside this scope were not scanned. |

### Remaining checks

The owner must open Steam's keyboard during TSM sign-in, complete or cancel
sign-in, and confirm it closes. Repeat with CurseForge key save, Close/B,
and external dismissal. The owner need not repeat the already confirmed
key-save or sign-in recognition checks just to establish those results.

Agent work still incomplete: dependency flag transitions and Details headers
after every mutation; TSM API pagination and fresh gzip transport/data
comparison; controlled sign-out/source transitions and account revocation;
closed-QAM automatic-update invalidation. Earlier results for those checks
remain partial or unchecked. This pass did not implement the additional
network fixtures needed for pagination/gzip or the source-transition driver.
No new owner authorization blocker was identified. No additional product bug
was confirmed. The keyboard fix is the only product change.

### Restoration and cleanup

The [normal fixed frontend deployment](keyboard-fix/keyboard-fixed-up.log)
replaced the special keyless build. [Key restoration](keyboard-fix/keyboard-key-restored3.log)
restored only the original curseApiKey, compared it with the private backup
in memory, and confirmed bundledPresent true and userConfigured true. The
private backup remains on the Deck, unread in this report. The first two
restore attempts used the wrong CEF context and failed before writing;
the successful script ran in SharedJSContext.

Tests used bounded bridge response rules, synthetic labels and existing
installation registrations. Temporary selection of Classic Era was restored
to Forever. No real import, companion install, TSM removal or follow write
reached the engine. No disposable WoW installation was added. The standalone
offer executable and audit scripts were removed from plugin data. The
bridge hook was replaced by normal main.py and the engine restarted.
[Final deployment](keyboard-fix/keyboard-normal-final-up.log),
[hashes](keyboard-fix/keyboard-final-hashes.log),
[health](keyboard-fix/keyboard-final-health.log) and
[down](keyboard-fix/keyboard-down.log) confirm cleanup. The bridge has zero
review.control occurrences. Local and installed frontend SHA-256 match
`68aad5acc6f5c7f741f72ddd08b30f0b91d92b157832506780960763023ae215`.
[Auto-update comparison](keyboard-fix/keyboard-auto-update-restoration.log)
shows false before and after this run; down had nothing to restore.
The normal keyboard-fixed build remains installed. Prose was checked
against the repository's unslop rules.

The [repeated gate before the evidence commit](keyboard-fix/docs-gate-summary.log)
also passed with the same test counts.

## Final device evidence, 2026-11-16

This continuation used branch `arch/review-229`, head `5d10673`.
It supersedes earlier pending rows only for the assertions named below.
No phone access, real account sign-out, issue closure or merge occurred.
CI green at the supplied head is owner-supplied context; earlier CI failures
above describe older heads.

OWNER-OBSERVED 2026-11-16: after `4c2a7c3`, the on-screen keyboard
dismisses on TSM sign-in completion and cancellation and on CurseForge key
save and close. CurseForge key save works. TSM sign-in is recognised, the
browser closes, and cancellation works. These checks are PASS and supersede
the earlier pending keyboard and owner-authentication checks.

### Assertions

| Assertion | Result | Evidence and limits |
| --- | --- | --- |
| #233 mutation flags and dependency headers | PASS, controlled UI | DEVICE 2026-11-16 [matrix](final/matrix-complete.log). The installed session's Ignore changes ignored to true; Pause changes paused to true. After Ignore, Pause, Reinstall and Update, dependencies, missingDependencies and neededBy survive. Each opened Details shows Requires Review229Missing and Missing: Review229Missing. Reinstall/update trigger a final list reread, whose fixture returns version 1.0; this is not evidence of a real version update. Earlier real Baganator/Syndicator library evidence and visible TOC evidence remain applicable. |
| #239 multi-page follows and gzip AppData | PASS, isolated engine | DEVICE 2026-11-16 [six scenarios](final/tsm-device.log). Compiled the existing tsm-auction-rpc and tsm-auth-rpc scenarios with a small assertion adapter and embedded recorded JSON. Real engine modules ran on Deck against loopback HTTP/WebSocket fixtures. Two-page follows, gzip with and without Content-Encoding, followed-realm AppData bytes, pruning and restart assertions passed. No owner credentials or installation paths were supplied. |
| #239/#241 sign-out, source transitions and revocation | PASS, isolated engine | Same executable. PKCE exchange, sign-out token deletion and revoke request, bounded stalled revocation, source off retaining account, source on refreshing without browser sign-in, and invalid-grant recovery passed. This does not establish revoked-state rendering in every mounted frontend view. |
| #239 secret-safe logging | PASS within stated scope | [Audit](final/audit-cleanup.log) scanned five current plugin logs, 21,300 characters, without printing credentials. Zero configured-secret or credential-query-URL matches. The isolated auction scenario also asserts its captured logs exclude the fixture token, account and blob endpoint. Rotated files and the live in-memory access token remain outside the audit scope. |
| #243 closed-QAM event invalidation | PASS, controlled UI | DEVICE 2026-11-16 [capture](final/closed-event.log). With panelMounted false, injected addons.changed and addons.autoUpdated events updated the retained session to 9.229. Reopening showed 9.229. No real automatic addon write ran, and this capture does not prove an automatic-update toast. |
| #236 automatic-update event toast | unchecked | The closed-QAM event was delivered, but no toast observer was active. Earlier install/update and game-page toasts do not prove this event's toast. |
| #232 certifi fallback | PASS, isolated plugin Python | DEVICE 2026-11-16 [result](final/certifi-device.json). Executed current recovery_updater.py in a private module inside Decky Python. Replaced only that module's ssl reference with a factory returning an empty SSLContext. certifi loaded 120 CAs, hostname checking stayed true, verify mode was 2, GitHub returned 200 and self-signed.badssl.com was rejected with a certificate verification error. No process-wide SSL mutation, system CA or environment change occurred. |
| #241 detect/add discovery and exact signed-out source refusal text | unchecked | No new controlled UI run for these assertions completed. Previous source toggles and signed-out rendering do not establish the exact refusal text or discovery trigger. These remain agent work. |
| #245 revoked account updates every frontend view | unchecked | Engine revocation and earlier account/destination change-event rendering passed separately. This continuation did not capture their combined frontend transition. |
| #247 Sources row polls at one-second intervals during signingIn | unchecked | The closed-event trace contains one-second status reads, but no active controlled signingIn transition was established. Owner success does not prove cadence. |

The isolated executable ran all six scenarios successfully after its ELF
interpreter was patched for SteamOS. Its first launch failed before execution
because the build carried the Nix interpreter path. A hook reload also
briefly rendered an error; Retry and reopening recovered the panel. Neither
attempt supplies passing evidence. No product bug was confirmed.

### Cleanup and validation

[Normal deployment](final/normal-up.log), [health](final/health.log),
[hashes](final/hashes.log) and [down](final/down.log) confirm the normal
keyboard-fixed build remains installed. Bridge hash is
`fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7`;
frontend hash is
`68aad5acc6f5c7f741f72ddd08b30f0b91d92b157832506780960763023ae215`.
The bridge contains zero review.control occurrences. The real account is
signedIn; CurseForge bundledPresent and userConfigured are true. The three
original installations remain, Forever selected, with nine real addons.
No real addon mutation was requested. The existing private key backup was
not read or changed.

The isolated executable, audit script, CA result and its temporary state
tree were removed from plugin data. The first rmdir found fixture leftovers;
the final cleanup removed that run's entire temporary tree. Local temporary
test source copies were removed. Tunnel ports 18080 and 9222 are free;
down reported nothing to restore. Only documentation and evidence are
committed, so the full product gate was not rerun, as requested. Prose was
checked against the unslop rules.

### Ticket readiness

This table covers device-checklist readiness, not code-review or automated
acceptance criteria. PASS includes explicitly controlled evidence above.
Tickets with no device item are marked separately. No issue was closed.

| Ticket | Device-checklist readiness |
| --- | --- |
| #230 | PASS, ready to close on device evidence. |
| #231 | PASS, controlled newest-offer comparison in keyboard-fix evidence. |
| #232 | PASS, historical Deck and phone TLS plus controlled Deck certifi fallback. No phone access this pass. |
| #233 | PASS, controlled mutation/header matrix plus earlier real library and visible TOC evidence. |
| #234 | PASS, engine startup and installation list. |
| #235 | PASS, system.getStatus on Deck. |
| #236 | PASS, controlled automatic-update toast captured in remaining evidence. |
| #237 | PASS, removal refusal and isolated rollback-cache evidence. |
| #238 | PASS, archive preview/install and cleanup evidence. |
| #239 | PASS, owner authentication plus isolated pagination/gzip/transitions and scoped logs. |
| #240 | PASS, accumulated installation isolation, browsing, unmanaged actions, no-install state and controlled all-install progress evidence. |
| #241 | PASS, controlled exact refusal toast and isolated engine detect/add discovery triggers. |
| #242 | PASS, install/update toast evidence. |
| #243 | PASS, controlled closed-QAM event invalidation, account/destination changes and backup progress/toast. |
| #244 | PASS, accumulated install locks, final results and recovery refusal. |
| #245 | PASS after e90ed5c; controlled revoked-state re-verification below supersedes the earlier FAIL. |
| #246 | PASS, busy/recovery Details actions and live update evidence. |
| #247 | PASS, controlled active signingIn Sources row with one-second status polling. |
| #248 | No device-specific checklist item; automated review decides closure. |
| #249 | No device-specific checklist item; automated review decides closure. |
| #250 | PASS, film/capture/profile/render evidence. |


## Remaining device checks, 2026-11-16

Branch `arch/review-229`, source head `5211af1`. Target was `deck`, the
skill default. No engine product change. A bounded bridge hook intercepted
responses and emitted events for frontend checks. A separate compiled
executable used private state under plugin data for engine checks. Neither
used the owner's credentials. No phone access or real account mutation.

| Assertion | Result | Evidence and limits |
| --- | --- | --- |
| #236 automatic-update toast | PASS | DEVICE 2026-11-16, controlled UI/event. [Toast capture](remaining/auto-poll2.log) observed "1 addon updated automatically Updated Review229 toast fixture" after addons.autoUpdated. The observer stopped cleanly. No automatic addon write ran. |
| #241 exact signed-out refusal toast | PASS, controlled UI plus isolated RPC | DEVICE 2026-11-16. [Isolated engine](remaining/engine-device2.log) refused enabling TSM without credentials with "Sign in to TradeSkillMaster first". [Sources callback capture](remaining/refusal.log) supplied that error at the bridge boundary and observed "Couldn't change TradeSkillMaster Sign in to TradeSkillMaster first". The controlled remembered-account/off status takes the registry-enable path. This is composed evidence, not a real owner sign-out and re-enable. |
| #241 detect/add update discovery | PASS, isolated engine RPC | DEVICE 2026-11-16. [Engine capture](remaining/engine-device2.log) and [driver](remaining/engine.ts). Real startEngine, installation handlers and services used private fixture folders. An observation wrapper delegated to the real checkAll and counted one call after detect, two after add. This proves the trigger, not successful remote offers. ReplayNetwork had no responses; TukUI scan failure is expected and reported. The first [attempt](remaining/engine-device.log) failed because an Interface-only folder is not automatically detected. Adding recorded-style build/flavor metadata corrected the fixture. |
| #245 revoked-state frontend transition | FAIL, controlled UI | DEVICE 2026-11-16. [Before](remaining/revocation-open.log), the destination showed Review229 controlled account and Manage opened the followed-realms modal. [After](remaining/revoked.log), a signedOut/null-account status, disabled source and tradeskillmaster.changed event changed the mounted modal to "Couldn't load followed realms". Closing it showed that the TSM destination disappeared. Options showed Sign in, but incorrectly also "Your account stays signed in while off. X signs out." No real revoke request ran. The account modal remains open with an error until dismissed; this is recorded without asserting that auto-dismissal is required. |
| #247 active sign-in polling | PASS, controlled UI/RPC trace | DEVICE 2026-11-16. [Capture](remaining/poll-capture.log) shows Cancel sign-in in Sources with signingIn supplied by the bridge. Consecutive status reads from 917.637 through 923.636 are 0.999 to 1.001 seconds apart. The longer trace includes an additional event/mount read at 899.894; it is not evidence of a second periodic poller. No browser or real sign-in was started. |

### Product bug

The revoked Sources row uses the account-retention description even when
status is signedOut and account is null. SourcesSection's tsmAccount test
includes signedOut, and its disabled-provider description then says the
account stays signed in. The transition itself reaches the views, but this
copy contradicts Sign in immediately below it. #245 is not ready on this
evidence. No product fix or issue change was made.

### Cleanup and validation

[Normal reload](remaining/normal-up.log), [hashes and fixture cleanup](remaining/cleanup.log),
[health](remaining/health.log) and [down](remaining/down.log) confirm restoration.
Bridge SHA-256 is `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7`;
frontend is `68aad5acc6f5c7f741f72ddd08b30f0b91d92b157832506780960763023ae215`.
The bridge has zero review.control occurrences. The private executable and
state trees were removed. The real account is signedIn, the original three
installations remain with Forever selected, and CurseForge userConfigured
and bundledPresent are true. userStatus was unvalidated after reload;
bundledStatus was valid. No key was read, written or restored in this run.
The normal fixed build remains installed. Down had nothing to restore and
closed the owned tunnel; ports 18080 and 9222 were free. Initial wrong-context
and malformed-eval attempts changed no real account state and supply no pass.

Prose was checked against the unslop rules. [Full gate](remaining/gate-summary.log) passed with 1300 frontend/tools tests,
1723 backend tests and 4 skips, Python suites of 33/17/27/6, and a successful
Rollup build. Lint, formatting and typechecks passed.


## Revoked Sources fix, 2026-11-16

Build: `arch/review-229`, product commit `e90ed5c`, PR #258 unmerged.
Target: `deck` (default). No engine change. The Sources retained-account
predicate included signedOut even with a null account. It now requires an
account before showing retained-account copy or offering Sign out.

The deterministic rendered-row test [failed before the fix](revoked-fix/red.log)
with “Your account stays signed in while off” beside Sign in.
The [full gate](revoked-fix/gate-summary.log) passed after the fix.
The regression row is “Revoke the session elsewhere” under
“TradeSkillMaster shared session” in docs/regression-test-plan.md.
This pass checks state and copy (T1–T3 plus controlled DEVICE evidence);
it does not claim new layout or full controller-navigation coverage.

| Assertion | Result | Evidence |
| --- | --- | --- |
| #245 revoked state reaches mounted views | PASS, controlled DEVICE UI, 2026-11-16 | [Before](revoked-fix/before2.log) shows the controlled account and opens Manage. [After](revoked-fix/after.log) shows the mounted modal refusing follows, the disabled destination disappearing after dismissal, and Options offering Sign in without retained-account copy. |
| Revoked Sources copy | PASS, controlled DEVICE UI | [Assertion](revoked-fix/assert.log) rejects “stays signed in” and “X signs out”. Its secondary-action introspection did not find a row, so that field supplies no separate footer-action verification. |
| Normal build restored | PASS, DEVICE deployment and SSH | [Normal reload](revoked-fix/normal-up.log), [hashes](revoked-fix/hashes.log) and [down](revoked-fix/down.log). The bridge contains zero review.control hooks. The fixed normal frontend remains installed. |

A bounded bridge hook supplied signedIn, then signedOut/null-account and a
disabled provider, and emitted tradeskillmaster.changed. It never signed out
or revoked the real account. No fixture addon files were installed. Reloading
the normal bridge removed the hook and its in-memory rules. No temporary
executable or state tree was created. No phone or CurseForge key access ran.
Final RPC checks confirmed the real account signedIn, three installations,
Forever selected, and CurseForge userConfigured/bundledPresent true.
Down restored nothing and closed this run's tunnel; both ports were free.

The first attempt encountered Decky's rendering-error screen before the
tabs mounted. Controller seek could not reach Retry; a DOM Retry click
[recovered the view](revoked-fix/retry2.log). Those initial attempts provide
no transition pass. Manage still displays its refusal until dismissed, as
in the earlier run; this fix does not add auto-dismissal.

Prose was checked against the unslop rules. #236, #241 and #247 retain their
PASS evidence from 3824e44 in “Remaining device checks”. #245 now passes its
controlled re-verification. #229 remains open until merge.

The [repeated pre-commit gate](revoked-fix/docs-gate-summary.log) also passed.
Closed #236, #241 and #247 with comments citing their evidence; #245 closes
with this report. PR #258 remains unmerged.
