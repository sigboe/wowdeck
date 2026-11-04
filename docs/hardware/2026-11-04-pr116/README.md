# PR 116 hardware test, 4 November 2026

The current result is the third pass below. It supersedes all earlier remaining-work
lists and human checklists in this report. Historical records describe what was
known at each pass, not outstanding instructions.

## Current human checklist

Only these checks require the owner or additional hardware:

- Assess physical controller and touch feel, glyphs, scrolling and back behavior.
- Rehearse filming and launch the intended WoW clients to check addon loading,
  retained settings, graphics configuration and in-game notifications.
- Test TV geometry, external controllers and physical removable storage only if
  those arrangements are part of the release claim. No phone coverage was requested.

No software test is assigned to a human merely because an operation finishes quickly.
Clipboard paste delivery remains unverified as described in the third pass.
This report does not approve a stable release.

## Historical first-pass record

AI operated the owner's x86_64 Steam Deck over SSH and CEF using
`tools/deck-ui/deck`. This is a partial release regression run, not release
approval. The second pass found and fixed a pre-existing backup-import picker
bug. No introduced product regression was confirmed. Several failure paths
still need testing. The first-pass record below is retained unchanged except
for headings that identify it as historical.

The tested code is `98cbebc84a6b9b60ad37222a8e4890559a7d5591` on
`feat/architecture-and-recovery`, compared with `origin/next`. The diff has
96 files and covers specs #87, #88, #89, #90 and #115. It includes archive
checks, transaction records and recovery, shared settings-backup state,
shared catalogue installs, installation selectors, feedback wording and QAM
popup restoration. The report commit changes documentation only.

The engine reports version 1.0.1, so that version alone does not identify
this build. [Matching local and installed hashes](evidence/hashes.log) identify it:

| Artifact | SHA-256 |
|---|---|
| Frontend | `b7537fa94f7834c45876936fc5178a551dd0bb187a374b1231b23c31d3f641b1` |
| Patched x86_64 engine | `8d6896b6318b6636ab1409f7dee8ac3276cf495aeb846034ab1114b05f882717` |
| Python bridge | `1e9c2450c105c91864d84344614b81087a836dd55469097bd60ab50d5f3250be` |

## Method and coverage

Every completed row below is DEVICE evidence dated 2026-11-04 for the exact
build above. UI means real rendered Steam/Decky controls driven by the
runner's virtual controller, with CEF focus probes and screenshots. Search
text was entered through the native input setter, then submitted with Enter.
RPC means the installed engine binary ran on the Deck against disposable
folders and separate state. RPC results do not establish UI behavior.

The 40 cases below have 30 passes, two partial results and eight not run.
These are report case counts, not a claim that all regression-plan rows or
all spec scenarios passed. Core mutation tests used fixtures; no game was
launched and no owner addon was intentionally installed, updated or removed.

| Case | Changed area or journey | Method and observed result | Result |
|---|---|---|---|
| 1 | Engine and frontend deployment | `deck up --engine`, engine smoke test, atomic binary replacement, reload, matching hashes | Pass |
| 2 | QAM shell | My Addons, Get Addons and Options opened through L1/R1 navigation | Pass |
| 3 | #115 nested folders | Picker navigated homebrew/data/wowdeck/hardware-116/nested; folders were navigable, archive filter showed zip, rar, 7z | Pass |
| 4 | #115 selection | A selected valid.zip, returned to Browse and showed inline Hardware 116 preview plus Install; selection did not install | Pass |
| 5 | #115 cancellation | Five Browse/A/B round trips returned to Browse with full visible pane and no cancellation error | Pass |
| 6 | #115 inspection failure | invalid.zip returned to full pane, inline no-addon error and enabled Browse | Pass |
| 7 | #115 non-file popup | Installed catalogue Details opened twice, B returned to same result and full width | Pass |
| 8 | #115 collapsed popup | Installation picker opened while collapsed; B returned to collapsed nav bar without widening | Pass |
| 9 | #115 deliberate QAM close | Close/open after repeated picker returns landed collapsed on Get Addons nav bar | Pass |
| 10 | #115 deliberate tab exit | Leaving Get Addons for Options/My Addons and returning landed collapsed | Pass |
| 11 | #87 structural validation | RPC accepted mixed-case direct TOC and empty TOC; rejected missing TOC and nested-only TOC archives | Pass |
| 12 | Addon install and replacement | RPC File install wrote version 1, repeat install wrote version 2 in isolated installation | Pass |
| 13 | Invalid install preservation | RPC invalid archive failed and existing fixture Lua bytes stayed unchanged | Pass |
| 14 | Rollback exchange | RPC adopted an unmanaged fixture, kept original bytes, rolled back to original and exchanged back to version 2 | Pass |
| 15 | Transactional removal | RPC removal emptied fixture list; subsequent recovery status was ready | Pass |
| 16 | Required dependencies | Real UI installed DBM Cataclysm r264 with required DBM-Core 12.1.19 in fixture installation | Pass |
| 17 | Removal follow-ups | RPC removing DBM Cataclysm returned successful DBM-Core autoremove; list retained only Xius | Pass |
| 18 | Recovery protection | Restarted isolated engine returned unverified list and refused refresh and installation removal with recovery_required | Pass |
| 19 | Retry conflict detection | RPC Retry refused edited Lua bytes with unchanged TOC and preserved the edit | Pass |
| 20 | Retry success | Restoring expected bytes allowed RPC Retry; live fixture and transaction work directory were removed as expected for interrupted new install | Pass |
| 21 | Verify refusal and success | RPC Verify refused unrepaired layout; after manual restoration to original arrangement it verified and cleared block | Pass |
| 22 | Unreadable state | Isolated truncated JSON containing addonTransactions reported global unreadable state; settings call left damaged bytes untouched | Pass |
| 23 | Shared recovery notice | Live UI marker for disposable installation showed notice on all three tabs | Pass |
| 24 | Recovery details and actions | Live UI Verify showed differences; Retry completed, focused Close and cleared recovery status | Pass |
| 25 | Backup creation | Options Back up now created a fixture backup; Manage backups displayed Backup created | Pass |
| 26 | Backup feedback across views | Closing/reopening Manage backups retained success feedback and the same backup row in probes | Pass |
| 27 | Backup restore and delete | Isolated RPC restored Config.wtf bytes, listed pre-restore safety backup and deleted the manual backup | Pass |
| 28 | Engine restart | Terminating only plugin engine changed PID 39916 to 40448; live backup dialog and subsequent catalogue install remained usable | Pass |
| 29 | Find WoW regression | Options Find WoW action completed; original three installation IDs remained after fixture removal | Pass |
| 30 | Cleanup and owner state | Original selection, custom backup folder, retention and autoUpdate restored; no markers or fixture installation remained | Pass |
| 31 | #90 pending installs | Real Xius install completed and Details showed Installed on both opens, but completed before pending controls could be observed | Partial |
| 32 | #88 cached-list error/Retry | Engine restarted and cached backup UI remained usable; no error/Retry state established. Overlapping later UI navigation also invalidated the wait attempt | Partial |
| 33 | #88 busy guards and unknown outcomes | Tiny fixture backup finished before pending/cancel controls could be observed; no response-loss injection | Not run |
| 34 | #88 settings copy/import lifecycle | Copy-source RPC returned empty for isolated single-flavor state; cross-version copy/import, invalidation and notice isolation not exercised | Not run |
| 35 | Transaction failure stages | No injected live rename/write/cleanup failure, unavailable root, symlink conflict or full-disk test; prepared interrupted-state fixtures cover recovery only | Not run |
| 36 | Bulk and partial results | No multi-addon update failure, partial import, multi-installation bulk failure or real provider update to newer release | Not run |
| 37 | Empty setup and archive variants | Did not clear owner setup; no live generic/client-specific TOC ordering, read failure, provider-filtered bundle, RAR or 7z test | Not run |
| 38 | Other hardware | No phone test requested; no external controller or separate 1080p TV geometry tested | Not run |
| 39 | Physical and in-game checks | No human controller-feel assessment, filming rehearsal, WoW launch, addon execution or in-game notification check | Not run |
| 40 | Removable storage and remaining regression plan | No SD removal, card absence, long-list/100-addon stress, clipboard/export round trip or file-manager journey | Not run |

## Evidence

[Engine archive/install evidence](evidence/engine.log),
[rollback and settings restore evidence](evidence/more.log), and
[recovery evidence](evidence/recovery.log) retain method, parameters and answers.
The recovery fixture describes an interrupted new install with one stage-to-live
move, original live location absent, content digests and actual Deck device/inode
identities. It is a prepared restart state, not a reproduced transaction crash.
The initial fixture omitted the required empty backup directory and was refused;
that fixture error was corrected before the recorded recovery run.

[UI round trips](evidence/07-roundtrips.log),
[inspection error and bounds](evidence/08-error.log),
[backup and catalogue UI](evidence/13-ui.log),
[Details returns](evidence/14-catalogue.log),
[collapsed picker](evidence/15-collapsed.log),
[recovery notices](evidence/16-recovery-ui.log), and
[recovery actions](evidence/17-recovery-actions.log) distinguish actual UI
operation from engine checks. The compact `items` probe omits some row text;
screenshots establish visible content where probes do not list it.

The CEF QuickAccess viewport measured 854 by 454 CSS pixels. The collapsed
root measured 300 pixels wide at x=48. After inspection failure the root was
806 pixels wide and the content pane was 506 pixels wide at x=348, extending
to the viewport's right edge. Screenshots compare actual rendered edges;
this run does not establish every Steam remount event order or TV layout.

- [Manual pane before picker](evidence/03-manual.png), [nested folder](evidence/07-nested.png), [selected archive preview](evidence/08-preview.png).
- [After five cancellations](evidence/10-five-cancels.png), [fresh collapsed entry](evidence/11-fresh.png), [inspection failure](evidence/13-inspect-error.png).
- [Collapsed installation picker](evidence/23-collapsed-picker.png) and [return](evidence/24-collapsed-return.png).
- [Backup dialog](evidence/15-backups.png) and [reopened feedback](evidence/16-backups-reopen.png).
- [Installed Details](evidence/18-details-install.png) and [restored browse pane](evidence/20-details-return.png).
- Recovery notices in [My Addons](evidence/25-recovery-myaddons.png), [Get Addons](evidence/26-recovery-getaddons.png), and [Options](evidence/27-recovery-options.png).
- [Recovery details](evidence/28-recovery-details.png), [Verify differences](evidence/29-verify-refused.png), and [Retry completed](evidence/30-recovered.png).

## Second pass, 4 November 2026

The combined matrix now has **33 passes, five partial results and two not run**.
Cases 1–30 retain their first-pass results. The table below replaces the status
of cases 31–40. These counts describe these 40 cases only, not complete stable
release qualification.

The second pass began at documentation head `7295208`, with unchanged code
`98cbebc84a6b9b60ad37222a8e4890559a7d5591`. Pending installs, backup boundary
fixtures, cross-version copy and transaction-driver checks used that code.
The backup-picker fix is `5132712e2b1a52abe4e1498673cba5eb1f59be30`.
Nested backup imports, notice isolation, export and empty-setup UI checks used
that build. [Installed hashes](evidence/pass2/hashes.log) match the local
frontend `9b75e21620310b5e4e153963e3d2d29c7852eca8776062660a231139cbe4b409`.
The engine and bridge hashes remain those in the first table.

All observations here are DEVICE, dated 2026-11-04. UI is rendered Steam/Decky
with synthetic controller input. RPC runs the installed engine binary with
separate state. Injected UI means a temporary wrapper around DeckyBackend.call
that matches only WoWDeck RPC routes. Other plugins and Steam calls pass
through. Driver means a separate executable compiled from project modules,
using the existing FaultInjectingFs and a fake provider. It is not the installed
JSONL engine and supplies no end-to-end UI evidence.

| Case | Second-pass observation | Combined result |
|---|---|---|
| 31 | Held addons.install before forwarding. Repeated X in Details, return to results, reopen Details and X again produced one install request. Selector showed Wait for addon installs to finish. Releasing the real RPC installed Auctionator only into the fixture; Details then showed Installed. | Pass |
| 32 | Injected wtf.list failure retained the cached backup row and showed Retry. Clearing the fault and pressing Retry removed the error and retained the list. | Pass |
| 33 | Held start disabled Back up now. Injected timeout showed unknown-result text and held reconciliation; releasing a real list allowed a real backup. Synthetic running-job/cancel checks survived modal reopen and sent one cancel despite repeat Enter. Separate installed-engine RPC emitted cancelled completion and left no new backup. Full cross-installation/settings guards remain incomplete. | Partial |
| 34 | Real UI copied Classic Era current settings to fixture Retail, added a safety backup and retained success across reopen. RPC confirmed copied saved-variable bytes and preserved Retail Config.wtf. Nested WowUp ZIP import and other-version import showed the correct already-present notices. Notice stayed with initiating Retail and did not appear in Classic Era. Logs show refreshed lists/copy sources. | Pass |
| 35 | Device driver injected folder.backup, folder.install, state.write and state.replace failures, preserving live bytes and reopened records and allowing retry. cleanup.remove retained version 2 with a warning. Installed engine separately refused a symlink conflict and preserved its target sentinel. These are not installed-engine rename/write/cleanup fault tests. | Partial |
| 36 | Device driver updated two installations with a one-shot folder.install failure. Results were failed, updated. No installed-engine/UI partial import or real-provider newer-release update. | Partial |
| 37 | Installed engine accepted RAR5 and 7z, rejected symlink 7z, chose Mainline over generic TOC, sorted Alpha before Zeta and rejected a directory named .toc. Separate engine started with no installations. Read-only empty-list UI fixture showed Find WoW and Open Options without clearing owner setup. Provider-filtered bundle and TOC read failure remain untested on device. | Partial |
| 38 | Phone, external controller and TV geometry remain outside this pass. | Not run |
| 39 | Physical controller feel, filming and in-game execution remain human checks. | Not run |
| 40 | Real UI generated a one-addon export and invoked Copy. Paste command and native Ctrl+V left the import field empty, so clipboard round trip is unverified. No removable-storage, long-list stress or file-manager journey. | Partial |

### Evidence and fixture limits

[Pending RPC trace](evidence/pass2/09-pending.log),
[pending Details](evidence/pass2/pending-details.png), and
[real completion](evidence/pass2/10-release-backups.log) establish case 31.
The held call had not reached the engine. Duplicate suppression is a UI
observation, not an engine concurrency test.

[Start guard](evidence/pass2/11-backup-starting.log),
[unknown outcome](evidence/pass2/12-unknown.log),
[cancel trace](evidence/pass2/14-cancel-repeat.log), and
[cached error/Retry](evidence/pass2/17-error-retry-copy.log) record the injected
backup paths. Disabled controls caused expected failed seeks. The synthetic
job used non-contract kind backup and phase archiving, so its fallback Working
label does not establish correct real progress wording. Its cancel acknowledgment
was synthetic. [Actual engine cancellation](evidence/pass2/cancel-rpc.log)
separately records kind create, phase scan and error code cancelled.
The unknown-start fixture returned a timeout without sending a mutation, then
held the fresh list. It tests frontend ambiguity handling, not real response loss.

[UI copy](evidence/pass2/20-copy-done.log),
[byte comparison](evidence/pass2/copy-rpc.log),
[nested import](evidence/pass2/26-import-fixed.log),
[import notice](evidence/pass2/27-import-notice.log), and
[other-version notice and isolation](evidence/pass2/41-other-import.log)
record case 34. Selecting a ZIP immediately completes the picker. The following
attempt to select a nonexistent Select button is a runner error, not a failed
import. The first RPC copy attempt used classic_era rather than _classic_era_
and was refused; the corrected call is the byte-verified result.

[Archive and symlink RPC](evidence/pass2/engine.log),
[TOC variants](evidence/pass2/toc.log), and
[empty setup](evidence/pass2/44-empty-ui.log) cover case 37.
The empty UI fixture replaces only installation/addon list reads; the installed
engine's truly empty state was checked separately. No owner setup was erased.

[Transaction driver output](evidence/pass2/transactions.log) and
[driver source](evidence/pass2/transactions.ts.txt) cover five failure stages
and the partial bulk result. The source was generated from the fixture in
backend/tests/addon-transaction.test.ts, saved at .scratch/pass2/transactions.ts,
compiled with bun build --compile, and patched for the Deck interpreter.
FIXTURE_ROOT constrained every temporary directory to the plugin test root.
Its finally block removed its directories. This driver used real Deck filesystem
operations with named injected EIO errors, not disk exhaustion or permission changes.

[Export](evidence/pass2/31-export-code.log),
[copy invocation](evidence/pass2/32-clipboard.log), and
[native paste attempt](evidence/pass2/40-paste-native.log) record the clipboard
limit. The field was enabled and writable in Steam Big Picture Mode. Neither
paste method transferred the 224-character source. This does not distinguish a
copy failure from CEF clipboard/focus behavior, so no clipboard pass is claimed.

### Bug found and fixed

Before the fix, Import from file showed ZIPs in /home/deck but no folders.
It could not reach a backup below homebrew/data/wowdeck. The call supplied
includeFolders=false and allowAllFiles=true. origin/next has the same arguments,
so this is pre-existing. The fix enables folder navigation and keeps ZIP-only
selection. Addon-list Load from file has the same old argument pattern; it was
identified by inspection and remains a separate follow-up, not a tested fix.

The rendered-modal regression test invokes the actual import callback. It
[failed on folder visibility](evidence/pass2/picker-red.log) before the fix and
[passed](evidence/pass2/picker-green.log) afterward. Hardware then navigated
homebrew/data/wowdeck/hardware-116-pass2 and selected the WowUp ZIP.
[Full checks](evidence/pass2/checks.log) passed before the fix commit, including
856 frontend/tool tests, 1331 backend tests, Python suites, lint, type checking
and builds. The [final pre-commit run](evidence/pass2/final-checks.log) passed
the same checks. Four backend tests skipped in both runs. No other product
bug was confirmed.

### Historical remaining work after the second pass

These software gaps belong to AI follow-up, not a handoff to humans because
operations are fast:

- Extend the valid job fixture to hold create, restore, import, delete and settings
  writes across installation switches and stale confirmations. The early synthetic
  cancel fixture did not model a valid progress payload. Real cancellation is now
  established independently; its complete UI completion journey still needs capture.
- The installed binary has no named-fault control. Use a separately instrumented
  JSONL build wired to FaultInjectingFs in isolated data to drive the full installed
  UI through rename, record-write and cleanup failures. The driver here verifies
  service behavior on the Deck but does not cover bridge wiring or rendered bulk results.
- Extend the fake-provider driver to partial import and provider-filtered bundle
  cases, and add the existing Bun.file TOC-read fixture. A real provider update
  needs two selected releases installed only into disposable state.
- Diagnose clipboard with a plugin-scoped copy boundary observation and verified
  host-window focus, without reading unrelated clipboard/account data. Inspect
  FileManager1 availability first and use only a fixture addon if opening Dolphin.
  File-manager and long-list tests were not attempted. Hot removal of the owner's
  active SD card is not an unattended fixture test; use a disposable unavailable
  directory for software behavior and reserve physical removal for a coordinated check.

Humans still need physical controller/touch feel and glyphs, the filming rehearsal,
and WoW client launches to verify loading, retained settings and in-game notifications.
TV/controller/storage arrangements need checks if release claims include them.
No phone test was requested. These results alone do not approve stable release.

### Second-pass cleanup

The first up found the existing tested build. Prior owner-state backups from the
first pass remained available; subsequent reloads made fresh runner backups.
UI backup/copy initially used the owner's configured SD backup root. This exceeded
the intended fixture-only location. Three new fixture backup files were identified
by their returned names, removed through wtf.delete, and checked absent. Further
backup work used the plugin fixture folder. No owner backup was deleted.
[Scope correction](evidence/pass2/23-backup-scope.log) and
[remaining backup removal](evidence/pass2/24-backup-clean.log) retain the commands.

[Cleanup RPC](evidence/pass2/45-cleanup-rpc.log),
[state comparison](evidence/pass2/48-cleanup-state.log), and
[final probe](evidence/pass2/49-final.log) establish original installation IDs,
selection, backup folder, retention and autoUpdate restored, original addon IDs
retained, zero recovery markers, no fixture root and no boundary hooks.
[deck down](evidence/pass2/47-down.log) restored autoUpdate to true after the final
reload. The QAM is closed. The fixed tested build remains installed. Only bounded,
isolated SSH connections were used; existing masters were untouched. This is not
a byte-for-byte audit of owner addon files. No Steam or Decky settings were changed.

## First-pass findings and release blockers

No completed case demonstrates an introduced or pre-existing product bug.
Failed runner seeks were corrected as test-operation errors. A same-release
File reinstall kept no rollback copy and Roll back refused it; a separate
adoption test exercised successful retention and rollback exchange. A backup
folder settings request for a nonexistent fixture folder was correctly refused;
creating the fixture directory allowed it. Neither refusal is a product defect.

Two attempted pending-install checks failed to capture the intended interval.
One search seek matched another result/input and opened the keyboard; it does
not establish duplicate suppression or a disabled installation selector. The
DBM module and dependency eventually installed, but their pending UI was not
captured. These limitations must not become hardware-pass claims.

The untested cases above block calling this a complete stable-release hardware
qualification. Existing deterministic checks provide evidence for many of them,
but are not a replacement for the remaining device journeys. No new source
code was needed. The previously green code checks were not rerun for this
documentation-only change.

The following first-pass checklist is superseded by the current human checklist above.
It is retained as history, not a request for humans to repeat software tests:

1. Use the Deck's own controls to assess focus, scrolling, glyphs, back behavior
   and touch through the tested popup journeys. Synthetic input can change the
   displayed controller glyphs, so these screenshots do not certify them.
2. Launch each intended WoW client and verify addon loading, retained settings,
   graphics configuration and in-game notifications. Rehearse the filming path.
3. Complete pending-install duplicate/switch guards and backup pending,
   cancellation, error/Retry and unknown-result journeys. A controlled delay or
   fault fixture is needed to make the short intervals observable.
4. Complete cross-version settings copy/import, real newer-release update,
   partial bulk failure and the remaining release regression rows. Have a
   verified settings backup before using real data.
5. Check the target TV/controller/storage arrangements if the video or release
   promises them. Phone coverage is outside this request.

## First-pass cleanup

[Cleanup RPC evidence](evidence/cleanup.log),
[state comparison](evidence/cleanup-state.log), and
[final status](evidence/final.log) record restoration. The original addon IDs
were retained, installation IDs matched the initial snapshot, and selection,
backup folder, retention and autoUpdate matched. This comparison does not
claim a full byte-for-byte audit of the owner's addon files.

The fixture root under `~/homebrew/data/wowdeck/hardware-116/` was deleted,
including its archives, fake clients, isolated state and backup copies.
Production markers were resolved through Retry, not force-cleared. The runner
backups remain under `~/homebrew/data/wowdeck/test-backups/`, beginning with
`2026-11-04-170719-931492`. `deck down` restored autoUpdate to true; a final
reload cleared the fixture UI session and a second down restored the guard
again. No persistent UI hooks were installed. The tested build remains
installed and the QAM was closed. Existing SSH masters were left untouched.

## Third pass, 4 November 2026

This pass began at `799701c`. The picker fix is `56c9650` and the import-result
fix is `95091aee1d27196147fefd59383ad2b42212bf25`. Backend product code remains
unchanged from `5132712`. The combined 40-case matrix is now **37 pass, one
partial and two not run**, using the method limits below. Cases 38 and 39
remain not run. Earlier passed cases were not repeated except for deployment,
cleanup and checks needed to verify these fixes.

| Case | Completed software coverage | Current result |
|---|---|---|
| 33 | DEVICE driver held create, restore, import, delete and settings writes. Eleven competing actions across two installation IDs sent no extra RPC, including stale restore/delete callbacks, settings writes and copy. Valid create/compress and restore/extract snapshots held the guard until completion. Rendered UI showed real create cancellation and retained cancelled feedback. A held UI create for C survived an actual selector change to B; B refused another create and release sent exactly one create for C. Valid injected progress rendered Backing up 10% and Restoring 20%. | Pass with mixed driver, UI and injected evidence |
| 35 | A separate instrumented JSONL engine ran behind the real Python bridge with isolated state. FaultInjectingFs injected folder.backup, folder.install, state.write, state.replace and cleanup.remove. Failed transactions retained version 1 bytes and records; cleanup failure retained version 2 with a warning. Rendered import drove install and record-write faults, and the fixed build retained record-write failure details and cleanup warnings after refresh. | Pass for named injected failures, not physical disk exhaustion |
| 36 | Isolated real GitHub provider installed Clicked 1.18.1, refreshed against 1.18.2, updated and retained previousVersion 1.18.1. A two-entry import through the instrumented bridge returned failed/installed; only Zeta reached disk. The fixed UI retained both results after automatic preview. Earlier two-installation driver coverage still applies. | Pass with pinned provider and injected import evidence |
| 37 | The instrumented engine failed Bun.file text reads only for Zeta/Zeta.toc. Preview returned an error and install completed with fallback metadata. A fake provider named only Zeta from an Alpha/Zeta bundle; the engine installed Zeta and left Alpha absent. Earlier empty-setup and archive-variant coverage still applies. | Pass with injected TOC and provider-fixture evidence |
| 40 | Real UI rendered 150 unmanaged addons and reached Stress 149's menu. Renaming an existing configured fixture backup root made wtf.list return dirAvailable=false, the UI show the unavailable-folder message and the attempted job leave that root absent. A private D-Bus FileManager1 fixture received exactly the two expected Clicked fixture URIs. The copy-boundary probe saw the entire 208-character export selected and native execCommand return true. | Partial: clipboard paste round trip remains unverified; no physical storage removal |

### Evidence and limits

All device observations are DEVICE on 2026-11-04. UI means rendered Steam/Decky
controls with synthetic input. RPC means a call through the real Decky/Python
bridge. Injected JSONL means the production composition root compiled separately
with test filesystem and provider wiring. Driver means project modules compiled
into a separate executable with deferred typed RPC. Driver results do not prove
that every rendered confirmation combination was driven. This pass does not establish every combination of rendered controls and confirmations.

[Guard driver](evidence/pass3/guards.log), [source](evidence/pass3/guards.ts.txt),
[held start](evidence/pass3/guards-start-ui3.log),
[cross-installation refusal](evidence/pass3/guards-cross-ui.log), and
[request trace and release](evidence/pass3/guards-clean.log) record case 33.
The failed seek in the cross-installation log is the expected refusal to focus
the disabled backup control. The trace identifies the actual switch to B and
only one create sent for C. [Valid restore progress](evidence/pass3/job-restore-ui.log)
and [actual cancellation](evidence/pass3/real-cancel.log) replace the invalid
second-pass progress wording evidence. The valid create hook's first read had
not yet arrived when Back up now was pressed; that real backup was confined
to the fixture root. It is not evidence of a suppressed duplicate request.

[Transaction bridge results](evidence/pass3/faults.log),
[rendered fault attempts](evidence/pass3/fault-ui.log),
[TOC and file-manager availability](evidence/pass3/toc-filemanager.log),
[partial import](evidence/pass3/partial2.log), and
[pinned GitHub update](evidence/pass3/provider.log) retain the answers.
The pinning adapter filters real release-list responses to GitHub release IDs
401702072 and 412596157. Metadata and archive downloads use the real provider
and network; this is not evidence that users can select historical releases.
The provider bundle fixture copies a real local archive and restricts its planned
folder list. It does not contact WowUp Hub.

[Instrumented entry](evidence/pass3/engine.ts.txt) and
[wrapper](evidence/pass3/wrapper-bus.txt) document the test-only wiring. The
entry was copied from backend/src/main.ts and compiled with Bun's baseline
Linux target, then patched to SteamOS's interpreter. Local imports in the
saved source name this checkout; adjust that prefix when reproducing elsewhere.
Faults are armed by a one-shot file inside isolated engine data. No fault API,
fixture provider or test switch was added to production code. The production
binary was saved before replacement. The wrapper set HOME and WOWDECK_DATA_DIR
to fixture paths. Before the first engine mutation, isolated state already
contained the explicit plugin fixture backup root. All backup writes in this
pass stayed there. No owner SD backup cleanup was needed.

[Stress UI](evidence/pass3/stress-ui.log),
[unavailable-root RPC](evidence/pass3/unavailable-rpc2.log),
[unavailable-root UI](evidence/pass3/unavailable-ui2.log), and
[file-manager fixture](evidence/pass3/filemanager-rpc2.log) cover case 40.
The private bus and Python service were kept alive through one bounded SSH
session after detached startup failed. The service accepted only fixture URIs.
It established protocol routing, not a visible Dolphin window. No running file
manager was available on the owner's session, and none was launched.

[Copy diagnosis](evidence/pass3/copy2.log) instruments only WoWDeck's offscreen,
read-only textarea copy operation. It records selection and the native return
value, never reads the clipboard, and removes its hook. Prior native Ctrl+V and
execCommand paste attempts left the plugin import field empty. The remaining
technical boundary is paste delivery in Steam's CEF session: successful selection
and a true copy result do not establish that a later paste receives the export.
No product clipboard defect or round-trip pass is claimed. Physical card removal,
external hardware and game execution were excluded by the brief.

### Bugs fixed and retested

The addon-list picker had the same pre-existing argument bug as backup import.
It hid folders and allowed all file types. The rendered test
[failed before](evidence/pass3/picker-red.log) and
[passed after](evidence/pass3/picker-green.log) the fix. Device UI then
[navigated Nested](evidence/pass3/picker-nested.log), hid hidden.zip and
[loaded list.txt](evidence/pass3/picker-selected.log). The old test's global
window pollution is fixed by restoring its original property descriptor.
The client-render tests also unmount and restore document and React's act flag.

The injected UI import exposed a second pre-existing bug. runImport set its
results, then automatic re-preview immediately cleared them. The regression
[failed](evidence/pass3/results-red.log) on missing failure text and
[passed](evidence/pass3/results-green.log) after automatic refresh preserved
results. Loading another file still clears the old results. On the Deck,
[Alpha's failed record write and Zeta's successful install](evidence/pass3/results-ui.log)
remained visible together; a later successful Alpha install
[retained its cleanup warning](evidence/pass3/cleanup-ui-fixed.log).

[Full checks](evidence/pass3/checks3.log) passed before the second code commit:
lint, type checking, 858 frontend/tool tests, 1331 backend tests, Python suites
and both builds. Four backend archive-tool tests skipped. Full checks also
passed before the first code commit. No merge, release or watch was requested.

### Tested build and cleanup

[Hashes](evidence/pass3/hashes.log) identify the final production build:

| Artifact | Installed SHA-256 |
|---|---|
| Frontend from 95091ae | `7d2bcad157d97270baff03157f2747f45d878197fbbb8b3e3f7d951bd9d15e29` |
| Production x86_64 engine | `8d6896b6318b6636ab1409f7dee8ac3276cf495aeb846034ab1114b05f882717` |
| Python bridge | `1e9c2450c105c91864d84344614b81087a836dd55469097bd60ab50d5f3250be` |

The hashes file also identifies all three instrumented engine builds and the
guard driver. Backend production code was unchanged throughout this pass.

[Production redeployment](evidence/pass3/production-deploy.log) replaced the
wrapper with the normal binary. [Production retest](evidence/pass3/production-retest.log)
opened My Addons with the original Forever selection. The owner state was
[exactly unchanged before restoration](evidence/pass3/pre-clean.log).
Startup was guarded against automatic addon updates during restoration.
[Final comparison](evidence/pass3/final-owner.log) confirms original settings,
installation records and addon records apart from refreshed scan timestamps.
No addon IDs or versions changed. This is not a byte-for-byte owner file audit.
The original autoUpdate value is restored to true.

[Cleanup](evidence/pass3/cleanup.log) removed the disposable clients, archives,
backups, state and fault executables. The private bus and service stopped.
[Final probe](evidence/pass3/final-probe.log) found no boundary hooks or fixture
backup root, and production had zero recovery markers.
[deck down](evidence/pass3/down.log) ran after production restoration and again
at the end. The QAM is closed. Runner snapshots remain under test-backups,
including 2026-11-04-180054-975761. Existing SSH masters were untouched.
