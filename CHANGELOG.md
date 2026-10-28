# Changelog

What's new in each version of WoWDeck Addon Manager. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Beta updates: pick the Beta channel (Options → Updates → ⋯) to get new
  features early, or switch back to Stable at any time.
- Press Y on the update panel's Update button to read what's new in the version
  on offer.

### Changed

- Updating WoWDeck moved to a panel at the top of the plugin, with an
  orange dot on the Options tab while an update is waiting.
- The update notification shows once per new version instead of every time
  the plugin loads.
- WoWDeck checks for its own updates once a day, including after the Deck
  wakes from sleep.
- The Forever beta client is now called Forever Beta. The live Forever
  client is found too, and both get Forever addons.

### Fixed

- On Beta, Update no longer fails after a newer beta replaces the one on offer. It
  installs the newer beta instead.
- With no backups yet, Manage backups now starts on Back up now, or on Import
  from file… when there's no WTF folder to back up.
- Update all no longer reports failures for addons from a source you turned off.
- Updating, ignoring or removing an addon changes its row once, without the list
  flickering or briefly showing the old version.
- Pausing automatic updates or ignoring an addon while updates run now sticks.
- Updating to a beta now opens Decky's install prompt instead of saying the
  update could not be verified.

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

[Unreleased]: https://github.com/sigboe/wowdeck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sigboe/wowdeck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/sigboe/wowdeck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sigboe/wowdeck/releases/tag/v0.1.0
