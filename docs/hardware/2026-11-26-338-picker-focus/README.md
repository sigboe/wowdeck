# Installation picker focus and the hidden-active picker (#338)

## Build and fixture

The brief named no target, so the run used the default, the owner's Steam
Deck (Wi-Fi `10.10.1.39`, handheld). WoW wasn't running. The build was the
worktree `fix/321-removed-installations` at `a500ee5` plus the uncommitted
changes to `InstallationService.ts`, `InstallationSelect.tsx` and their tests,
deployed with `deck up --engine` (frontend and engine). Local build hashes,
SHA-256:

- `dist/index.js` `090c8282620f127ab7f533081da5928e17cba28e208a6d96aa9e0627fb19344f`
- `backend/out/wowdeck-x86_64` `b5f54051ef2dd6366315dc4c824470cbe216daafc38fb105dc1ae312e702d562`

`deck up` reported `deployed index.js engine … reloaded 1.3.0, engine pid
91631→93331`. Backup: `~/homebrew/data/wowdeck/test-backups/2026-11-26-222502-1840732`.

Installations, before and after (identical):

| Installation | Hidden | Active |
| --- | --- | --- |
| Forever Beta | yes | |
| Classic Era | no | |
| Forever | no | yes |

No addons were installed or removed. "Remove this installation" wasn't used.
The tested build stays installed; `deck down` restored autoUpdate.

## Rerunning the focus loop

`where.js` prints one `WHERE` line for the focused element in the active
navigation document: `PICKER` (an ancestor fiber is `InstallationSelect`),
`TAB` (a `.wowdeck-tab`) or `OTHER`, with its label, role, readable classes and
the Get Addons layout (`collapsed`, `widened`, or `no-get-addons-zone` on My
Addons). `focus-batch.txt` holds the batch. Each section prints the focus
before A (must be `PICKER`) and after the menu closes. "Pick the entry above,
then back" assumes the active installation is the second visible entry
(Forever under Classic Era), as on this Deck. From the worktree root, after
`tools/deck-ui/deck up`:

```sh
tools/deck-ui/deck run "$(tr '\n' ' ' < docs/hardware/2026-11-26-338-picker-focus/focus-batch.txt)" \
  | grep -E '^(eval|rpc|FAIL|at:)' | sed 's/^\(eval\|rpc\) [^→]*→ //'
```

## Results

### Part A: where focus goes after the picker's menu closes

DEVICE 2026-11-26, UI (real pad presses through `deck run`, focus read by
`where.js`).

| Picker | View | Close by | Focus after | Result |
| --- | --- | --- | --- | --- |
| Get Addons | collapsed | B | GET ADDONS tab | failed |
| Get Addons | widened | B | picker, still widened | passed |
| Get Addons | collapsed | pick Classic Era | GET ADDONS tab | failed |
| Get Addons | collapsed | pick Forever (back) | GET ADDONS tab | failed |
| Get Addons | widened | pick Classic Era | GET ADDONS tab, QAM collapsed (5 of 6 runs; once the picker, collapsed) | failed |
| Get Addons | widened | pick Forever (back) | picker, QAM collapsed (5 of 6 runs; once the tab) | failed |
| My Addons | n/a | B | picker | passed |
| My Addons | n/a | pick Classic Era, then Forever | picker both times | passed |

The collapsed Get Addons picker loses focus to the tab on every close. The
widened one keeps it on B. A pick in the widened view always collapses the
QAM, and focus then depends on direction: Forever → Classic Era lands on the
tab in 5 of 6 runs, Classic Era → Forever on the picker in 5 of 6. Adding a 400 ms
gap between moving to the entry and pressing A changed nothing (2 runs each).
`GetAddonsTab.tsx` restores focus to the Installation row only when
`enterBrowseSession()` resumes `"list"`, which happens while widened, and a
pick seems to end the widened session.

Evidence (first full batch run):

```text
== 1 Get Addons, collapsed: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE TAB label="GET ADDONS" role=button class=wowdeck-tab.wowdeck-tab-selected.Panel.gpfocus view=collapsed
== 2 Get Addons, widened: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
== 3 Get Addons, collapsed: pick the entry above, then back ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE TAB label="GET ADDONS" role=button class=wowdeck-tab.wowdeck-tab-selected.Panel.gpfocus view=collapsed
WHERE TAB label="GET ADDONS" role=button class=wowdeck-tab.wowdeck-tab-selected.Panel.gpfocus view=collapsed
== 4 Get Addons, widened: pick the entry above, then back ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
WHERE TAB label="GET ADDONS" role=button class=wowdeck-tab.wowdeck-tab-selected.Panel.gpfocus view=collapsed
WHERE TAB label="GET ADDONS" role=button class=wowdeck-tab.wowdeck-tab-selected.Panel.gpfocus view=collapsed
== 5 My Addons: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
== 6 My Addons: pick the entry above, then back ==
WHERE PICKER label="Classic Era" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
```

The tab-focus results repeat with the active installation hidden: picking
Unhide or Classic Era in the collapsed Get Addons picker also left focus on
the GET ADDONS tab, while My Addons kept it on the picker.

### Part B: the picker with the active installation hidden

DEVICE 2026-11-26, UI (Options › Y on Active installation › Hide, then the
pickers), state read by RPC `installations.list` and the menu's options by
`options.js`.

| Claim | Result |
| --- | --- |
| My Addons opens the normal list, the active entry with an eye-slash, Unhide last | passed |
| Get Addons (collapsed and widened) opens the same list | passed |
| Picking "Unhide Forever" unhides it; the next open has no Unhide entry (My Addons) | passed |
| The same from Get Addons | passed |
| Picking another installation switches to it (Get Addons, My Addons) | passed |
| Every Hide setting and the active installation restored | passed |

Menu options, all three pickers, with Forever active and hidden:

```text
OPTIONS ["Classic Era","Forever [Hidden installation] *focus*","Unhide Forever"]
```

After picking Unhide (both pickers): `hidden` went `[true,false,true]` →
`[true,false,false]`, and the next open showed `["Classic Era","Forever *focus*"]`.
Picking Classic Era: `selected` went `[false,false,true]` → `[false,true,false]`
on both pickers; Forever stayed hidden. Options' picker showed every
installation: `["Forever Beta [Hidden installation]","Classic Era *focus*","Forever [Hidden installation]"]`.

Screenshots: `B1-myaddons-hidden-active.png`,
`B2-getaddons-collapsed-hidden-active.png`,
`B3-getaddons-widened-hidden-active.png`, `B4-myaddons-after-unhide.png`,
`B5-getaddons-after-unhide.png`.

The engine's new fallback (`ensureSelection` prefers an installation that
isn't hidden) wasn't exercised: it needs a stale or missing selection, which
only Remove produces here, and the brief excluded Remove. Pending; the unit
test `backend/tests/hidden-selection.test.ts` covers it.

## Other finding: Options crashes when opened before the engine connects

DEVICE 2026-11-26, UI. The first QAM open right after `deck up` showed
Decky's error screen for WoWDeck: `Error: The engine isn't connected yet` from
`AboutSection` (Options was the remembered tab). `engine.rpc()` in
`src/engineLink.ts` throws synchronously through `connected()`, so
`AboutSection`'s `.catch()` never sees it and the throw escapes the effect.
Clicking Retry recovered. It predates this change (`engineLink.ts` last
changed in `417ffaf`).

## Fix rerun

### Build

The same worktree and branch, with one more uncommitted frontend change on
top of the first run's build: Get Addons' Installation picker marks its menu
open through `showInstallationMenu`, so the remount after the menu closes puts
focus back on the picker. The engine didn't change, so the run used
`deck up` without `--engine`. WoW wasn't running beforehand (`pgrep` matched
only WoWDeck's `main.py` and engine). Local build hashes, SHA-256:

- `dist/index.js` `7229e4b46c5d6a4f5b0466d69323998f79085dfd353f91ea4c85793be6c1a4eb`
- `backend/out/wowdeck-x86_64` `b5f54051ef2dd6366315dc4c824470cbe216daafc38fb105dc1ae312e702d562` (the same as the first run)

`deck up` reported `deployed index.js … reloaded 1.3.0, engine pid
93331→94799`. Backup: `~/homebrew/data/wowdeck/test-backups/2026-11-26-224109-1843923`.

Installations were as the first run left them, and so they stayed: Forever
Beta hidden, Classic Era and Forever shown, Forever active (RPC
`installations.list`: `hidden` `[true,false,false]`, `selected`
`[false,false,true]` before and after). No addons were installed or removed,
and Remove wasn't used. The tested build stays installed; `deck down`
restored autoUpdate.

### The focus loop, three runs

DEVICE 2026-11-26, UI (`focus-batch.txt` run three times, unchanged; focus
read by `where.js`). Counts are runs where focus landed on the picker after
the menu closed.

| Picker | View | Close by | Run 1 | Run 2 | Run 3 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Get Addons | collapsed | B | picker | picker | picker | passed (3/3) |
| Get Addons | widened | B | picker, widened | picker, widened | picker, widened | passed (3/3) |
| Get Addons | collapsed | pick Classic Era, then Forever | picker both times | picker both times | picker both times | passed (6/6) |
| Get Addons | widened | pick Classic Era, then Forever | picker both times, QAM collapsed | picker both times, QAM collapsed | picker both times, QAM collapsed | passed (6/6) |
| My Addons | n/a | B | picker | picker | picker | passed (3/3) |
| My Addons | n/a | pick Classic Era, then Forever | picker both times | picker both times | picker both times | passed (6/6) |

Every Get Addons case now returns focus to the picker; in the first run
(Part A) only the widened B and most widened picks back to Forever did. My
Addons is unchanged. A pick
in the widened view still collapses the QAM, as before; focus now stays on
the picker there. The three runs printed identical output:

```text
== 1 Get Addons, collapsed: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
== 2 Get Addons, widened: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
== 3 Get Addons, collapsed: pick the entry above, then back ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Classic Era" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
== 4 Get Addons, widened: pick the entry above, then back ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=widened
WHERE PICKER label="Classic Era" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
== 5 My Addons: A then B ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
== 6 My Addons: pick the entry above, then back ==
WHERE PICKER label="Classic Era" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
[false,false,true]
```

### Down after a collapsed B, and leaving with R1

DEVICE 2026-11-26, UI, two runs each, both identical.

| Claim | Observed | Result |
| --- | --- | --- |
| Down after a collapsed-B return goes to the first destination row | Focus moved from the picker to Search, the first destination, and the QAM widened | passed (2/2) |
| R1 then L1 keeps the landing rules, starting from the Search row | R1: Options, focus on its Installation picker. L1: Get Addons collapsed, focus on the picker | passed (2/2) |
| The same, starting from the picker after a collapsed B | The same: Options' picker, then Get Addons collapsed on the picker | passed (2/2) |

Tabs confirmed with `probe tab`: Get Addons → R1 → Options → L1 → Get
Addons. Re-entry lands collapsed with focus on the picker, as did every
`lb lb rb` entry in the first run.

```text
== collapsed B, then Down ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE OTHER label="Search" role=button class=Panel.gpfocus view=widened
== R1 to Options, L1 back (from the row) ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
== collapsed B, then R1, L1 (from the picker) ==
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=no-get-addons-zone
WHERE PICKER label="Forever" role=combobox class=DialogButton.gpfocus view=collapsed
```

`docs/ui/focus.md`'s Get Addons row still says collapsed focus sits "on the
plugin-tab nav bar". On the device, entry lands on the Installation picker,
in this run and the first. That row may need updating with the fix.

The engine's non-hidden fallback in `ensureSelection` is still pending, for
the reason given under Part B.
