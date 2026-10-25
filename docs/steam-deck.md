# Steam Deck reference notes

## Contents

- [Runtime environment](#runtime-environment)
- [Typical WoW installation](#typical-wow-installation)
- [Detection implications](#detection-implications)
- [On-device behavior confirmed](#on-device-behavior-confirmed)
- [Pre-release testing checklist](#pre-release-testing-checklist)
- [Packaging must run with patchelf (2026-10-15 incident)](#packaging-must-run-with-patchelf-2026-10-15-incident)

Observations from testing on real Steam Deck hardware (SteamOS holo,
x86_64). These notes inform the detection design — don't bake anything
device-specific into engine code.

## Runtime environment

- SteamOS `holo`, x86_64, glibc (Arch-based).
- **No Node.js / Bun / Deno on the device** — the engine must ship as a
  self-contained executable (`bun build --compile`, target `bun-linux-x64`).
- Python 3.13.5 (`/usr/bin/python3`) hosts decky-loader and plugin backends.
- Decky loader installed at `~/homebrew`, typically alongside several
  third-party plugins — assume their files and settings are present and
  leave them alone.

## Typical WoW installation

- Location: `~/Applications/World of Warcraft/` (Lutris-style layout on
  internal storage, not inside a Proton compatdata prefix).
- Flavors seen in one install: `_retail_`, `_classic_era_`, `_classic_beta_`.
- Addon folders are real, large and varied: dozens per flavor, including
  big multi-folder suites.
- AddOns directory ownership: `deck`, mode `755` — the plugin does **not**
  need root to manage addons under the deck user's home.
- Addon folders with unusual names (e.g. a leading dash, `-Lvl1QuickSetup`)
  occur in the wild — the scanner must handle them safely.
- Removable storage mounted at `/run/media/deck/<uuid>` — detection must
  include user-configured paths on any mount.

## Detection implications

1. Do not assume Battle.net default paths; support explicit user paths.
2. A single WoW root can host multiple flavors (`_retail_`, `_classic_`,
   `_classic_era_`, `_classic_beta_`, `_ptr_`, `_beta_`); each flavor is its
   own installation.
3. Also scan typical prefix locations: Steam compatdata, Lutris
   (`~/Games`, `~/Applications`), Bottles.

## On-device behavior confirmed

The bun-compiled engine binary (patchelf'd to
`/lib64/ld-linux-x86-64.so.2` — see `tools/package.py`) has been
verified directly on SteamOS hardware:

- `system.getStatus` succeeds on real SteamOS (glibc compat confirmed —
  a NixOS-built binary otherwise references the Nix store loader, which
  doesn't exist on SteamOS).
- `installations.detect` correctly finds multiple real flavors under a
  Lutris-style WoW root.
- `addons.list` scans real, large addon folders with correct TOC titles,
  including addons with unusual folder-name characters.
- `addons.refresh` (fingerprints + live hub) tolerates a transient hub
  404 without failing the whole refresh — `NetworkClient` retries
  5xx/429/network errors twice before giving up.

## Pre-release testing checklist

Run on-device before release (the full plan, with steps and expected results,
is `docs/regression-test-plan.md`; these are its section 6):

- Game Mode + Desktop Mode
- suspend/resume during update-all
- Wi-Fi loss mid-download (addon must survive intact)
- Decky reload (plugin restart, engine respawn)
- WoW on internal storage and on SD card

## Packaging must run with patchelf (2026-10-15 incident)

A zip built without `patchelf` in the Nix shell shipped an engine whose loader
was `/nix/store/...ld-linux`. On the Deck the plugin loaded, but the engine never
started and the UI showed "Engine is not running" with a useless Retry; the
plugin log only said "Starting engine binary" because Decky sets the log level
to critical once the UI connects. `tools/package.py` now reads the ELF loader
itself and **fails the build** unless it is `/lib64/ld-linux-x86-64.so.2` (or
`patchelf` can set it). Build with `make package` (the dev shell carries
`patchelf`).
