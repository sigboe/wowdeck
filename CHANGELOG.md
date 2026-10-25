# Changelog

Notable changes to WoWDeck Addon Manager. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-25

### Added

- WoWDeck's own update notice: once per session the engine asks GitHub for
  the latest release and the UI shows a toast and an Options → Updates row
  when a newer version is out. A configured GitHub token is used when it
  can read the repo (the private pre-release state), with an
  unauthenticated fallback so it never makes the answer worse.
- Update WoWDeck from Options → Updates: the engine downloads the release's
  WoWDeck.zip, verifies its hash and package (name and version), and hands
  the local file to Decky's own installer, whose prompt installs it and
  reloads the plugin. Nothing is staged when any check fails.

## [0.1.1] - 2026-10-25

### Fixed

- Plugin name is `WoWDeck`: GitHub turns spaces in release-asset names into
  dots, and Decky matches install-from-URL updates by the asset's file name
  — a spaced name could install but never update.
- Release builds match local builds again: CI builds the engine with the
  Bun version pinned in `flake.lock` (1.4.2).

### Added

- Plugin screenshot in the README and plugin metadata.

## [0.1.0] - 2026-10-25

First tagged release.

### Added

- Addon management from Game Mode: installed list including unmanaged
  folders, provider matching via TOC ids and WowUp fingerprints, update
  detection and update-all with failure isolation, remove, ignore,
  filtering, roll back (previous versions kept), optional automatic updates
  (never while WoW runs), release channels per addon.
- Get Addons: search and install via CurseForge (bundled API key, user-key
  fallback), WowUp Hub, TukUI, GitHub and WoWInterface; popular and
  category listings; install from a provider URL, a direct link to a
  zip/rar/7z, or a local file.
- WoW installation detection (Steam Proton, Lutris, `~/Applications`, SD
  cards, custom paths) with flavor selection.
- WTF (settings) backup and restore; WowUp-compatible addon-list
  import/export; diagnostics with one-tap copy; Steam game-page link with
  pending-update count.
- Transactional installs: a failed install leaves the previous state
  intact.

[Unreleased]: https://github.com/sigboe/wowdeck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sigboe/wowdeck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/sigboe/wowdeck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sigboe/wowdeck/releases/tag/v0.1.0
