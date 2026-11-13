# TradeSkillMaster Deck test, 2026-11-10

Continuation of the report at d66a35c. Tested production build d7ddfca1e10c826a8bdb1d333a71f70ea4155f03 for PR #184 on the owner's x64 Steam Deck. This is not a full approval. The two controller focus defects were fixed and retested in the continuation below. Partial cases still have uncovered subcriteria.

## Evidence boundaries

LIVE means the installed plugin, real account, real addon files and controller in game mode. ISOLATED means DEVICE execution of the same production contracts, RPC handlers and services against a localhost HTTP/WebSocket service and temporary WoW trees. Both ran on the Deck. Fixture entitlement and price strings do not establish real entitlement or gameplay correctness.

Read the prior report, device skill and reference, regression cases, PR diff and fixture implementations to select coverage. No login, logout, live revocation or forced auth expiry was performed. No Steam, Decky, system or other-plugin settings changed. No phone access. No child agents. Applied unslop to this report.

The standalone runner reuses the four existing addon, auction, Classic and discovery RPC test modules, replacing only bun:test registration/assertions. It does not compile the test runtime or mock the UI. Its 26 scenarios passed, including all 22 flavor/entitlement combinations. Synthetic token files, auth restore and sign-out occur only in isolated temporary trees. HOME and TMPDIR point under plugin data. Service endpoints are localhost. Production auth files are never read. FaultInjectingFs supplies transaction faults where ordinary filesystem access cannot produce them safely.

Build with `nix develop -c python3 tools/tsm-device-fixtures/build.py`; patch its ELF interpreter to `/lib64/ld-linux-x86-64.so.2` before copying to SteamOS. Deploy runner and backend/tests/fixtures/tsm under `~/homebrew/data/wowdeck/isolated-tsm/`. Run with HOME=home, TMPDIR=tmp and TSM_FIXTURES=fixtures set to absolute paths there. The runner prints one JSON result per scenario and exits nonzero on failure. Results are in [isolated-results.jsonl](test-evidence/tsm-2026-11-10/isolated-results.jsonl).

## Case results

PASS covers the authorized subcriteria using the stated evidence boundary. Explicitly excluded authentication and phone portions remain listed separately in each mixed row and do not make its authorized portion PARTIAL. PARTIAL names the uncovered subcriteria. EXCLUDED means explicitly outside this run's authorization. BLOCKED requires an unavailable external activity. Fixture passes never count as live gameplay.

| Case | Result | Evidence or remaining subcriterion |
| --- | --- | --- |
| TSM-174-1 | PASS | LIVE source cycle retained auth. Browser sign-in, sign-out and phone repetition EXCLUDED. |
| TSM-174-2 | EXCLUDED | Sign-in initiation, cancellation and expiry are outside the requested scope. |
| TSM-175-1 | PARTIAL | LIVE full plugin reload changed engine PID 110438 to 111287, retained signed-in source and declined follow. Decky restart is outside allowed settings/process scope. |
| TSM-175-2 | EXCLUDED | Session revocation and forced expiry excluded. |
| TSM-175-3 | PASS | LIVE source off hides destination; on restores ownership without sign-in. Rejection and reauthentication EXCLUDED. |
| TSM-175-4 | PASS | ISOLATED transport disconnect/reconnect passes. Token-refresh-specific failure was not included in the compiled runner; no live auth expiry induced. |
| TSM-176-1 | PASS | LIVE controller Install restored Forever TSM 4.15.5 and helper 4.15. ISOLATED addon RPC matrix passes all 11 client types, dependency flag and version normalization. |
| TSM-176-2 | PASS | ISOLATED 11 client types with and without beta role; channel switch installs 4.16 then stable, disallowed beta rejects. Real paid entitlement remains unverified. |
| TSM-176-3 | PASS | ISOLATED socket release advances 4.15.4 to 4.15.5; marker and auto-update off, paused and enabled behavior asserted. |
| TSM-176-4 | PASS | LIVE TSM removal left helper installed; source-off file install/removal passed. ISOLATED neededBy empty asserted. Live sign-out EXCLUDED. |
| TSM-176-5 | PASS | ISOLATED invalid downloaded ZIP fails update with byte-identical prior TOC and installed version. Does not simulate a physical power cut. |
| TSM-177-1 | PASS | LIVE fresh File copies in Forever adopted on enable/refresh; 766 static files unchanged. ISOLATED same adoption in two installations with keep.lua sentinels intact. |
| TSM-177-2 | PASS | ISOLATED both folders reject catalogue, File, URL Zip, changeSource, adopt and kept archive rollback while signed in; sentinel files unchanged. |
| TSM-177-3 | PASS | LIVE empty .git marker causes INSTALL operation failed, error TradeSkillMaster is a developer addon. Marker removed. ISOLATED git and development TOCs protect both folders. |
| TSM-177-5 | PASS | ISOLATED source catalogue offers TradeSkillMaster by folder without search. Live enable/refresh adopts both File copies without replacing static files. |
| TSM-177-4 | PASS | LIVE source off, File installs of both addons, File helper removal, enable and refresh passed. ISOLATED unavailable source operations pass. Live sign-out EXCLUDED. |
| TSM-178-1 | PARTIAL | LIVE allowance, freshness, no-data and Refreshing UI observed. ISOLATED scan timestamps, follow and region data pass. Published case expects tier label while TSM-192-1 requires no tier; live UI has no tier. |
| TSM-178-2 | PASS | ISOLATED real localhost HTTP/WebSocket delivers to active, inactive and TSM-only Retail trees; connected All houses share payload and changes notify destination. Gameplay not asserted. |
| TSM-178-3 | PASS | ISOLATED disconnected service reconstruction retains catalogue, follows and per-file timestamps. |
| TSM-178-4 | PASS | ISOLATED dropped keys pruned, unknown line retained; occupied temp path preserves old file, retry recovers; independent target still writes. |
| TSM-179-1 | PASS | LIVE Normal Horde removed and restored, count 4/3/4. ISOLATED cross-install Retail pruning and external ownership preservation pass. |
| TSM-179-2 | PASS | LIVE declined Normal survives full plugin reload BEFORE refollow, wake and discovery. Explicit refollow clears declined. Original choice metadata restored. Login/logout EXCLUDED. |
| TSM-179-3 | PARTIAL | ISOLATED allowance refusal/acceptance, failed DELETE ownership and repeated/concurrent writes pass. Stale frontend installation-control race has no device UI reproduction. |
| TSM-182-1 | PASS | ISOLATED Classic payload assertions cover realm, shopping, regions, both factions, localized/connected names, helper and TSM-only inactive trees. |
| TSM-182-2 | PASS | LIVE exact dropdown Forever Beta, Classic Era and Forever; Beta empty, Era both Soulseeker factions and Pyrewood Alliance with Classic-EU/HC-EU; Forever Normal Horde and Forever-EU. ISOLATED missing-data and evidence filtering pass. |
| TSM-182-3 | BLOCKED | No Blizzard gameplay session or desktop price comparison available to this run. Fixture price=123 verifies delivery only. Character creation and prices in game require owner gameplay. |
| TSM-182-4 | PASS | ISOLATED dropping Horde prunes only Horde; Alliance and unknown lines remain across Classic installations. |
| TSM-187-1 | PASS | ISOLATED update and rollback reconnect, restored helper immediately receives price=300 rather than stale price=100. |
| TSM-187-2 | PASS | ISOLATED managed and hand-copied helper removal deliver prices 400 and 500 into TSM file without waiting for next scheduled push. |
| TSM-187-3 | PASS | LIVE source-off File helper install and destination install with required library passed. ISOLATED post-install data delivery passed. Continuation drove the real file picker to the backed-up AppHelper archive and Install. Signed-in ownership correctly refused takeover. Final continuation: source OFF, real picker archive selection and Install succeeded with Updated TradeSkillMaster_AppHelper and provider File. |
| TSM-187-4 | PASS | LIVE source-off File install and removal succeed; ISOLATED socket counts verify no reconnect. Live sign-out EXCLUDED. |
| TSM-194-1 | PASS | LIVE neither, both, TSM-only and helper-only states observed; Install only when absent, Uninstall otherwise. PNGs show action and Refresh fit on one row. |
| TSM-194-2 | PASS | LIVE continuation: repeated Cancel and B settle on Uninstall, then Right reaches Refresh. Dialog names both addons; files unchanged. |
| TSM-194-3 | PASS | Filesystem confirmed only Forever TSM and helper removed; Era copies and Syndicator remained. Account still had original four follows. |
| TSM-194-4 | PARTIAL | Prior LIVE developer-removal partial failure retained TSM and removed helper. ISOLATED recovery-required grouped removal preserves copies. Recovery-error UI not induced on live installation. |
| TSM-194-5 | PASS | LIVE controller Install, Uninstall confirmation, Uninstall both and Refresh reached and activated; Install changes to Uninstall, Refresh changes to Refreshing. Cancellation focus defect recorded separately. |
| TSM-192-1 | PASS | Manage listed all four account follows with regions, flavors and factions; signed-in account shown. No tier label in visible text. |
| TSM-192-2 | PASS | LIVE continuation: last Normal Horde and different Soulseeker Horde confirmations focus Cancel. B returns to the measured containing row; repeated Normal Cancel also returns to Normal Horde. No account mutation. |
| TSM-192-3 | PARTIAL | LIVE confirmed Unfollow removes Normal and count becomes 3. ISOLATED service failure retains follow. Error-and-retry UI with actual service failure was not driven. |
| TSM-192-4 | PASS | LIVE Done and B from Manage settle on Manage. Removed Normal stays absent across discovery and full plugin reload before restoration. |
| TSM-193-1 | PASS | LIVE real dropdown filtering plus ISOLATED missing Classic faction/region and US/EU exclusions pass. |
| TSM-193-2 | PASS | LIVE Forever Beta selected by exact label. Empty evidence help, account count and Manage remain. Manage shows account-wide follows; Done returns Manage without mutation. |
| TSM-193-3 | PARTIAL | ISOLATED actual SavedVariables fixture changes make matching Forever evidence appear after scan. Live help seen; Blizzard login/logout and saved new character not performed. |
| TSM-195-1 | PASS | LIVE positive Normal Horde / EU / Forever preview and unchecked control observed. Existing authentic owned provenance was already eligible; no account mutation needed. ISOLATED pre-existing/shared exclusions pass. |
| TSM-195-2 | PASS | B cancellation followed by unchecked grouped uninstall preserved all four follows and signed-in state. |
| TSM-195-3 | PASS | ISOLATED partial cleanup removes Extra, reports Realm1 left behind and local addon removed; discovery does not refollow success. |
| TSM-195-4 | PASS | LIVE Up from Uninstall both reaches toggle, A changes aria-checked false to true, Down reaches Uninstall both and Right reaches Cancel. Cancel/A returns Uninstall without changing four follows. Account-wide consent visible. |
| TSM-195-5 | PASS | ISOLATED failed eligibility GET after successful preview removes local addon, reports previewed follows left behind and sends zero DELETEs. |
| TSM-195-6 | PARTIAL | LIVE bounded paused-engine retest of the working-tree fix showed Working after QAM close/reopen while destination RPC remained pending. Switching while busy remains unverified because selection RPC also waited for the paused engine. No cleanup result existed to test preservation; live failure presentation remains unverified. ISOLATED failure results asserted. |
| TSM-195-7 | PASS | ISOLATED DELETE success followed by GET 503 updates Manage account/count result; cleanup reports removed and declined prevents discovery recreation. |

Numbered totals for authorized subcriteria: 40 PASS, 7 PARTIAL, 2 wholly EXCLUDED and 1 BLOCKED. Seven PASS rows also contain excluded authentication or phone portions. The 26 isolated device scenarios are separate executions, not 26 additional live passes. PASS rows may rely on isolated evidence as explicitly marked; these totals are not a live-only pass count.

## Unnumbered procedures and remaining coverage

| Procedure | Result | Evidence or remaining subcriterion |
| --- | --- | --- |
| #180 discovery order, all flavors and factions | PARTIAL | ISOLATED recent-order and Retail tie priority, refusal stopping, Classic saved scopes and missing region, retry after GET failure pass. Live new Blizzard characters were not created. |
| #180 declined persistence | PARTIAL | LIVE full plugin reload while Normal Horde remained declined, before explicit refollow, passed. Login/logout excluded. |
| #180 character deletion | PASS | ISOLATED deleting character evidence empties local lists without deleting account follow. |
| #180 retry and server refusal | PASS | ISOLATED failed reads retry discovery; unchanged refused scans do not repeat POSTs. |
| #181 browser sign-in and phone repetition | EXCLUDED | Authentication flows excluded. Phone testing was not authorized. |
| #181 install and game prices | PARTIAL | LIVE destination controller install passes. ISOLATED delivery passes. In-game price comparison needs owner gameplay and desktop data. |
| #181 refresh active/inactive and queued transfer cancellation | PASS | ISOLATED selected-file refresh, unchanged inactive file, four-download concurrency and stale queued-event discard pass. |
| #181 folder swap recovery | PASS | ISOLATED actual file transactions update, roll back, install and remove helper; prices return after swap and removed paths are dropped. |
| #181 suspend, reconnect and source pause | PARTIAL | ISOLATED dropped socket, server disconnect, bounded reconnect backoff, wake cancellation of retry and source-disable queue cancellation pass. Physical suspend/resume not performed. |
| #181 diagnostics privacy | PARTIAL | LIVE Show diagnostics and Copy diagnostics activated. Displayed JSON has enabled, signedIn, tier, connected, lastPush and followedCount only for TSM; account names, realm names and token fields absent. Temporary-field clipboard paste returned empty, and Import modal used a different input element than attempted; clipboard byte equality remains unverified. ISOLATED diagnostic and log privacy assertions pass. Live sign-out excluded. |

Unnumbered totals are 4 PASS, 5 PARTIAL and 1 EXCLUDED.

Manage Cancel row identity was measured in the focus-fix continuation. The final continuation below records the source-off picker install, positive cleanup toggle and pending-removal attempt. Pending-removal error results and failed-service retry presentation remain uncovered. Those are coverage gaps, not blocked conditions or passes inferred from fixture tests. No production account response was replaced to obtain UI coverage. Paid live channels, Blizzard saves and in-game price comparisons remain unavailable in this run. A rename-only filesystem failure was not induced; the runner covers write failure before rename and subsequent recovery.

## Original live defects, fixed and retested

1. TSM-194-2. In Forever with both addons installed, open TradeSkillMaster, focus Uninstall and press A. Cancel by selecting Cancel and pressing A. After the modal settles, focus is Manage. Repeat with B and wait for focus to settle. It again becomes Manage. Expected Uninstall with Refresh reachable from that row. Both dialogs preserved installed files. Reproduced after full plugin reload.
2. TSM-192-2. Manage, choose Normal Horde, press A and wait until Unfollow realm? appears. Focus is Unfollow instead of Cancel. Press B. The list returns with focus Done, rather than Normal Horde. Selecting Cancel returns to an Unfollow control, but the row identity was not measured. No account mutation occurs on cancellation.

These are the original findings against d7ddfca. The continuation below fixes and retests both.

Screenshots remain locally under `.scratch/tsm-device/`, named absent.png, both.png, tsm-only.png and helper-only.png. The absent screenshot shows Install TradeSkillMaster and Refresh auction data fitting side by side. The other states show Uninstall in that row. Screenshots contain the signed-in account heading and are not committed to the repository.

## Restoration and validation

Before mutating live follows, copied state.json and tsm-choices.json into `~/homebrew/data/wowdeck/test-backups/tsm-continuation-20261110/`. Copied both Forever folders into local ZIP archives there before removal. No credential file was inspected or overwritten. Normal Horde was the only live follow temporarily removed. Account RPC after restoration lists exactly Soulseeker Alliance, Soulseeker Horde, Pyrewood Village Alliance and Normal Horde, with signedIn status.

Restored original Forever addon folders from these archives, the original addon records, and the exact choice metadata. Reload refreshed unrelated updatedAt fields and latest-release metadata on What The Whisper. Restored all original addon records again after the last reload. Final disk comparison reports original_addon_records_exact=true and choices_exact=true. The running engine may refresh scan and latest-release fields again during normal operation. Selected installation is Forever. The temporary Forever .git marker is gone; Era's existing developer checkout remains. The tested build remains installed. No in-memory hooks were installed.

Compared 42,214 static files with the prior run's manifest, with zero mismatches. The verifier excluded 13,037 inventory entries containing transaction paths or generated AppData.lua and wowup_data_addon/data.lua. Generated data may advance during live synchronization. Original generated TSM files remain in the backups. Isolated runner temporary trees clean up after each case; its executable, fixtures, results and verification scripts remain under plugin data, apart from live installation trees.

`nix develop -c make lint typecheck test build` passed. The 26 standalone device scenarios passed again after tightening partial-object array assertions to require equal lengths. No network fixtures ran against the production account. `deck down` restored the original autoUpdate setting. GLOSSARY.md and untracked docs/adr/0010-pr-builds-on-pages.md remain untouched. No pushes or issue closures.


## Focus-fix continuation

DEVICE, 2026-11-10. Continued from 430a9a9 with local frontend fixes, deployed with `tools/deck-ui/deck up`. Manage now rebuilds its navigation group when switching between the list and confirmation and requests focus by follow identity after that render. Uninstall has its own destination focus identity. Both modal flows reopen the panel and release the browse hold through Steam's modal-close callback. No focus timers were added.

At the approved TsmAddon component seam, `nix develop -c bun test src/tsmDestination.test.tsx` went red before each fix. Manage failed because the active element remained the body instead of Cancel. Uninstall failed the same body-focus assertion after closing and remounting. The final nine tests pass, including repeated last/different follow selections, B and Cancel, delayed account loading and pending-operation remounts. These tests do not emulate Steam's navigation engine; the real controller checks below supply that evidence.

The live controller sequence selected the last Normal Horde follow, opened confirmation, checked Cancel focus, pressed B and measured the active navigation node's ancestors. Its containing row read `Normal · HordeEU · ForeverUnfollow`. Repeated with Cancel and obtained the same row. Moved up twice to Soulseeker Horde, confirmed Cancel focus, pressed B and measured `Soulseeker · HordeEU · Classic Era - HardcoreUnfollow`. The measurement used `DFL.getFocusNavController().GetActiveNavTree().m_lastFocusNode.m_element` and its containing DOM rows, rather than matching the repeated Unfollow label. Closing Manage settled on Manage.

For Uninstall, repeated real A to open, Cancel/A or B to dismiss, and `wait focus = Uninstall`. Right then focused Refresh auction data. Steam can briefly report Get Addons or no active tree during modal exit; the settled identity was Uninstall. Early intermediate builds failed this check and were corrected before recording PASS.

Manual Install used the real picker through homebrew/data/wowdeck/test-backups/tsm-continuation-20261110 and selected TradeSkillMaster_AppHelper.zip with A. The returning pane focused Install and displayed the archive identity and version v4.15. A on Install displayed `TradeSkillMaster installs this addon`, preserving signed-in ownership. This does not establish successful source-off file-picker installation.

No account follows were changed in this continuation. The final account RPC returned the original Soulseeker Alliance, Soulseeker Horde, Pyrewood Village Alliance and Normal Horde. Choices remained byte-identical to the original backup. All 42,214 static addon files matched, with the same 13,037 generated/transaction entries excluded. Original addon records were restored after reload refreshed scan metadata. The running engine later rewrote three updatedAt values and release metadata on one unrelated addon. A final restoration verified exact addon-record equality immediately after writing; normal engine refresh can advance those fields again. Forever remained selected. No temporary git marker, auth access, production-response substitution or system setting change was used. `deck down` restored autoUpdate, and the tested frontend remains installed.

The extra requested live cases remain incomplete. Positive cleanup and checked-toggle navigation were not executed. No safe ordinary-flow provenance setup was established in this continuation; that is a coverage gap, not an external blocker. Pending uninstall with QAM close/reopen and cross-installation result display were not executed. No real bounded account-service failure was established without replacing production responses or changing network settings, so Manage error/retry remains unverified. These rows retain PARTIAL. Successful source-off picker installation also remains a gap. Gameplay, paid live channels and Blizzard saves remain unavailable; authentication stays explicitly excluded. This continuation is not a full-PR test approval.

`nix develop -c make lint typecheck test build` passed for this continuation. No push or issue status change was made. Applied unslop to the new report prose, regression instructions and changelog line.


## Four-gap continuation at fe047cc

DEVICE, 2026-11-10. Deployed frontend and engine fe047cc with `deck up --engine`. Engine PID changed from 113900 to 114879. Used the real account and ordinary UI. No authentication changes or new follows. Applied the unslop checklist to this continuation and the regression-plan update.

The source-off Manual Install succeeded. Disabled only TradeSkillMaster through providers.setEnabled, opened Manual Install, then Browse…. In the real picker selected homebrew, data, wowdeck, test-backups, tsm-continuation-20261110 and TradeSkillMaster_AppHelper.zip. Each selection used the visible folder or archive label and controller A. The returning Install control showed version v4.15 and the archive name. A displayed "Updated TradeSkillMaster_AppHelper" and "It shows as a Local file install in My Addons and never checks for updates". addons.list confirmed provider File for the helper. Re-enabled the source afterwards.

The initial live cleanupPreview already returned Normal Horde / EU / Forever. destination reported owned=true and declined=false. The production eligibility filter requires current-account provenance, local evidence and no other-installation evidence. No refollow or metadata modification was needed. In Uninstall, the ordinary UI displayed Normal Horde / EU / Forever once the preview loaded. The checkbox started aria-checked=false. Up from Uninstall both reached the checkbox; A changed aria-checked to true. Down reached Uninstall both, Right reached Cancel, and A returned to Uninstall. Account count remained four. An earlier unchecked removal in this continuation was followed by the ordinary destination Install flow before this check.

For pending removal, paused only our engine PID 114879 for 35 seconds with SIGSTOP. A separate bounded SSH command installed an EXIT trap to send SIGCONT and resumed the process automatically. No response patch, filesystem corruption or system configuration change was used. Confirmed unchecked Uninstall both while the engine was paused, closed QAM, reopened it, selected TradeSkillMaster and pressed A. The destination displayed only TradeSkillMaster and its version footer, without Working or the action controls. After resume, RPC confirmed both addons removed and exactly four follows. Revisiting the destination showed Install TradeSkillMaster. This is a concrete reproduction for root review: pending state is hidden while remounted destination data is still loading. In src/components/TsmAddon.tsx, the action row is inside `const status = data && (...)`, although busy lives in the persistent installation state. This guard matches the observed missing Working control. It does not establish the expected pending-remount pass. No production code was changed. The installation-picker attempt matched Forever instead of Forever Beta, so it supplies no cross-installation isolation evidence. That portion remains unverified.

A real service-failure/retry UI could not be configured under the allowed boundary. TradeSkillMasterAuth accepts endpoint injection only in its constructor. backend/src/main.ts instantiates it with the production defaults, and exposes no TSM endpoint environment override or RPC configuration. main.py forwards to that engine. The standalone isolated runner injects localhost endpoints directly but is not connected to the ordinary UI bridge. Rendering it through that UI would require a new bridge or production endpoint hook. No production account responses, credentials, DNS, network or system settings were changed. TSM-192-3 therefore retains PARTIAL with isolated failure coverage only.

The four targeted gaps now have two completed live checks, one pending-remount finding with cross-installation coverage still missing, and one endpoint-configuration blocker. Positive preview and toggle are two criteria within the second completed check. No gameplay or desktop comparison was attempted. Authentication portions remain EXCLUDED.

Restored the original Forever folders from the existing helper and TSM archives, reloaded the plugin, then restored original addon records. Verification reported 42,214 static files checked with zero mismatches, 13,037 generated/transaction entries excluded, exact addon records and choice metadata, Forever selected and no temporary git marker. Final account read returned the original four follows; status remained signedIn and the source was enabled. No live follow mutations occurred in this continuation. `deck down` restored autoUpdate on. The tested build remains installed. Unrelated dirty GLOSSARY.md and the untracked ADR were left untouched.

`nix develop -c make lint typecheck test build` passed after these checks. Only the report and regression plan are included in the docs commit, with Refs #173 and Refs #191. No push or issue mutation was made. The run does not approve the full PR.


## Working-tree action-row follow-up

DEVICE, 2026-11-10. Local HEAD dca0923a0db118b7dd7372d898d1285be4db2b96 with the parent's uncommitted TsmAddon action-row fix and tests. `deck up` built and deployed the working tree. No production files were edited by the device tester. Read deck-test and applied unslop to this prose. No children, authentication actions, credential access, response substitution, process pauses or system changes.

Confirmed ordinary unchecked Uninstall both in Forever. The immediate settled focus was Working…. Closed QAM, reopened it and selected TradeSkillMaster. Removal had already completed; the panel displayed Install TradeSkillMaster and No auction data yet. Natural timing did not expose a pending remount. This does not prove Working appears before destination data loads and does not clear the earlier paused-engine finding.

Used the real installation dropdown. From Forever, Up twice focused Forever Beta; A selected it. Reopening QAM showed Forever Beta. Its destination displayed Install TradeSkillMaster, No auction data yet and No saved character evidence, with no Working or removal error. Returned through the dropdown with Down twice to Forever. Its destination again displayed Install TradeSkillMaster. Earlier text seeks matched Forever rather than Forever Beta; only the measured dropdown sequence supplies switching evidence. The unchecked removal produced no cleanup result, so result preservation and switching while busy remain unverified.

Uninstall Cancel/A and B each returned to Uninstall; Right reached Refresh auction data. Uninstall confirmation initially reported empty focus, so Cancel was selected explicitly. Manage's last row was measured through the SharedJSContext navigation node and ancestor text as Normal · Horde / EU · Forever. Confirmation started on Cancel. B and Cancel/A each returned to the same measured row. Closing Manage returned to Manage. No follow changed.

Restored Forever folders and choice metadata from tsm-continuation-20261110, reloaded the tested plugin, then restored all original addon records. Verification returned 42,214 static files checked, zero mismatches, 13,037 generated/transaction entries excluded, exact addon records and choices, Forever selected and no temporary git marker. Compared every file in both addon ZIPs too: all 762 TradeSkillMaster files matched; four of five helper files matched and live synchronization had advanced AppData.lua. Restored that generated file separately and immediately verified exact backup bytes. Normal synchronization can advance generated data and addon metadata again. Final account read returned exactly the original four follows and signedIn status. TradeSkillMaster source remained enabled. `deck down` restored autoUpdate on. The tested working-tree build remains installed.

TSM-195-6 remains PARTIAL for pending remount, switching while busy, result preservation and live failure presentation. The existing service-failure endpoint blocker remains. This follow-up does not approve the full PR. No commit, push or issue change was made; parent owns final checks and commit.


## Deterministic action-row verification

DEVICE, 2026-11-10. Local HEAD dca0923a0db118b7dd7372d898d1285be4db2b96 with the parent's uncommitted action-row fix and tests. `deck up --no-build` confirmed this build was already deployed. Used deck-test and reviewed this prose against unslop. No children, production edits, commits or pushes.

Prepared the ordinary Uninstall dialog in Forever before pausing. The preview listed Normal Horde / EU / Forever. Left the cleanup toggle at its unchecked default and focused Uninstall both. `system.getStatus` identified engine PID 117162. An isolated SSH connection with ControlMaster=no and ControlPath=none ran Python with a command-line assertion for wowdeck, SIGSTOP, a 35-second sleep and SIGCONT in finally. It printed ENGINE_STOPPED and ENGINE_RESUMED for that PID. A subsequent process read showed Sl, not stopped. No Steam, Decky or other process was paused.

Controller A confirmed removal while the engine was paused. The destination displayed Working… and Refresh auction data. Closed QAM, reopened it, selected TradeSkillMaster through the ordinary navigation control and pressed Enter. The panel again displayed Working… and Refresh auction data, with No auction data yet and the version footer. The engine was still paused. This verifies the action row remains visible across remount before destination RPC returns and clears the earlier missing-Working finding for this working tree.

Opened the real Forever dropdown, moved Up twice to the measured Forever Beta option and pressed A. The pane continued to show Forever and Working because installation selection also needed the paused engine. A second dropdown attempt likewise did not establish a selected Beta pane during the pause. After automatic resume, installations.list reported Beta selected, but the UI showed its startup retry screen. Retry navigation failed with DFL undefined. Reloading only our plugin recovered access. This is not a pass for busy-state isolation or returning to Forever while pending. No cleanup result existed; result preservation and removal-error presentation remain unverified. Account RPC after resume returned all four original follows. A completed-removal UI or both-absent file assertion was not captured before restoration, so this run does not claim that additional completion observation.

Restored original Forever folders and exact choice metadata using the prior backup script, reloaded only our plugin, selected Forever through RPC and restored all original addon records. Final verification checked 42,214 static files with zero mismatches, excluding the same 13,037 generated/transaction entries. Addon records and choice metadata matched exactly, Forever was selected and the temporary git marker was absent. Final account read returned Soulseeker Alliance, Soulseeker Horde, Pyrewood Village Alliance and Normal Horde; status remained signedIn. Generated data may advance during normal synchronization. `deck down` restored autoUpdate on. No authentication actions, account mutation, response substitution or system settings changes. The two original focus defects remain fixed as documented above. TSM-195-6 stays PARTIAL for the remaining criteria. Parent owns full checks and commit.
