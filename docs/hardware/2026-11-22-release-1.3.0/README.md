# Release 1.3.0 verification

The release candidate is `release/1.3.0`, based on `next` at `3bf483f`.
Only the version manifests and release notes changed. The engine and frontend
were built together from this tree. The target was `deck`.

## Automated checks

`make lint typecheck test build` passed. [Results](checks.log):

- Frontend and tools passed 1,383 tests.
- Backend passed 1,825 tests, with four RAR cases skipped because the
  standard Nix shell has no RAR-capable extractor.
- All 83 Python tests passed across packaging, versioning, the bridge and
  recovery updater suites.
- A separate run with `unrar` passed all 91 tests across the archive extractor,
  file provider and zip provider suites, including those four cases.
  [RAR results](rar.log).
- The [release gate and method consistency check](release-gate.log) passed.
  All three manifests say `1.3.0`, the version is untagged, its notes exist,
  and Unreleased is empty.
- Packaging produced `build/WoWDeck.zip` with both engine architectures.
  The local package has no bundled CurseForge key. The publishing workflow
  supplies the repository secret when configured.

## Steam Deck smoke test

DEVICE, 2026-11-22. The owner authorized a fresh smoke test. The runner
backed up plugin files and state, disabled automatic updates during deployment,
and installed the frontend and engine. [Deployment](deploy.log).
[Hashes](hashes.log) identify the installed frontend and patched engine
against the local files. The engine reported `1.3.0`.

| Claim | Result | Method and evidence |
| --- | --- | --- |
| Plugin and engine load | Passed | UI and RPC. My Addons loaded the active Forever installation. Diagnostics reported no alerts, busy indicators or recent errors. [Initial smoke](initial-smoke.log). |
| Get Addons expands and controller glyphs appear | Passed | UI. Focusing Search widened the QAM and showed the search pane with both bumper glyphs. [Screenshot](browse.png). |
| Steam library controls and return focus | Passed | UI. Options opened Steam library with the linked WoW game, Add a game, Find games and page toggles. Controller B returned focus to Steam library. [Controls](steam-library.log). |
| Expansion works after frontend reload | Passed | UI. Reloaded the frontend with the QAM open, returned from Options to Get Addons, and focused Search. The pane widened again. [Log](reload-and-game-page.log), [screenshot](reload-browse.png). |
| Linked WoW page has Play target and addon section | Passed | UI and RPC. The game page focused Play Forever and showed WoW addons. Its update check completed with one addon update and Update all. Launch state listed Battle.net, Classic and Forever, with Forever selected and busy false. [Page](reload-and-game-page.log), [state](launch-state.log). |

Two test-command attempts stopped on a missing navigation label or malformed
JSON quoting. Corrected commands completed the same checks. Neither attempt
changed game files or settings.

## Scope and cleanup

No addons were installed, updated or removed. No WoW or Steam session was
started or stopped. The three existing installations and their selection
were preserved. The tested build stays installed.

This smoke test did not repeat the whole regression matrix. Previous reports
cover [SteamOS launches](../2026-11-18-steam-launch-delivery/README.md),
[NixOS launches](../2026-11-21-kaptan-launch/README.md),
[DroidDeck Play](../2026-11-22-droiddeck-play/README.md), and
[the refactor and recovery work](../2026-11-16-arch-review-229/README.md).
The hardware interruption and offline cases were not rerun for this release.

The [first cleanup](deck-down.log) restored automatic updates. A second
[hash check](deck-final-up.log) confirmed the final build already matched
the device. [Final diagnostics](deck-final-health.log) stayed clear, and
[final cleanup](deck-final-down.log) closed the owned tunnel.
