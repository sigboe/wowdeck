# Changelog

What's new in each version of WoWDeck Addon Manager. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- WoWDeck finds WoW through Battle.net prefixes and Steam shortcuts, including shared prefixes and the SD card.
- Detected WoW and Battle.net entries now show addon updates on their Steam game pages and home tiles.
- Find WoW from My Addons when setting up, with a reminder to link its Steam library entry.
- WoWDeck now installs and runs on arm64 SteamOS devices, from the same zip
  as everyone else.
- Every tab shows incomplete addon changes and offers recovery or checks your manual repair before allowing further changes.
- When saved addon information can't be read, every tab explains how to restore it and resume saving settings.

### Changed

- The installation picker is greyed out while a Get Addons install runs.
- Installing a beta build switches you to Beta updates; installing a stable build by hand
  switches you back to Stable.
- Manage backups and Copy settings keep your backups visible and offer Retry when a refresh fails.
- Backup actions and the backup folder settings turn off while one of them is running.
- An unknown backup or folder-change result stays visible, so you can check it before repeating the action.
- On devices it can't run on, WoWDeck now says so instead of telling you to
  try again.
- When an addon installs or is removed but its temporary files can't be
  deleted, WoWDeck says so and deletes them at the next addon change.
- Update all names the addons it couldn't update.
- Removing an addon names the libraries removed with it or left behind.

### Fixed

- Load addon lists from files inside nested folders.
- Keep addon import failures and cleanup warnings visible after the list refreshes.

- Import backup now shows folders so you can reach ZIP files outside your home folder.

- Manual Install can browse folders for archives, and returning from popups restores the full pane width.

- Installing addons without WoW set up now points you to Find WoW installations in Options.
- Finding WoW is faster on large Steam libraries.
- WoW installations using Wow-ARM64.exe are now recognized during installation scans and Steam shortcut detection.
- A Roll back that fails now leaves the addon as it was and keeps the version
  you can go back to.
- Get Addons keeps showing an addon as installing, and no longer installs it twice.
- L1/R1 move one tab at a time instead of sometimes skipping Get Addons.
- Get Addons opens wide again on newer Steam versions, where Latest, Popular
  and Search stayed out of sight.
- Latest, Popular and Search say what to fix when no WoW installation is set
  up, instead of blaming the addon source.
- WoWDeck starts after Decky installs or updates it where Decky runs without
  root, such as DroidDeck.
- An addon install, update or removal that fails part-way puts the old files
  back, so My Addons matches what WoW loads.

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
