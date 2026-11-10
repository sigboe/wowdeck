# Changelog

What's new in each version of WoWDeck Addon Manager. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions loosely follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- TradeSkillMaster shows auction prices for locally saved characters' realms, with account-wide follow management.
- Install or uninstall both TradeSkillMaster addons beside auction refresh, with optional cleanup of eligible account follows.

- My Addons marks a library no addon needs and shows it even with libraries hidden, so you can remove it.
- The Steam picker shows each game's icon and app id, and whether it's linked by hand or automatically.
- Addon details show every game version a release supports as colored tags with friendly names, including Titan Reforged, so multi-game addons list them all.
- Titan Reforged and China Beta installations are detected and can be added, so their addons install like any other client.

### Changed

- A test build now shows the way out: pick Beta or Stable under Options › Updates to switch to it.

### Changed

- TradeSkillMaster has its own icon in Get Addons and account headings.

### Fixed

- Addons lose the Updated tag when a newer update is found, until another update succeeds.

- TradeSkillMaster confirmations restore focus; uninstall progress stays visible during loading, and cleanup reports successful removals when account reads fail.

- The WoWDeck update row in Options shows just the version change and no longer runs off the right edge.
- Focus now lands on Install after you pick a file in Manual Install, even after changing the file picker's sort order.
- Screen readers now name the Update channel button on WoWDeck's row in Options.

## [1.1.1] - 2026-11-07

### Added

- Manual Install warns before a file replaces an addon from CurseForge or another source, which then stops updating from there.
- If a file matches two installed addons, Manual Install lets you remove one, even when reusing a filename or link.

### Changed

- Removing an addon asks whether to remove the libraries only it needed too, and names each one.

### Fixed

- Libraries stay needed after you change an addon's source or replace it with a file, so removing another addon no longer deletes them.
- Installing or updating an addon no longer replaces a library you installed from a file, another source or by hand.
- Installing a newer zip of an addon from a file or link updates it instead of adding a second listing.
- If My Addons lists an addon twice after you installed a newer zip, WoWDeck keeps only the newest install and its Roll back.
- After you pick a file in Manual Install, focus lands on Install, so A installs it.
- An addon pack installed from a file or link keeps the name Manual Install showed, not one of its libraries' names.
- File pickers open in your home folder, also on devices whose Steam user isn't named "deck".
- If an addon change is cut short during its download, WoWDeck deletes its temporary files at the next addon change.
- Screen readers now name installation fields, Browse, Check for updates and screenshot arrows.
- After Use default folder in Options, focus moves to Backup folder instead of disappearing.

## [1.1.0] - 2026-11-04

### Added

- WoWDeck installs and runs on arm64 SteamOS devices, from the same zip as everyone else.
- WoWDeck finds WoW in Battle.net's Proton prefixes and in Steam shortcuts, including shared prefixes and the SD card.
- Steam game pages and home tiles for WoW and Battle.net show when addon updates are waiting.
- Find WoW from My Addons when setting up, with a reminder to link its Steam library entry.
- If an addon change was cut short, every tab says so and offers recovery, or checks your own fix, before more changes.
- If WoWDeck can't read its saved addon information, every tab explains how to restore it.

### Changed

- Installing a beta build switches you to Beta updates; installing a stable build by hand switches you back to Stable.
- On devices it can't run on, WoWDeck says so instead of asking you to try again.
- Update all names the addons it couldn't update.
- Removing an addon names the libraries removed with it or left behind.
- If an addon's temporary files can't be deleted, WoWDeck says so and deletes them at the next addon change.
- Manage backups and Copy settings keep your backups visible, offer Retry when a refresh fails, and lock while a backup runs.
- If a backup or folder change ends with an unknown result, it stays on screen so you can check before trying again.
- The installation picker is greyed out while Get Addons installs an addon.

### Fixed

- An addon install, update or removal that fails part-way puts the old files back, so My Addons matches what WoW loads.
- A Roll back that fails leaves the addon as it was and keeps the version you can go back to.
- Get Addons keeps showing an addon as installing, and no longer installs it twice.
- Without WoW set up, installing or browsing addons points you to Find WoW installations in Options.
- WoWDeck finds WoW's ARM64 version, in installation scans and in Steam shortcuts.
- Finding WoW is faster on large Steam libraries.
- Import backup and Manual Install can browse folders, so you can reach ZIP files outside your home folder.
- Addon lists load from files inside nested folders, and import failures and cleanup warnings stay visible after a refresh.
- Get Addons opens wide again on newer Steam versions and after closing a popup.
- L1/R1 move one tab at a time instead of sometimes skipping Get Addons.
- WoWDeck starts after Decky installs or updates it where Decky runs without root, such as DroidDeck.

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

[Unreleased]: https://github.com/sigboe/wowdeck/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/sigboe/wowdeck/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/sigboe/wowdeck/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/sigboe/wowdeck/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/sigboe/wowdeck/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/sigboe/wowdeck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/sigboe/wowdeck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sigboe/wowdeck/releases/tag/v0.1.0
