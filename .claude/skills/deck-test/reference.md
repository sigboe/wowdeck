# Deck test reference

## Geometry

A 1080p TV in Big Picture is 1500 CSS px wide, the QAM view 854 px at x 1152.
The Deck screen is 854 px. Test QAM geometry on both.

## Engine-only run (no real installs touched)

Run the patched binary from `/tmp` with `HOME=/tmp/x/home` (the detector then
finds nothing), `WOWDECK_DATA_DIR=/tmp/x/data`, `WOWDECK_CHILD=1`,
`WOWDECK_BUNDLED_CURSEFORGE_API_KEY` from `bin/bundled-curseforge-key`.
Fake a flavor at `/tmp/x/A/_retail_/{Data,Interface/AddOns}`, add it with
`installations.add {path, clientType:"retail"}`, then `installations.select`
(`addons.install` targets the selected one). Drive JSONL `{id,method,params}`
from `python3` on the Deck. A Curse pair with a required dependency: Baganator
914482 → Syndicator 988370. Comparing providers: run old vs new binary on a
copied state with addons stripped and `autoUpdate` off, then `addons.refresh`.

## Install from URL test links

- RAR5: `https://raw.githubusercontent.com/kibo809/Retail-ui-3.3.5/HEAD/RetailUI.rar`
- zip: `https://raw.githubusercontent.com/NoM0Re/WoW-3.3.5a-Addons/HEAD/src/Addons/BNetToast.zip`
- 404: the same path under `Plan414/World-of-Warcraft-3.3.5-Addons`
- A local archive on the Deck: any absolute path under the deck user's home
  (for example `~/Downloads/<name>.rar`); the file provider takes it as-is.

## File picker

Steam's picker is a modal (`tree` = `ModalDialogOverlay_*`) driven by focus
navigation. Enter on the archive itself completes the picker and closes the
modal — there is no Select button after it, and seeking one is a runner
error, not a failed pick. Manual Install's flow, for example:

```sh
tools/deck-ui/deck run 'open; seek Manual Install --enter; seek Browse… --enter;
  wait tree ~ Modal; seek BNetToast.zip --enter; wait tree !~ Modal; probe items'
```

## Text fields

Pad A on a focused field opens the on-screen keyboard (B closes it). To fill
one without the owner: native value setter + `input` event in the QuickAccess
target (in-memory only).

## Toasts

The virtual pad pops "Controller connected/disconnected" toasts beside ours.
Capture them with the runner instead of polling: `toast-start` before the
action retains every notice's complete text in order, `toast-read` after it
returns the history (`toast-start` … `toast-read` in one `deck run`), and the
run's exit cleans the observer up and prints the capture either way.

## Clipboard (Copy path, Copy Diagnostics, Export)

The frontend copies with `execCommand("copy")`; there is no clipboard CLI
on the Deck. Check a copy by pasting it into a
text field (the **Import addon list** box) and comparing the field's value
over CDP with the source text, newlines included.

## File manager (Show in folder)

- FileManager1 is D-Bus-activatable (Dolphin). Headless test:
  `QT_QPA_PLATFORM=offscreen dolphin --daemon`, kill it by pid after
  (`pkill -f` with the pattern kills your own SSH shell).
- A nested desktop in Game Mode has its own session bus: find
  `DBUS_SESSION_BUS_ADDRESS` in deck-owned processes' `/proc/*/environ`, use
  `busctl --address=<addr>`.
- gamescope shows only windows descending from the Steam-launched game:
  `ShowItems` spawns an invisible dolphin; use
  `org.kde.dolphin-<pid> /dolphin/Dolphin_1 MainWindow.openFiles`. Focus:
  `DISPLAY=:0 xprop -root GAMESCOPE_FOCUSED_APP` (769 = Steam UI); windows:
  `DISPLAY=:1 xwininfo -root -children`.

## Synthetic input

Steam's screensaver swallows synthetic input; if focus stops moving, ask the
owner to disable it for the run. In-memory style or nav-node trials are undone
by a Steam UI reload; remove them when done.

## Plugin-update offers with a fake older version

Use a released-form version older than the channel's newest release (for
example `0.1.9`) so real GitHub releases produce an update offer. A
`-test.N` version uses the leave-test flow instead.

1. Record the current local version files and the device's chosen update
   channel (`settings.get`) before changing either.
2. Run `make version-set VERSION=0.1.9` (or `nix develop -c make
   version-set VERSION=0.1.9`). This keeps `package.json`, `plugin.json`
   and `backend/package.json` in sync. The engine reads its reported version
   from the backend manifest compiled into the binary; editing only the root
   manifest does not change it.
3. Run `tools/deck-ui/deck up --engine` to rebuild and deploy the engine too.
   Check `system.getStatus --pick=backendVersion,pid` before testing the offer.
4. After the pass, restore the device's original update channel and run
   `deck down`. Restore the three local version files to their recorded
   contents, preserving any changes that predated the pass. Leave the tested
   build installed unless the brief requests a replacement.
