# Controller-layout feasibility on the owner's Deck

Device observations, 17 November 2026. These experiments establish a local
application and recovery path. They do not establish native playtime credit,
gameplay compatibility or durable recovery across Steam restarts and cloud
sync.

## Build and method

Target was the owner's Steam Deck on its attached display. Wake-on-LAN and
bounded SSH probes reached both configured addresses. No plugin build was
deployed. The documentation branch was `docs/controller-layout-design`,
based on `8a3b202`, with no engine changes.

Steam reported the `steamdeck_stable` channel. Its installed Ubuntu manifest
version was `1792618285`. SHA-256 of its installed `steamui/sp.js` was
`4b818cd371388e06c66fe8c0bb592b7dfd4a6fb55eb56844d1b360b64aec3046`.
This differs from the extracted source snapshot used in the earlier research.

The installed plugin identified itself as `1.2.2-pr.258.5`. Its hashes were:

| File | SHA-256 |
| --- | --- |
| `dist/index.js` | `aa3d5615636ce36a1d752ba1c04402af5d6bca31e5d17df93e625705575a6633` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `b60c6b8b86b0c71f7b05eeaffeee48f0b08b700aff1efe9e385fff14bfc3a11e` |

Methods were CEF Runtime evaluation of Steam's native interfaces, DOM
measurement, keyboard navigation and the native F3 Apply Layout action.
File reads and hashes ran through SSH. These were automated observations,
not a human playtest or a physical-controller input test inside WoW.

## Fixtures and scope

The connected Steam Deck controller had index 15. Temporary shortcuts used
`/usr/bin/true` or `/usr/bin/false` as inert targets. Neither was launched.
Two synthetic VDFs derived from Steam's installed gamepad template differed
in the A-button output. Fixture A mapped A to A; fixture B mapped A to B.
These were data files and were never executed.

The owner supplied Kinzo's VDF and later its share link:
`steam://controllerconfig/pcbattlenet/3810861852`. Public Steam metadata
resolved that item to the exact supplied CDN URL. Its title was
`Kinzo WoW Forever`, its source controller declaration was
`controller_triton`, and its VDF revision field was 61. The file was 21,040
bytes, with SHA-256
`97cd0c87e6a2cd607519f9d3b2ad9ca0bb61255126e0647b01b7a67b81ed41d5`.
Its SHA-1 matched the digest in the CDN URL. That observation identifies this
snapshot; the published item itself remains mutable.

The real WoW shortcut was never selected for a different layout. Its selected
URL and origin stayed unchanged. Its active VDF SHA-256 stayed
`edd78023870bdabcea17b951c4b91048cf4370e68680845e628913400282072d`.

## Results

Each entry below is a DEVICE observation and names its method.

| Result | Claim and method | Evidence |
| --- | --- | --- |
| passed | Native preview, selection, export and selection-change interfaces exist on this client. Runtime inventory only. | Installed bridge method inventory; subsequent calls below. |
| passed | The native browser uses 8 px row padding, 6 px bottom margin, 2 px corner radius and 16 px/20 px title typography. DOM measurement on the attached display. | [Geometry](evidence/native-geometry.json). The measured row was about 564 CSS px wide. |
| failed | `file://` and an absolute `template://` URL load the supplied external VDF. Native preview returned a default layout instead. | The expected synthetic title and mappings were absent. A resolved call did not imply a successful import. |
| partial | An external `autosave://` VDF previews correctly. Applying that URL did not apply the previewed mappings. Native calls. | Synthetic preview loaded, but selection fell back to default mappings. This is not the delivery route to use. |
| passed | An exact snapshot staged as a separate file in the disposable game's controller-config directory can preview and apply through `usercloud://`. Native calls and decoded mapping comparison. | [Both fixtures](evidence/usercloud-import-result.json). Preview did not select either layout; all decoded sets and modes matched after application. |
| passed | Steam's own preview screen can apply the staged layout. UI with keyboard F3, then native readback. | [UI result](evidence/native-ui-apply.json). Selected `WoWDeck test A`; preview cleared. This was a UI test, not just a direct apply call. |
| passed | A local-only native export preserves a synthetic personal edit and restores it after replacement. Native export type 1, selection and decoded mapping comparison. | [Recovery](evidence/restore-export-result.json). The export used a `usercloud://` URL despite being local-only. |
| passed | Clearing temporary explicit overrides restores inherited default mappings. Native calls and decoded mapping comparison. | [Default recovery](evidence/clear-selection-result.json). Both mapping content and default selection were checked. |
| failed | A nonexistent layout is safely rejected by the native API. Native calls. | [Missing-file experiment](evidence/failure-result.json). Preview reported no load failure, and applying selected the missing URL with default mappings. The saved recovery snapshot restored the customized mapping. |
| passed | Personal edits to an imported snapshot preserve the staged approved file. Native edit/save and file hashes. | [Hashes](evidence/post-edit-hashes.jsonl). Editing created an autosave with the staged layout as progenitor; both approved files remained unchanged. |
| failed | Different non-Steam app IDs guarantee isolated controller selections. Native calls on two identically named disposable shortcuts. | [Collision](evidence/collision-result.json). Selecting a template for one also changed the other. |
| passed | A published item can apply to a differently named shortcut while retaining its published-file ID. Native calls using an already cached layout. | [ConsolePort WoW](evidence/cross-name-published-result.json), item 1730342178. No gameplay or time report was performed. |
| passed | Kinzo's published item can apply to a differently named disposable shortcut while retaining item 3810861852. Native download, preview, selection and decoded mapping comparison. | [Kinzo](evidence/kinzo-cross-name-result.json). The native path also matched its previewed mappings. |
| partial | A native local export of the unmodified published Kinzo layout preserves its mappings. Native local-only export and decoded comparison. | [Published-to-local export](evidence/published-export-result.json) preserved mappings, but changed the selection to a local `usercloud://` URL with reported ID 14 and empty progenitor. Original Steam item identity was not preserved by that operation. |
| partial | Native conversion can load this candidate on the Deck. Native preview and selection. | [Archived candidate](evidence/candidate-result.json) loaded two sets and 25 modes. This does not prove preservation of every Triton-specific feature or actual gameplay behavior. |
| passed | A public server can resolve a known published controller item without a player's login or an API key in this tested request. Read-only HTTP POST. | [Endpoint observation](evidence/public-endpoint-result.json) and [Kinzo metadata](evidence/kinzo-published-metadata.json). |
| passed | The WoW shortcut's native query returns community records. Native read-only queries. | Two bounded queries each returned a subset containing 50 Workshop records plus personal layouts and templates. This is not an exhaustive catalogue. |
| partial | Vote and playtime fields are accessible through Steam's client stores. Native metadata reads. | The inspected item had zero-valued fields; the WoW query records also exposed zero playtime. This does not establish reporting eligibility, units or freshness. |
| pending | Ordinary play through a differently named shortcut contributes to the original item's total. | No actual game session was run. Retaining an item ID is necessary evidence, not proof of credit. |
| pending | Personal edits stop contribution, and offline time is reported without loss or duplication. | No controlled playtime experiment was performed. |
| pending | Restore survives Steam restart, account changes and cloud conflicts. | These operations were excluded from the local passes. |
| pending | The candidate works with the player's WoW setup and all intended controllers. | No in-game or physical-controller test. Only one candidate was supplied. |

Mapping comparisons used the decoded controller type, action sets and modes,
not only the selected title or URL. They exclude metadata identity and do
not measure physical output, haptics or game interpretation.

## Interface behavior that affects implementation

The selection-change callback reported app ID 0 with controller index 15.
Treat it as an invalidation signal and read the intended target back. Do not
require the callback to echo the target app ID before recognizing a change.

`RegisterForControllerConfigInfoMessages` returned no disposable registration
handle in this experiment. Its built-in handler was restored. Do not assume
all Register functions support the same subscription pattern.

`SteamClient.Apps.ShowControllerConfigurator` opened a separate configurator
window. It did not navigate the main window as expected. That test-owned
window continued to affect the shared editing store until explicitly closed
with `CloseDesktopConfigurator`. For a main-window preview, use and verify
the intended window instance. Never assume a route change alone restored the
editing context.

Native local exports, staged snapshots and mutable published items have
different identities. A tiny local selection ID reported for a staged file
must not be treated as the original published item. Preserve approved content
identity separately from the Steam item ID and active selection URL.

The identical-name result is a real scope constraint. A target picker that
lists one app ID cannot promise that only that entry's controls change.
Detect or establish the shared selection scope before applying. Do not
silently rename a player's shortcuts to manufacture isolation.

## Candidate requirements

The Kinzo file contains gamepad outputs, mouse buttons and keyboard bindings,
including B, C, L, M, P, Space and Left Control. The file alone does not prove
which in-game bindings or addons it expects. ConsolePort was present in the
active Forever installation, but that does not establish a dependency.
No conclusion was drawn from the absence of a GamePadEnable entry in its
Config.wtf.

## State left on the Deck

The experiment removed all disposable shortcuts, synthetic layouts, the
local export, plugin-data fixtures and the empty test namespaces. It removed
its temporary callbacks and diagnostic globals, closed its standalone
configurator window, and restored the original main-window route and editing
app. It closed its own SSH tunnels and left existing SSH sessions alone. It
made no deployment, Steam restart, Workshop publication, subscription, vote,
manual time report or cloud-conflict choice.

Steam downloaded Kinzo through its normal Workshop mechanism. Its cache grew
from 347 to 348 items. The downloaded layout remains in Steam's
managed cache. The experiment did not edit or delete shared cache files.
The real WoW selection, origin and active VDF hash remained unchanged.

The [final observation](evidence/final-observation.json) confirms the original
editing app, original route, zero remaining test shortcuts, zero standalone
configurator windows and no pending or unsaved edits. The
[final filesystem observation](evidence/final-observation-filesystem.json)
confirms the unchanged WoW VDF hash and removed experiment namespaces.

## Next evidence

The next playtime experiment must observe ordinary use of a known published
layout through the intended WoW launch path. It needs a meaningful baseline,
bounded observation windows and a way to distinguish this player's
contribution from other players and delayed statistics. Do not call an
internal duration-reporting message to manufacture a positive result.

The first release can still omit unverified metrics as agreed. Published-item
nominations simplify intake, but do not resolve whether to deliver a frozen
approved snapshot or follow the mutable source item's latest content.

## Follow-up check, 17 November 2026

A later pass on the same branch, with no code change, deployed a build of
`8a3b202` (reported as `1.2.1`). This replaced a `1.2.2-pr.270.2` build that
was on the Deck at the start. The plugin loaded, the engine answered with
protocol 1, and the panel reported no alerts or errors.

| Result | Claim and method | Evidence |
| --- | --- | --- |
| passed | The real WoW layout file is unchanged. Method: SSH SHA-256. | A file under `Steam Controller Configs/54679723/` still hashes to `edd78023…2072d`. |
| passed | No disposable shortcuts remain. Method: SSH read of `shortcuts.vdf`. | No WoWDeck or test entries were found. |
| passed | Steam's choose-layout screen has no refresh control. Method: UI route navigation and a DOM read on the Recommended tab. | Visible controls were Load new Layout, Recommended, Templates, Community Layouts and Search. None was labelled refresh, reload or update. The main window then returned to library home. |

The owner also found no refresh button on WoWDeck's Controller layouts
destination once its catalogue had loaded. #272 tracks adding one.

## Playtime investigation for #263, 17 November 2026

The owner requested SSH investigation of native playtime attribution. This
pass inspected the installed client, running process maps, existing
controller logs and runtime method names. It did not launch a game, change
controller selections, edit bindings or send duration reports.

The plugin checkout was `docs/controller-layout-design` at `8a3b202`, with
no engine changes. Test setup deployed only its frontend and reloaded the
existing engine, which reported `1.2.1`, protocol 1. The previous installed
frontend was restored from the test backup and the plugin reloaded at the
end. Both restored-file and backup SHA-256 values were
`0ef5638259666ae7a686203d1c05c42e56e7f6ba9cd9e6fcf7d53bd808c25cc1`.
No fixture installation was needed. The run closed its own tunnel on ports
18081 and 9223 and left the existing SSH tunnel untouched.

| Result | Claim and method | Evidence |
| --- | --- | --- |
| passed | The running Steam process loads the inspected SteamRT64 library. DEVICE, SSH process maps and SHA-256. | Process 2124 loaded `steamrt64/steamclient.so`, SHA-256 `dab8df0daa27ffa6594ef5d6bc8cf707f37990220628f1f249fb30f4d88ade91`. The stable manifest version was `1792618285`. |
| passed | A native implementation constructs controller playtime reports. DEVICE, SSH binary copy and local disassembly. | The loaded library references `PublishedFile.SetPlaytimeForControllerConfigs#1` at virtual address `0x1262549`. The installed `steamui/sp.js` defines an app ID and repeated published-file IDs with floating-point active seconds. These observations establish client machinery, not backend acceptance. |
| passed | The inspected upload loop excludes IDs 0 through 15 and nonpositive durations. DEVICE, disassembly. | At `0x12621db`, an unsigned comparison excludes IDs at or below 15. The next comparison requires positive activity. At `0x1262654` and `0x1262658`, the code stores the remaining ID and duration into a report entry. The previously tested local export returned ID 14, so that ID would fail this filter. This does not establish whether another upstream record retains the original ID. |
| partial | The native client has controller activity accounting and has started playtime tracking for a non-Steam app. DEVICE, binary references and existing controller log. | The loaded library references `CSteamController::UpdateControllerActivityWindows` and `CUser::UpdateSteamControllerPlaytimeStats`. `controller.txt` line 18971 records `Successfuly started tracking playtime` for app `-1465590757` on 16 November at 22:22:36. The log does not identify the resulting credited published layout or prove this event used the controller-specific upload path. |
| passed | No game was running at the runtime observation. DEVICE, CEF read of app-store running flags. | The running-app list was empty. No gameplay, credit propagation or edit eligibility experiment ran. |
| pending | An ordinary WoW session credits the source published layout while preserving an approved revision. | Requires passive observation of a genuine session and its selected identity. Repeat with a personal edit and the approved local-copy delivery path. Establish upstream identity selection before concluding that the ID filter excludes all possible source attribution. |
| pending | Offline, suspend, retry and server aggregation behavior preserve correct totals. | No corresponding sessions or server-credit controls ran. |

Raw source extracts, binary hashes and disassembly are retained locally in
`.scratch/controller-playtime-263/`. The inspected `linux64/steamclient.so`
is a different library from the loaded `steamrt64/steamclient.so`; conclusions
above use the loaded library's addresses and hash. No internal usage getter,
manual report, counter mutation or ancestry modification was invoked.

### Activity record follow-up

Static analysis of the same archived SteamRT64 library traced the ID back
one step from the report. The activity routine calls an ID lookup at
`0x126a27c`. If it returns an ID from 1 through 15, the branch at
`0x126a2a5` skips a later lookup and keeps that ID. When this path creates
a usage record, it passes the ID at `0x126a12d`. The record writer stores
it at `0x12192b0`. The reporter reads that field as the grouping key at
`0x1261e78` before applying its range check.

If the native activity lookup returns the local selection's observed ID 14,
this path carries 14 to the report filter. A live observation still needs
to establish which ID the activity lookup returns for each selection and
whether the service credits an eligible report.

The next experiment needs genuine WoW play with a known published layout and
passive observation of the native accounting boundary. A successful upload
alone would still need a controlled follow-up of server totals. Source
identity, approved revision identity and the observed credited identity must
remain separate in the evidence.
