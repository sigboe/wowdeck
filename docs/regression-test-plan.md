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
| G-5 | `python3 tools/test_package.py && python3 tools/test_main_bridge.py` | 19 + 8 tests OK |
| G-6 | `python3 tools/package.py` | one zip, `build/WoWDeck.zip`, and no `build/wowdeck/` left (unless `--keep-stage`); the packager's ELF check passes (engine interpreter `/lib64/ld-linux-x86-64.so.2`). Note the sha256 |
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
| E-3 | P0 | | SSH: `file` / `readelf -l` on the engine binary | Interpreter `/lib64/ld-linux-x86-64.so.2` |
| E-4 | P1 | | Kill the engine process (`kill <pid>`), open the plugin | "Engine is not running" row with a Retry button; Retry brings it back |
| E-5 | P0 | | Decky → reload plugin, or restart Steam | Engine respawns; the plugin opens on the last tab |
| E-6 | P1 | | Read the latest plugin log under `~/homebrew/logs/` | No exceptions. (Decky lowers the log level once the UI connects, so a clean log doesn't prove much.) |

## 4. UI regression (the rework, T6)

### 4.1 QAM shell and tabs

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| Q-1 | P1 | S | Open the plugin; press L1/R1 | Tabs move My Addons → Get Addons → Options and **stop at the ends** (R1 on Options and L1 on My Addons do nothing; owner decision 2026-10-20: with three tabs in a narrow bar, wrapping is more jarring, and Steam's own bars differ). Steam-style pills: selected grey, focused white; inactive tabs show icons only |
| Q-1b | P1 | S | Look at the glyphs at both ends of the tab bar, with the Deck's own controls and (if you have one) an Xbox/PlayStation pad | **The same glyphs Steam shows in its own Library tab bar for that controller** (LB/RB on Xbox, L1/R1 on Deck/PlayStation). If they differ from the Library, note both |
| Q-2 | P2 | | Touch each tab | Same as Q-1 |
| Q-3 | P2 | | Compare the tab bar with the plugin list's look (font, spacing, section titles) | Section titles are 12 px uppercase grey like Steam's; rows have Steam's separators and focus highlight. Nothing is squeezed or overlapping |
| Q-4 | P1 | | Close the QAM on Options, reopen | Comes back on Options |
| Q-5 | P1 | S | With more than one installation, My Addons: look at the top at rest, then scroll the list down | The tab bar and the **Installation** picker sit directly under Decky's title with no gap, at rest and while scrolling (a floating pane, opaque) while rows scroll under them; picking another installation reloads the list. Other tabs: only the tab bar floats |
| Q-6 | P1 | S | Focus the tab bar, then scroll a long list a little and look at the tab bar and the line under the floating pane | The tab bar is never cut or faded (the glyph keycaps and pills are whole); a soft fade appears **under** the floating pane only once the list is scrolled, never at rest and never over the tab bar or a focused row |
| Q-7 | P2 | S | Open the plugin and look at the title | "WoWDeck Manager" on one line; Decky's back button has no fade over it; about 16 px between the title and the tab bar, like Steam's own QAM pages ("Quick Settings") |

### 4.2 My Addons

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| M-1 | P1 | S | D-pad Down through the list | One stop per addon; the page scrolls with focus; nothing skipped |
| M-2 | P1 | S | Focus an addon; look at the footer | A **Details**, Menu **Options**, and X **Update** only when that addon has an update |
| M-3 | P1 | S | A on a managed addon | Details opens (carousel, description, changelog); B closes and focus returns near the row |
| M-4 | P1 | S | X on an addon with an update | Spinner on the row, then a toast "Updated <name>" with the plugin icon; the row's "→ new version" disappears |
| M-5 | P1 | S | Menu on an addon | Steam context menu: Update (blue, if offered), Details, Ignore, then a separator and Remove (red). B closes it. **Check where it appears** inside the QAM |
| M-6 | P1 | | Touch the ⋯ button on a row | Same menu as M-5; tapping it doesn't also open Details |
| M-7 | P1 | | Touch the row itself | Opens Details |
| M-8 | P0 | | Menu → Remove → confirm | Folder gone from AddOns; toast "Removed"; a dependency installed only for it is also removed (autoremove) |
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
| M-33 | P1 | S | An addon installed as another's dependency (Syndicator via Baganator) | **LIBRARY** tag and "needed by Baganator" on its row. **Show libraries** (bottom, saved) hides and shows such rows. Remove on Baganator: the confirmation says it also removes Syndicator |
| M-34 | P2 | | An addon whose TOC needs a folder that is missing | The row says "missing <name>" and sorts with the other problems |
| M-35 | P1 | S | Update an addon (or let auto-update do it), then its Options menu | "Roll back to <old version>" right after "Release channel"; it puts the old files back (toast) and offers "Undo rollback (<new version>)"; using it toasts "Returned <name> to <new version>" |
| M-36 | P1 | | Options → Updates → **Previous versions kept** | Shows the space ("17 MB for 1 addon"); **Clear** empties it ("None kept") and the rollback item disappears. **Keep previous versions** off: updates keep nothing |
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

Browse bar and zero-capability screens (ADR 0002, `.scratch/get-addons-filter-bar`,
device-passed 2026-10-23 on the Deck screen, pane 506 CSS px):

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| GA-18 | P1 | S | Right/A from Latest and from Popular, with results loaded; then Up | Focus lands on the first result row, never on the bar; Up reaches the bar (Source, and Category on Popular). Search and From URL start on their text field |
| GA-19 | P1 | S | Popular with two discover sources on (WowUp Hub + CurseForge) | One bar row: **Source** and **Category** inline side by side, values truncated with an ellipsis, nothing wraps; with one source on, Source is hidden and Category closes up to the left. No "(off)"/"(not set up)" entry in either menu |
| GA-20 | P1 | S | Popular open on row 3; R1 to Options, toggle a discover source off; L1 back to Popular | Get Addons lands collapsed (GA-1); opening Popular again shows the same list and source with focus back on row 3; the bar stays one row (a segment may hide); results never reload or jump (verified DEVICE 2026-10-27: WowUp Hub off, Popular on CurseForge kept its page and row 3, Source hid, Category closed up to the left, no request) |
| GA-21 | P1 | S | Turn every discover source off (CurseForge and WowUp Hub); open Latest, then Popular | The zero-source screen, not results: each destination with its own icon (clock for Latest, flame for Popular) and words ("No addon source is on for Latest" / "…for Popular"), body naming the sources that can serve it, **Open addon sources** focused on entry; no turn-on offer row. Search with no name-search source shows the same shape naming those sources. Destination rows read "Needs an addon source" |
| GA-22 | P1 | S | A on **Open addon sources** | Options opens at Addon sources; the compatible rows (WowUp Hub, CurseForge) pulse together with Steam's own row highlight, full row size and no outline, three times (~1.8 s), and the first one's toggle has focus. Nothing was turned on. Moving focus clears the marks; focus is never trapped |
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

### 4.5 Options

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| O-1 | P1 | S | D-pad from top to bottom of Options | Every row reachable; dropdowns, toggles and drill-in rows look like Steam's settings |
| O-2 | P1 | | WoW installations: **Find WoW installations** | Finds the Steam/Lutris/Proton installs; toast with the count |
| O-2b | P0 | | A WoW root with a `_forever_` folder (the Forever client): **Find WoW installations**, then Get Addons → search "Questie" | The installation is listed as "Forever" (Installation details: "World of Warcraft: Forever · _forever_"), not Retail; a `_retail_` beside it stays Retail; Get Addons finds Forever addons |
| O-3 | P1 | | **Add installation manually**: Browse, then back out of the picker without choosing | Focus is back **on the Browse button** |
| O-3b | P1 | | Browse, pick a folder | The path is filled in and focus is **on Display name (optional)** |
| O-3c | P1 | | **Game version** dropdown: open it, back out; open it, pick another | Both times focus returns to **Game version**, the page does not jump |
| O-3d | P1 | S | Anywhere in Options (e.g. Safety backups to keep, Active installation, Export): open the dropdown/modal and come back | Focus returns to the same row every time; note any jump |
| O-3e | P1 | | Scroll far down Options, then Up to the top | Rows stay clear of the title (as M-22) |
| O-3f | P2 | | Move through every text field in Options (WoW folder, Display name, CurseForge key if shown, GitHub token) and Import/Export | Each is a row with its label above (QAM) or beside (dialogs) the input, and the **whole row lights up** when the field has focus, the same for all of them |
| O-4 | P0 | | **Installation details** → **Remove this installation…** → confirm | Removed from the list; **no files deleted** on disk |
| O-5 | P1 | | **Installation details** → **Rescan addons** | Addons changed outside WoWDeck show up; toast "Addons rescanned" |
| O-5b | P1 | S | Options → **Installation details** | A dialog titled with the installation's name: Game version (1.60.1), Build (70338), Game type (Forever Beta, with "World of Warcraft: Forever Beta · _classic_beta_"), Added, Game folder (~/…), Addons ("16 installed, 15 managed"), then Rescan and Remove (red), Close. No AddOns folder row. D-pad reaches every row; B closes |
| O-5c | P1 | S | Options → **Active installation**, press **Y** | Footer shows Y **Installation details**; Y opens it. The description reads "Version 1.60.1 · Detected automatically" and wraps only between the two facts. There is no separate "Installation details" row |
| O-5d | P1 | S | **Add installation manually** → Browse → pick a WoW version folder (e.g. `_classic_era_`) | Display name fills in ("Classic Era") and Game version switches from Auto to the detected version at once; both can be changed. A name you typed is kept. The label is "Display name" (no "optional") |
| O-5e | P0 | S | From Options open **Export addon list**, **Import addon list**, **Manage backups**, **Installation details** (Y on Active installation) and each dropdown; back out with B each time | Focus returns to the **same row** every time (regression 2026-10-17) |
| O-6 | P1 | | Addon list: **Export** → Generate, Copy, Save to file | Export code shown; file written |
| O-7 | P1 | | **Import** from a string and from a file (WowUp's own `.txt` export too) | Preview lists names; "Install N new" installs them; each result line starts with the addon's name ("Alpha: installed" / "Beta: failed, …"); footer is action first, Close second |
| O-8 | P1 | | CurseForge: bundled key status; **Recheck bundled key** | Shows working; the key itself is never displayed |
| O-9 | P2 | | Enter your own CurseForge key, then clear it | Saved hidden; fallback to the bundled key afterwards |
| O-10 | P2 | | GitHub personal access token: save, clear | "A token is saved (hidden)"; clear works |
| O-11 | P1 | | Providers: turn one off | Its results vanish from Search; turning it back on restores them |
| O-12 | P2 | | Notifications: **Update available toast** off/on | Respected by the once-a-day toast (L-3) |
| O-13 | P2 | | Diagnostics: **Show diagnostics** | Versions, paths and recent errors; no secrets |

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
`system.updateStage`) and PU-18–PU-20 and PU-24 (the panel, its release notes, the update dot
and the switch to stable) in the same window as PU-4; PU-23 (Update on Beta)
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
| PU-4 | P0 | S | Release window: tag `vX.Y.Z` pushed, Deck still on the older version, day's check due (clear `lastPluginUpdate` to force); reload the plugin | One toast "WoWDeck X.Y.Z available" / "Update in Options"; row "WoWDeck update available" / "\<old\> → \<new\> · https://github.com/sigboe/wowdeck/releases…"; the log shows the one successful call (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: one toast, `pluginUpdateToastShownFor` "0.2.0", row 0.1.9 → 0.2.0 with the release link) |
| PU-5 | P1 | | Same day as PU-4: leave and re-enter Options, switch tabs, close and reopen the QAM, reload the plugin | Row stays correct; **no second toast for that version — ever**; no second `releases/latest` call in the log — the answer is stored for 24 h (`lastPluginUpdate`) and the toast mark for good (`pluginUpdateToastShownFor`), neither per engine session (verified DEVICE 2026-10-26: plugin reload plus QAM close/reopen — no second toast, `lastPluginUpdate.checkedAt` unchanged, no `[plugin-update]` line) |
| PU-5b | P1 | | After PU-4's toast: restart the Deck entirely (not just reload the plugin), wait for the plugin to load again | No second toast; `state.json` still carries `pluginUpdateToastShownFor: "X.Y.Z"`; the row still says the update is available |
| PU-5c | P2 | | A second, newer tag `vX.Y.Z+1` while the Deck is still on the old version, next day's check due | Exactly one more toast — "WoWDeck X.Y.Z+1 available" — and never two for the same version afterwards |
| PU-6 | P1 | | Suspend and resume: a short sleep, then one that crosses the 24 h mark | Short sleep: no WoWDeck toast, no request (still inside the interval). Crossing the mark: the wake triggers one check — a toast only for a release version not already announced, a `[plugin-update]` line only when it failed. The addon-updates toast (N-1) is a different check with its own daily stamp |
| PU-7 | P2 | | Decky → reload WoWDeck during PU-4's window | Inside the interval: no toast, no request — the stored answer is returned. When the day's check is due: one request, and a toast only if the newest version was not announced yet (verified DEVICE 2026-10-26 inside the interval, with PU-5) |
| PU-8 | P1 | S | Update the Deck to the new release (Install from URL again, README "Update"), open Options → Updates | Row "WoWDeck \<new\>" / "Up to date"; no toast — the notice the release window raised is now cleared (verified DEVICE 2026-10-26, owner-run: the row reads "Up to date" on 0.2.0) |
| PU-9 | P2 | | During PU-4: try to reach the release page from the row with the controller | The row shows the URL **as text** — nothing focusable. **Decided 2026-10-26 (owner): accepted** — updating is the **Update** button and the URL stays informational text; there is no link to press. Revisit only if users ask for one |
| PU-10 | P2 | | Public repo whose newest release is a draft/prerelease only (`releases/latest` answers 404) | Reads "Couldn't check for a newer release", like PU-1 — never a failure; informational, matches the engine contract |
| PU-16 | P1 | S | Wi-Fi off or repo unreachable, day's check due (PU-2's state): let one check fail, then reload the plugin and re-open Options several times within the hour | No request in the log for any trigger — the failure backed off; the row may keep yesterday's stored answer ("Up to date"/"update available") or say "Couldn't check" when none was stored; still no toast, no error, one `[plugin-update] check unavailable` line per real attempt only (verified DEVICE 2026-10-26, engine-only run with an unreachable releases URL: first trigger `checked: true` plus one log line, every later trigger and a fresh session `checked: false`, no request) |
| PU-17 | P1 | | PU-16's state kept failing for 1h, then 2h more (offline overnight, say); Wi-Fi back | The next trigger after each window runs exactly one real attempt (`pluginUpdateBackoff.failures` grows: window 1h, then 2h, then 4h — capped); once one attempt succeeds, the normal daily cadence is back and `pluginUpdateBackoff` reads `null` in `state.json` (verified DEVICE 2026-10-26, engine-only, windows elapsed by editing `failedAt`: failures 1→6, 3.5 h after the 6th failure still no request (4 h cap), 4 h 01 m after one request that succeeded — backoff `null`, one toast-pending answer, then stored answers) |
| PU-11 | P0 | S | Release window (PU-4's state), release has `WoWDeck.zip`: press **Update** on the update panel under Options' nav bar | Button reads "Preparing…", then Decky's own install prompt for WoWDeck \<new\>; log `[self-update] staged WoWDeck X.Y.Z …`; a 0600 `wowdeck-update-X.Y.Z.zip` in the temp dir (verified DEVICE 2026-10-26, owner-run: private repo + token) |
| PU-12 | P0 | | PU-11's prompt: confirm | Decky installs and reloads WoWDeck; the open panel closes (decky-loader #976); reopening shows the new version and PU-8's row (verified DEVICE 2026-10-26, owner-run: the Deck came up on 0.2.0) |
| PU-13 | P1 | | PU-11's prompt: cancel | Nothing changes; the old version keeps running; the button is usable again (verified DEVICE 2026-10-26, owner-run). Scope: the **loader's own** prompt is upstream — cancelling after decky-loader takes over can leave the plugin uninstalled; that is decky-loader's flow, not ours |
| PU-14 | P1 | | Private repo with PU-1b's token, release window: press **Update** | Same as PU-11 — the download uses the token, never logged (verified DEVICE 2026-10-26, owner-run: this is the path the 0.2.0 pass used) |
| PU-15 | P2 | | No newer release (or the check couldn't run); then a release without `WoWDeck.zip` | No update panel, Options looks as before; the Updates row has no Update button (only its ⋯) and reads up to date / couldn't check. Without the zip: no toast, no panel, no dot — the Updates row names the release and its link; once the zip is attached the next check (an hour later at most) brings the panel, the dot and the version's one toast (verified DEVICE 2026-10-26, engine built as 0.1.9 with a stored no-zip answer: no toast, dot or panel, row 0.1.9 → 0.2.0; aged 61 min, the reload re-checked GitHub, found the zip and showed one toast, the dot and the panel; a further reload did not toast again) |
| PU-18 | P1 | S | Release window: open Options, press Down from the tabs; scroll; switch tabs (L1/R1) and back. Then press Down from **Update** | Panel "WoWDeck X.Y.Z available" + **Update** floats under the nav bar, no animation; Down lands on it first; the list scrolls under it without hiding rows; the panel row is remembered like My Addons' installation switcher. The Updates row shows current → latest and the release link, no button. The panel is exactly the one line and button, with no release notes under it. #8 moved them to PU-24's modal. Down from **Update** moves straight to the rows below (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: panel under the nav bar, focus lands on **Update**; row 0.1.9 → 0.2.0 · link, no button. Release notes verified DEVICE 2026-10-27, engine built as 0.1.9, virtual pad and deck-ui measurements: Stable offered v0.2.0, Beta v0.2.1-beta.1, each with its own notes as plain text in a 104 px box, **Update** fully on screen above it; entering the box did not scroll it, each Down scrolled ~30 px to the true bottom, the next Down moved to the Active installation row, Up re-entered, a held Up/Down glided and stopped at the edge, Up at the top returned to **Update**; that inline box is gone since #8, so the panel without notes still needs a pass) |
| PU-19 | P1 | S | Release window: look at the nav bar on My Addons, then move focus onto the Options tab (white pill) and open it; focus the panel's **Update** button; then update (PU-11) | An orange dot (Decky's badge colour, 10 px, thin dark ring) sits on the top-right corner of the Options tab pill on every tab, readable on the white focused pill, and on the **Update** button; no other tab carries one and no green, red or blue dot appears. After the update installs and the plugin reloads, both dots are gone (verified DEVICE 2026-10-26, engine built as 0.1.9 against the real v0.2.0 release: dot on the Options tab on My Addons and on the focused white pill, and on **Update**; back on a real 0.2.0 build both dots and the panel are gone, row "Up to date" — the install step itself is PU-11's) |
| PU-20 | P1 | S | Run a beta build (e.g. `0.3.1-beta.N`) on Beta, then Options › Updates › WoWDeck → **Stable** while the latest stable is older than the build | The panel reads "Switch to stable X" with a **Switch to stable X** button, the Updates row reads "Switch to stable X" with `beta → X`, the Options tab carries the orange dot; on the next plugin load one toast "Switch to stable X" / "Install it in Options", unless X already toasted (the gate is per version, so a stable X toasted before the move to Beta stays quiet). The button stages and installs the older stable through Decky's prompt; afterwards the panel, dot and row are gone. On Beta, running a beta, no older stable is offered (verified DEVICE 2026-10-27, engine built as 0.2.1-beta.1 on Stable: panel, button and row "Switch to stable 0.2.0", row `0.2.1-beta.1 → 0.2.0` with the link, dot on Options; with 0.2.0 already toasted no toast, with the mark cleared one toast "Switch to stable 0.2.0" / "Install it in Options"; on Beta the same build was offered 0.2.1-beta.2. The install itself was not run) |
| PU-21 | P1 | S | Options › Updates: the WoWDeck row's **⋯** (D-pad onto it, A); in the modal move between the rows, press B; open it again, pick **Beta**; open it again, pick **Stable** | The ⋯ sits right-aligned on the WoWDeck row and is a focus stop of its own. The modal "WoWDeck Update Channel" lists **Stable** "Recommended for most users." and **Beta** "Built from every merged change. Newer features, may have bugs.", a checkmark on the active one; both rows take focus. B closes without changing anything. A on a row closes the modal at once, no confirm: the checkmark moves on the next open, and the panel, the Options tab's dot and the WoWDeck row show the switch's fresh check (Beta: the newest beta or stable build; back on Stable: the latest stable, or PU-20's switch). A on the checked row just closes (verified DEVICE 2026-10-27, deck-ui scripts and a virtual pad: ⋯ right-aligned at the Clear button's edge, also beside a three-line description; B on Beta kept Stable; Stable → Beta brought the 0.2.1-beta.1 panel, dot and row, Beta → Stable removed them) |
| PU-22 | P1 | | On Beta, with the panel offering beta.N from a check earlier the same day, a newer beta publishes and CI prunes beta.N. Press **Update** | No "Couldn't download the update" toast. The log shows one `[self-update] download failed: … HTTP 404` line, then `[self-update] staged WoWDeck <newer beta> …`, and Decky's prompt names the newer beta. Afterwards the panel and the Updates row offer the newer beta, and `lastPluginUpdate` in `state.json` names it. To set this up without waiting for CI, stop the plugin and point `lastPluginUpdate.downloadUrl` at a pruned beta's asset URL, for example `…/releases/assets/682923259` (verified DEVICE 2026-10-28, this fix's build on 0.2.0, Beta, stored answer pointed at pruned beta.1's asset: the panel offered 0.2.1-beta.1; **Update** logged one 404 for asset 682923259, then staged 0.2.1-beta.4 (sha256 05116756…); the panel then read "WoWDeck 0.2.1-beta.4 available", and `lastPluginUpdate` named asset 684438832. Toasts were not watched during the press. Decky's install prompt did not appear: the frontend's artifact check accepts only digits and dots in the version, so it refuses every beta before calling Decky's installer, a separate bug) |
| PU-23 | P0 | S | A Deck on Beta, running a build that accepts staged betas (#10), with a newer beta offered (`X.Y.Z-beta.N`): press **Update** on the panel | Button reads "Preparing…", then Decky's own install prompt for WoWDeck X.Y.Z-beta.N, never "The update could not be verified"; log `[self-update] staged WoWDeck X.Y.Z-beta.N …`; a 0600 `wowdeck-update-X.Y.Z-beta.N.zip` in the temp dir. Run it from a build that already has the fix. A Deck on 0.2.0 still has the old check and refuses every beta, so install its first fixed build by hand (README "Updating") (verified DEVICE 2026-10-28, this branch's build as 0.1.9 on Beta, from the release notes modal's **Update**: "Preparing…", then Decky's "Update WoWDeck" prompt for 0.2.1-beta.4; log `[self-update] staged WoWDeck 0.2.1-beta.4 for Decky's installer (sha256 05116756…)`; `/tmp/wowdeck-update-0.2.1-beta.4.zip` mode 600. The prompt was cancelled, so the install did not run) |
| PU-24 | P1 | S | On Stable and again on Beta (PU-21), with an offered release whose notes are longer than the modal's box: focus **Update** on the panel; press Y; press Down, hold Down, press Up; press B. Open it again and press A on the modal's **Update**. Also an offered release with an empty body | With **Update** focused the footer shows **Y Release notes**; Y opens the modal "WoWDeck X.Y.Z release notes" with the build's notes as plain text (no `#`, `**`, link syntax or HTML; bullets read •; a bullet or paragraph wrapped in `CHANGELOG.md` reads as one line, wrapped by the box) and its own **Update** button, focused. Down/Up scroll the notes, a held press glides and stops at the end, with one bell at the edge. B closes and focus lands back on the panel's **Update**. A on the modal's **Update** closes the modal and the panel reads "Preparing…", then Decky's prompt, as in PU-11. While staging the modal's button is disabled. Without a body there is no Y hint and Y does nothing. The no-notes logic is also covered by `src/pluginUpdate.test.ts` (verified DEVICE 2026-10-28, this branch's build as 0.1.9, virtual pad and deck-ui measurements. On Beta the offer was 0.2.1-beta.4, with its notes tripled in the stored answer so they overflow the box. The footer showed **Y Release notes**; Y opened "WoWDeck 0.2.1-beta.4 release notes", plain text, • bullets, wrapped bullets on one line, `##` headings without the marks, **Update** focused; box capped at 422 px; each Down scrolled ~126 px, a held Down glided to the end (713 px) and stopped, Down there stayed put, Up and a held Up scrolled back to the top, focus stayed on **Update** throughout; B closed with focus back on the panel's **Update**; A on the modal's **Update** closed it, the panel read "Preparing…", then Decky's prompt (PU-23). On Stable the offer was 0.2.0, and Y opened "WoWDeck 0.2.0 release notes" with its one-line body, B returned to **Update**. With the stored notes emptied: no Y hint, Y did nothing. The edge bell was not listened for, and the modal's disabled button during staging was not seen, since A closes the modal) |

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
| W-2 | P0 | S | **Back up now** | Progress bar with percent, then a "Backup created" notification (also when you left Options while it ran); the zip is under `<plugin data>/wtf-backups/<flavor>/` |
| W-3 | P1 | | **Manage backups** | Dialog in Steam's style; each backup is one row (no Restore/Delete buttons on it, a chevron); A Restore, X Delete in the footer; B closes. Scroll down and back up: rows keep room above them |
| W-3b | P1 | | Touch: tap a backup | The Restore dialog opens with a red **Delete this backup…** row; tapping it asks to confirm and deletes. For a damaged backup, or while WoW runs, the dialog says why and Restore is off, but Delete works |
| W-4 | P0 | | Change something in WTF (or log in and out in WoW), then Restore | Restore dialog: green "from this device" line, Config.wtf toggle **off**, focus starts on the toggle, Restore first and Cancel second. After restore the change is gone and a "Safety backup" row exists |
| W-5 | P0 | | Restore the safety backup | The state before W-4 returns |
| W-6 | P0 | | Start WoW, open WTF backup | Amber "WoW is running" note; Restore refused; Back up still works. **This is spike S2** (does `/proc` detection see WoW under Proton) |
| W-7 | P0 | | Cancel during a long backup | No `.partial` file or zip left behind |
| W-8 | P0 | | Reload the plugin or restart the Deck during a backup | Next start: no stray `.partial`, `.WTF-restore-*` or `WTF-pre-restore-*`; WTF intact |
| W-9 | P1 | | **Backup folder** → choose an SD-card folder | List switches to it; remove the card → "folder not available"; Use default folder returns |
| W-10 | P1 | | **Import from file…** with a copied zip | Added to the list |
| W-11 | P1 | | Restore a backup made on another computer or by WowUp | Red "from another computer" line; Config.wtf toggle **on**; disabled when the backup has no Config.wtf |
| W-12 | P1 | | Desktop WowUp round trip (optional) | A Deck backup restores in WowUp; a WowUp backup restores here |
| W-13 | P2 | | **Safety backups to keep** = 1, restore twice | Only one safety backup remains |
| W-14 | P1 | | Delete a backup (X in the list) → confirm | File gone; Cancel keeps it |
| W-15 | P1 | S | An installation with no backups: open **Manage backups**; press Down and Up. Then an installation with no WTF folder (a version never started) and no backups: the same | Once the list loads ("No backups yet."), focus lands on **Back up now**, and Down reaches **Import from file…**. With no WTF folder, **Back up now** is off and focus lands on **Import from file…** (verified DEVICE 2026-10-28, build 95f402e, arrow keys over CDP and a virtual pad. Forever, no WTF folder and no backups: focus on **Import from file…** from the first sample after A and still there 2 s later; Up and Down stayed on it. Classic Era, WTF folder and no backups: focus on **Back up now**, Down reached **Import from file…**, Up returned. W-10 on Classic Era with no backups: the picker opened from the focused row, the zip was added ("Backup added to the list.", Backups (1)) and focus stayed on **Import from file…**. The zip was a fresh Classic Era backup copied out and deleted from the list first; a Forever Beta zip imported into Forever was refused as "made for a different WoW version", as expected) |
| W-16 | P1 | S | **Manage backups** on an installation where no other WoW version has backups; then make a backup in another version and reopen | No **Copy settings from another version…** row at first (not a greyed-out row); after the other version's backup it appears below **Import from file…** and the D-pad reaches it (verified DEVICE 2026-10-28, build c7f9ae3, pad presses and taps over CDP with focus, innerText and engine-RPC samples. With a fresh empty-backups data dir, `wtf.copySources` returned no sources and the row was absent, not greyed out; after a Forever Beta backup was made the row appeared below **Import from file…** and Down reached it) |
| W-17 | P1 | | **Copy settings from another version…** with backups in a related version (Forever Beta → Forever) and an unrelated one (Retail), plus one no longer installed | **Copy from** opens on the related version; A opens the dropdown, related versions first, client names (Forever Beta), never folder names; the uninstalled one is marked "(not installed)" in the list and shows "Not installed · backups only" once chosen; Down reaches every backup row, newest first; B closes. The same by touch (verified DEVICE 2026-10-28, same run. The dropdown opened on Forever Beta, then Retail (not installed), then Classic Era; choosing the uninstalled one showed "Not installed · backups only" with only its backups below; Down reached every backup row; B closed; taps drove the same path, and Classic Era showed its "Current settings" row) |
| W-18 | P0 | | Choose a related version's backup → **Copy** | Dialog titled "Copy settings?", **Keep this device's graphics & display settings** on, a plain line about old realms and unused addon settings. Progress and Cancel in Manage backups; "Settings copied from Forever Beta" notification; a safety backup in this version's list; the source version's WTF and backups unchanged (verified DEVICE 2026-10-28, same run. The dialog named Forever Beta's backup and showed the old-realms line and the **Keep this device's graphics & display settings** toggle; "Copying… 0%" with Cancel ran in Manage backups; the toast read "Settings copied from Forever Beta."; scripted end checks found the source's zips, the SD backup folder and its WTF unchanged) |
| W-19 | P1 | | Choose an unrelated version's backup | Red warning that its settings may not work here; the button reads **Copy anyway** (verified DEVICE 2026-10-28, same run. The warning line was shown and the button read **Copy anyway**) |
| W-20 | P1 | | Start WoW (the target version), then try a copy | The copy screen says WoW is running and to close it, even when it's the version you copy from; every row's A label reads Details; the dialog says to close WoW and **Copy** is off (not run on device 2026-10-28: needs WoW actually running) |
| W-21 | P0 | | **Copy settings from another version…** with Forever Beta installed (Forever Beta → Forever); choose **Current settings** → **Copy** | **Current settings** is the first row under **Copy from**, above the backups. The dialog says Forever Beta's settings are backed up first and kept in its backups. Progress and Cancel in Manage backups across both phases; "Settings copied from Forever Beta" notification; Forever has Forever Beta's addon settings and a safety backup in its list; Forever Beta's list has one new manual backup and its WTF is unchanged (verified DEVICE 2026-10-28, same run. "Current settings · What Forever Beta has now · changed 17 Oct" was the first row; the dialog said Forever Beta's settings are backed up first and kept in its backups; toasts sampled both phases, "Backing up the settings to copy… 0%" through 66% and then "Settings copied from Forever Beta. Your previous settings were saved as a safety backup."; Forever Beta's list gained one manual backup and its WTF was unchanged) |
| W-22 | P1 | | Choose a version that is no longer installed but still has backups | No **Current settings** row; only its backups are listed (verified DEVICE 2026-10-28, same run. The uninstalled Retail had no **Current settings** row, only its backups) |
| W-23 | P1 | | Start the source version's WoW (Forever Beta), open the copy modal on Forever and choose **Current settings** | The copy is blocked on purpose, because the Deck can't tell which version is running. The copy screen says to close WoW even when it's the version you copy from, the row's A label reads Details, and the dialog says to close WoW with **Copy** off. After quitting WoW the same row copies (not run on device 2026-10-28: needs WoW actually running) |
| W-24 | P1 | | Start a **Current settings** copy and press Cancel while it reports "Backing up the settings to copy…" | "Cancelled. Nothing was changed."; neither version's list gains a backup and both WTF folders are unchanged (verified DEVICE 2026-10-28, same run. Cancel clicked at "Backing up the settings to copy… 0%": "Cancelled. Nothing was changed."; neither list nor either WTF folder changed) |
| W-25 | P1 | | On Forever, **Import from file…** with a Forever Beta zip (a Forever Beta backup copied out and deleted from its list first); then import the same zip again | "Added to Forever Beta's backups. To use it here, choose Copy settings from another version." Forever's own list doesn't change. **Copy settings from another version…** appears (or stays) and lists that backup under Forever Beta. The second import says the backup is already in Forever Beta's backups and adds nothing. A desktop WowUp zip still lands in Forever's list as "Backup added to the list." (verified DEVICE 2026-10-28, same run. The first import said "Added to Forever Beta's backups. To use it here, choose Copy settings from another version." and Forever's count stayed 4; the copy modal listed the backup under Forever Beta; the second import said "That backup is already in Forever Beta's backups." and added nothing; a desktop WowUp zip raised Forever's count to 5 with a "From WowUp" row) |
| W-26 | P1 | | Put a desktop WowUp backup zip (it records no version) into Forever Beta's backup folder, then copy it into Forever | The dialog says the backup doesn't say which WoW version it is for and to continue only if it is for Forever Beta; **Copy** then works as in W-18 (verified DEVICE 2026-10-28, same run. The dialog read "This backup was made by WowUp and doesn't say which WoW version it is for. Only continue if it is for Forever Beta."; **Copy** then completed as in W-18) |
| W-27 | P2 | | **Copy settings from another version…** with Forever Beta installed and backed up; scroll the list, then switch **Copy from** to a version that isn't installed | The header over the rows reads "Copying from Forever Beta" in Steam blue, brighter than the other text. The first row reads "Forever Beta · Current settings" with "Changed …" under it; each backup row reads "Forever Beta · <when> · <size>". After the switch, the header and every row name the new version. Focus order and A/B are as in W-17 |

## 5. In-game and notifications

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| N-1 | P1 | | With an update waiting, suspend and resume (or restart the plugin) | One "updates available" toast with the plugin icon; not again the same day |
| N-2 | P2 | | Start WoW after the plugin has run | The companion data addon (`wowup_data_addon`) is present and not shown in My Addons |

## 6. Robustness (the pre-release list)

| ID | Pri | S | Steps | Expected |
|---|---|---|---|---|
| R-1 | P0 | | Suspend the Deck during Update all; resume | No crash; every addon either old or new, never a half-written folder; a retry finishes the job |
| R-2 | P0 | | Turn Wi-Fi off in the middle of a download | Error toast; the addon is still intact at its old version |
| R-3 | P1 | | Close the QAM while a request runs; reopen | No crash; state correct after a refresh |
| R-4 | P1 | | WoW installed on the SD card; card removed and reinserted | Clear error while missing; works again after reinsert |
| R-5 | P2 | | Desktop Mode: open the plugin through Decky there | Same behaviour with mouse and keyboard |
| R-6 | P1 | | No network at all, open each tab | Error rows with Retry; nothing hangs forever |

## 7. Known risks to look at first

These are the places most likely to be wrong, so check them first in a full
run. Updated 2026-10-15 after the owner's first device pass and the fixes for
it; again 2026-10-18 for the widened-QAM rework:

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
