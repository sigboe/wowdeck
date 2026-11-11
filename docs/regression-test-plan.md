# Regression test plan

## Contents

- [1. How to use this plan](#1-how-to-use-this-plan)
  - [Test data you need](#test-data-you-need)
- [2. Automated gates (T1–T3, no device)](#2-automated-gates-t1t3-no-device)
  - [2b. Guideline audit (device, read-only, no human needed)](#2b-guideline-audit-device-read-only-no-human-needed)
- [3. Install and engine (T6)](#3-install-and-engine-t6)
- [4. UI regression (the rework, T6)](#4-ui-regression-the-rework-t6)
  - [4.1 QAM shell and tabs](#41-qam-shell-and-tabs)
  - [4.2 My Addons](#42-my-addons)
  - [4.3 Get Addons (widened QAM tab)](#43-get-addons-widened-qam-tab)
  - [4.4 Details modal](#44-details-modal)
  - [4.5 Options](#45-options)
  - [4.5b Steam library (BEYOND-05)](#45b-steam-library-beyond-05)
  - [4.5c WoWDeck update notice (the plugin's own update check)](#45c-wowdeck-update-notice-the-plugins-own-update-check)
  - [4.6 WTF backup (folds in WF-01 `deck_verification`)](#46-wtf-backup-folds-in-wf-01-deck_verification)
- [5. In-game and notifications](#5-in-game-and-notifications)
- [6. Robustness (the pre-release list)](#6-robustness-the-pre-release-list)
- [7. Known risks to look at first](#7-known-risks-to-look-at-first)
- [8. Result record](#8-result-record)

The plan for checking a build before it is called good. It covers the whole
plugin, not only the latest change. Written 2026-10-15 after the Steam-native UI
rework (`dd81038`, `7e66f0d`), which changed nearly every screen and has **not
yet been run on a Deck**.

Latest partial hardware run: [PR #116, 4 November 2026](hardware/2026-11-04-pr116/README.md).
It records 30 passed cases, two partial results and eight cases not run.
The remaining checks still apply.

Related documents:

- `docs/UI_DEVELOPMENT_BEST_PRACTICES.md` §8: test tiers (T1–T6), the rule that
  an agent may not claim hardware verification (§8.3), and the report template
  (§8.5). §8.6 is the short UI checklist; this plan contains it and goes wider.
- `docs/steam-deck.md`: SSH access, packaging with patchelf, and the original
  pre-release list (folded into section 6 here).
- `docs/wtf-backup.md`: how WTF backup and restore are meant to behave.

## 1. How to use this plan

| Run | When | What | Time |
|---|---|---|---|
| **Gate** | Every commit | Section 2 (automated) | ~3 min |
| **Smoke** | Every deploy to the Deck | Section 2 + every case marked **S** | ~15 min |
| **Full** | Before a release, and the first time after a large UI change (now) | Every case | ~2 h |

- Cases are written for a controller first. "A, B, X, Y, L1, R1, Menu" are the
  Deck's buttons; "touch" means the touchscreen.
- Priority: **P0** = data loss, crash or a dead plugin; **P1** = a main task
  can't be done; **P2** = looks wrong or is awkward.
- Record results with the template in section 8. If a case fails, write down
  what you saw and keep going; don't stop the run for a P2.
- Deploys, input and changes on the Deck follow `AGENTS.md` ("The owner's
  Steam Deck"): a test request approves them within the WoW installation and
  our plugin.

### Test data you need

- At least one WoW installation with **10+ addons**, including:
  - one with an update waiting. To get one, install an addon and then
    edit its version in the `.toc`, or keep an old copy around;
  - one unmanaged folder (copied in by hand, not known to any provider);
  - one addon that is a git checkout (a folder with `.git`);
  - one addon with a required dependency (for example an Ace3 user).
- For the installation picker: a second installation (a second flavor
  such as `_classic_`, or a manual path).
- For the long-list tests: about 100 addons in one installation. A copied
  AddOns folder is fine.
- A WTF folder with real data. Back it up by hand first (`cp -a WTF
  WTF.manual`) before any restore test.
- An SD card containing a WoW installation or a backup folder.
- Optional: a desktop WowUp install for the round-trip cases.

## 2. Automated gates (T1–T3, no device)

Run inside `nix develop` (or through `make`):

| ID | Command | Pass |
|---|---|---|
| G-1 | `pnpm run lint && pnpm run typecheck && pnpm run format:check` | no output errors |
| G-2 | `pnpm test` | all pass (309 at `8ee6b5b`); the script runs every `src/**/*.test.ts` (`bun test ./src`; `make test` runs G-2, the G-4 tests and G-5 together) |
| G-3 | `pnpm run build` | `dist/index.js` built |
| G-4 | `cd backend && bun run typecheck && bun test && bun run build` | all pass |
| G-5 | `python3 tools/test_package.py && python3 tools/test_main_bridge.py` | all tests OK |
| G-6 | `python3 tools/package.py` | one zip, `build/WoWDeck.zip`, and no `build/wowdeck/` left (unless `--keep-stage`); the packager's ELF check passes for both engines (`bin/wowdeck-x86_64`: x86-64, interpreter `/lib64/ld-linux-x86-64.so.2`; `bin/wowdeck-aarch64`: AArch64, interpreter `/lib/ld-linux-aarch64.so.1`); no `bin/wowdeck`. Note the sha256 |
| G-7 | `unzip -l "build/WoWDeck.zip"` | no `curseForgeAPIKey-dontcommit`, no `.env`, no source maps with secrets |

A failing gate blocks the deploy. The gates prove the code builds and the
logic tests pass. They don't prove anything about layout, focus or the device
(§8.2 of the guide).

### 2b. Guideline audit (device, read-only, no human needed)

Run recipe R8 of the UI guide (`tools/deck-ui/audit-view.mjs` and
`audit-focus.js` with `walk.mjs`) on every view: My Addons, Get Addons tab,
Options, each page tab, Details, Manage backups, Restore, Import, Export. Pass:
no INSET, TOUCH (other than Steam's classic rows), SMALL_TEXT or CLIPPED issue.
First run (2026-10-15) found: the My Addons installation picker (content touching
its highlight), the Game version value overflowing, sub-12 px text in Details,
the status tag and the glyph fallback; all fixed in the next build.

## 3. Install and engine (T6)

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| E-1 | P0 | S | Install the zip through Decky (or copy it and reload Decky). Open the QAM → WoWDeck | The plugin opens on My Addons; no "Engine is not running" |
| E-2 | P0 | S | SSH: `sha256sum` of the installed `dist/index.js` and the engine binary, compare with the build | Same as the local build |
| E-3 | P0 | | SSH: `file` / `readelf -l` on `bin/wowdeck-x86_64`; `grep "engine binary" ~/homebrew/logs/wowdeck/*.log` | Interpreter `/lib64/ld-linux-x86-64.so.2`; the log line names machine `x86_64` and `wowdeck-x86_64` |
| E-4 | P1 | | Kill the engine process (`kill <pid>`), open the plugin | "Engine is not running" row with a Retry button; Retry brings it back |
| E-5 | P0 | | Decky → reload plugin, or restart Steam | Engine respawns; the plugin opens on the last tab |
| E-6 | P1 | | Read the latest plugin log under `~/homebrew/logs/` | No exceptions. (Decky lowers the log level once the UI connects, so a clean log doesn't prove much.) |
| E-7 | P0 | | An arm64 device (the owner's DroidDeck test bed, or an arm64 SteamOS machine): install the same `WoWDeck.zip`; open the panel; list addons; install and remove one addon; then E-3's log check | My Addons lists addons; install works as GA-7 and remove as M-8; the log names machine `aarch64` and engine binary `wowdeck-aarch64` (#59). Verified DEVICE 2026-11-01 on DroidDeck 0.6.9, build `1.0.2-test.2`: the universal zip installed through Decky's own installer, a session restart cleared the Decky-reload wedge (`.claude/skills/droiddeck-test/SKILL.md`), the engine started with its execute bit self-restored, the log names machine `aarch64` and `wowdeck-aarch64`, `get_status` is ok and the panel renders normally. The WoW-dependent steps ran against a hand-made flavor dir inside our data directory, registered by hand as the `addon-data` tier because the phone has no real WoW, so FEX install detection stayed unexercised: My Addons listed its one TOC as unmanaged, Latest installed MPDM 3.4.7.15 from CurseForge, Menu → Remove deleted the folder, and the log had no errors. The test installation and folder were removed afterwards |
| E-8 | P1 | | The unsupported-machine panel, simulated on any one device (Steam itself runs only on x86_64 and arm64, so no real device reports an unsupported machine): a diagnostic build with one changed line in `main.py`'s `_main` (`machine = platform.machine()` becomes `machine = "riscv64"`), deployed like any other; open the panel; then deploy the normal build again; SSH: read the log and `ps aux \| grep wowdeck` | Panel: "This device isn't supported" / "WoWDeck doesn't run on riscv64 devices.", **no Retry button**; log: "Machine riscv64 has no engine binary"; no `wowdeck-` process starts. The error envelope and the no-spawn rule for every call are already pinned by G-5's bridge tests (#57) |
| E-9 | P1 | | Test the Deck runner: `deck up --engine`, run a batch with focus seeking, controller presses, probes and RPC calls, deliberately fail an expectation, capture full-window and clipped screenshots, then `deck down` | The engine smoke test and atomic swap pass; a failed expectation stops later steps; screenshots are PNGs at most 800 px on the longest edge; auto-update returns to its original value. Verified DEVICE 2026-11-02 on the owner's x86_64 Deck, PR #79, engine 1.0.1, using the runner over SSH and CEF. Persistent controller navigation, entering Search and B returning to its nav bar, compact tree and audit output, per-key measurement diffs, RPC projections, unchanged-build detection and dry-run hashes passed. The Get Addons audit reported zero issues. `down` restored auto-update to true and a second `down` changed nothing |
| E-10 | P1 | | Options → Scan with Battle.net registry paths on C:, an SD-card D: and Z: outside the prefix. Include sibling flavors, a case mismatch, an ambiguous path and a stale prefix | All supported sibling flavors appear once. Real installs register automatically; addon-only data asks for confirmation. Ambiguous and stale paths add nothing, other discovery continues, and logs contain no registry values or personal paths. Cover Steam, Lutris, Bottles and a custom prefix. Not run on device for #75 |
| E-11 | P1 | | Options → Scan with a non-Steam shortcut launching Wow.exe directly outside the usual folders. Repeat with its flavor folder and WoW root as program or start folder, and with shortcuts under two Steam users. Include registry-only installs in live, deleted-shortcut and installed Steam app prefixes. Repeat with a missing or malformed shortcuts.vdf | Direct-launch installs appear once with the usual validity rules. Every user's shortcuts count. Registry discovery searches all prefixes, including shared, named and unreferenced ones, and continues past broken shortcut files. Unreferenced prefixes do not create Steam links. Custom paths retain priority. Not run on device for #76 |
| E-12 | P1 | | Find WoW through registries, direct client shortcuts and the WoW/Battle.net launchers. Include a shared prefix override, an old default prefix, several matching Steam entries, a different Blizzard game and a folder-only fallback. Open each linked game page and its home tile. Rescan after removing a shortcut, and disable automatic linking in Options | All matching WoW/Battle.net entries get the existing addon section and badge. Another Blizzard game, an old overridden prefix and folder-only fallback do not create links. Removed shortcuts lose their links. Manual linking still works. Automatic addon updates and existing check/badge choices stay as the user set them. DEVICE 2026-11-03, x86_64 Deck via `tools/deck-ui`: all three installed clients linked to World of Warcraft. With the manual link cleared, its game-page section and two visible home-tile badges remained. Disabling automatic linking removed the section; enabling it restored the section after reload. Automatic updates stayed off under the test guard, then the original update setting and manual link were restored. Multiple shortcuts, external overrides, old prefixes, wrappers, fallback-only discovery and grep failure are covered by deterministic fixtures. DEVICE recheck for PR #114 on 2026-11-03 via `tools/deck-ui/deck`: the exact build was already installed. A rescan retained the same three clients and Steam links. After clearing the manual link and reloading, the game page had one addon section and home had two badges. Controller A toggled automatic linking off and on, removing and restoring the section without another reload. Restored the manual link, automatic linking, automatic updates, background checks and badges to their original values. DEVICE 2026-11-03, Galaxy S25 on DroidDeck 0.6.9 via adb and droiddeckctl, PR #114 at de29c5e: build 1.0.2-test.114 started the native ARM64 engine and detected Forever with Wow-ARM64.exe. It linked the Steam entry without a manual link. The game-page addon section and Open button worked; disabling automatic linking removed the section, and re-enabling restored it. No addons were installed, so pending-update badges were not verified. Shared-prefix layouts were not tested on this device. Automatic linking was left enabled, the test build remained installed and Steam was running |
| E-13 | P1 | S | Runner toast evidence and active-document eval (spec #140), on a disposable installation: one batch with `toast-start` before a source change (X Find online source) and an unrelated addon's Menu → Remove, `toast-read` after; `eval --active` on a control inside the open file-picker or a modal; one batch ending cleanly and one failing an `expect` on purpose, each with `toast-start` active; then a bare `toast-read` | Both notices retained complete and in action order; `eval --active` sees the same document focus navigation drives (picker entries, focused dialog control); both exits clean the observer up and print the captured history, `toast-stop` reports what it retained, and every later `toast-read` says there is no observer. Verified DEVICE 2026-11-09 on the owner's x86_64 Deck, build `c374c0f` (runner-only change; the installed plugin already ran it): capture `["Speedy AutoLoot now updates from CurseForge Your files are kept: Roll back returns to 1.0.0.","Removed BNetToast"]`; a failed `expect` exited 1 with its capture retained in cleanup. Review-fix follow-up: the structural selector retained real controller notices with hashed classes, explicit stop printed their text, and a failed expectation printed its history and removed the observer; the second review follow-up also verified SIGINT during the final timed step exits 130 with captured controller text and observer removal; details and evidence in [hardware/2026-11-09-spec140-acceptance](hardware/2026-11-09-spec140-acceptance/README.md) |

One initial R1 press during E-9 skipped Get Addons. Four follow-up checks,
including one immediately after a plugin reload and one using the previous
controller script, each advanced one tab. A separate diagnosis on 2026-11-03
made the failure repeatable: when DOM focus reported BODY, the focused handler
and the native fallback both advanced the tab for one R1 press. The companion
R1 fix gives native input sole ownership while the QAM has input, with a
focused-event fallback when the native bridge or tree lookup is unavailable.
The follow-up also verified the real on-screen keyboard, which needs another
A after entering Search: R1 leaves the plugin tab alone until B closes it.
The runner's example waits for the plugin and probes the current tab, since
inactive tabs have no text for `seek` to match.

## 4. UI regression (the rework, T6)

### 4.1 QAM shell and tabs

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| Q-1 | P1 | S | Open the plugin; press L1/R1 | Tabs move My Addons → Get Addons → Options and **stop at the ends** (R1 on Options and L1 on My Addons do nothing; owner decision 2026-10-20: with three tabs in a narrow bar, wrapping is more jarring, and Steam's own bars differ). Steam-style pills: selected grey, focused white; inactive tabs show icons only |
| Q-1b | P1 | S | Look at the glyphs at both ends of the tab bar, with the Deck's own controls and (if you have one) an Xbox/PlayStation pad | **The same glyphs Steam shows in its own Library tab bar for that controller** (LB/RB on Xbox, L1/R1 on Deck/PlayStation). If they differ from the Library, note both |
| Q-1c | P1 | S | Start on My Addons. Focus the nav bar and press R1 once; repeat after closing/reopening the QAM and reloading the plugin. Repeat from Decky's title-bar back button. Open Search, enter its input and press A to open the keyboard; press R1, then B. Developer regression: keep Steam gamepad focus on the tab while DOM focus reports BODY, then deliver one virtual-pad R1 | Each press advances exactly one tab, including when DOM and gamepad focus differ. Releases do not advance tabs, rapid presses still work, and navigation clamps at each end. The keyboard owns R1 until B closes it, and the plugin tab stays unchanged. The panel's callback stops when it unmounts. DEVICE 2026-11-03 over SSH/CEF with a virtual pad: the DOM-focus fixture reproduced a two-tab skip before the fix; the fixed fixture and normal runner sequence passed. Nine deterministic regression tests cover both input paths, render-time focus loss, title-bar input, clamping, releases, keyboard and other active trees, unmount cleanup and missing bridge/tree fallbacks |
| Q-2 | P2 | | Touch each tab | Same as Q-1 |
| Q-3 | P2 | | Compare the tab bar with the plugin list's look (font, spacing, section titles) | Section titles are 12 px uppercase grey like Steam's; rows have Steam's separators and focus highlight. Nothing is squeezed or overlapping |
| Q-4 | P1 | | Close the QAM on Options, reopen | Comes back on Options |
| Q-5 | P1 | S | With more than one installation, My Addons: look at the top at rest, then scroll the list down | The tab bar and the **Installation** picker sit directly under Decky's title with no gap, at rest and while scrolling (a floating pane, opaque) while rows scroll under them; picking another installation reloads the list. Other tabs: only the tab bar floats |
| Q-6 | P1 | S | Focus the tab bar, then scroll a long list a little and look at the tab bar and the line under the floating pane | The tab bar is never cut or faded (the glyph keycaps and pills are whole); a soft fade appears **under** the floating pane only once the list is scrolled, never at rest and never over the tab bar or a focused row |
| Q-7 | P2 | S | Open the plugin and look at the title | "WoWDeck Manager" on one line; Decky's back button has no fade over it; about 16 px between the title and the tab bar, like Steam's own QAM pages ("Quick Settings") |

### 4.2 My Addons

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| M-0 | P1 | S | With no WoW installation, open My Addons. Press Find WoW, retry after an empty or failed scan. Repeat with a detectable installation, including one with no addons. | Find WoW appears only without an installation. Scanning shows progress and prevents another scan. An empty scan reports zero; failure offers a retry. Below the result, **Add WoW folder** adds a folder by hand (O-3j). The widget has no Steam library hint and no Open Options button. A successful scan shows the installation's addons, or its empty addon list, without the widget. |
| M-1 | P1 | S | D-pad Down through the list | One stop per addon; the page scrolls with focus; nothing skipped |
| M-2 | P1 | S | Focus an addon; look at the footer | A **Details**, Menu **Options**, and X **Update** only when that addon has an update |
| M-3 | P1 | S | A on a managed addon | Details opens (carousel, description, changelog); B closes and focus returns near the row |
| M-4 | P1 | S | X on an addon with an update | Spinner on the row, then a toast "Updated <name>" with the plugin icon; the row's "→ new version" disappears |
| M-5 | P1 | S | Menu on an addon | Steam context menu: Update (blue, if offered), Details, Ignore, then a separator and Remove (red). B closes it. **Check where it appears** inside the QAM |
| M-6 | P1 | | Touch the ⋯ button on a row | Same menu as M-5; tapping it doesn't also open Details |
| M-7 | P1 | | Touch the row itself | Opens Details |
| M-8 | P0 | | Menu → Remove → confirm | Folder gone from AddOns; toast "Removed". A library only it needed stays unless you chose **Remove both** (LIB-135-2) |
| M-9 | P1 | | Menu → Remove → cancel | Nothing removed |
| M-10 | P1 | | A on an unmanaged addon | Opens the menu (no Details for unmanaged); Remove deletes the folder after confirm |
| M-11 | P1 | | Menu → Ignore | Row disappears; the **Show ignored addons** toggle appears; turning it on shows the row **greyed (Steam's disabled grey) with an IGNORED tag**, still selectable; Unignore brings it back |
| M-12 | P1 | S | **Update all (N)** | A progress bar replaces the buttons, then a toast "N updated"; button reads "All up to date" |
| M-13 | P1 | | Refresh (↻) | Spinner, then the list with fresh update info |
| M-14 | P2 | | 100-addon installation: hold Down from top to bottom | No stutter worse than Steam's own lists; last row reachable; Up returns to the top |
| M-15 | P2 | | Empty installation | "No addons found…" text, no crash |
| M-16 | P1 | | A git-checkout folder in AddOns, then turn on **Show ignored addons** | Hidden until the toggle is on; then a row "Git checkout, not managed" with no footer actions, no ⋯ and no menu; never changed by Update all |
| M-17 | P1 | | Delete one folder of a managed addon (e.g. a suite's library folder) over SSH, reopen My Addons | Row says "files missing"; Menu shows **Reinstall to repair** first, in blue |
| M-18 | P0 | | Menu → Reinstall to repair | Toast "Reinstalled"; the folder is back; "files missing" gone |
| M-19 | P2 | | Menu on an up-to-date managed addon | **Reinstall** after Details; it rewrites the files; toast "Reinstalled". Afterwards Details offers no "Roll back" to the version already installed, and an older version kept from an earlier update is still offered |
| M-20 | P2 | | Ignore an addon | With **Show ignored** on, the row carries the **IGNORED** tag and no "ignored" reason text (the tag says it; other reasons, e.g. "files missing", still show) |
| M-22 | P1 | S | Scroll far down My Addons, then press Up repeatedly back to the top (and the same in Options, Get Addons, Manage backups) | **Every single press** that would bring the focused row near an edge scrolls the list a little, like Neovim's scrolloff: the row never slides under the title or the floating tab bar, and there is never a run of presses with no scrolling followed by a jump. In the QAM the row stays around the middle |
| M-23 | P1 | S | Far down the list: open the **Installation** dropdown and back out; open Details (A) and close it; open the context menu (Menu) and back out | Each time focus returns to **the same row** and the list stays where it was |
| M-24 | P1 | S | Options (Menu) on DBM, Plater or WeakAuras (installed from CurseForge; the item only shows when a pre-release is newer than stable, or the addon is already on Beta/Alpha) → **Release channel: Stable** → Beta | A second menu with Stable (marked), Beta, Alpha. Picking Alpha (DBM/Plater/WeakAuras have alphas) shows the row's spinner, then the toast "<name>: Alpha – Installed <alpha version>"; the row has an **ALPHA** tag and its version is the alpha. Picking the marked channel does nothing |
| M-25 | P1 | | On an alpha-installed addon switch back to **Stable** | The **stable** release is installed at once (downgrade on purpose); the tag is gone; no update is offered afterwards |
| M-26 | P2 | | Details (A) on such an addon | Footer has ≡ Release channel; it opens the same menu and closes Details after a pick. Not shown for GitHub/WoWInterface/TukUI addons |
| M-27 | P1 | S | Start a long action from a row's **Options** menu (Release channel → another channel, or Update / Reinstall); with ignored addons, turn **Show ignored** on first | The list **stays on screen** the whole time (never empty), the row shows its spinner, Show ignored stays on; the row updates when the install ends |
| M-28 | P2 | | While such an install runs, open Get Addons and search, or open Details | Results and the description load without waiting for the install |
| M-29 | P1 | S | My Addons toolbar: Refresh, **filter glyph**, Update all. Press the glyph, type "dbm" on the keyboard, press Filter | Only matching rows; the heading reads "INSTALLED (1 of N)"; the glyph is blue; footer on the glyph shows X **Show all**. No new rows above the list. Press X: everything is back |
| M-30 | P2 | | Filter for something that matches nothing; open the filter and press **Show all**; open it and press B | "No addons match …" with what to press; Show all clears it; B keeps the filter as it was |
| M-31 | P1 | S | With two or more installations, focus **Update all** | Footer shows ≡ **Update all installations**; it runs with "Updating all installations…" (the progress bar stays **inside the panel**, S32; the same for the WTF backup progress in Options) and a toast with the total. With one installation the ≡ action is absent. With nothing to update here, the button stays reachable when other installations exist |
| M-32 | P2 | | An installation on an SD card that is removed: Update all installations | That installation's updates fail with "… is not available: its folder is missing (is the SD card in?)"; nothing is written under the card's mount path; the other installations still update |
| M-33 | P1 | S | An addon installed as another's dependency (Syndicator via Baganator) | **LIBRARY** tag and "needed by Baganator" on its row. **Show libraries** (bottom, saved) hides and shows such rows, except a library no addon needs, which stays shown. Remove on Baganator: the confirmation names Syndicator and offers **Remove Baganator only** and **Remove both** |
| M-34 | P2 | | An addon whose TOC needs a folder that is missing | The row says "missing <name>" and sorts with the other problems |
| M-35 | P1 | S | Update an addon (or let auto-update do it), then its Options menu | "Roll back to <old version>" right after "Release channel"; it puts the old files back (toast) and offers "Undo rollback (<new version>)"; using it toasts "Returned <name> to <new version>" |
| M-35b | P2 | | Update an addon, then delete its kept copy under AddOns/.wowdeck/rollback/ over SSH; reopen My Addons and its Options menu | No "Roll back" item; the row is otherwise as it was |
| M-36 | P1 | | Options → Updates → **Previous versions >**, A | One row; its description reads "On · 17 MB for 1 addon". The modal holds **Keep previous versions**, **Space used** ("17 MB for 1 addon") and **Clear**. Clear empties it ("None kept") and the rollback item disappears. **Keep previous versions** off: updates keep nothing |
| M-36b | P1 | | In that modal, turn **Keep previous versions** off, then press B; open it again, press **Clear**, press B | Each B puts focus back on **Previous versions**. Repeat by tapping the row without focusing it first. Its description reads "Off · 17 MB for 1 addon" after the first close and "Off" after the clear |
| M-36d | P2 | | Make the engine unavailable, then open **Previous versions**. Restore the engine and press **Try again** | The modal shows a load error with Clear disabled. Try again shows the space used and enables Clear when versions are kept |
| M-36c | P2 | | Open **Previous versions** with nothing kept | **Space used** says "None kept"; **Clear** is greyed out and D-pad skips it |
| M-37 | P1 | S | Options → Updates → **Update automatically** on; WoW's Steam page → Check for updates (or restart / wake the Deck) | Waiting updates install by themselves; toast "N addons updated automatically"; the toggle's description shows the last run. Off by default |
| M-38 | P1 | | Roll an addon back, then check again with auto-update on | The addon is **paused** (PAUSED tag; toast "Automatic updates paused for it"): no automatic update, also not for a newer release; still offered as an update by hand. Rolling forward to the latest, or updating by hand, resumes it |
| M-38b | P1 | S | Auto-update on: an addon's Options menu → **Pause automatic updates**, then **Resume** | PAUSED tag on, then off; the items appear only while automatic updates are on |
| M-38c | P2 | | Auto-update on, two addons with updates: **Update all**, and while the first installs, pause the second from its Options menu (then again with Ignore) | The second stays PAUSED (or IGNORED) and is not updated; the first updates as usual |
| M-39 | P1 | | With WoW running, trigger a check with auto-update on | Nothing is updated; toast "Automatic update waited: WoW was running" |
| M-40 | P1 | S | An addon you put in AddOns yourself (not installed by WoWDeck) | Row is greyed out with an **UNMANAGED** tag and "Installed manually"; it sorts with the ignored rows at the end. **Show unmanaged addons** (bottom, saved) hides and shows such rows |
| M-41 | P1 | S | A CurseForge addon whose author left the file name as its version (Controller Forever, AtlasLoot Classic) with an update waiting | Next version reads like a version ("12488") or, when the file name has none, "16 Oct release"; never "ControllerForever.zip" |
| M-42 | P1 | S | On an unmanaged addon known to CurseForge (Speedy AutoLoot, Details) the footer shows **X Find online source**: press X (or Options → **Find online source…**); then a sub-folder (OmniCC_Config) and a private one | A dialog lists sources whose release installs that folder as Get Addons rows (summary, downloads, date), the best one focused (B closes it); a sub-folder finds its main addon; none: "No online source found." A opens the source's Details (B returns to the same row); X, in the row or in Details ("Use this source"), closes both and installs: toast "<name> now updates from <source>", the row turns into a normal managed one on the latest version, and its menu offers "Roll back to <the hand-copied version>", which puts the hand-copied files back |
| M-43 | P1 | | An addon with an update waiting; turn its source off in Options (e.g. WoWInterface), back to My Addons, **Update all** | The row says Source off with no new version; Update all (N), the Library band and the update toast leave it out; Update all finishes with no failure for it |
| M-21 | P1 | S | Order of My Addons | Updates first, then "files missing" / "not on …", then A–Z, ignored last. After X updates the top row, it moves to its A–Z place: **note where focus lands** (wanted: on the next row with an update, not the top of the page) |
| M-44 | P1 | S | On an addon with an update: X (Update); then Options → Ignore and back; then Remove. Repeat Update from a Get Addons result | After each action the row changes once, with no flicker or second spinner: Update → the new version and an UPDATED tag (Get Addons: "Installed, Updated"); Ignore → the row hides (with Show ignored: the IGNORED tag); Remove → the row is gone (Get Addons: Install again) (verified DEVICE 2026-10-27: the row goes from its spinner straight to the new state; the refresh button stays still) |
| M-45 | P1 | | Two installations with updates waiting, one on an SD card; take the card out, then ≡ **Update all installations** | The toast counts the updated addons and names the others: "Not updated: <name>, <name> +N." The other installation's addons are updated and stay updated; My Addons shows each addon's real version |

One list refresh per addon action (#33) passed M-44, M-4 (row), M-8, M-11,
M-27, M-33 and M-38b on device on 2026-10-27, driven with the pad and
watched through an in-memory hook on every engine call and every state of
the row. Each action read the list at most once. Update first failed M-44:
its spinner ended before that read landed, so the row showed the old version
again for up to 150 ms beside a spinning refresh button. The row now stays
busy until the read lands, which does not spin the refresh button; checked
again on device the same day in My Addons and Get Addons.

### 4.3 Get Addons (widened QAM tab)

Revised 2026-10-19 (UI-02 rev 2): Get Addons maps Steam's Friends & Chat
pattern — a collapsed destination list (Search, Latest, Popular, From URL)
beside a pane that holds the selected destination's browse UI. Focusing a
destination slides the QAM open without a press; the list is replaced as the
main navigation. The launcher rows, the full-screen page and rev 1's detail
pane are gone; the page-era cases G-10…G-27 and the detail-pane cases are
retired. Facts to know while testing: Steam's own browses widen by two root
classes on the QAM's `BasicUI` div; the plugin re-applies and enforces them
while a destination is focused; if the mechanism is missing everything
degrades to collapsed. Addon details use the details modal.

The destinations building their own requests and the one sources store (#34)
passed GA-6, GA-9 (Category and Details round trips), GA-19, GA-20 and GA-25
on device on 2026-10-27, with a virtual pad and the engine requests logged in
memory. Latest: Source to WowUp Hub sent one request from index 0, Load more
continued it from index 10, focus on the first new row. Popular: a category
sent its `categoryId`, a Source change dropped it (Category back to All),
All categories sent none; CurseForge's categories were asked once and not
again after a Details round trip. Turning WowUp Hub off in Options moved
Latest to CurseForge without an error. Switching the installation put Latest
and Popular on CurseForge at once, with the new installation's results.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| GA-1 | P1 | S | Enter Get Addons fresh, by touch, and bumper-cycled back from My Addons/Options | One title bar: Decky's, left-aligned against its back button. **Install into**, then a vertical destination list (Search, Latest, Popular, From URL, each with an icon); focus lands on the plugin-tab nav bar, QAM at the standard width; no pane |
| GA-2 | P1 | S | Down/Up through the destinations, both directions, quickly | Focusing a destination selects it and slides the QAM open (≈0.3 s) with that destination's browse UI in the pane — no press; the destination list stays visible beside it; focus clamps at the first and last destination |
| GA-3 | P1 | S | In the pane: Search text keys, Latest/Popular lists, Popular's Category, From URL | The pane (~550 px) holds the destination's own controls and results; Category belongs to the Popular pane; result rows keep full size; the destination list keeps ~240 px |
| GA-4 | P1 | S | Pane: long result list, changelog-length descriptions in Details | The pane scrolls like the rest of the QAM; the floating tab bar still keeps rows clear of the title |
| GA-5 | P1 | S | Right or A from a destination; then Left/B | Right/A moves focus into the pane; B (or Left out of the pane) slides the QAM closed and leaves focus on the plugin-tab nav bar, not on a destination row |
| GA-6 | P1 | S | Load more at the end of Latest/Popular | The row stays "Loading…" then ten more rows; focus on the first new row; until the end or 200 results |
| GA-7 | P1 | S | X on a result row; install from Details; addon with a required dependency | X installs into the selected installation: row spinner, toast, installed state; Details' Install does the same; dependencies install with their addon |
| GA-8 | P1 | S | L1/R1 while a destination is focused (QAM wide) | The QAM slides closed and the plugin tab switches (clamped — L1 on My Addons does nothing); bumping back to Get Addons lands collapsed on the nav bar, never slid out |
| GA-9 | P1 | S | Wide: open and back out of **Install into**, **Category** (Popular), a release-channel menu, and the Details modal | Widened mode survives the G4 round-trips without flapping; focus returns to the same row; picking a category reloads the Popular pane |
| GA-10 | P1 | S | A on a result row in any destination, collapsed and wide | The existing Details modal opens (not a pane); close returns to the row; X installs |
| GA-11 | P2 | | Touch: tap a destination (opens the pane), tap a row, tap Details' Install | Same behavior as the controller cases; rows do not double-activate |
| GA-12 | P0 | S | Fallback drill (Steam-update simulation, see below): focus every destination, search, install one addon; read the console over SSH or CDP | Everything stays collapsed at the standard width; browse, search and install all still work; no console errors (at most one `warn`); other Valve sections never widen |
| GA-13 | P1 | S | Recovery: make the widening mechanism available again (undo the simulation), close and reopen the QAM | Without a plugin reload, focusing a destination widens again on the next Get Addons mount |
| GA-14 | P1 | S | Close the QAM mid-browse (destination focused, widened) and reopen; again via Decky's title back button; also leave from My Addons afterwards | Every reopen shows Get Addons collapsed on the nav bar at standard width — no stray widened state; loaded lists/search text may persist ("the store remembers") |
| GA-15 | P0 | S | Decky → reload plugin while widened and mid-browse, then CDP into `QuickAccess_uid2` and look for `.QAMFriendExpanded` on the `BasicUI` div | The reloaded world starts collapsed: no widened classes left on Steam's DOM (uninstalled widening would widen every QAM section forever); Get Addons opens collapsed on the nav bar |
| GA-16 | P1 | S | Widened, then fast repeated modals (dropdown open/close ×5, Menu, confirm dialogs) | No flap: widened through a modal, collapsed only on its triggers; a Steam class-drop re-applies within ~100 ms of the mount |
| GA-17 | P1 | | Switch destinations while the pane is open, install everything already installed, overflow a long results list | The pane never shows another destination's content; installed rows read ✓ Installed right after X |
| GA-27 | P0 | S | On DroidDeck (arm64 Steam, the Friends flag only counts on the Friends tab) and on the Deck: focus Latest, open the Source menu and close it, Search with the on-screen keyboard, R1 out, close and reopen the QAM, then Decky → reload plugin while wide | The QAM slides wide on focus and stays wide through the menu and the keyboard; R1 and the QAM close slide it back; the reload collapses it and the next focus widens again. Friends & Chat's own expand still works afterwards (DEVICE 2026-10-31 on DroidDeck 0.6.9, all but the Friends check, and on the Deck, SteamOS 3.9.5, all of it: Friends' own expand still slides the QAM out and back, and Get Addons widens again afterwards. The phone's reload is the in-memory swap, because a Decky reload there hangs Decky until the session restarts) |

Browse bar and zero-capability screens (ADR 0002, `.scratch/get-addons-filter-bar`,
device-passed 2026-10-23 on the Deck screen, pane 506 CSS px):

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| GA-18 | P1 | S | Right/A from Latest and from Popular, with results loaded; then Up | Focus lands on the first result row, never on the bar; Up reaches the bar (Source, and Category on Popular). Search and From URL start on their text field |
| GA-19 | P1 | S | Popular with two discover sources on (WowUp Hub + CurseForge) | One bar row: **Source** and **Category** inline side by side, values truncated with an ellipsis, nothing wraps; with one source on, Source is hidden and Category closes up to the left. No "(off)"/"(not set up)" entry in either menu |
| GA-20 | P1 | S | Popular open on row 3; R1 to Options, toggle a discover source off; L1 back to Popular | Get Addons lands collapsed (GA-1); opening Popular again shows the same list and source with focus back on row 3; the bar stays one row (a segment may hide); results never reload or jump (verified DEVICE 2026-10-27: WowUp Hub off, Popular on CurseForge kept its page and row 3, Source hid, Category closed up to the left, no request) |
| GA-21 | P1 | S | Turn every discover source off (CurseForge and WowUp Hub); open Latest, then Popular | The zero-source screen, not results: each destination with its own icon (clock for Latest, flame for Popular) and words ("No addon source is on for Latest" / "…for Popular"), body naming the sources that can serve it, **Open addon sources** focused on entry; no turn-on offer row. Search with no name-search source shows the same shape naming those sources. Destination rows read "Needs an addon source" |
| GA-22 | P1 | S | A on **Open addon sources** | Options opens at Addon sources; the compatible rows (WowUp Hub, CurseForge) pulse together with Steam's own row highlight, full row size and no outline, three times (~1.8 s), and the first one's toggle has focus. Nothing was turned on. Moving focus clears the marks; focus is never trapped |
| GA-22b | P1 | S | Build without the bundled key, no CurseForge key saved, WowUp Hub off: Latest, then A on **Open addon sources**. Move Down to the CurseForge row, press A, save a working key | WowUp Hub and CurseForge blink; focus starts on WowUp Hub's toggle. CurseForge is a `>` row and keeps blinking when focus moves onto it. A opens the key modal. After saving, the modal closes, CurseForge is a toggle that is on, and focus is on it |
| GA-23 | P1 | S | From URL: a direct .zip link (test data), Look up, X; then a WoWInterface link with WoWInterface off | The zip installs into the selected installation as a Zip addon; the WoWInterface result shows its "turned off: installs, but won't get updates" notice on an **Open addon sources** row; A jumps to Options with WoWInterface marked and focused, nothing turned on (Get Addons never enables a source) |
| GA-24 | P1 | S | ADR 0001 pattern with the bar in place: focus destinations, Right into the pane, B | The destination list still slides the pane open on focus and stays beside it; B collapses the QAM and leaves focus on the plugin-tab nav bar; details stay a modal |
| GA-25 | P1 | S | PC-20 fix, in-pane segment menus (ADR 0002 rev 2026-10-24): wide in Latest/Popular, open the Source menu, pick another source; then Popular's Category menu, scroll it, pick a category; B out of an open menu | Both menus open as a list inside the pane below the segment, current choice checked, focus on it; **the QAM never moves and never hides while opening or closing** (no contract-then-widen, no black gap); a pick reloads the list and focus returns to the segment's button; B closes the menu back to the button without collapsing the session; Up/Down move within the menu and stop at its ends (Steam's own navigation fired the close instead — DEVICE); Left/Right under an open menu do nothing; the long Category list scrolls and the focused entry stays visible |
| GA-26 | P1 | | Forever Beta selected: Popular, source WowUp Hub; the same on Forever; then Options → Import a list exported from Forever Beta into Forever, and into Mists Classic | Popular leads with Questie on both (the hub's Forever list, not Mists'); the import previews on Forever and is refused on Mists Classic as a list for a different WoW version |

### 4.4 Details modal

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| D-1 | P1 | S | Open Details from My Addons and from the page | Same layout as before the rework (news-card style) |
| D-1b | P1 | S | Open Details on the Deck screen and, if possible, on an external 1080p screen; compare with a Steam news item | Same look as the news view: the screen behind is **blurred and dimmed, not black**; pages fill the width (80 %) and reach the bottom behind the footer; the end of a long description scrolls fully above the footer |
| D-2 | P2 | | Screenshots gallery: D-pad through the image buttons, A to enlarge | Works; B closes the enlarged image first, then the modal |
| D-3 | P2 | | Long description | Whole card scrolls |
| D-3b | P1 | S | Long description: Up/Down mid-page, then hold Down to the end, release, press Down again; press Up at the top; Left on the first page, Right on the last | **No sound** while it scrolls or pages; **one** "can't move" sound per press at the top, the bottom, the first and the last page; holding into the end makes no repeated sounds (S29) |
| D-4 | P1 | | Install / Update button in Details | Same result as GA-7 / M-4 |
| D-5 | P1 | S | Details of a result with required dependencies (e.g. an addon that needs Ace3 on CurseForge), then Details from My Addons of an installed addon with `## Dependencies` | Result: "Needs N other addons, installed automatically" under the status line. Installed: "Requires Ace3, …"; a dependency whose folder is not in AddOns adds "· Missing: …" in amber. No line when there are none |
| D-5b | P1 | S | Details of "DBM - Dungeons" and of "BigWigs" from Get Addons; Details of an installed addon with dependencies from My Addons | A **Relationships** page after Changelog: DBM - Dungeons shows Required → DBM-Core with INSTALLED; BigWigs shows Embedded libraries. No Relationships page for an addon without dependencies (DBM-Core itself). From My Addons: the TOC's dependencies with Installed / Missing |
| D-5d | P1 | S | My Addons: Menu (☰) on a multi-folder addon (DBM) › **Folders…**; on an unmanaged folder too. Press A on a folder row; A on Show with no file manager running; then with Dolphin running as a non-Steam game, and in a nested desktop session, Show again | Folders… sits just above Remove, enabled even while busy. The dialog: Show row first (greyed "Show in file manager" with "Requires a file manager that is already running. Tip: …non-Steam game or in a nested desktop session." under it when none runs), the AddOns folder (~/…), then one row per folder, main first, a deleted one "Missing from AddOns". A on a folder copies its path (toast with the path). Greyed Show toasts "No file manager found" and **never starts one**; with Dolphin running the row reads "Show in Dolphin"; Show opens AddOns with the folders selected **as a tab in the Dolphin window that is already open** (no second Dolphin process), and, with Dolphin as a non-Steam game, closes the dialog and the QAM and switches to Dolphin |
| D-5c | P2 | | My Addons Details of a multi-client addon (DBM) | The status line shows one game version, the installation's ("WoW 1.60.1" on Forever Beta), not a list of interface numbers |
| D-6 | P2 | | Details of an addon with a long status line (long version string), on the Deck and at 1080p | The provider chip says "CurseForge" (not "Curse"); the line wraps **only between facts**, no line starts or ends with "·"; a fact longer than the line ends in "…" |
| D-7 | P1 | | Get Addons: X on a result that isn't installed, then at once A for its Details; B out, A again; switch to My Addons and back; let it finish | Details and the row both show it installing (spinner, X shows Install…, no Release channel); X or a Release channel pick sends no second install; when it finishes, both show Installed and Details' X offers Reinstall |
| D-8 | P1 | | Two or more installations. Get Addons: X on a result that isn't installed; while it installs, look at the Installation picker in Get Addons, My Addons and Options, and switch plugin tabs. Let it finish, switch installation, then search and press X on a result | While it installs, all three pickers are greyed out with "Wait for addon installs to finish." under them, and tabs still change. Once it finishes, all three work again. The new install lands in the newly selected installation (My Addons lists it there). While a switch loads, a result that isn't installed shows no X and no Release channel, in Results and in Details |

### 4.5 Options

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| O-1 | P1 | S | D-pad from top to bottom of Options | Every row reachable; dropdowns, toggles and drill-in rows look like Steam's settings |
| O-2 | P1 | | WoW installations: **Find WoW installations** | Finds the Steam/Lutris/Proton installs; toast with the count |
| O-2a | P1 | | With no installations, try X on a Get Addons row, a release channel, the Details install action, and Manual Install from a file. Cancel, then choose **Find WoW installations**. Repeat after finding WoW. | Each attempt opens the same warning without installing. Cancel keeps the browse position. Find closes the warning and focuses the blinking Find row in Options without starting a scan. The row legend changes from Find WoW install to Install once WoW is available. Detection shows a spinner until it finishes, including across tab changes. |
| O-2b | P0 | | A WoW root with a `_forever_` folder (the Forever client): **Find WoW installations**, then Get Addons → search "Questie" | The installation is listed as "Forever" (Installation details: "World of Warcraft: Forever · _forever_"), not Retail; a `_retail_` beside it stays Retail; Get Addons finds Forever addons |
| O-3 | P1 | | Options: **Add WoW folder**, then back out of the picker without choosing | The row sits right below Find WoW installations. The folder picker opens at once, with no form first. Backing out adds nothing and focus is back **on Add WoW folder** |
| O-3b | P1 | S | **Add WoW folder**, pick a World of Warcraft folder holding `_retail_`, `_classic_era_` and `_classic_` that are not added yet | WoWDeck adds all three at once with a toast like "Added 3 installations", and no modal opens. Active installation and its addons update right away |
| O-3c | P1 | S | **Add WoW folder**, pick one version folder (e.g. `_classic_era_`). Repeat with a parent folder that holds only one version | **Add installation** opens with the folder as read-only text, the display name ("Classic Era") and the game version preset. Change the name and press **Add**. The installation gets that name and the modal closes. B or **Cancel** adds nothing. Focus is back on Add WoW folder |
| O-3d | P1 | S | Anywhere in Options (e.g. Safety backups to keep, Active installation, Export): open the dropdown/modal and come back | Focus returns to the same row every time; note any jump |
| O-3e | P1 | | Scroll far down Options, then Up to the top | Rows stay clear of the title (as M-22) |
| O-3f | P2 | | Move through every text field in Options (Display name in Add installation, the GitHub token and CurseForge key in their modals) and Import/Export | Each is a row with its label above (QAM) or beside (dialogs) the input, and the **whole row lights up** when the field has focus, the same for all of them |
| O-3g | P1 | | **Add WoW folder**, pick a folder that holds no WoW version (e.g. an empty folder) | **Add installation** opens with the folder's own name and no game version. **Add** stays disabled until a version is chosen. The version list has no **Auto** |
| O-3h | P1 | | **Add WoW folder**, pick a folder that is already added. Then pick its parent where only some versions are added | The first shows "Already added: Retail" and no modal. The second adds only the new versions and the toast names them; the existing ones keep their names. Repeat with exactly one new version: rename it in Add installation and confirm that only it gets the new name |
| O-3i | P2 | | **Add WoW folder**, pick an empty folder, choose any game version and press **Add** | An error toast appears and the modal stays open, so you can pick again or cancel |
| O-3j | P1 | | With no installation, on My Addons press **Add WoW folder** in the Find WoW widget. Run O-3, O-3b and O-3c from there | It behaves as in Options. Backing out of the picker puts focus back on the widget's Add WoW folder. Once an installation is added the widget disappears and its addons show |
| O-4 | P0 | | **Installation details** → **Remove this installation…** → confirm | Removed from the list; **no files deleted** on disk |
| O-5 | P1 | | **Installation details** → **Rescan addons** | Addons changed outside WoWDeck show up; toast "Addons rescanned" |
| O-5b | P1 | S | Options → **Installation details** | A dialog titled with the installation's name: Game version (1.60.1), Build (70338), Game type (Forever Beta, with "World of Warcraft: Forever Beta · _classic_beta_"), Added, Game folder (~/…), Addons ("16 installed, 15 managed"), then Rescan and Remove (red), Close. No AddOns folder row. D-pad reaches every row; B closes |
| O-5c | P1 | S | Options → **Active installation**, press **Y** | Footer shows Y **Installation details**; Y opens it. The description reads "Version 1.60.1 · Detected automatically" and wraps only between the two facts. There is no separate "Installation details" row |
| O-5e | P0 | S | From Options open **Export addon list**, **Import addon list**, **Manage backups**, **Installation details** (Y on Active installation) and each dropdown; back out with B each time | Focus returns to the **same row** every time (regression 2026-10-17) |
| O-6 | P1 | | Addon list: **Export** → Generate, Copy, Save to file | Export code shown; file written |
| O-7 | P1 | | **Import** from a string and from a file (WowUp's own `.txt` export too) | Preview lists names; "Install N new" installs them; each result line starts with the addon's name ("Alpha: installed" / "Beta: failed, …"); footer is action first, Close second |
| O-8 | P1 | | Release build (built-in CurseForge access works): Options › Addon sources, CurseForge row | A plain CurseForge toggle with no Options (≡) action in the footer. There is no CurseForge section, and no row says "see CurseForge above" |
| O-9 | P1 | S | Build without the bundled key (`make build` without `curseForgeAPIKey-dontcommit`), no key saved: Options › Addon sources, CurseForge row, then A | The row reads "CurseForge" with a `>` and "Needs an API key", and D-pad focus stops on it. A opens the "CurseForge API key" modal: status first ("No CurseForge key saved yet" and a line about built-in access), the key field (typed text hidden), **Save key** (off until something is typed), **Get a CurseForge API key**, Close. No Clear key. B closes it and focus is back on the CurseForge row |
| O-9a | P1 | S | Same build: open the CurseForge `>` row, type a working key, **Save key** | Toast "CurseForge key saved and verified", the modal closes, and the row is now a CurseForge toggle that is on, with focus on it. Get Addons lists CurseForge results. The key itself is never shown |
| O-9b | P1 | S | With your own key in use, on the CurseForge toggle press the Options button (≡) | The footer shows ≡ **API key**; it opens the same modal with "Your key works", **Replace key** and **Clear key**. **Clear key**: toast "CurseForge key cleared", the status becomes "No CurseForge key saved yet" and the modal stays open. B closes it, the row is a `>` row again and focus is on it |
| O-9c | P2 | | Same modal: type a wrong key, **Save key**; then **Get a CurseForge API key** | A wrong key gives "Couldn't check the key", nothing is saved and the modal stays open. Get a key opens the CurseForge console in Steam's browser; after closing the browser, the modal or the row has focus |
| O-9d | P2 | | A build whose bundled key CurseForge rejects (set `WOWDECK_BUNDLED_CURSEFORGE_API_KEY` to a wrong key): open the CurseForge `>` row | The modal also offers **Try built-in access again**; pressing it shows a spinner, then the updated status. It is not offered when built-in access was never there |
| O-10 | P2 | | Move to GitHub at the end of Addon sources, with and without a saved token | GitHub is a single `>` row with no token help text. The chevron is at the far right, centered against the whole row |
| O-10a | P1 | | Open GitHub, enter a rejected token, then a valid token and Save | The masked field keeps rejected input and shows the error. A valid token saves and closes the modal. Explanation and saved status appear beside the field, with no separate status focus stop |
| O-10b | P1 | | With a token saved, open GitHub and choose Remove token; reopen and Cancel | Removal clears the token. Closing returns to the GitHub row. The modal uses Steam spacing and native controls |
| O-11 | P1 | | Providers: turn one off | Its results vanish from Search; turning it back on restores them |
| O-12 | P2 | | Notifications: **Update available toast** off/on | Respected by the once-a-day toast (L-3) (verified DEVICE 2026-10-29, build 521db61: with the switch off and the daily check due, a plugin reload showed no toast and `notifications.checkUpdateToast` answered `{"toast":null}`; switched on again, the next reload toasted) |
| O-13 | P2 | | Options › About › **Diagnostics** (A) | Diagnostics is the last About row. A modal titled "Diagnostics" opens with versions, installations and recent errors; no paths, keys or tokens. Options has no Diagnostics section |
| O-13a | P1 | | Open Diagnostics and move through its labeled rows with Up/Down; reach Copy diagnostics and Close, then close with B and with Close | Rows scroll within the dialog and stay clear of its header and footer. No raw JSON is displayed. Closing restores the Diagnostics row |
| O-13b | P1 | S | Copy to clipboard, three ways: Options › About › **Diagnostics** → **Copy diagnostics** (in its modal; the modal stays open); My Addons Menu (☰) › **Folders…** → A on a folder row; **Export addon list** → Generate → **Copy** (a full-screen dialog). Paste each into a text field (the **Import addon list** box, or a desktop text editor). Do it once with A and once with touch | Toasts "Diagnostics copied", "Path copied" with the path, "Export code copied". Each paste matches the copied text exactly, line breaks included, and a long export code is not cut off. Focus stays on the button or row you pressed; nothing flashes on screen. No "clipboard helper" error, and it works in Game Mode with no desktop session |
| O-14 | P2 | | Options › About › **Third-party notices** (A); scroll with D-pad Up/Down and the stick to the end and back; press B; move away and come back to Options. With no names in `SUPPORTERS.md` and no keys set in `.github/FUNDING.yml`, look at About. Then start the engine with `WOWDECK_ABOUT_URL` pointing at a local server whose `SUPPORTERS.md` lists enough names to scroll, one of them `**Bold** [link](https://example.com)`, and whose `.github/FUNDING.yml` has `ko_fi: <a real Ko-fi page>` and `custom: [http://example.com, <a real https page>, "bitcoin:<a real address>", "bitcoin:<the same address with its last character changed>"]`. Press **Check again** in Options › Updates, open **Supporters** (A), scroll and close it the same way. Open **Support WoWDeck** (A). Scan each web link's QR code with a phone camera, and the Bitcoin code with a wallet app. Move between the links with the D-pad in all four directions, press A on the Bitcoin row, then on a web link, close Steam's browser, then press B. Stop the server, press Check again and open both modals once more | About is the last section. The modal opens at once, with no spinner, and shows the notices as formatted text (headings, links). Scrolling stops at both ends with one bell per press. B and A on **Close** both close it, and focus is back on the Third-party notices row. Focus memory returns to that row when you come back to Options. With no names there is no Supporters row, and with no funding keys there is no Support WoWDeck row. After Check again Support WoWDeck is the first row and Supporters the second, above Third-party notices. The Support modal shows the developer's note, then the links two to a row, each with the platform name (Ko-fi, and the custom page's name or hostname), the link's QR code below it and a short URL without `https://` under the code, on one line. An odd last link sits alone in the left column. The `http://` link is not there. One Bitcoin row shows the full address with no `bitcoin:` in front, and the address with the changed character is not there. The phone opens the same page as the URL under each code, and the wallet app fills in the address printed under the Bitcoin code. Left/Right moves between the two links in a row, Up/Down moves between rows and stays in the same column, and Down from the last row reaches **Close**. A on the Bitcoin row does nothing, and A on a web row opens that page in Steam's browser, and B closes the modal with focus back on the Support WoWDeck row. The Supporters modal scrolls, closes and keeps focus the same way. It lists the names alphabetically as plain text: the test name reads `Bold link`, not bold and not a link. With the server stopped the same names and links stay, with no error and one `[about] … not refreshed` line per file in the log. Opening About never fetches anything. SSH: `THIRD_PARTY_NOTICES.md`, `about-snapshot/SUPPORTERS.md` and `about-snapshot/FUNDING.yml` are in the installed plugin folder, and `about/SUPPORTERS.md` and `about/FUNDING.yml` are in the plugin's data folder after the fetch |

### 4.5b Steam library (BEYOND-05)

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| L-1 | P1 | S | Options → Steam library → **World of Warcraft in Steam**; type "wow"; pick the WoW entry | The picker lists non-Steam games, likely WoW entries first; "wow" also finds "World of Warcraft" by its initials. After A: toast "Linked to Steam"; the row says "<name>: its game page shows addon updates" |
| L-2 | P1 | S | Library → the WoW entry's page | A **WOW ADDONS** band between the hero and the Play row: "N addon updates …" (green) or "All addons are up to date"; buttons Update all (only with updates), Check for updates, Open. Focus starts on **Play**; Up reaches the band |
| L-3 | P1 | | Check for updates; Open | Check: a toast "Checked for addon updates" with the result. Open: the QAM opens WoWDeck Manager on My Addons |
| L-4 | P1 | | Update all on the band (with updates waiting) | All installations update; toast with the count; the band then says all is up to date |
| L-5 | P1 | S | Another game's page; WoW's page again; restart the Deck and open WoW's page | No band on other games; exactly one band on WoW's; the link survives the restart |
| L-6 | P2 | | Picker → **Unlink** | Toast "Unlinked from Steam"; no band on WoW's page any more |
| L-7 | P1 | S | Home screen with the linked game in Recent; also the Library grid | A round badge in the tile's top-right corner: **green with a download arrow** when updates wait, **dark with a check** when all are current, **blue** while checking. It follows the tile when focus moves (big/small tile). Not on other games |
| L-8 | P1 | | Restart the Deck, wait on the home screen; then open the game page within 15 minutes | The badge's appearance checks in the background (the badge turns blue briefly); the game page shows the counts without a second check. With **Check for updates when shown** off, neither checks |
| L-9 | P2 | | Options → **Show a badge on its tile** off, then on | The badge disappears and comes back. The picker lists Battle.net / Blizzard entries first along with WoW ones |
| L-10 | P1 | S | Link one shortcut by hand and let WoWDeck detect another, then open **World of Warcraft in Steam**. Close it, turn **Link detected Steam games** off and open it again | Every row's description starts with "App <id>", right under the name, so two entries with the same name can be told apart and all app ids line up. The hand-linked row says "App <id> · Currently linked", with "Currently linked" in green, and the detected one says "App <id> · Linked automatically". With automatic linking off, the detected row shows only its app id. A shortcut that is both linked by hand and detected says "Currently linked" |
| L-11 | P1 | S | Have three shortcuts: one with a custom PNG icon, one with a custom ICO icon and one with no icon. Restart Steam, then open **World of Warcraft in Steam** | The PNG and ICO shortcuts show their icons in front of the name. Any icon missing when the picker opens appears within a second. Each icon spans the name and the description line. The shortcut with no icon gets an empty space of the same size, so all names and descriptions start at the same place |
| L-12 | P2 | | In the picker, type "wow", then the first digits of a listed app id | "wow" lists the World of Warcraft entries. The digits match nothing and the picker says "Nothing matches" |

### 4.5c WoWDeck update notice (the plugin's own update check)

The plugin is not in the Decky store, so `system.updateCheck` asks GitHub
**at most once every 24 hours** on the owner's update channel
(`pluginUpdateChannel`, Stable unless picked): Stable asks `releases/latest`,
Beta lists the releases and offers the newest stable or beta build, drafts
left out. `system.setUpdateChannel` stores the channel and checks at once,
past the interval and any backoff; a stored answer serves only the channel
that produced it. Each ask goes unauthenticated, or
through the configured GitHub token when GitHub accepts it, and maps every
unreachable state (private repo beyond the token's reach, offline, rate
limited) to "couldn't check" — never an error. The answer and when it ran are
persisted (`lastPluginUpdate` in `~/homebrew/data/wowdeck/state.json`), so
plugin load, waking the Deck and opening Options → Updates are only
*triggers*: the stored stamp decides whether a request happens, and a trigger
inside the interval answers from the stamp without a call. A failed check
never advances the stamp; instead it **backs off**: consecutive failures
space the next network attempt 1h, 2h, then 4h (capped), persisted in
`pluginUpdateBackoff` so the window survives restarts, and any success
clears it and re-arms the daily cadence. Within a window a trigger answers
from the stored answer with no request, and so does the failed attempt
itself, so the row and panel never blink away. Failed checks stay completely
silent — no toast, no error, one `[plugin-update]` log line. The **toast**
is gated once per *release version*, not per day: only a toast trigger
(plugin load, wake — `notify`) can report it, never Options or staging, and
only once the release has `WoWDeck.zip`. The engine marks the version shown
(`pluginUpdateToastShownFor`, engine-written only) the moment it reports
`toastPending`, so re-checks, plugin reloads, QAM churn and Deck restarts
never re-toast a version already announced, while a genuinely newer release
earns its own single toast. A stored answer that offers a release without
its zip is re-asked after an hour, not a day. When **Update** gets HTTP 404
for the stored answer's zip, it checks again at once, past the interval and
any backoff, and stages what that check offers. CI prunes older betas
whenever a new one publishes, so Beta hits this. Any other download failure
shows the download error without a new check. What the row shows depends on
the **repo's** state, so the
real-data cases slot into the release sequence itself
(`docs/development.md`, "Releasing"): PU-1–PU-2 any time before the public
flip (PU-1b when a token that can read the repo is configured), PU-3 right
after it, PU-4–PU-7 in the release window (tag pushed, Deck
not yet updated), PU-8 after updating the Deck, PU-11–PU-15 and PU-22 (the **Update** button,
`system.updateStage`) and PU-18–PU-20 and PU-24–PU-27 (the panel, its release notes, Check
again, the update dot and the switch to stable) in the same window as PU-4; PU-23 (Update on Beta)
whenever a newer beta is out. The engine states and version
parsing are already covered by `backend/tests/plugin-update-check.test.ts`
`backend/tests/update-stager.test.ts` and `src/pluginUpdate.test.ts`
(gate G-2); these cases are the device tier.
The log line to watch, `[plugin-update] …`, is in
`~/homebrew/logs/wowdeck/<date>.log` on the Deck. To force a due check
without waiting out the day, stop the plugin and set `lastPluginUpdate` to
`null` (or its `checkedAt` to `0`) in `state.json` before reloading; to
force a backoff window elapsed, set `pluginUpdateBackoff`'s `failedAt` to
`0` there (or the field to `null`); to
re-arm a toast for a version already marked shown, clear
`pluginUpdateToastShownFor` there too.

The v0.2.0 release window (2026-10-25/26) was the first one run end to end on
device, and it went through the hardest path — private repo, repo-scoped PAT in
Options → GitHub: the row raised the notice, **Update** staged the release,
Decky's prompt installed it and the Deck came up on 0.2.0. That closes PU-11,
PU-12, PU-13 and PU-14 (owner-run); PU-8 is verified. The toast-gate build
passed PU-4, PU-5, PU-7, PU-16–PU-19 on 2026-10-26 with its engine built as
0.1.9, so the real v0.2.0 release opened a window. PU-5b (full Deck restart),
PU-5c (a second newer tag) and PU-6 (suspend/resume) still need a pass.
The review fixes (toast only on `notify`, the stored answer surviving a
failed check and a same-day rollback, the hourly re-ask without a zip)
passed engine-only runs on the Deck the same day, and PU-15 passed on device.

The engine-built offer (#32: one `offer` that the toast, panel, dot and row
all render) passed PU-1, PU-3, PU-4, PU-5, PU-7, PU-11 (up to Decky's prompt,
dismissed with B), PU-15, PU-18, PU-19 and PU-20 on device on 2026-10-27,
with engines built as 0.1.9, 0.2.1-beta.1 and 0.2.0 against the real
releases. The wording and gating did not change. A `lastPluginUpdate` saved
by the earlier build (flat fields, markdown notes) is still served inside the
interval, with plain-text notes.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| PU-1 | P1 | S | Repo private (the state until the public flip), no token or one GitHub won't accept for it: reload the plugin, open Options → Updates | Row "WoWDeck \<version\>" / "Couldn't check for a newer release"; **no toast, no error**; one log line `[plugin-update] check unavailable: … HTTP 404` (verified DEVICE 2026-10-25) |
| PU-1b | P1 | | Private repo, GitHub token configured with read access to it — a fine-grained PAT needs **this repo selected** and **Contents: Read** (the owner's pre-flip setup): reload the plugin | Row "WoWDeck \<version\>" / "Up to date"; no toast; the log shows the one successful call — the token is used opportunistically and never logged (verified DEVICE 2026-10-25, owner-run: repo-scoped classic token saved in Options, row "Up to date", no `plugin-update` line in the fresh session log) |
| PU-2 | P1 | | Wi-Fi off, reload the plugin (a fresh engine session), open Options → Updates | Same row as PU-1; the log shows the network error; the engine and every other feature start normally |
| PU-3 | P1 | S | Right after the public flip, no newer tag (latest == running version) | Row "WoWDeck \<version\>" / "Up to date"; no toast (verified DEVICE 2026-10-27, engine 0.2.0 against the real v0.2.0: row "Up to date", no panel, dot or toast) |
| PU-4 | P0 | S | Release window: tag `vX.Y.Z` pushed, Deck still on the older version, day's check due (clear `lastPluginUpdate` to force); reload the plugin | One toast "WoWDeck X.Y.Z available" / "Update in Options"; row "WoWDeck update available" / "\<old\> → \<new\>" — no URL, so it ends inside the QAM's right edge; the log shows the one successful call (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: one toast, `pluginUpdateToastShownFor` "0.2.0", row 0.1.9 → 0.2.0. The URL-free row of #122 is covered by `src/pluginUpdate.test.ts`; its device pass, including the QAM fit, is still open) |
| PU-5 | P1 | | Same day as PU-4: leave and re-enter Options, switch tabs, close and reopen the QAM, reload the plugin | Row stays correct; **no second toast for that version — ever**; no second `releases/latest` call in the log — the answer is stored for 24 h (`lastPluginUpdate`) and the toast mark for good (`pluginUpdateToastShownFor`), neither per engine session (verified DEVICE 2026-10-26: plugin reload plus QAM close/reopen — no second toast, `lastPluginUpdate.checkedAt` unchanged, no `[plugin-update]` line) |
| PU-5b | P1 | | After PU-4's toast: restart the Deck entirely (not just reload the plugin), wait for the plugin to load again | No second toast; `state.json` still carries `pluginUpdateToastShownFor: "X.Y.Z"`; the row still says the update is available |
| PU-5c | P2 | | A second, newer tag `vX.Y.Z+1` while the Deck is still on the old version, next day's check due | Exactly one more toast — "WoWDeck X.Y.Z+1 available" — and never two for the same version afterwards |
| PU-6 | P1 | | Suspend and resume: a short sleep, then one that crosses the 24 h mark | Short sleep: no WoWDeck toast, no request (still inside the interval). Crossing the mark: the wake triggers one check — a toast only for a release version not already announced, a `[plugin-update]` line only when it failed. The addon-updates toast (N-1) is a different check with its own daily stamp |
| PU-7 | P2 | | Decky → reload WoWDeck during PU-4's window | Inside the interval: no toast, no request — the stored answer is returned. When the day's check is due: one request, and a toast only if the newest version was not announced yet (verified DEVICE 2026-10-26 inside the interval, with PU-5) |
| PU-8 | P1 | S | Update the Deck to the new release (Install from URL again, README "Update"), open Options → Updates | Row "WoWDeck \<new\>" / "Up to date"; no toast — the notice the release window raised is now cleared (verified DEVICE 2026-10-26, owner-run: the row reads "Up to date" on 0.2.0) |
| PU-9 | P2 | | During PU-4: try to reach the release page from the row with the controller | The row shows only the version transition (`<old> → <new>`) — nothing focusable and nothing runs past the QAM's edge. The 2026-10-26 decision kept the URL as informational text; #122 dropped it because it was clipped, and **Y Release notes** is the route to the release content |
| PU-10 | P2 | | Public repo whose newest release is a draft/prerelease only (`releases/latest` answers 404) | Reads "Couldn't check for a newer release", like PU-1 — never a failure; informational, matches the engine contract |
| PU-16 | P1 | S | Wi-Fi off or repo unreachable, day's check due (PU-2's state): let one check fail, then reload the plugin and re-open Options several times within the hour | No request in the log for any trigger — the failure backed off; the row may keep yesterday's stored answer ("Up to date"/"update available") or say "Couldn't check" when none was stored; still no toast, no error, one `[plugin-update] check unavailable` line per real attempt only (verified DEVICE 2026-10-26, engine-only run with an unreachable releases URL: first trigger `checked: true` plus one log line, every later trigger and a fresh session `checked: false`, no request) |
| PU-17 | P1 | | PU-16's state kept failing for 1h, then 2h more (offline overnight, say); Wi-Fi back | The next trigger after each window runs exactly one real attempt (`pluginUpdateBackoff.failures` grows: window 1h, then 2h, then 4h — capped); once one attempt succeeds, the normal daily cadence is back and `pluginUpdateBackoff` reads `null` in `state.json` (verified DEVICE 2026-10-26, engine-only, windows elapsed by editing `failedAt`: failures 1→6, 3.5 h after the 6th failure still no request (4 h cap), 4 h 01 m after one request that succeeded — backoff `null`, one toast-pending answer, then stored answers) |
| PU-11 | P0 | S | Release window (PU-4's state), release has `WoWDeck.zip`: press **Update** on the update panel under Options' nav bar | The progress bar takes the button's place (PU-37), then Decky's own install prompt for WoWDeck \<new\>; log `[self-update] staged WoWDeck X.Y.Z …`; a 0600 `wowdeck-update-X.Y.Z.zip` in the temp dir (verified DEVICE 2026-10-26, owner-run: private repo + token) |
| PU-12 | P0 | | PU-11's prompt: confirm | Decky installs and reloads WoWDeck; the open panel closes (decky-loader #976); reopening shows the new version and PU-8's row (verified DEVICE 2026-10-26, owner-run: the Deck came up on 0.2.0) |
| PU-13 | P1 | | PU-11's prompt: cancel | Nothing changes; the old version keeps running; the button is usable again (verified DEVICE 2026-10-26, owner-run). Scope: the **loader's own** prompt is upstream — cancelling after decky-loader takes over can leave the plugin uninstalled; that is decky-loader's flow, not ours |
| PU-14 | P1 | | Private repo with PU-1b's token, release window: press **Update** | Same as PU-11 — the download uses the token, never logged (verified DEVICE 2026-10-26, owner-run: this is the path the 0.2.0 pass used) |
| PU-15 | P2 | | No newer release (or the check couldn't run); then a release without `WoWDeck.zip` | No update panel, Options looks as before; the Updates row has no Update button (only its ⋯) and reads up to date / couldn't check. Without the zip: no toast, no panel, no dot — the Updates row names the release's version transition; once the zip is attached the next check (an hour later at most) brings the panel, the dot and the version's one toast (verified DEVICE 2026-10-26, engine built as 0.1.9 with a stored no-zip answer: no toast, dot or panel, row 0.1.9 → 0.2.0; aged 61 min, the reload re-checked GitHub, found the zip and showed one toast, the dot and the panel; a further reload did not toast again) |
| PU-18 | P1 | S | Release window: open Options, press Down from the tabs; scroll; switch tabs (L1/R1) and back. Then press Down from **Update** | Panel "WoWDeck X.Y.Z available" + **Update** floats under the nav bar, no animation; Down lands on it first; the list scrolls under it without hiding rows; the panel row is remembered like My Addons' installation switcher. The Updates row shows current → latest with no URL, no button. The panel is exactly the one line and button, with no release notes under it. #8 moved them to PU-24's modal. Down from **Update** moves straight to the rows below (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: panel under the nav bar, focus lands on **Update**; row 0.1.9 → 0.2.0, no button. Release notes verified DEVICE 2026-10-27, engine built as 0.1.9, virtual pad and deck-ui measurements: Stable offered v0.2.0, Beta v0.2.1-beta.1, each with its own notes as plain text in a 104 px box, **Update** fully on screen above it; entering the box did not scroll it, each Down scrolled ~30 px to the true bottom, the next Down moved to the Active installation row, Up re-entered, a held Up/Down glided and stopped at the edge, Up at the top returned to **Update**; that inline box is gone since #8, so the panel without notes still needs a pass) |
| PU-19 | P1 | S | Release window: look at the nav bar on My Addons, then move focus onto the Options tab (white pill) and open it; focus the panel's **Update** button; then update (PU-11) | An orange dot (Decky's badge colour, 10 px, thin dark ring) sits on the top-right corner of the Options tab pill on every tab, readable on the white focused pill, and on the **Update** button; no other tab carries one and no green, red or blue dot appears. After the update installs and the plugin reloads, both dots are gone (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: dot on the Options tab on My Addons and on the focused white pill, and on **Update**; back on a real 0.2.0 build both dots and the panel are gone, row "Up to date" — the install step itself is PU-11's) |
| PU-20 | P1 | S | Run a beta build (e.g. `0.3.1-beta.N`) on Beta, then Options › Updates › WoWDeck → **Stable** while the latest stable is older than the build | The panel reads "Switch to stable X" with a **Switch to stable X** button, the Updates row reads "Switch to stable X" with `beta → X` and no URL, so it ends inside the QAM's right edge, the Options tab carries the orange dot; on the next plugin load one toast "Switch to stable X" / "Install it in Options", unless X already toasted (the gate is per version, so a stable X toasted before the move to Beta stays quiet). The button stages and installs the older stable through Decky's prompt; afterwards the panel, dot and row are gone. On Beta, running a beta, no older stable is offered (verified DEVICE 2026-10-27, engine built as 0.2.1-beta.1 on Stable: panel, button and row "Switch to stable 0.2.0", row `0.2.1-beta.1 → 0.2.0`, dot on Options; with 0.2.0 already toasted no toast, with the mark cleared one toast "Switch to stable 0.2.0" / "Install it in Options"; on Beta the same build was offered 0.2.1-beta.2. The install itself was not run. The URL-free row and its QAM fit are #122's device pass and still open) |
| PU-21 | P1 | S | Options › Updates: the WoWDeck row's **⋯** (D-pad onto it, A); in the modal move between the rows, press B; open it again, pick **Beta**; open it again, pick **Stable** | The ⋯ sits right-aligned on the WoWDeck row and is a focus stop of its own. The modal "WoWDeck Update Channel" lists **Stable** "Recommended for most users." and **Beta** "Built from every merged change. Newer features, may have bugs.", a checkmark on the active one; both rows take focus. B closes without changing anything. A on a row closes the modal at once, no confirm: the checkmark moves on the next open, and the panel, the Options tab's dot and the WoWDeck row show the switch's fresh check (Beta: the newest beta or stable build; back on Stable: the latest stable, or PU-20's switch). A on the checked row just closes (verified DEVICE 2026-10-27, deck-ui scripts and a virtual pad: ⋯ right-aligned at the Clear button's edge, also beside a three-line description; B on Beta kept Stable; Stable → Beta brought the 0.2.1-beta.1 panel, dot and row, Beta → Stable removed them) |
| PU-22 | P1 | | On Beta, with the panel offering beta.N from a check earlier the same day, a newer beta publishes and CI prunes beta.N. Press **Update** | No "Couldn't download the update" toast. The log shows one `[self-update] download failed: … HTTP 404` line, then `[self-update] staged WoWDeck <newer beta> …`, and Decky's prompt names the newer beta. Afterwards the panel and the Updates row offer the newer beta, and `lastPluginUpdate` in `state.json` names it. To set this up without waiting for CI, stop the plugin and point `lastPluginUpdate.downloadUrl` at a pruned beta's asset URL, for example `…/releases/assets/682923259` (verified DEVICE 2026-10-28, this fix's build on 0.2.0, Beta, stored answer pointed at pruned beta.1's asset: the panel offered 0.2.1-beta.1; **Update** logged one 404 for asset 682923259, then staged 0.2.1-beta.4 (sha256 05116756…); the panel then read "WoWDeck 0.2.1-beta.4 available", and `lastPluginUpdate` named asset 684438832. Toasts were not watched during the press. Decky's install prompt did not appear: the frontend's artifact check accepts only digits and dots in the version, so it refuses every beta before calling Decky's installer, a separate bug) |
| PU-23 | P0 | S | A Deck on Beta, running a build that accepts staged betas (#10), with a newer beta offered (`X.Y.Z-beta.N`): press **Update** on the panel | Button reads "Preparing…", then Decky's own install prompt for WoWDeck X.Y.Z-beta.N, never "The update could not be verified"; log `[self-update] staged WoWDeck X.Y.Z-beta.N …`; a 0600 `wowdeck-update-X.Y.Z-beta.N.zip` in the temp dir. Run it from a build that already has the fix. A Deck on 0.2.0 still has the old check and refuses every beta, so install its first fixed build by hand (README "Updating") (verified DEVICE 2026-10-29, build 521db61, which reports itself as 0.2.0, on Beta, from the panel's **Update**: "Preparing…", then Decky's "Update WoWDeck" prompt for 0.2.1-beta.7; log `[self-update] staged WoWDeck 0.2.1-beta.7 for Decky's installer (sha256 2d272165…)`; `/tmp/wowdeck-update-0.2.1-beta.7.zip` mode 600. The prompt was cancelled. Verified DEVICE 2026-10-28, this branch's build as 0.1.9 on Beta, from the release notes modal's **Update**: "Preparing…", then Decky's "Update WoWDeck" prompt for 0.2.1-beta.4; log `[self-update] staged WoWDeck 0.2.1-beta.4 for Decky's installer (sha256 05116756…)`; `/tmp/wowdeck-update-0.2.1-beta.4.zip` mode 600. The prompt was cancelled, so the install did not run) |
| PU-24 | P1 | S | On Stable and again on Beta (PU-21), with an offered release whose notes are longer than the modal's box: focus **Update** on the panel; press Y; press Down, hold Down, press Up; press B. Open it again and press A on the modal's **Update**. Also an offered release with an empty body | With **Update** focused the footer shows **Y Release notes**; Y opens the modal "WoWDeck X.Y.Z release notes" with the build's notes as plain text (no `#`, `**`, link syntax or HTML; bullets read •; a bullet or paragraph wrapped in `CHANGELOG.md` reads as one line, wrapped by the box) and its own **Update** button, focused. Down/Up scroll the notes, a held press glides and stops at the end, with one bell at the edge. B closes and focus lands back on the panel's **Update**. A on the modal's **Update** closes the modal and the panel reads "Preparing…", then Decky's prompt, as in PU-11. While staging the modal's button is disabled. Without a body there is no Y hint and Y does nothing. The no-notes logic is also covered by `src/pluginUpdate.test.ts` (verified DEVICE 2026-10-28, this branch's build as 0.1.9, virtual pad and deck-ui measurements. On Beta the offer was 0.2.1-beta.4, with its notes tripled in the stored answer so they overflow the box. The footer showed **Y Release notes**; Y opened "WoWDeck 0.2.1-beta.4 release notes", plain text, • bullets, wrapped bullets on one line, `##` headings without the marks, **Update** focused; box capped at 422 px; each Down scrolled ~126 px, a held Down glided to the end (713 px) and stopped, Down there stayed put, Up and a held Up scrolled back to the top, focus stayed on **Update** throughout; B closed with focus back on the panel's **Update**; A on the modal's **Update** closed it, the panel read "Preparing…", then Decky's prompt (PU-23). On Stable the offer was 0.2.0, and Y opened "WoWDeck 0.2.0 release notes" with its one-line body, B returned to **Update**. With the stored notes emptied: no Y hint, Y did nothing. The edge bell was not listened for, and the modal's disabled button during staging was not seen, since A closes the modal) |
| PU-25 | P1 | S | With the panel showing an offer from a check earlier today, publish a newer build on the Deck's channel. Focus **Update** on the panel, press X; press X twice quickly | The footer shows **X Check again**. The button reads "Checking…", disabled, then the panel, the update dot and the Updates row name the newer build, with the toast "WoWDeck <version> is available". Pressed twice, one check runs and one toast shows. With nothing newer the toast reads "WoWDeck is up to date"; with Wi-Fi off, "Couldn't check for updates" and the panel keeps its offer. Works with WoW running. `src/selfUpdateStore.test.ts` covers the joining and the toasts; `backend/tests/plugin-update-check.test.ts` covers skipping the daily cap and the backoff (verified DEVICE 2026-10-28, this branch's build with the engine built as 0.2.1-beta.3 on Beta, virtual pad and CDP polling. The stored answer named 0.2.1-beta.4, checked minutes earlier. With **Update** focused the footer showed **X Check again** and **Y Release notes**. X turned the button into "Checking…", disabled, for about 0.5 s. Then the panel read "WoWDeck 0.2.1-beta.6 available", the Updates row read `0.2.1-beta.3 → 0.2.1-beta.6`, `lastPluginUpdate` named beta.6 and the toast read "WoWDeck 0.2.1-beta.6 is available". The update dot was not measured. Two presses 180 ms apart sent one `system.updateCheck {force: true}` and showed one toast. "WoWDeck is up to date" is in PU-26. Turning Wi-Fi off is a system setting, so a test wrapper started the engine with `WOWDECK_RELEASES_URL` pointing at a closed local port. The button read "Checking…" for about 6 s, the toast read "Couldn't check for updates" and the panel kept the beta.6 offer. The log showed `[plugin-update] check unavailable: request to https://127.0.0.1:9/repos/sigboe/wowdeck/releases?… failed: TypeError: Unable to connect. …`. A check that succeeds logs nothing. The next forced check, inside the backoff that failure started, ran and cleared `pluginUpdateBackoff`. Not run with WoW open) |
| PU-26 | P1 | S | Options › Updates, up to date: focus the WoWDeck row's **⋯**, press X; then press A | The footer shows **X Check again**, no Y. The row's description reads "Checking…" until the toast "WoWDeck is up to date". When a newer build exists, the toast reads "WoWDeck <version> is available" and the panel appears. A still opens the update channel modal (verified DEVICE 2026-10-28, engine built as 0.2.1-beta.6 on Beta, stored answer 0.2.1-beta.6. The row read `WoWDeck 0.2.1-beta.6` / `Up to date`. On **⋯** the footer showed **X Check again**, A Select and B Back, no Y. Two X presses 180 ms apart sent one forced check; the description read "Checking…" for about 0.4 s, then one toast "WoWDeck is up to date". A opened the update channel modal with **Stable** focused, and B closed it with focus back on **⋯**. The newer-build case ran with the engine built as 0.2.1-beta.3 and a stored answer naming 0.2.1-beta.3: no panel, row "Up to date", Y on **⋯** did nothing. X then brought the panel "WoWDeck 0.2.1-beta.6 available" and the toast "WoWDeck 0.2.1-beta.6 is available". During a check started from the panel the row also read "Checking…") |
| PU-27 | P1 | S | Options › Updates with an offered build that has release notes: focus the WoWDeck row's **⋯**, press Y; press B; press Y again and A on the modal's **Update** | The footer shows **Y Release notes**. Y opens the same "WoWDeck X.Y.Z release notes" modal as PU-24, **Update** focused; B closes it with focus back on **⋯**; A starts the update as in PU-11 (verified DEVICE 2026-10-28, engine built as 0.2.1-beta.3 on Beta, offer 0.2.1-beta.6. On **⋯** the footer showed **X Check again** and **Y Release notes**. Y opened "WoWDeck 0.2.1-beta.6 release notes", plain text with • bullets, **Update** focused, footer A Update and B Back. B closed it with focus back on **⋯**. Y again, then A on the modal's **Update**: the panel's button read "Preparing…", disabled, the log showed `[self-update] staged WoWDeck 0.2.1-beta.6 for Decky's installer (sha256 dbe4f436…)`, and Decky's prompt "Update WoWDeck" asked to update to 0.2.1-beta.6. B cancelled the prompt, so the install did not run, and the QAM went back to Decky's plugin list) |
| PU-28 | P1 | | On Stable, install a beta zip by hand and restart. Pick Stable in Options and restart again. On Beta, install a stable zip by hand, then repeat with a newer stable through the in-app updater. Also try a first install without settings and a first start without a stored last-run version | The beta install selects Beta before the first check. The choice made in Options survives a restart of the same build. A stable zip installed by hand selects Stable; an in-app stable update keeps Beta. Without a stored last-run version, the installed build selects its channel. Options › Updates shows the channel, with no notice about the switch. Automated coverage is in `backend/tests/plugin-update-check.test.ts` and `backend/tests/update-stager.test.ts` (partly verified DEVICE 2026-11-03, build 1.0.1 with engine RPCs and restarts. Beta picked, then a restart of the same build: still **Beta**. From Stable, a build labelled 1.0.2-beta.99 installed by hand: **Beta**. From that Beta, stable 1.0.1 installed by hand: **Stable**. No errors in the plugin log. Not run on the device: the in-app stable update, which needs Decky's installer prompt; the first start without a stored version; and the Options › Updates screen) |
| PU-28b | P1 | | On Stable, open the channel modal (Options › Updates › WoWDeck's **⋯**). Pick **Beta** and open it again; turn on **Move to Stable after release**, press B and restart the plugin, then open it again. With it on, install a newer stable through the in-app updater from Beta. Repeat with the toggle off | On Stable the modal has no toggle. On Beta it sits below **PR builds…**, off on a first install. Flipping it keeps the modal open, and it is still on after the restart, with `pluginMoveToStableAfterRelease` true in the settings file. With it on, successful staging selects **Stable** before Decky's install prompt, and later checks offer only stable releases. Cancelling or failed staging keeps **Beta**. With it off, the stable update keeps **Beta**, as in PU-28. Engine coverage in `backend/tests/plugin-update-check.test.ts`, `backend/tests/update-stager.test.ts` and `backend/tests/state-store.test.ts`; the toggle in `src/prBuildsModal.test.tsx` |
| PU-29 | P0 | | Upgrade from the last stable release. Remove WoWDeck, install the last stable `WoWDeck.zip` from GitHub Releases, then find WoW and install, update and roll back a few addons so its saved addon information is real. Pick **Beta** in Options › Updates and press **Update** on the panel for the release candidate beta. After the reload, open My Addons, Get Addons and Options, then update, roll back and remove one addon | Decky's prompt installs the candidate and WoWDeck reloads on it. Every addon, installation and setting from the old version is still there. No tab shows the recovery notice or the can't-read-saved-information notice. The addon actions work, and the log has no errors |
| PU-30 | P2 | | Turn on Steam's screen reader. In Options › Updates, move onto the WoWDeck row's **⋯** | The reader says "Update channel" |
| PU-31 | P1 | | On a test build (X.Y.Z-test.N, built with `make version-set`): open Options › Updates; press X on the WoWDeck row's **⋯** and on the panel's Update button; open the channel modal (A), pick either channel, then Update on the panel | No **X Check again** anywhere. The channel modal shows no checkmark on either row; A on either row (even the stored one) closes it and the check runs, offering that channel's newest build however it compares: panel "Switch to beta \<version\>" or "Switch to stable \<version\>", same on the Updates row, one toast per version. **Update** stages and hands to Decky's installer as any update; after it installs, the build is on the picked channel and Check again returns. Engine coverage in `backend/tests/plugin-update-check.test.ts` (the leaveTest offer, its wording, the once-per-version toast, test tags never offered); the GUI helpers in `src/pluginUpdate.test.ts` (verified DEVICE 2026-11-09 on kaptan, build 1.1.2-test.200 installed through Decky's installer, virtual pad and CDP. The engine set Beta on first start and offered leaveTest: panel and row "Switch to beta 1.1.2-beta.40" / "1.1.2-test.200 → 1.1.2-beta.40". On the test build neither the panel's Update button nor **⋯** had an X action (React props null) and X on Update changed nothing. The channel modal showed no checkmark with Beta stored and again with Stable stored; picking Stable re-offered "Switch to stable 1.1.1", picking Beta restored the beta.40 offer. The toast gate held: `pluginUpdateToastShownFor` = 1.1.2-beta.40, later picks toasted nothing more. **Update** read "Preparing…", the engine staged beta.40 (`[self-update] staged WoWDeck 1.1.2-beta.40 …`), Decky's prompt appeared and its confirm installed it; after the reload the engine ran 1.1.2-beta.40 on Beta, the row read "Up to date" and **X Check again** was back) |
| PU-32 | P1 | S | With one or more labeled PRs published: open Options › Updates, press A on the WoWDeck row's **⋯**, then A on **PR builds…**; move through the rows and press B. Then remove every `pr-build` label and open the list again. Then turn Wi-Fi off, open the list, turn Wi-Fi on and press **Retry** | **PR builds…** sits below Stable and Beta. A closes the channel modal and opens "PR Builds", which reads "Loading PR builds…" until the engine answers. Each row shows "#N title" and "author · version · built <date, time>", newest PR first. The title shows as plain text, markup and all. The D-pad walks the rows and B closes the modal. With nothing labeled the modal reads "No PR builds right now." and shows no error. Offline it reads "Couldn't load PR builds. Check the connection and try again." with **Retry**, and Retry with Wi-Fi back shows the list. The engine asks Pages only when the modal opens and when Retry is pressed. Engine coverage in `backend/tests/pr-build-list.test.ts`; the modal and the picker row in `src/prBuildsModal.test.tsx` |
| PU-33 | P0 | | Note `pluginUpdateChannel` in the settings file. In PU-32's list, press A on a PR build's row, then **Cancel**. Press A again, then **Install**, and confirm Decky's prompt. Then start the engine with `WOWDECK_PR_BUILDS_URL` pointing at a copy of `index.json` whose sha256 for that PR is wrong, and press **Install** again | A asks first. The modal reads "Install WoWDeck <version>?", the PR's number, title and author, and "Its code comes from a labeled, unreleased pull request." Cancel returns to the list, and the engine downloads nothing. Install shows the download's progress bar (PU-38); the log shows `[pr-builds] staged WoWDeck X.Y.Z-pr.N …` and the temp dir holds a 0600 `wowdeck-update-X.Y.Z-pr.N.zip`. The modal closes and Decky's own prompt names the version. After the reload the engine runs the PR build, and `pluginUpdateChannel` still holds the value noted before. With the wrong sha256 the modal reads "The download doesn't match the published PR build, so it wasn't installed". The engine stages no file, Decky's prompt never opens, and the old version keeps running. Engine coverage in `backend/tests/pr-build-install.test.ts` and the channel case in `backend/tests/plugin-update-check.test.ts`; the confirmation in `src/prBuildsModal.test.tsx` |
| PU-34 | P1 | S | Install a PR build as in PU-33, then push a commit to that PR as its maintainer and wait for CI to publish the rebuild. Reload the plugin (or wake the Deck) and watch for a toast. Reload once more. Open Options › Updates. Press A on the panel's button and confirm Decky's prompt | The first reload toasts "PR #N has a newer build" with "Update in Options". The second reload shows no toast. Options shows the panel "PR #N has a newer build" with the button "Update to X.Y.Z-pr.N.K" and the update dot, and the WoWDeck row reads the same with "<running> → <newer>". Both have **X Check again**. A shows the download's progress bar (PU-37); the log shows `[pr-builds] staged WoWDeck X.Y.Z-pr.N.K …`, and Decky's prompt names that version. After the reload the engine runs the newer build with `pluginUpdateChannel` unchanged. Engine coverage in `backend/tests/plugin-update-check.test.ts` ("the PR channel") and `backend/tests/pr-build-install.test.ts` ("Update on the PR channel"); the wording in `src/pluginUpdate.test.ts`, the store in `src/selfUpdateStore.test.ts` |
| PU-35 | P1 | | On a PR build, merge its PR into `next`. Before CI publishes the next beta, reload the plugin and open Options › Updates. After the beta publishes, reload the plugin again, open Options › Updates and press A on the panel's button, then confirm Decky's prompt | Before the beta: the panel reads "PR #N was merged. A beta with it is still building" with no button, and the row reads "PR #N was merged" / "A beta with it is still building". No older beta is offered. After the beta: the panel reads "PR #N was merged. Switch to beta X.Y.Z-beta.M" with the button "Switch to beta X.Y.Z-beta.M", where M is the newest beta, built from a commit that contains the merge. The check selects Beta. A shows the download's progress bar (PU-37) and hands the beta to Decky's installer. After the reload the engine runs that beta on Beta. Engine coverage in `backend/tests/pr-build-follow.test.ts`; the wording in `src/pluginUpdate.test.ts`, the switch in `src/selfUpdateStore.test.ts` |
| PU-36 | P2 | S | Check a closed or unlisted PR, then check again while offline | The cached closed or unlisted notice and return offer stay visible. See PU-45 and PU-46 for the channel cases. No repeat toast for the same offered version. |
| PU-37 | P1 | S | Release window (PU-11's state): press **Update** on the update panel and watch the panel. Press it again and press B on the bar halfway. Press it again, turn Wi-Fi off halfway and wait | Valve's progress bar takes the button's place, reading "Downloading X of Y MB" with Y about 73 and X rising, then "Preparing…" until Decky's prompt opens. B stops the download: the button comes back with no toast, the log shows `[self-update] download of X.Y.Z cancelled`, and the temp dir holds no `wowdeck-update-X.Y.Z.zip`. With Wi-Fi off the toast reads "Couldn't update WoWDeck: Couldn't download the update. Try again" and **Update** works again once Wi-Fi is back. Engine coverage in `backend/tests/update-stager.test.ts` and `backend/tests/network-download.test.ts`; the panel's state in `src/selfUpdateStore.test.ts` |
| PU-38 | P1 | S | In PU-32's list, press A on a PR build, then **Install**. Press it again and press B on the bar halfway. Press it again, turn Wi-Fi off halfway and wait | The progress bar takes the place of Install and Cancel, reading "Downloading X of Y MB" with Y the PR build's size, then "Preparing…" until the modal closes and Decky's prompt opens. B stops the download and returns to the confirmation with no error and no toast; the log shows `[pr-builds] download of PR #N cancelled` and the temp dir holds no partial zip. With Wi-Fi off the confirmation reads "Couldn't download the PR build. Try again" and Install works again. Engine coverage in `backend/tests/pr-build-install.test.ts`; the modal in `src/prBuildsModal.test.tsx` |
| PU-39 | P1 | S | On a PR build whose PR is listed with nothing newer: note `pluginUpdateChannel` in the settings file. Open Options › Updates and press X on the panel line. Press A on the WoWDeck row's **⋯**, then A on the PR's row. Open the modal again and pick the channel you noted. Reload the plugin and open the modal once more. Then switch to a Stable or Beta build and open the modal | The panel reads "Up to date with PR #N" with no dot, and the row reads "WoWDeck <version>" / "Up to date with PR #N". X reads "Checking…", then toasts "Up to date with PR #N". The modal shows "PR #N" first, checked, with the PR's title as plain text, and Stable and Beta unchecked. A on the PR's row only closes the modal. Picking the noted channel closes the modal and the panel offers "Switch to <channel> X" at once. After the reload the modal shows no PR row and checks nothing, and `pluginUpdateChannel` still holds the noted value. On a Stable or Beta build the modal never shows a PR row. Engine coverage in `backend/tests/plugin-update-check.test.ts` ("the PR channel"); the panel line, row and modal choice in `src/pluginUpdate.test.ts`, the modal in `src/prBuildsModal.test.tsx`, Check again in `src/selfUpdateStore.test.ts` |
| PU-40 | P1 | S | Run a PR build whose PR was merged and whose beta contains the merge. Check on load, open Options, restart, then press Update | Beta is selected and persisted. The lower-version beta has an Update button, orange dot and one notification. Restart keeps the offer without another notification. Update downloads through normal staging and opens Decky's prompt. Nothing installs before confirmation. |
| PU-41 | P1 | S | Run a merged PR build before its beta contains the merge, then repeat with the comparison unavailable | The PR stays selected. The panel says "PR #N was merged. A beta with it is still building". No install button, dot or notification appears. Check again repeats that message. |
| PU-42 | P1 | S | After PU-40, install the beta and check again after another beta is published | Checks use Beta. The installed beta is current until a newer build exists. The next beta is offered normally. |
| PU-45 | P1 | S | Run a closed, unmerged PR build with Stable stored, then repeat with Beta. Check for updates | The panel says "PR #N was closed", with the update dot and the stored channel's newest build, even older. Checks and restarts keep the PR channel and stored choice. Installing leaves the PR channel. Engine and frontend store coverage; device check pending. |
| PU-46 | P1 | S | Remove a running open PR from the builds list. Check with Stable stored, then Beta | The panel says "PR #N is no longer listed" and offers the stored channel's newest build with the update dot. The PR channel and stored choice stay unchanged until installation. Engine and frontend store coverage; device check pending. |
| PU-47 | P1 | S | After PU-46, list the PR again with a newer build. Press Check again | The newer PR build replaces the return offer, with the update dot. The channel still reads PR #N. Engine tests use recorded PR list and open/closed fixtures; frontend store tests cover replacement. Device check pending. |

### 4.6 WTF backup (folds in WF-01 `deck_verification`)

Back up WTF by hand before starting this section.

The 2026-10-28 device run below finished its cleanup in its last minute,
verified afterwards over SSH: the fixtures (`w25-fixtures/`,
`w16-empty-backups/`, the `_retail_` and `_forever_` backup folders) are
gone, `_classic_era_` is empty again, `_classic_beta_` holds the five
pre-existing zips, settings equal the pre-test snapshot, and no `.partial`
or restore strays remain. The pre-test snapshot is
`~/wowdeck-backups/2026-10-28-w16` on the Deck.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| W-1 | P1 | S | Options → WTF backup | Caption plus "Last backup …" or "No backups yet" for the active installation |
| W-2 | P0 | S | **Back up** on the **Back up now** row | Progress bar with percent, then a "Backup created" notification (also when you left Options while it ran); the zip is under `<plugin data>/wtf-backups/<flavor>/` |
| W-3 | P1 | | **Manage backups** | Dialog in Steam's style; each backup is one row (no Restore/Delete buttons on it, a chevron); A Restore, X Delete in the footer; B closes. Scroll down and back up: rows keep room above them |
| W-3b | P1 | | Touch: tap a backup | The Restore dialog opens with a red **Delete this backup…** row; tapping it asks to confirm and deletes. For a damaged backup, or while WoW runs, the dialog says why and Restore is off, but Delete works |
| W-4 | P0 | | Change something in WTF (or log in and out in WoW), then Restore | Restore dialog: green "from this device" line, Config.wtf toggle **off**, focus starts on the toggle, Restore first and Cancel second. After restore the change is gone and a "Safety backup" row exists (verified DEVICE 2026-10-29, build 521db61, on Forever: "From this device" in green, rgb(89, 191, 64); the **Keep this device's graphics & display settings** toggle off with focus on it; Restore, then Cancel. After Restore a marker file added to WTF was gone and a "Safety backup · 113 files" row topped the list) |
| W-5 | P0 | | Restore the safety backup | The state before W-4 returns (verified DEVICE 2026-10-29, same run: the safety backup's dialog also opened with the toggle off, and the marker file came back) |
| W-6 | P0 | | Start WoW, open WTF backup | Amber "WoW is running" note; Restore refused; Back up still works. **This is spike S2** (does `/proc` detection see WoW under Proton) |
| W-7 | P0 | | Cancel during a long backup | No `.partial` file or zip left behind |
| W-8 | P0 | | Reload the plugin or restart the Deck during a backup | Next start: no stray `.partial`, `.WTF-restore-*` or `WTF-pre-restore-*`; WTF intact |
| W-9 | P1 | | **⋯** on **Back up now** → **Backup folder** → choose an SD-card folder | List switches to it; remove the card → "folder not available"; Use default folder returns |
| W-10 | P1 | | **Import from file…** with a copied zip | Added to the list |
| W-11 | P1 | | Restore a backup made on another computer or by WowUp | Red "from another computer" line; Config.wtf toggle **on**; disabled when the backup has no Config.wtf |
| W-12 | P1 | | Desktop WowUp round trip (optional) | A Deck backup restores in WowUp; a WowUp backup restores here |
| W-13 | P2 | | **⋯** on **Back up now** → **Safety backups to keep** = 1, restore twice | Only one safety backup remains |
| W-14 | P1 | | Delete a backup (X in the list) → confirm | File gone; Cancel keeps it |
| W-15 | P1 | S | An installation with no backups: open **Manage backups**; press Down and Up. Then an installation with no WTF folder (a version never started) and no backups: the same | Once the list loads ("No backups yet."), focus lands on **Back up now**, and Down reaches **Import from file…**. With no WTF folder, **Back up now** is off and focus lands on **Import from file…** (verified DEVICE 2026-10-28, build 95f402e, arrow keys over CDP and a virtual pad. Forever, no WTF folder and no backups: focus on **Import from file…** from the first sample after A and still there 2 s later; Up and Down stayed on it. Classic Era, WTF folder and no backups: focus on **Back up now**, Down reached **Import from file…**, Up returned. W-10 on Classic Era with no backups: the picker opened from the focused row, the zip was added ("Backup added to the list.", Backups (1)) and focus stayed on **Import from file…**. The zip was a fresh Classic Era backup copied out and deleted from the list first; a Forever Beta zip imported into Forever was refused as "made for a different WoW version", as expected) |
| W-16 | P1 | S | **Manage backups** on an installation where no other WoW version has backups; then make a backup in another version and reopen | No **Copy settings from another version…** row at first (not a greyed-out row); after the other version's backup it appears below **Import from file…** and the D-pad reaches it (verified DEVICE 2026-10-28, build c7f9ae3, pad presses and taps over CDP with focus, innerText and engine-RPC samples. With a fresh empty-backups data dir, `wtf.copySources` returned no sources and the row was absent, not greyed out; after a Forever Beta backup was made the row appeared below **Import from file…** and Down reached it) |
| W-17 | P1 | | **Copy settings from another version…** with backups in a related version (Forever Beta → Forever) and an unrelated one (Retail), plus one no longer installed | **Copy from** opens on the related version; A opens the dropdown, related versions first, client names (Forever Beta), never folder names; the uninstalled one is marked "(not installed)" in the list and shows "Not installed · backups only" once chosen; Down reaches every backup row, newest first; B closes. The same by touch (verified DEVICE 2026-10-28, same run. The dropdown opened on Forever Beta, then Retail (not installed), then Classic Era; choosing the uninstalled one showed "Not installed · backups only" with only its backups below; Down reached every backup row; B closed; taps drove the same path, and Classic Era showed its "Current settings" row) |
| W-18 | P0 | | Choose a related version's backup → **Copy** | Dialog titled "Copy settings?", **Keep this device's graphics & display settings** on, a plain line about old realms and unused addon settings. Progress and Cancel in Manage backups; "Settings copied from Forever Beta" notification; a safety backup in this version's list; the source version's WTF and backups unchanged (verified DEVICE 2026-10-29, build 521db61: Forever Beta's backup from 18 hours ago opened "Copy settings?" with the old-realms line and the toggle on. Cancel closed it; the copy itself ran in W-21. Verified DEVICE 2026-10-28, same run. The dialog named Forever Beta's backup and showed the old-realms line and the **Keep this device's graphics & display settings** toggle; "Copying… 0%" with Cancel ran in Manage backups; the toast read "Settings copied from Forever Beta."; scripted end checks found the source's zips, the SD backup folder and its WTF unchanged) |
| W-19 | P1 | | Choose an unrelated version's backup | Red warning that its settings may not work here; the button reads **Copy anyway** (verified DEVICE 2026-10-28, same run. The warning line was shown and the button read **Copy anyway**) |
| W-20 | P1 | | Start WoW (the target version), then try a copy | The copy screen says WoW is running and to close it, even when it's the version you copy from; every row's A label reads Details; the dialog says to close WoW and **Copy** is off (not run on device 2026-10-28: needs WoW actually running) |
| W-21 | P0 | | **Copy settings from another version…** with Forever Beta installed (Forever Beta → Forever); choose **Current settings** → **Copy** | **Current settings** is the first row under **Copy from**, above the backups. The dialog says Forever Beta's settings are backed up first and kept in its backups. Progress and Cancel in Manage backups across both phases; "Settings copied from Forever Beta" notification; Forever has Forever Beta's addon settings and a safety backup in its list; Forever Beta's list has one new manual backup and its WTF is unchanged (verified DEVICE 2026-10-29, build 521db61: "Forever Beta · Current settings" was the first row; its dialog read "Copy settings?" with the toggle on, "Forever Beta's settings are backed up first and kept in its backups, as a record of what was copied." and the old-realms line. The toast read "Settings copied from Forever Beta" / "Your previous settings were saved as a safety backup.". Forever's WTF then matched Forever Beta's, Forever Beta's WTF was unchanged and its list gained one manual backup. The job ended within 1.5 s, before the first progress sample. Restoring Forever's safety backup put its WTF back. Verified DEVICE 2026-10-28, same run. "Current settings · What Forever Beta has now · changed 17 Oct" was the first row; the dialog said Forever Beta's settings are backed up first and kept in its backups; toasts sampled both phases, "Backing up the settings to copy… 0%" through 66% and then "Settings copied from Forever Beta. Your previous settings were saved as a safety backup."; Forever Beta's list gained one manual backup and its WTF was unchanged) |
| W-22 | P1 | | Choose a version that is no longer installed but still has backups | No **Current settings** row; only its backups are listed (verified DEVICE 2026-10-28, same run. The uninstalled Retail had no **Current settings** row, only its backups) |
| W-23 | P1 | | Start the source version's WoW (Forever Beta), open the copy modal on Forever and choose **Current settings** | The copy is blocked on purpose, because the Deck can't tell which version is running. The copy screen says to close WoW even when it's the version you copy from, the row's A label reads Details, and the dialog says to close WoW with **Copy** off. After quitting WoW the same row copies (not run on device 2026-10-28: needs WoW actually running) |
| W-24 | P1 | | Start a **Current settings** copy and press Cancel while it reports "Backing up the settings to copy…" | "Cancelled. Nothing was changed."; neither version's list gains a backup and both WTF folders are unchanged (verified DEVICE 2026-10-28, same run. Cancel clicked at "Backing up the settings to copy… 0%": "Cancelled. Nothing was changed."; neither list nor either WTF folder changed) |
| W-25 | P1 | | On Forever, **Import from file…** with a Forever Beta zip (a Forever Beta backup copied out and deleted from its list first); then import the same zip again | "Added to Forever Beta's backups. To use it here, choose Copy settings from another version." Forever's own list doesn't change. **Copy settings from another version…** appears (or stays) and lists that backup under Forever Beta. The second import says the backup is already in Forever Beta's backups and adds nothing. A desktop WowUp zip still lands in Forever's list as "Backup added to the list." (verified DEVICE 2026-10-28, same run. The first import said "Added to Forever Beta's backups. To use it here, choose Copy settings from another version." and Forever's count stayed 4; the copy modal listed the backup under Forever Beta; the second import said "That backup is already in Forever Beta's backups." and added nothing; a desktop WowUp zip raised Forever's count to 5 with a "From WowUp" row) |
| W-26 | P1 | | Put a desktop WowUp backup zip (it records no version) into Forever Beta's backup folder, then copy it into Forever | The dialog says the backup doesn't say which WoW version it is for and to continue only if it is for Forever Beta; **Copy** then works as in W-18 (verified DEVICE 2026-10-28, same run. The dialog read "This backup was made by WowUp and doesn't say which WoW version it is for. Only continue if it is for Forever Beta."; **Copy** then completed as in W-18) |
| W-27 | P2 | | **Copy settings from another version…** with Forever Beta installed and backed up; scroll the list, then switch **Copy from** to a version that isn't installed | The header over the rows reads "Copying from Forever Beta" in white, the same colour as the dialog title "Copy settings to …" and brighter than the row labels. The first row reads "Forever Beta · Current settings" with "Changed …" under it; each backup row reads "Forever Beta · <when> · <size>". After the switch, the header and every row name the new version. Focus order and A/B are as in W-17 (verified DEVICE 2026-10-29, build d436040: the header "Copying from Forever Beta" and the title "Copy settings to Forever" both computed to rgb(255, 255, 255); row labels stay rgb(220, 222, 223). Verified DEVICE 2026-10-28, build 2632917, when the header was still Steam blue: the header read "Copying from Forever Beta" in rgb(26, 159, 255), brighter than the row labels at rgb(220, 222, 223); the first row read "Forever Beta · Current settings" / "Changed 17 Oct"; all 6 backup rows read like "Forever Beta · 33 minutes ago · 171 KB". Switching to Classic Era renamed the header and its only row, "Classic Era · Current settings". Focus, A and B were as in W-17. Not checked on device: a version that isn't installed, because none had backups left) |
| W-28 | P1 | | Open Options → WTF backup, wait for "Last backup …", then open **Manage backups**, close it, and open it again | Manage backups shows the same backups at once, without a spinner, and then updates if anything changed. Back in Options, the "Last backup …" line is there at once too. Switching to another installation never shows the previous one's backups, even for a moment |
| W-29 | P1 | | Open **Manage backups**, then kill the plugin's engine process over SSH and wait ten seconds; once WoWDeck has restarted it (within 30 s), press **Retry**. Then do the same before the list has ever loaded | The backups stay on screen with a red error and a **Retry** row; Options shows the same error and **Retry**. **Retry** reads the list again, and the error goes once a read succeeds. A list that never loaded shows the error and **Retry**, never "No backups yet." |
| W-30 | P1 | | Open **Manage backups** → **Copy settings from another version…** and wait for the versions to list; close it and open it again. Then, with it open, kill the plugin's engine process over SSH and wait ten seconds; once WoWDeck has restarted it (within 30 s), press **Retry**. Then do the same before the versions have ever loaded | Reopening shows the same versions and rows at once, without a spinner. After the kill, the versions and rows stay on screen with a red error and a **Retry** row; **Retry** reads them again, and the error goes once a read succeeds. Versions that never loaded show the error and **Retry**, never "No other WoW version has settings to copy." |
| W-31 | P1 | | With two installations, press **Back up now** in Options, then at once open **Manage backups** for each installation in turn, close it and open it again. Start another backup and press **Cancel** in Manage backups several times quickly | As soon as you press it, **Back up now** and **Import from file…** are off and the backup rows read **Details** for both installations, before any progress shows. Reopening Manage backups shows the same progress and no second backup appears. Pressing **Cancel** repeatedly cancels once: the progress stays until the backup stops, then "Cancelled. Nothing was changed." shows. A backup that finishes before the cancel lands shows "Backup created." |
| W-32 | P1 | | With a custom **Backup folder** set, press **Back up** in Options, then open **⋯** (Backup settings) while it runs, close it and open it again. Afterwards, in Backup settings choose the installation's WTF folder as the **Backup folder**, close it, open **Manage backups** and close it, then open Backup settings again | While the backup runs, **Backup folder**, **Use default folder** and **Safety backups to keep** are off, also after reopening; they come back when it ends. WoWDeck refuses the WTF folder and shows why in red under **Backup folder**, inside Backup settings and not on the Options page. The reason is still there after Manage backups closes, and the folder doesn't change |
| W-33 | P1 | | In **Manage backups**, import a backup zip with **Import from file…**. Once the notice shows, close Manage backups and open it again, then open it for another installation. Go back to the first installation and press **Back up now**. Then start a backup and, while it runs, press X on a backup row in another installation | The import notice is still there after reopening, and only on the installation you imported into. **Back up now** clears it. While the backup runs, no row offers Delete in any installation, and **Import from file…** is off. |
| W-34 | P1 | | With Retail and Classic installed: open **Manage backups** for Retail and copy Classic's **Current settings** into it. When it finishes, open **Manage backups** for Classic. Then, in Retail's **Manage backups**, import a backup zip made for Classic and open Classic's again | After the copy, Retail lists its new safety backup and Classic lists the backup WoWDeck made of its current settings, with no **Retry** needed. After the import, the zip shows up in Classic's list, not Retail's, and **Copy settings from another version…** in Retail offers it under Classic |
| W-35 | P1 | | In Options, press **Back up now** on a large WTF folder. Before it finishes, kill the plugin's engine process over SSH and wait for WoWDeck to restart it (within 30 s) | While the engine is down, the progress stays and **Back up now** stays off. Once WoWDeck reaches the engine again, the progress goes and Options reads "Couldn't tell whether the backup finished. Check the backup list before trying again." **Back up now** is on again, and WoWDeck doesn't start the backup again by itself |
| W-36 | P2 | | In **Copy settings from another version…**, choose a row of a large WTF folder and press **Copy**, then kill the plugin's engine process over SSH before the dialog closes. Then, in **WoW Settings Backup**, pick a new **Backup folder** and kill the engine again before the row changes | The copy screen stays open and reads, in grey like the other description lines and not in red, "Couldn't tell whether the Settings copy finished…"; every row's A label reads Details until WoWDeck reaches the engine again. After the folder kill, WoW Settings Backup reads "Couldn't tell whether that was saved…" in grey, and **Backup folder** shows the folder the engine has once it answers |
| W-37 | P2 | | With a custom **Backup folder** set, open **WoW Settings Backup**, move to **Use default folder** with the D-pad and press A | The button goes away, the folder row reads "Internal storage (default)" and focus is on **Backup folder** without another D-pad press |
| W-38 | P1 | | Open Options, Settings backup | WoW Settings Backup is one selectable row with status and a centered right-edge chevron. No Back up button or three-dot control appears on Options. Manage backups remains separate |
| W-39 | P1 | | Open WoW Settings Backup and close with B or Close | The modal contains Back up, Backup folder, Use default folder when applicable, and Safety backups to keep. Closing restores its Options row |
| W-40 | P1 | | In WoW Settings Backup, cancel the folder picker, choose a folder, change retention, then reopen | Folder and retention persist. Picker and dropdown return focus to their originating rows. Steam row spacing and dialog scrolling apply |
| W-41 | P1 | | Start a backup inside WoW Settings Backup, close and reopen while it runs, then Cancel | Progress survives reopening. Folder and retention controls stay disabled while busy. Cancel stops the backup. Completion and errors appear inside the modal |

## 5. In-game and notifications

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| N-1 | P1 | | With an update waiting, suspend and resume (or restart the plugin) | One "updates available" toast with the plugin icon; not again the same day (verified DEVICE 2026-10-29, build 521db61, auto-update off for the run: a plugin reload with the daily check due showed one toast with the plugin icon; another `notifications.checkUpdateToast` and another reload the same day showed none) |
| N-3 | P2 | | The N-1 toast with updates in one installation, then in two or three | Title "N addon updates available" ("1 addon update available" for one), counting every installation. Body "Open WoWDeck Manager to update" for one installation; "In A and B" or "In A, B and C" for several, naming only those with updates, in the installation list's order (verified DEVICE 2026-10-29, build 521db61: both updates in Forever Beta gave "2 addon updates available" / "Open WoWDeck Manager to update"; two in Forever Beta and one in Classic Era gave "3 addon updates available" / "In Forever Beta and Classic Era". Not checked on device: one update, and three installations with updates) |
| N-2 | P2 | | Start WoW after the plugin has run | The companion data addon (`wowup_data_addon`) is present and not shown in My Addons |
| N-4 | P1 | | With WowUp Hub on and WowUp Companion missing from the active installation, scroll Options with the D-pad to **Updates inside WoW** and press A | The row takes focus and shows `>`. A opens "Install WowUp Companion into *name*?" with **Install** and **Cancel**. Cancel or B closes it, nothing is installed, and focus is back on **Updates inside WoW**. Repeat by tapping the row without focusing it first |
| N-5 | P1 | | Turn WowUp Hub off in Addon sources, then press A on **Updates inside WoW** | The dialog reads "Turn on WowUp Hub in Addon sources to install it." and has only **Close**. Closing it puts focus back on the row, and WowUp Hub is still off |
| N-6 | P1 | | Repeat N-4 and press **Install** | A toast says "Installed WowUp Companion". It shows in My Addons as a WowUp Hub addon and updates like the others. Once the toast shows, **Updates inside WoW** reads "Installed in *name*", loses its `>` and A does nothing. The row still names other installations without it. With the network off, Install shows "Couldn't install WowUp Companion" instead |
| N-7 | P2 | | With the companion in another installation but not the active one, switch the active installation back and forth and open Options each time | Only the active installation is offered the install; the row names the others that lack it, and never offers to install there |

## 6. Robustness (the pre-release list)

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| R-1 | P0 | | Suspend the Deck during Update all; resume | No crash; every addon either old or new, never a half-written folder; a retry finishes the job |
| R-2 | P0 | | Turn Wi-Fi off in the middle of a download | Error toast; the addon is still intact at its old version |
| R-3 | P1 | | Close the QAM while a request runs; reopen | No crash; state correct after a refresh |
| R-4 | P1 | | WoW installed on the SD card; card removed and reinserted | Clear error while missing; works again after reinsert |
| R-5 | P2 | | Desktop Mode: open the plugin through Decky there | Same behaviour with mouse and keyboard |
| R-6 | P1 | | No network at all, open each tab | Error rows with Retry; nothing hangs forever |
| R-7 | P1 | | Recovery fixture, built in isolation. Add a manual installation from a copied folder (for example `~/wowdeck-fixtures/recovery/World of Warcraft/_retail_`) holding one managed addon, `Suite`, beside a second, untouched installation. Reload the plugin from Decky to stop the engine. In `~/homebrew/data/wowdeck/state.json`, add to `addonTransactions` an unfinished update marker for the fixture installation, in the shape `AddonTransaction` writes. The marker moves `Suite` to `.wowdeck/tx-fixture/backup/Suite`, and that folder holds the original copy. Put a different folder at `AddOns/Suite`. Open the plugin with the fixture installation active. Visit My Addons, Get Addons and Options, reload the plugin, then switch to the second installation and back | A notice named "<installation> needs recovery" sits at the top of all three tabs and comes back after the reload. My Addons tags every row Unverified. The row menu keeps Details and Folders and disables every change. X does nothing, and Update all is off. Get Addons still searches and opens Details, but X shows no Install, and the file Install button is off. In Options, the installation details show Rescan addons and Remove this installation as unavailable, and Addon List Import can't install. On the second installation the notice is gone and every control works. Afterwards delete the fixture marker and the fixture installation |
| R-8 | P1 | | Same fixture as R-7. Press A on the notice in each of the three tabs, and scroll the view with the D-pad | Each tab opens the same Recovery details view. It names the installation and says other installations work normally. Under `Suite` it shows "Update stopped" with the start time and old version, then "AddOns/.wowdeck/tx-fixture/backup/Suite" with "Recovery copy of the original files. It belongs at AddOns/Suite.", then "AddOns/Suite" with "Holds the files this addon change put here", which says Retry recovery moves them aside. The D-pad reaches every row and B closes the view. With the SD card removed (fixture on the card), the view says the game folder isn't available |
| R-9 | P1 | | Build the Retry recovery fixture from the R-7 fixture, with a marker the engine can check. Its `moves` take `Suite` to `.wowdeck/tx-fixture/backup/Suite` (backup), then `.wowdeck/tx-fixture/stage/Suite` to `Suite` (install). Its `evidence` holds both folders' digests, taken before the moves with `folderEvidence` from `backend/src/wow/addons/FolderEvidence.ts` (a `bun -e` one-liner on the dev machine). Its `root` holds the Deck's own `stat -c '%d:%i'` of the game folder and of AddOns. Move the folders so both moves are done. Open Recovery details, press Retry recovery | The footer shows Retry recovery and Verify recovery beside Close. Retry recovery reads "Retrying recovery…" while it runs, and both buttons are off until it finishes. Then a toast reads "Recovered Retail" and names `Suite`. The view says the installation doesn't need recovery. `AddOns/Suite` holds the original files again, `.wowdeck/tx-fixture` is gone, and the notice has left all three tabs. My Addons shows `Suite` at its old version, without the Unverified tag |
| R-10 | P1 | | R-9 fixture again. Before pressing Retry recovery, change one line of a `.lua` file in `.wowdeck/tx-fixture/backup/Suite` and leave the TOC alone. Press Retry recovery. Then undo the edit and press it again | The first press shows "Retry recovery stopped". It says files changed since the addon change stopped, asks you to put them back, and says nothing was overwritten or deleted. The changed folder is listed. No folder moved, and the notice stays in all three tabs. The second press recovers as in R-9. With a marker the engine can't read (set `"version": 99`), the view shows neither Retry recovery nor Verify recovery. Instead it says "Retry recovery and Verify recovery aren't available" and to put the kept files back by hand |
| R-11 | P1 | | R-9 fixture with both moves done. Repair it by hand over SSH. Delete `AddOns/Suite` (the new files) and move `.wowdeck/tx-fixture/backup/Suite` back to `AddOns/Suite`. Open Recovery details and press Verify recovery | Verify recovery reads "Verifying recovery…" while it runs, and both footer buttons are off until it finishes. Then a toast reads "Verified the repair of Retail" and names `Suite`. The view says the installation doesn't need recovery. `AddOns/Suite` holds the original files, `.wowdeck/tx-fixture` is gone, and the notice has left all three tabs. My Addons shows `Suite` at its old version, without the Unverified tag |
| R-12 | P1 | | R-9 fixture again, untouched. Press Verify recovery. Then make the R-11 repair, but change one line of a `.lua` file in `AddOns/Suite` and leave the TOC alone, and press it again. Then undo the edit and reload the plugin from Decky to stop the engine. Add `"Extra": {"kind":"absent"}` to the marker's `evidence`, create the folder `AddOns/Extra`, and press Verify recovery once more | Each press shows "Verify recovery found differences". It says the original files aren't all back yet, asks you to put them back and verify again, and says nothing was changed. The first lists `AddOns/Suite` as differing from the original. The second lists `AddOns/Suite` again. The third lists `AddOns/Extra` as not there before the addon change. No file or folder changes, `state.json` keeps the marker as it was, and the notice stays in all three tabs. Deleting `AddOns/Extra` and pressing again verifies as in R-11 |
| R-13 | P1 | | With the engine stopped, preserve state.json and replace it with truncated JSON containing the key "addonTransactions". Reload WoWDeck and visit My Addons, Get Addons and Options. Restore the preserved file and restart | Every tab says saved addon information cannot be read, addon changes are paused and settings are not saved. The notice explains restoring state.json and restarting. No installation needs to be listed for this notice to appear. The damaged file stays untouched. Restoring it and restarting clears the notice |
| R-14 | P2 | | Start installing an addon, and reload the plugin from Decky while it downloads, so the engine stops before the change begins. Over SSH, list `AddOns/.wowdeck/` and look for a `tx-…` folder. If the download finished first, make one by hand: `mkdir -p "AddOns/.wowdeck/tx-$(uuidgen)/stage"`. Then install or remove any addon (#134) | No "needs recovery" notice appears. After the second addon change, `AddOns/.wowdeck/` has no `tx-…` folder left, and the log has one line per deleted folder saying it had no marker. Every addon in AddOns is unchanged apart from the one the second change installed or removed |

## 7. Known risks to look at first

These are the places most likely to be wrong, so check them first in a full
run. The newest list comes first.

### Before 1.1.0 (2026-11-04)

1.1.0 is the first release with the arm64 engine and with transactional
addon changes. The Recovery screen still has only Retry (#118 is not in this
release). If the engine fails to start on a device, the player's only fix is
a manual reinstall, so check engine start before anything else.

1. E-1, E-7: the engine starts on the Deck and on DroidDeck from the same
   zip, and E-3's log line names the right binary for each machine.
2. PU-29: the new version reads the addon information that 1.0.1 saved,
   with no recovery notice and nothing lost.
3. R-1, R-2, R-7 to R-13: every addon install, update and removal now goes
   through a transaction. An interrupted change must leave either the old or
   the new files, and recovery must finish or undo it.
4. E-10 to E-12, R-4, M-45: detection now reads Battle.net prefixes, Steam
   shortcuts and the SD card. Look for missed installs, duplicates and
   entries pointing at the wrong flavor.
5. PU-20, PU-23, PU-28: the update channel follows the installed build, and
   switching back from Beta to Stable works.
6. Q-1 to Q-6, GA-3, GA-27: L1/R1 and the widened Get Addons on the Steam
   build installed at test time.

### Earlier risks (2026-10-15 to 2026-10-18)

Written after the owner's first device pass and the fixes for it, then
updated for the widened-QAM rework.


1. Q-1b: the glyphs come from Steam's own glyph component, found at runtime;
   if the lookup misses, text "L1/R1" shows instead.
2. M-22, O-3e, GA-3 (the browse pane), W-3: Valve's 250 px buffer above the
   focused row, measured below Decky's title / the page's header and bar.
3. M-23, O-3b–O-3d, GA-9: focus coming back to the same row after a dropdown,
   modal or picker (focus memory, S21) — plus the widening surviving the G4
   remount without flapping.
4. GA-12/GA-13: the fallback world — a Steam update renaming every hashed
   class must leave Get Addons collapsed-only and silent, and widening must
   come back on its own when the mechanism does.
5. GA-14: the close-collapse depends on Steam's QuickAccess window flipping
   `document.hidden` (the same reach as @decky/ui's own
   `useQuickAccessVisible`, G10/G13; UNVERIFIED on this device). If a Steam
   build closes the QAM without the flip, widened mode would survive into the
   reopen — check the reopen closely.
6. GA-15: a plugin reload mid-widened must revert the classes the old instance
   applied; widening everything forever would be the failure.
7. B-exit (GA-5, GA-14): B out of the pane or the destination list collapses
   and focuses the plugin-tab nav bar itself (Steam's `NavigateBack` landed on
   the destination row, which widened again); the title bar's own back button
   still returns to the plugin list. Note whether leaving mid-session leaves
   anything widened.
8. GA-16: widened-enforcement racing an intentional collapse (Steam's own
   class-drop mid-interaction) — no flap, and never widened against the
   machine's wanted mode.
9. W-3, W-3b: backup rows without buttons; Delete in the Restore dialog;
   scrolling up in Manage backups (the margin carried through DialogBody).
   Q-6: no fade over the tab bar.
10. M-5: where the context menu opens inside the QAM.

## 8. Result record

### Release 1.1.0, November 4, 2026

DEVICE. The candidate was the v1.0.2-beta.29 release zip (3a241e6), which
has the same code as v1.1.0; only Markdown and the version changed after it.
The runs used CDP probes, the virtual pad and engine RPC over SSH, and
`droiddeckctl` on the phone.

On the Deck (SteamOS 3.9.5), before release:

- Passed: E-1, E-3, R-13, Q-1, Q-4, and PU-20 up to the Switch button.
- PU-29 passed. Starting from the real v1.0.1 zip with an empty state, the
  Deck matched 41 addons over 3 installations. After addon changes in 1.0.1,
  the Beta update to the candidate kept every addon and installation, and no
  tab showed a recovery notice.
- Found #122 (P2). The release URL in the WoWDeck row in Options › Updates
  runs past the QAM's edge.
- Q-1b showed F6/F7 keycaps after CDP keyboard input. On the phone, real pad
  input shows L1/R1; recheck on the Deck with the pad.

On DroidDeck 0.6.9 (arm64), before release:

- E-7 passed. The zip installed through Decky's installer with the engine at
  mode 0600. After the session restart the log names `wowdeck-aarch64` and
  says the execute bit was restored. The phone now has a real WoW Forever
  install, which WoWDeck found on its own. MyWheel installed from Latest and
  Menu › Remove deleted it.
- GA-27 passed in full, including the Friends check: Friends' own expand
  still works, and Get Addons widens again afterwards.
- Decky hung again after the update until the session restarted. The cause
  is DroidDeck's Decky build, which runs Python 3.14 under proot. It is
  reported as Droid-Deck/DroidDeck#2103.

On the Deck after publishing, PU-4, PU-11 and PU-12 passed. 1.0.1 on Stable
was offered 1.1.0 and installed it through Decky's prompt. The staged zip's
sha256 matched the published asset. Afterwards the channel was still Stable,
all 3 installations and 45 addons were there, and no tab showed a recovery
notice.

These did not run before release: R-1, R-2, R-4 and M-45, which need a
suspend, a Wi-Fi drop or the SD card; R-7 to R-12; E-10 to E-12; PU-23 and
PU-28; GA-3 on the Deck; and the rest of the full plan. Start the next run
with them.

### Device run, November 3, 2026

DEVICE, ticket #64, M-0 and O-2a. Tested through Deck CEF probes and controller
input. Temporary RPC responses presented an empty installation list without
removing the owner's installation or addon records. The My Addons widget
showed a spinner and Finding WoW while scanning, then Found 0 installations.
Browse X opened the warning, B returned to the same row, and Find WoW installations opened
Options with its Find row focused. Installing from Details left the warning
open after Details closed; B returned to the browse row. No install RPC reached
the engine. The Find row had the blink animation, which cleared when focus
moved on. Starting a scan in Options and switching to My Addons kept the
Finding WoW state until the result arrived. Release-channel and archive gates
have deterministic frontend tests. The engine RPC test checks the empty-store
refusal. Test hooks were removed, real installations were shown again, and
auto-update was restored after the run.

Eight full detection RPCs took 5.9483, 5.9711, 6.3315, 5.8803, 6.3417, 5.8806,
6.4144 and 5.8981 seconds. Mean 6.0833 seconds; median 5.9597 seconds. These
measure the combined registry, VDF and path discovery, including RPC overhead,
not separate stages or startup. Each returned three installations. The Deck
had 84 Steam game manifests across two libraries, 76 Proton prefixes, 225
registry files in those prefixes and one shortcuts VDF. Those are inventory
counts, not a claim that every registry is read. Repeated scans used warm
filesystem caches; this is not a cold-cache or worst-case bound.

### Record template

Copy for each run, into the commit notes or `ActionItems.yaml`:

```
Regression run <date> — <Smoke|Full>
- Build: <commit>, zip sha256 <first 16>
- Device: <LCD/OLED>, SteamOS <ver>, Steam <date>, Decky <ver>
- Tester: <who>  (agent runs are T1-T3 only, guide §8.3)
- Gates G-1..G-7: pass | fail (<which>)
- Passed: <ids>
- Failed: <id>: <what happened>  (P0/P1/P2)
- Not run: <ids> and why
```

### Manual Install popup restoration, #115

The [4 November Deck run](hardware/2026-11-04-pr116/README.md) checked nested
selection, five cancellations, inspection failure, Details returns, a collapsed
installation picker and deliberate QAM close/reopen. DroidDeck, TV layouts and
all deliberate exit variants still need checking. Compare visible QAM edges
before and after each popup, rather than relying on widening classes.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| MI-115-1 | P1 | | Open Manual Install, choose From a file, and navigate through nested folders | Folders are visible and navigable. Only .zip, .rar and .7z files can be selected. A folder cannot be selected as an addon archive |
| MI-115-2 | P1 | | Select an addon archive from a nested folder | The previous full QAM width and Manual Install pane return. The archive preview appears. Nothing installs until confirmed |
| MI-115-3 | P1 | | Cancel From a file, then repeat five times | The previous full width returns every time. Focus returns to From a file. No error appears |
| MI-115-4 | P1 | | Select an archive without addon folders | The full pane width returns. The inspection error appears inline and Browse remains available |
| MI-115-5 | P1 | | Repeat a Details modal round trip from a result row, then open Install into while collapsed | The previous width, destination and focus return for both states. No clipped pane or unwanted widening |
| MI-115-6 | P1 | | After several popup returns, close the QAM and reopen Get Addons. Repeat after leaving the plugin tab and after Decky's Back button | Each fresh entry lands collapsed on the nav bar |
| MI-128-1 | P1 | | Press A on Browse… in From a file, pick an addon archive with A, then press A again | Focus is on the preview card's Install once the card shows, and the second A installs the addon. Cancelling the picker or picking an archive without addon folders leaves focus on Browse… |

The automated reproduction uses the shared browse-session and widening
adapter boundary. While a popup holds the session, Steam's content becomes
hidden and a widening enforcement collapses the native view. Showing the
same content again previously left the native width at 348 pixels despite a
wanted width of 854 pixels. The regression checks the native placeholder's translation
and ancestor width caps, then repeats through content remounts and a deliberate
close. Picker selection and cancellation mount Manual Install with its real
FocusSlot and disabled Browse control. The picker stays pending through the
remount. After it settles, the test checks that Browse becomes enabled. A
selection then moves focus to the preview card's Install, and a cancellation
leaves it on Browse. Existing file-import
state tests cover inspection errors and state survival.

The layout fixture uses the stylesheet-controlled clipping ancestor documented
in the UI guide's QAM widening measurements. Its former inline 348px cap
could never respond to Steam's widening class. The native adapter changes the
placeholder's Expanded class and CSS translation, as described in ADR 0001
revision 7. Tests check that translation and every ancestor's max-width after
popup returns and remounts. Reinstating the inline cap makes these assertions
fail; disabling pending-focus delivery makes the focus assertions fail.
Neither finding requires a production DOM change.

These are CSS constraint checks in jsdom, which has no layout engine. They do
not measure rendered bounds or establish which event order occurs on a
particular Steam build. The device checks above remain necessary.

### Manual Install file match, #126

Engine tests cover the match, the update in place, Roll back and the
match after it. The Deck
check below confirms that the card and My Addons show the same result. Use
two RestedXP zips of different versions, or any two releases of one addon
that share a folder.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| MI-126-1 | P1 | | From a file: install the older zip. Pick the newer zip, read the card's button, then Install. Pick the newer zip again, then the older zip, without installing either. In My Addons, use Roll back on the addon. Then pick the older zip, then the newer zip, and Install the newer one. Open the addon's menu | The newer zip's button says "Updates <name>" and the status says "Updated <name>". My Addons shows one listing with the newer version and the original name. Picking the newer zip again says "Reinstall". Picking the older zip says "Updates <name>", since it is no longer the installed one. Roll back returns to the older version, and Update all doesn't count the addon. After Roll back, the older zip says "Reinstall" and the newer zip says "Updates <name>", not the other way round. Installing the newer zip says "Updated <name>", and the menu offers "Roll back to <older version>" |

### Manual Install catalogue takeover, #129

Engine tests cover the takeover preview and the install that switches the
addon to a local file. File-import state tests cover the warning's words.
The Deck check below confirms the card. It needs an addon installed from
CurseForge or another addon source, and a zip of the same addon.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| MI-129-1 | P1 | | From a file: pick a zip of an addon installed from CurseForge. Read the card, then Install. In My Addons, check the addon and Check for updates. Then pick a newer zip of an addon installed from a file | The card shows an amber warning icon with "This replaces <name> from CurseForge" and "<name> will stop updating from CurseForge" under it, and Install is enabled. The words make sense without the colour. After Install, My Addons shows one listing with the same name as a Local file install, and update checks never offer it. The zip of the file-installed addon shows no warning |

### Manual Install conflict card, #130

Engine tests cover the conflict preview and the refused install, which
leaves the records and folders unchanged. File-import state tests cover the
card's words, the "+n more" cut-off, the check after Remove and where focus
goes. The Deck check below confirms the card. You need two addons installed
from files and a zip with folders from both. To make one, zip one folder
from each addon.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| MI-130-1 | P1 | | From a file: pick the zip with both addons' folders. Read the card. Press Remove on the first row, cancel, then press it again and confirm. Install | The card shows an amber warning icon with "This file matches 2 installed addons" and "Remove one, and the file will update the other" under it. Each addon's row names the addon, then lists its shared folders, cut off after three with "+n more". Install is disabled and focus is on the first Remove. Cancel removes nothing. Confirming removes the addon, the card changes to "Updates <the other>" and focus moves to Install. Install leaves one listing in My Addons |

### File picker start folder, #133

Run these on a device whose Steam user isn't `deck`, such as a desktop
Steam install, and once on the Deck.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| FP-133-1 | P1 | S | Get Addons, Manual Install, then **Browse…** | The picker lists the contents of the Steam user's home folder |
| FP-133-2 | P1 | | Options, **Add WoW folder** | The picker opens in the home folder |
| FP-133-3 | P2 | | Options, WTF backup folder picker with no backup folder set, then with one set. **Import from file…** in Manage backups | The folder picker opens in the home folder, then in the saved backup folder. Import from file opens in the home folder |

### Libraries after a source change, #135

Engine tests cover who needs a library after a takeover and after Change
source in both directions, and what each Remove choice removes. Frontend
tests cover the dialog's words and which button OK is. The Deck checks below
confirm the dialog and its focus. Use a disposable installation with
Baganator installed from CurseForge (Syndicator comes with it), a zip of the
same Baganator folder, and one unrelated addon.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| LIB-135-1 | P0 | S | Manual Install, From a file: install the Baganator zip over the CurseForge one. In My Addons, check Syndicator. Then remove the unrelated addon, from My Addons and from the Manual Install conflict card | Syndicator still says "needed by Baganator". Each Remove dialog names only the addon itself, with one Remove button. The toast names no library and Syndicator stays installed |
| LIB-135-2 | P0 | S | Remove Baganator. Read the dialog and where focus is. Press A. Then reinstall Baganator from CurseForge, remove it again and pick **Remove both** | The dialog names Syndicator and shows **Remove Baganator only**, **Remove both** and **Cancel**, with focus on **Remove Baganator only**. A keeps Syndicator, still tagged LIBRARY, saying "not needed by any addon". **Remove both** removes both, and the toast says "Also removed Syndicator". "Remove Baganator only" may wrap onto two lines, which is expected |
| LIB-135-3 | P1 | | Change source of Baganator to another source, then of Syndicator. Check Syndicator's row after each | Syndicator still says "needed by Baganator" after both |
| LIB-137-1 | P1 | | Install Syndicator from a file (Manual Install of a Syndicator zip). Change Baganator's source to a file, then back to CurseForge. Then update Baganator | Syndicator stays installed from the file after each step, with one Syndicator row. No toast mentions Syndicator |

### Libraries no addon needs, #136

Frontend tests cover the row's words, and that an unverified list marks no
library. Start where LIB-135-2 leaves off after pressing A, with Syndicator
installed and Baganator removed.

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| LIB-136-1 | P1 | S | Look at Syndicator's row in My Addons. Turn **Show libraries** off | The row shows LIBRARY and "CurseForge · <version> · not needed by any addon". It stays listed with Show libraries off, while libraries that are still needed hide |
| LIB-136-2 | P1 | | Remove Syndicator from its row | The dialog names only Syndicator, and Remove takes it out |

### Reused archive conflicts

Repeat MI-130-1 after overwriting the first addon's original zip with a bundle
containing both addons. The preview must still show both owners and disable
Install. Repeat through From a link after replacing the archive at the original
URL. Installation must refuse the conflict and leave both addons unchanged.

### TradeSkillMaster sign-in (#174)

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| TSM-174-1 | P1 | | In game mode, open Options → Addon sources. Enable TradeSkillMaster and finish browser sign-in. Turn the source off, then on. Press X on its row (Sign out). Repeat on arm64 when phone testing is authorized | Source starts off. Steam's browser signs in without copied codes, closes once sign-in finishes and Options reopens. The row shows the account. Off keeps the account and says X signs out; on again needs no browser. Sign out turns the source off, forgets the account and leaves installed addons intact |
| TSM-174-2 | P1 | | Start sign-in, return and cancel. Start again and leave it unfinished for ten minutes | Both attempts leave the source off; a late browser callback cannot enable it |

Device runs are pending; this ticket's automated checks use local endpoints.

| TSM-175-1 | P1 | | Sign in, restart Decky, then reopen Options | The source stays on, shows the account and remains usable |
| TSM-175-2 | P1 | | End the session elsewhere and wait for refresh; reopen Options repeatedly | One notification; blue dots on Options and the source row. Source stays on but unusable |
| TSM-175-3 | P1 | | Open Get Addons after session rejection, select TradeSkillMaster, use its Options jump and sign in again | Fifth destination follows Manual Install, has no browse bar, and focuses the source row in Options. Sign-in clears dots. Turning the source off hides the destination and stops token refresh requests |
| TSM-175-4 | P1 | | Disconnect the network across token refresh, then reconnect | No session-ended notification or blue dots; refresh retries without signing out |


### TradeSkillMaster addon management (#176)

| ID | Priority | Result | Steps | Expected |
| --- | --- | --- | --- | --- |
| TSM-176-1 | P1 | | Sign in and install TradeSkillMaster from its destination in each supported flavor | TSM and AppHelper install. My Addons shows versions without v, and AppHelper as a required library |
| TSM-176-2 | P1 | | With beta access, switch the normal release channel to Beta and back. Repeat without beta access | Only permitted channels appear. Each switch installs that channel |
| TSM-176-3 | P1 | | Check for a new release, update it, then repeat with automatic updates enabled | Normal update marker and update controls work. Automatic updates follow the existing setting |
| TSM-176-4 | P1 | | Remove TSM, then disable the source or sign out | AppHelper stays as an unneeded library. Installed rows remain with Source off |
| TSM-176-5 | P1 | | Interrupt a download during an update | The prior addon files and installed version remain intact |

### TradeSkillMaster folder ownership (#177)

| ID | Priority | Result | Steps | Expected |
| --- | --- | --- | --- | --- |
| TSM-177-1 | P1 | | Start with TSM and AppHelper from files or another source in two installations. Sign in and refresh each | Both folders use TradeSkillMaster without reinstalling. Existing files stay intact |
| TSM-177-2 | P1 | | While signed in, try each folder through another catalogue, a pasted link, Change source, Manual Install and Roll back to a kept archive version after adoption | Each refuses with "TradeSkillMaster installs this addon". Files stay intact |
| TSM-177-3 | P1 | | Refresh with a git checkout or development build in either folder, then try installing TSM | Developer folders remain untouched |
| TSM-177-5 | P1 | | With TSM or AppHelper installed from another source and TradeSkillMaster signed in, open Change source on each | TradeSkillMaster is listed and switching to it keeps the files |
| TSM-177-4 | P1 | | Disable the source, refresh both installations, then install from a file. Enable it and refresh. Repeat with Sign out | Disabling and signing out leave files installed with Source off. Other sources work while unavailable. Enabling restores TSM ownership |

### Retail auction data (#178)

| ID | Check | Expected |
| --- | --- | --- |
| TSM-178-1 | Sign in with Retail realms followed; open TradeSkillMaster in Get Addons. | Installed version/channel or Install, account tier and account-wide allowance, "Updated … ago" freshness for each followed realm and region appears. Realms read "Name · Faction" with a Follow or Unfollow button. Without data they say No auction data yet. Refresh auction data says Refreshing… until new data arrives, then shows when the data was last updated. Followed realms in every flavor get prices: realm times follow the price scan, not historical data. |
| TSM-178-2 | Leave WoW running and receive a newer auction push with two eligible Retail installations. | Both active and inactive installations receive prices; the destination updates without reopening. Connected realms share prices. Catalogue house type All produces one connected-realm entry. A Retail installation with only TradeSkillMaster also receives data. |
| TSM-178-3 | Disconnect networking and reopen the destination. | Cached follows and catalogue remain visible with timestamps from the installation's file. |
| TSM-178-4 | Drop a followed realm on the account, then reconnect. Preserve an unknown line in the existing data file. | Dropped realm data is pruned; the unknown line remains unchanged. Failed writes preserve the previous file. |

These device checks are pending; deterministic RPC coverage uses a fake WoW
tree, recorded protocol fixtures, a local socket/blob endpoint and manual timers.

### TradeSkillMaster followed realms (#179)

| ID | Steps | Expected |
| --- | --- | --- |
| TSM-179-1 | Open the destination with realms followed from another computer. Unfollow one, then follow it again. | Manage lists external follows with an account-wide warning. Counts update; dropped Retail prices disappear from every eligible installation. No follow is removed automatically. |
| TSM-179-2 | Unfollow a realm, sign out, restart and sign back in. | The declined choice remains. Following manually clears it. WoWDeck-added follows retain their ownership across restart. |
| TSM-179-3 | Attempt a follow at the displayed allowance. | The request reaches TradeSkillMaster. Server acceptance updates the list; refusal leaves it unchanged and shows an error. Failed unfollows keep the follow and its ownership. Repeated or concurrent follows do not send duplicate writes. Controls from a previous installation cannot replace the current list. |

### TradeSkillMaster character realm discovery (#180)

With several known installations, sign in with Retail character folders and
Classic TSM SavedVariables present. Check that recent character realms are
followed first across installations, with Retail first on equal timestamps.
Use TradeSkillMaster.lua as the game writes it (it saves TSMItemInfoDB too),
and check every realm and faction with a character is listed with Follow.
Before a Classic login has saved faction and region, check that no faction is
guessed. After login, wait for discovery and check the correct faction appears.
At the account limit, check remaining candidates have usable unfollowed toggles.
Unfollow one, sign out and back in, and check it stays unfollowed. Follow it by
hand and check the choice clears. Remove a character folder and check its
account follow remains. Repeat with Hardcore, Season of Discovery, Anniversary,
progression and Forever. Device execution remains pending.

Disconnect networking when a new character appears, then reconnect. Discovery
retries the follow without needing another new character. A server refusal
stops that discovery batch; unchanged scans do not repeat refused requests.


### TradeSkillMaster interruption recovery (#181)

Device results are pending. This implementation run did not authorize or access devices.

- On Steam Deck in game mode, enable TradeSkillMaster, complete sign-in in Steam's browser, and return to WoWDeck.
- Install TradeSkillMaster and its AppHelper library. Confirm realm and region update times appear within seconds, then check prices in WoW.
- Select Refresh auction data. Confirm the active installation gets current prices again, even with unchanged timestamps. Check that another current installation stays unchanged.
- Refresh while downloads are still arriving. Confirm old queued downloads do not resume or replace the refreshed data.
- Update or reinstall AppHelper and change its source where permitted. Confirm data returns after the folder swap without waiting for the next scheduled push.
- Suspend and wake the Deck. Confirm auction data resumes immediately. Disconnect the network, restore it, and confirm recovery. Disable the source and confirm sync stops.
- Copy Diagnostics while signed in and after sign-out. Confirm it shows enabled state, authentication, tier, socket state, last push and followed count, without account names, realm names, tokens or download links.
- Repeat Steam-browser sign-in, install, refresh, update recovery and data arrival on DroidDeck arm64. Compare the destination and in-game prices with Deck behavior. Ask before every phone Steam session stop or start.

### TradeSkillMaster cross-flavor prices (#182)

Pending on-device verification. Use existing account follows without relying
on character discovery. Repeat for Classic Era, Hardcore, Season of Discovery,
Anniversary, progression Classic and WoW Forever where available.

| ID | Action | Expected |
| --- | --- | --- |
| TSM-182-1 | Keep one installation active and refresh prices with AppHelper installed in other flavors. Also include an installation with only TradeSkillMaster. | Every matching installation receives realm, shopping and region data. Localized realm names have the correct Horde or Alliance suffix. Connected realms share data within the same faction. |
| TSM-182-2 | Switch installations in the destination, including both factions and a region without data. | Only realms, factions and regions supported by that installation's saved character evidence appear. Factions and update times match the installed data. Missing data says it is waiting. |
| TSM-182-3 | Log into each available flavor and faction after delivery. Compare a known item's realm, shopping and region prices with TradeSkillMaster's desktop data. | Prices load in game for the correct region and faction. Record any unavailable flavors as unverified. |
| TSM-182-4 | Unfollow one faction house while keeping the other followed, then refresh. | Only the unfollowed house is pruned. The other faction's prices and unknown file lines remain. |

### TradeSkillMaster folder changes (#187)

Pending on-device verification.

| ID | Action | Expected |
| --- | --- | --- |
| TSM-187-1 | Update AppHelper, let new prices arrive, then roll it back. | Prices reach the restored AppHelper within seconds, without waiting for the next push. |
| TSM-187-2 | Remove AppHelper from My Addons, then repeat with a hand-copied AppHelper folder removed as unmanaged. | TradeSkillMaster's own data file gets current prices within seconds each time. |
| TSM-187-3 | Install AppHelper from Manual Install. Then remove both addons and install TradeSkillMaster, which installs AppHelper as a library. | Each install succeeds and prices reach AppHelper within seconds. |
| TSM-187-4 | Disable the source or sign out, then install or remove AppHelper. | The change succeeds and WoWDeck makes no TradeSkillMaster connection. |


### TradeSkillMaster grouped addon controls (#194)

Run on Steam Deck or DroidDeck only after a device-test request. These cases have not been run on a device.

| Case | Action | Expected |
| --- | --- | --- |
| TSM-194-1 | Open the destination with neither addon, both addons, only TradeSkillMaster, then only AppHelper installed. | Install appears when both are absent. Uninstall appears when either is present. The action shares one row with Refresh auction data. Both labels fit the widened pane. |
| TSM-194-2 | Use the controller to open Uninstall, then cancel with Cancel and with B repeatedly, including a panel remount and delayed data load. Wait for modal exit to settle. | The dialog names TradeSkillMaster and AppHelper. Nothing changes. Focus returns to the action row and can reach Refresh. |
| TSM-194-3 | Confirm Uninstall both with another installation configured and unrelated libraries installed. | Only the selected installation loses the two named addons. Sign-in, account follows, other installations and unrelated libraries stay. Install becomes available. |
| TSM-194-4 | Try removal with a developer copy or an installation requiring recovery. | A visible error directs the player to My Addons. Protected files and recovery copies stay. Retry reflects the remaining addons. |
| TSM-194-5 | Install from the action row, then navigate between Install or Uninstall and Refresh with the controller. | Both addons install into the selected installation. Uninstall replaces Install. Focus stays usable through confirmation and return. |
### TradeSkillMaster account follows (#192)

Run on a device only after a device-test request. Use an account with follows
in several regions and WoW versions, including a realm absent locally.

| ID | Action | Expected |
| --- | --- | --- |
| TSM-192-1 | Open the destination and use the controller to reach Manage beside the count. | The headline says TradeSkillMaster. Signed in shows the account name. No tier label appears. Manage lists all account follows with region, WoW version and faction where applicable. |
| TSM-192-2 | Select the last follow, then cancel with B and Cancel repeatedly. Select a different follow and repeat. Measure the containing row identity, not only the repeated Unfollow label. | Confirmation explains the change affects every computer. Cancel has initial focus. Neither cancellation changes the account. Focus returns to that follow. |
| TSM-192-3 | Confirm Unfollow, then repeat with a service failure. | Success removes the row and updates the count. Failure keeps the follow and shows an error with retry available. |
| TSM-192-4 | Close Manage with B or Done. Reopen it after character discovery and a plugin restart. | Focus returns to Manage. The removed follow stays absent, including when local characters use that realm. |


### TradeSkillMaster local evidence (#193)

Device execution requires an explicit device-test request. These cases have
not been run on a device.

| ID | Action | Expected |
| --- | --- | --- |
| TSM-193-1 | Switch between installations with different saved regions and Classic factions. | Each list uses only the selected installation's evidence. A saved Horde scope does not expose Alliance. A region without matched evidence stays hidden. |
| TSM-193-2 | Select an installation with no saved character evidence while the account follows realms elsewhere. Navigate to Manage with the controller and open it. | The local list is empty, with help about logging in and logging out to save settings, and enabling TradeSkillMaster and AppHelper for Classic. Account count and Manage remain available. Manage lists all account follows. Closing it returns focus to Manage. No follow changes. |
| TSM-193-3 | Follow the help for a missing destination, then reopen the destination after WoW saves settings. | Matching realm, faction and region rows appear. Help describes locally saved evidence without claiming live Blizzard character knowledge. |

### Optional TradeSkillMaster uninstall cleanup (#195)

Pending a device-test request. These cases have not been run on a device.

| Case | Action | Expected |
| --- | --- | --- |
| TSM-195-1 | Open Uninstall with exclusive, shared and pre-existing account follows. | Cleanup starts unchecked. Preview identifies eligible realms by region, WoW version and faction. Shared and pre-existing follows are excluded. |
| TSM-195-2 | Cancel, then uninstall with cleanup unchecked. | Cancellation changes nothing. Unchecked uninstall removes addons and preserves all follows and sign-in. |
| TSM-195-3 | Select cleanup and confirm while some unfollows fail. | Addons are removed. The result names follows left behind separately from local removal. Successful removals stay unfollowed after discovery. |
| TSM-195-4 | Navigate preview, cleanup toggle, Cancel and Uninstall both with controller. | Controls remain reachable; consent text explains the account change affects all computers. |
| TSM-195-5 | Confirm cleanup after a successful preview while the account service cannot reload eligibility. | Addon removal proceeds. The result names the previewed follows left behind. No follows are deleted using stale eligibility. |
| TSM-195-6 | Confirm uninstall, close the QAM while it runs, then reopen it before and after completion. Repeat with addon failure and account cleanup failure. | Working remains visible while pending. The returning panel shows removal errors or the cleanup result with realm identities. Other installations do not inherit the result. |
| TSM-195-7 | Remove a follow in Manage or cleanup while DELETE succeeds but subsequent account reads fail. | The removal succeeds. Manage updates its list and count. Cleanup counts the follow as removed, and discovery does not recreate it. |

### TradeSkillMaster Deck verification, 2026-11-10

DEVICE, Steam Deck via `tools/deck-ui/deck`, deployed frontend and engine.
Account heading and allowance showed correctly after removing the old tier row.
Manage listed four account follows across Classic Era, Hardcore and Forever.
Down selected the next follow. Its confirmation started on Cancel; B returned
to the list without mutation. Uninstall named both addons, with cleanup
unchecked and no eligible follows for Forever. Cancel left the addons present.
The corrected action row fit both buttons and Right moved from Uninstall to
Refresh. Switching Classic Era and Forever updated the destination while
Manage retained all four account follows. No plugin errors appeared.

Closing a modal with B closed the QAM; reopening returned to the destination
selector rather than Manage. Return focus remains unverified. The audit still
reported one overflow elsewhere in the pane. No live unfollows or addon removal
were performed. Empty-evidence, partial-removal and cleanup-failure cases remain
covered by automated tests, with device execution pending.

### Manage return-focus follow-up, 2026-11-10 (#192)

DEVICE, Steam Deck via `tools/deck-ui/deck`, frontend-only deployment over
0589c04's engine, with Forever selected. After cancelling a stale installation
selector without changing the installation, both B and Done closed Manage and
returned directly to the TradeSkillMaster destination with Manage focused.
No manual QAM reopening was needed. Down reached Uninstall and Up returned to
Manage. Within Manage, Down moved from Soulseeker Alliance to Soulseeker Horde.
Both buttons say Unfollow, so the action probe reported no change; inspecting
the focused button's containing row confirmed the move. Confirmation opened on
Cancel. Down reached Unfollow and Up returned to Cancel. B and Cancel each returned to the account list while keeping Manage
open. No live unfollows or addon removals were performed. Diagnostics reported
no plugin errors. The earlier failed return-focus observation above describes
the previous build.

Automated component coverage unmounts the destination while Manage is open,
then remounts it with the account response held pending. Both dismissal paths
reopen the QAM and focus Manage when that response resolves. Both tests failed
before the fix because the QAM was never reopened. The existing focus-memory
restore window remains two seconds; longer account delays are not verified.

### Expanded TSM Deck run, 2026-11-10

See [the device report](tsm-deck-test-2026-11-10.md) for live account unfollow and restoration, grouped removal and installation, helper retention, developer protection, file verification and every TSM case disposition. This run remains incomplete. Authentication scenarios were excluded by request; skipped cases still require verification.


### Four-gap Deck follow-up at fe047cc, 2026-11-10

DEVICE. The source-off real Manual Install picker installed the backed-up helper ZIP successfully as provider File. Source state was restored. The positive cleanup preview listed Normal Horde / EU / Forever from existing current-account ownership. Controller navigation checked the toggle, reached Uninstall both and Cancel, and cancelled without changing the four follows. Manage Cancel row identity was already measured in the preceding focus-fix run.

TSM-195-6 remains incomplete. A bounded 35-second pause of only our engine held a real unchecked uninstall pending. Closing and reopening QAM, then returning to TradeSkillMaster, displayed the heading/version without Working while destination data was loading. Removal completed after automatic engine resume. The working-tree follow-up below records the attempted fix verification. The picker attempt did not switch installations, so it does not verify result isolation. No code was changed in the test run.

TSM-192-3 service-failure presentation remains unverified. The shipped engine has constructor-only TSM endpoint injection and no environment or RPC override; its isolated runner cannot render through the ordinary UI bridge. A localhost service test through that UI needs an explicit bridge or endpoint seam. Production account responses and network settings were not changed. See the device report for scoped counts and restoration. Its 26 isolated device scenarios are not live account passes. Excluded authentication portions are counted separately from remaining authorized gaps.


### Working-tree action-row Deck follow-up, 2026-11-10

DEVICE, local HEAD dca0923 with the uncommitted action-row fix. Real unchecked removal showed Working immediately after confirmation, but completed before QAM reopened. Pending remount before destination data remains unverified. Real dropdown selection reached Forever Beta and returned to Forever; neither displayed leaked busy/error state after completion. No cleanup result existed, so result preservation and switching while busy remain uncovered. TSM-195-6 retains PARTIAL.

Uninstall Cancel and B returned to Uninstall, then Right reached Refresh auction data. Manage last-row confirmation started on Cancel; B and Cancel returned to the measured Normal Horde row. Restored folders, generated helper data, original addon records and exact choice metadata from backups. Verified all static files without mismatches, original four follows, signed-in status, enabled source and Forever selection. `deck down` restored autoUpdate. See the device report for comparison counts and the generated-data refresh boundary. No production edits or authentication actions. Parent owns final checks and commit.


### Deterministic action-row Deck retest, 2026-11-10

DEVICE, local HEAD dca0923 with the uncommitted action-row fix. Prepared the ordinary unchecked Uninstall preview, then paused only the RPC-identified wowdeck engine for 35 seconds through an isolated SSH command with automatic SIGCONT in finally. Confirmed Uninstall both, closed and reopened QAM, then selected TradeSkillMaster. Working remained visible while the engine and destination RPC were still held. Pending-remount visibility passes for this working tree.

Real dropdown navigation focused Forever Beta, but selection waited on the same paused engine. The pane stayed on Forever with Working. After automatic resume, Beta was selected and the startup retry screen appeared; plugin reload recovered access. Busy-state isolation and return to Forever while pending remain unverified. No cleanup result or removal error existed to verify preservation. Completion was not observed before backup restoration. TSM-195-6 retains PARTIAL. The earlier missing-Working observation describes the previous build; the two focus defects were already fixed and retested.

Restored original folders, addon records and choice metadata. Verified 42,214 static files without mismatches, exact records and choices, Forever selected and all four original follows. Engine resume was confirmed before restoration reload. `deck down` restored autoUpdate. No production edits, commits, pushes, authentication or account mutations. See the device report for the exact sequence and remaining limits. Parent owns final checks and commit.


### Updated status invalidation, #196

| Check | Steps and expected result | Status |
| --- | --- | --- |
| UPDATED-196 | Update an addon successfully. Confirm Updated in My Addons, Get Addons and details. Check after its provider publishes another release. Updated disappears everywhere while Update available remains. Withdraw the offer, change channel and restart WoWDeck. Updated stays absent. Failed and already-current attempts leave it absent. Successfully update again, manually, with Update all or automatically. Updated returns and expires after the configured duration. | PARTIAL. DEVICE at 13744fe, 2026-11-11: after a rollback of Forever Loot Sparkles to v1.3.1 and a refresh, Updated disappeared from My Addons, the Get Addons result and Get Addons details while Update available remained (What The Whisper - Forever lost it the same way on a real release). It stayed absent through a WoWDeck restart and returned after a successful manual update, twice. A refresh with no update kept Updated. Withdrawal, channel change, failed and already-current attempts, Update all and automatic updates were not run on device; service lifecycle and frontend tests cover them. Earlier run at 69976b3, 2026-11-10, matched. |

### PR #210 review follow-up, device checks pending

- From the first, middle and last Options rows, press Right past the row's own controls. Focus reaches the floating Update button. Left returns to the exact control and scroll position.
- With no update offered, or while Update is disabled, Right keeps its normal behavior. Up and Down continue through Options.
- The floating panel shows its status once beside a button labeled Update. Words wrap normally, and the button label stays on one line. Download progress replaces the action in the same panel.
- Check every modal-opening row with and without a description. Its chevron stays at the right edge and vertically centered against the whole row.

These cases have not been run on hardware.
