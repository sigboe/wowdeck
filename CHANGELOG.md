# Changelog

What's new in each version of WoWDeck Addon Manager. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- WoWDeck now installs and runs on arm64 SteamOS devices, from the same zip
  as everyone else.

### Fixed

- Get Addons opens wide again on newer Steam versions, where Latest, Popular
  and Search stayed out of sight.
- Latest, Popular and Search say what to fix when no WoW installation is set
  up, instead of blaming the addon source.
- WoWDeck starts after Decky installs or updates it where Decky runs without
  root, such as DroidDeck.

## [1.0.1] - 2026-10-31

### Fixed

- The Update button in the panel can install the coming WoWDeck versions,
  which 1.0.0 can't.

## [1.0.0] - 2026-10-30

First public release.

### Added

- Manage your WoW addons from Game Mode: update one or all, remove, roll
  back, and turn on automatic updates.
- Find and install addons from CurseForge, WowUp Hub, TukUI, GitHub and
  WoWInterface, or from a link or a zip file.
- Finds your WoW installation on its own, whether it runs through Steam,
  Lutris or a custom folder. Forever and Forever Beta both get Forever addons.
- Back up and restore your WoW settings.
- Copy addon settings, keybinds and layout from another WoW version, such as
  Forever Beta into Forever.
- Import and export addon lists that WowUp understands.
- Update WoWDeck from the panel at the top of the plugin. An orange dot on the
  Options tab tells you when a new version is out.
- Press Y on the Update button, or on WoWDeck under Options → Updates, to
  read what's new. Press X there to check for a newer version right away.
- Pick the Beta channel (Options → Updates → ⋯) to get new features early,
  or switch back to Stable at any time.
- Options → About lists ways to support WoWDeck, the Supporters and the
  third-party notices.

## [0.2.0] - 2026-10-25

### Added

- WoWDeck tells you when a new version of itself is out.
- Update WoWDeck in one tap from Options → Updates.

## [0.1.1] - 2026-10-25

### Fixed

- WoWDeck installed from a URL in Decky can now update itself.

### Added

- Screenshot in the plugin's description.

## [0.1.0] - 2026-10-25

First release.

### Added

- Manage your WoW addons from Game Mode: update one or all, remove, roll
  back, and turn on automatic updates.
- Find and install addons from CurseForge, WowUp Hub, TukUI, GitHub and
  WoWInterface, or from a link or a zip file.
- Finds your WoW installation on its own, whether it runs through Steam,
  Lutris or a custom folder.
- Back up and restore your WoW settings.
- Import and export addon lists that WowUp understands.

[Unreleased]: https://github.com/sigboe/wowdeck/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sigboe/wowdeck/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/sigboe/wowdeck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/sigboe/wowdeck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sigboe/wowdeck/releases/tag/v0.1.0
