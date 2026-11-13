# PR #211 installation preferences on the Deck, 12 November 2026

Deck pass for the "Installation preferences (#154)" section of
`docs/regression-test-plan.md`. Five claims passed or partly passed on the
first pass. Claim 3 failed there, and passed on the re-test after the fix
in `48853fd` (see "Re-test of claim 3" below). The third pass tested the
update notification, the part of claim 1 left open, and it passed (see
"Third pass: the update notification" below). All six claims have now
passed.

## Build

Branch `feat/154-installation-preferences` at `5abfa94`. The feature commit
is `416460c`. The engine changed, so the build went on with
`deck up --engine` (engine pid 144172→144969, later 146988 after a
restart). The installed `dist/index.js` has sha256 `7d071bc7…0f213`, the
same hash as the local build. The build is still installed, and
`deck down` turned Decky's autoUpdate back on.

Connection: `deck@10.10.1.39` (Wi-Fi), with the dedicated agent at
`/tmp/claude-1000/deck-agent.sock`. The Deck fell asleep once mid-run and
Wake-on-LAN brought it back.

## Installations and fixtures

The Deck has three detected installations: Forever (`5e80311f078e`,
active), Forever Beta (`351cab445486`) and Classic Era (`032c354a655f`), so
no fixture was needed for claims 1–4 and 6.

- Outdated addons for claims 1 and 6: rolled back with `addons.rollback`
  and unpaused. Prat 3.0 in Era (3.9.117→3.9.116), DBM-Core in Beta
  (12.1.21→12.1.20), Forever Loot Sparkles in Forever (v2.0.0→v1.3.1). Every
  one is back on its newer version, with automatic updates not paused.
- Install test for claim 2: DungeonJournal (CurseForge, folder
  `ForeverDungeonJournal`) installed into hidden Classic Era from Get
  Addons → Popular with X, then removed with `addons.remove`. The folder is
  gone.
- Claim 5 fixture: `~/Applications/World of Warcraft/_ptr_/` with an empty
  `WowT.exe` and `Interface/AddOns/`, detected as "Retail PTR"
  (`c93e9e42702e`). Removed from the list with `installations.remove`, and
  the directory was deleted.
- State left behind: all three installations have Auto updates on and Hide
  off. Forever is active, and the plugin setting `autoUpdate` is false, as
  it was before the run.

## Claims

| # | Claim | Result | Method |
| --- | --- | --- | --- |
| 1 | Auto updates off: the automatic check skips it; Rescan and My Addons refresh check it | passed (notification on the third pass) | RPC + UI |
| 2 | Hiding an inactive installation removes it from the My Addons and Get Addons pickers; Options lists it with an eye-slash and can select it; browsing and installing work | passed | UI |
| 3 | Hiding the active installation keeps its picker entry with an eye-slash; its menu offers only Unhide | failed at `5abfa94`, passed at `48853fd` | UI |
| 4 | A hidden installation's details show Auto updates off and disabled, with an explanation; unhiding restores the earlier setting | passed | UI |
| 5 | Auto updates and Hide survive a restart and a new detect; new installations start with Auto updates on and Hide off | passed | RPC + UI |
| 6 | Update all installations includes hidden and auto-off installations | passed | UI |

### 1. Auto updates off: passed

DEVICE 2026-11-12, RPC and UI. Era had Auto updates off, with Prat outdated;
Beta and Forever had Auto updates on, each with one outdated addon; the
plugin setting `autoUpdate` was true.

- Game-page summary: `addons.updateSummary {}` listed only Forever Beta (1)
  and Forever (1). Era was left out, although it had an update waiting.
- Automatic check: `addons.updateSummary {"refresh":true}`, the Steam
  page's background path. `lastAutoUpdate.updated` was
  `["DBM - Deadly Boss Mods (DBM-Core)","Forever Loot Sparkles"]`, and Prat
  stayed at 3.9.116. My Addons for Era then still showed
  "Prat 3.0 · 3.9.116 → 3.9.117".
- Which installations a check scans: Era and Beta both contain a
  `RaiderIO` folder without a toc, and each scan of that folder logs
  `[scanner] no toc found for addon folder: RaiderIO`. That line counts
  the scanned installations:
  - automatic check: 2 lines (Beta only);
  - manual check (`manual:true`): 4 lines (Beta and Era);
  - Rescan (`addons.refresh {installationId: Era}`): 3 lines;
  - My Addons "Check for updates" with Era selected, pressed in the UI:
    3 lines.
- The update notification was untested on this pass because the daily
  gate was not due. The third pass tested it, and it passed (below).

### 2. Hide an inactive installation: passed

DEVICE 2026-11-12, UI. Era was hidden and Forever active. The dropdown
items read from the menu modal:

- My Addons: `["Forever Beta","Forever"]`
- Get Addons: `["Forever Beta","Forever"]`
- Options: `["Forever Beta","Classic Era","Forever"]`, eye-slash on
  `Classic Era [Hidden installation]`

Picking Classic Era in Options made it active. Get Addons then showed
"Classic Era" and its Popular list loaded. X on DungeonJournal installed
it (row became "INSTALLED"; folder in `_classic_era_/Interface/AddOns`).

### 3. Hide the active installation: failed at `5abfa94` (re-test passed, below)

DEVICE 2026-11-12, UI. With Era active and hidden, the My Addons button
shows "Classic Era" with the eye-slash (`<title>Hidden installation`).
That part passed.

Pressing A on it opened the ordinary dropdown (Forever Beta, Classic Era,
Forever, Cancel) instead of a menu with only Unhide. A screenshot from the
run shows it. The fiber walk shows `InstallationSelect` hands its handler
to `DropdownItem` (the `showChoiceMenu("Installation", [unhide])` closure is
in its props).

Cause, from Steam's dropdown class on the Deck:

```js
ToggleMenu(){if(this.state.bOpened)this.HideMenu();else{if(this.props.onMenuWillOpen&&this.props.onMenuWillOpen(this.ShowMenu)==!1)return;this.ShowMenu()}}
```

Steam opens the ordinary menu unless `onMenuWillOpen` returns `false`.
The hidden-active handler returned `undefined`, so `ShowMenu()` ran anyway.
Commit `48853fd` makes the handler return `false`. The dropdown fake in
`src/installationSelect.test.tsx` now follows Steam's rule, so the test
fails if the ordinary menu opens. The same commit corrects the
`showWithoutClosing` comment in `src/browseSessionState.ts`, which said the
menu opens only when `showMenu` runs.

### 4. Hidden installation details: passed

DEVICE 2026-11-12, UI (Options → Y on Active installation; `role=checkbox`
state read from the modal).

- Hidden: Auto updates `aria-checked=false` with the disabled class. A
  on it changed nothing. Description: "Hidden installations never update
  automatically. Unhide this installation to change Auto updates."
- Auto updates off, then Hide on and off: Auto updates is off again and
  enabled again ("Never updates or checks automatically…");
  `installations.list` shows `autoUpdateEnabled:false`.
- Auto updates on, then Hide on and off: Auto updates is on again
  ("Updates automatically when 'Update automatically' is on…");
  `autoUpdateEnabled:true`.

### 5. Persistence and new installations: passed

DEVICE 2026-11-12, RPC and UI. Before the restart, Beta was hidden and Era
had Auto updates off.

- `deck up --engine --reload` restarted the engine (pid 144969→146988).
  `installations.list` still showed `autoUpdateEnabled [true,false,true]`
  and `hidden [true,false,false]`. The Options picker after the restart
  showed `Forever Beta [Hidden installation]`.
- `installations.detect` with the `_ptr_` fixture present found
  "Retail PTR" with `autoUpdateEnabled:true, hidden:false`. Beta stayed
  hidden and Era stayed off.

### 6. Update all installations: passed

DEVICE 2026-11-12, UI. Beta was hidden, Era had Auto updates off and was
active, and Forever was normal, each with one outdated addon. `autoUpdate`
was false. Menu on "Update all (1)" in My Addons showed "UPDATING ALL
INSTALLATIONS…", then the toast "Updated 3 addons". Afterwards Prat (Era)
was 3.9.117, DBM-Core (Beta) 12.1.21 and Forever Loot Sparkles v2.0.0.

## Re-test of claim 3 after the fix

Build: `feat/154-installation-preferences` at `48853fd` ("Installations:
open only Unhide for a hidden active installation", on top of `5abfa94`).
The change is frontend-only, so plain `deck up` deployed it (engine pid
146988→147440, backup `test-backups/2026-11-12-120544-997802`). The
installed `dist/index.js` and the local build both have sha256
`aa659377…211707aa`. The build is still installed, and `deck down` turned
Decky's autoUpdate back on.

Result: **passed**. DEVICE 2026-11-12, UI (A presses on a real pad; menu
items read from the modal).

- Setup: `installations.update {installationId: Forever, hidden: true}`
  with Forever active, then the panel closed and reopened.
- My Addons: the picker reads "Forever" with the eye-slash
  (`svg title` = `Hidden installation`). A opened one modal,
  `Installation`, with items `Unhide | Cancel`. The screenshot shows only
  that menu, with no installation list behind it. B closed it.
- Get Addons: the same entry, eye-slash and menu (`Unhide | Cancel`).
- Unhide, chosen from Get Addons: the modal closed, and
  `installations.list` showed `hidden [false,false,false]`. The picker
  lost the eye-slash.
- Regression, ordinary pickers: with Forever not hidden, A on the picker
  opened the ordinary list `Forever Beta | Classic Era | Forever | Cancel`
  in Get Addons and in My Addons. No eye-slash on either.
- State left behind: Forever Beta, Classic Era and Forever all have Auto
  updates on and Hide off; Forever is active.

## Third pass: the update notification

Build: the same as the re-test. `deck up` printed "the Deck already runs
this build". The installed `dist/index.js` has sha256 `aa659377…211707aa`,
the same as the local build at `48853fd`, and the engine
`bin/wowdeck-x86_64` has sha256 `dc13fc30…272ecaa4`. HEAD is `dca4ad6`,
which changes only docs. No deploy was needed and no backup was made by
`up`.

Result: **passed**. DEVICE 2026-11-12, UI (plugin reload, notification
captured with `toast-start`/`toast-read`), with RPC for setup and
read-back.

- Setup: the plugin setting `autoUpdate` was set to false, so the check
  counts updates instead of applying them. Classic Era got Auto updates
  off. Prat 3.0 (Era), DBM-Core (Beta) and Forever Loot Sparkles (Forever)
  were rolled back with `addons.rollback`, then unpaused.
  `addons.updateSummary {}` listed only Forever Beta (1) and Forever (1).
- Making the gate due: `state.json` was backed up to
  `test-backups/2026-11-12-toastgate/`, then `settings.lastUpdateCheckAt`
  was set from `1794428764192` to `null` over SSH. Then
  `loader/reload_plugin` restarted the plugin (engine pid 148262), and
  plugin load calls `notifications.checkUpdateToast`.
- Captured notification, the only one shown:
  `"4 addon updates available" / "In Forever Beta and Forever"`. Classic
  Era is not in it. Afterwards `lastUpdateCheckAt` was `1794490380497`
  (the gate ran), and `addons.updateSummary {}` showed Forever Beta 1 and
  Forever 3, which makes 4. Forever had two upstream updates besides the
  rollback, which the check found.
- Era still had its update waiting after the check: Prat 3.0 at `3.9.116`,
  `updateAvailable:true`, `autoUpdatePaused:false`.
- Restored: Prat 3.0 3.9.117, DBM-Core 12.1.21 and Forever Loot Sparkles
  v2.0.0 with `addons.update`, Classic Era Auto updates back on, and
  `autoUpdate` back to true, its value before this pass. All three
  installations have Auto updates on and Hide off, and Forever is active.
  Forever's two other upstream updates were left pending. This pass did
  not cause them, and with `autoUpdate` on, the next daily check applies
  them.
  `deck down` had nothing to restore.

## Tool notes

- `rpc … --pick=<missing key>` crashes `deck.mjs`
  (`TypeError … reading 'length'` in `clip`, `deck.mjs:91`), and the run
  stops. It should print `undefined` instead.
- A run with a single `rpc … --full` step prints bare JSON without the
  `rpc … →` prefix. A run with several steps prints the prefix. Scripts
  that parse the output need both forms.
- The Deck slept during a pause of about two minutes between calls. `up`
  woke it with Wake-on-LAN.
- `deck run` strips double quotes from bare JSON arguments
  (`rpc params are not JSON: {settings:{autoUpdate:false}}`). Single-quote
  the JSON inside the run string.
- `rpc … --full` output for a large `addons.list` (Classic Era) ends at
  65,536 characters, which breaks JSON parsing. `--pick` with `--full`
  stays under the limit.
- No step makes the daily update-notification gate due. This pass edited
  `state.json` over SSH and reloaded the plugin.
