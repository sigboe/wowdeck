# WTF backup and restore

## Contents

- [Where backups live](#where-backups-live)
- [Zip format (compatible with desktop WowUp)](#zip-format-compatible-with-desktop-wowup)
- [Create](#create)
- [Restore](#restore)
- [Recovery after an interruption](#recovery-after-an-interruption)
- [Restore dialog (UI)](#restore-dialog-ui)
- [Protocol (engine ⇄ UI)](#protocol-engine--ui)
- [Privacy and safety](#privacy-and-safety)
- [Moving settings between computers](#moving-settings-between-computers)
- [Open items](#open-items)

WTF is the folder inside a WoW flavor directory (`…/_retail_/WTF`) where the game
keeps addon settings (`SavedVariables`), keybinds, macros, UI layout and `Config.wtf`.
This feature zips it, lists the backups and restores one, with a way back after every
restore.

Code: `backend/src/wow/wtf/*` (engine), `src/components/Wtf*.tsx`, `src/wtf*.ts` (UI).
Derived from desktop WowUp's `wtf.service.ts` (see `docs/wowup-provenance.md`).

## Where backups live

`<plugin data dir>/wtf-backups/<flavor>/wtf_<epochMs>.zip`, or the same under a folder
chosen in settings (`wtfBackupDir`, e.g. on an SD card).

`<flavor>` is the flavor *folder name* (`_retail_`, `_classic_era_`, `_classic_ptr_`,
`_anniversary_`, …), not the installation id: ids are hashes of the path and change when
WoW is moved, which is exactly when backups are needed. A folder with an unusual name
falls back to the coarse game type. Classic and its PTR never share a list.

A user-chosen folder is never created by us: if it is missing (SD card removed) the list
reports `dirAvailable: false`, which is a different state from "no backups".

## Zip format (compatible with desktop WowUp)

WTF contents at the archive root with explicit `dir/` entries, plus `wowup-meta.json`:

```json
{
  "createdBy": "manual | pre-restore | auto",
  "createdAt": 1700000000000,
  "contents": [{ "path": "", "isDirectory": true, "size": 0 },
               { "path": "/Account/X/SavedVariables/A.lua", "isDirectory": false, "size": 12, "hash": "<sha256>" }],
  "wowupDecky": { "formatVersion": 1, "flavor": "_retail_", "deviceId": "<random uuid of this plugin install>", "pluginVersion": "0.1.0" }
}
```

Verified against the real libraries desktop WowUp pins (adm-zip 0.5.12, yauzl 3.4.0, spike
S6): upstream's restore compares `contents.length` with the number of nodes it finds after
extracting — **the WTF root (`""`), every directory and every file** — and throws on a
mismatch. So the metadata must list the root and all directories, and the zip must contain
directory entries, or desktop WowUp rejects our backups. Directory hashes are optional
(upstream only warns). `wowupDecky` is ignored by upstream. A fixture produced the upstream
way is committed in `backend/tests/fixtures/wtf/`.

Our backups exclude `*.lua.bak` (WoW rewrites a throw-away copy of every SavedVariables file
on each logout; measured 48 % of the bytes on a real Deck) and never contain symlinks.
Classic (non-zip64) zips only: at most ~65 000 entries and < 4 GiB per file
(`wtf_too_large` otherwise).

Not yet proven: an actual round trip with a desktop WowUp install.

## Create

1. WTF must exist (`wtf_missing`); the backup folder must be available.
2. Walk the tree (sorted, no symlinks, `.lua.bak` skipped).
3. Free space ≥ 0.6 × size + 64 MiB (`insufficient_space`).
4. Stream every file through sha256 into `wtf_<ts>.zip.partial` (fflate `Zip`, level 1, 64 KiB
   chunks; one event-loop yield every 20 files). The source tree is only ever read: the
   metadata is built in memory and added as the last entry (upstream writes a metadata file
   into the live WTF folder).
5. `fsync`, read back the central directory (entry count must match), atomic rename.

Memory stays bounded (≈ 40 MB RSS growth on a 304 MB tree; create 4.4 s on a dev machine).
Backing up while WoW runs works but misses the session's changes: WoW saves SavedVariables
on logout or `/reload`.

## Restore

1. Preconditions: bare `*.zip` name; flavor matches (`flavor_mismatch`), or the backup has no
   flavor (made by desktop WowUp) and the caller confirmed (`flavor_unknown_needs_confirm`);
   WoW not running (`game_running`; `unknown` is allowed and the UI says so); free space.
2. **Safety snapshot** of the current WTF (`pre-restore`, newest 3 kept per flavor). If it
   fails the restore aborts. Manual backups are never pruned automatically.
3. Stream-extract into `.WTF-restore-<ts>` next to `WTF` (same filesystem ⇒ atomic rename).
   Every entry is checked against the metadata while streaming: unsafe names (zip-slip),
   unlisted or duplicate entries, a file growing past its declared size (zip-bomb guard), a
   size or sha256 mismatch ⇒ `verify_failed`/`backup_invalid`, nothing changed. Desktop WowUp
   only logs hash mismatches; we fail.
4. Optional `keepCurrentConfig`: this device's `Config.wtf` (graphics/display) replaces the
   backup's. With no current `Config.wtf` the backup's own is restored (nothing to keep); a backup
   without one keeps the current. Each backup reports `hasConfig` and `keepConfigSuggested` (true for
   backups from another computer) so the UI can default the choice per restore.

   "Another computer" = the backup's `wowupDecky.deviceId` is missing or differs from this install's
   id: a random UUID created once and kept in the engine's state file (not derived from hardware or
   hostname; no device name is stored). Desktop WowUp backups have no id, so they count as another
   computer. Wiping the plugin's data makes a new id, after which older own backups look foreign — the
   safe direction (the default then keeps the device's current display settings; it can be switched
   off per restore). `fromThisDevice` is reported on each backup.
5. Swap: `WTF → WTF-pre-restore-<ts>`, `.WTF-restore-<ts> → WTF`, rolled back if the second
   rename fails. After the swap the old copy is deleted; the safety snapshot is the way back
   (restore it to undo).

File modification times are not re-applied on restore (the streaming unzip does not expose
them); WoW does not depend on them.

## Recovery after an interruption

Run for every installation when the engine starts, and before each restore:

| On disk | Meaning | Action |
| --- | --- | --- |
| no `WTF`, `WTF-pre-restore-<ts>` present | died between the two renames | rename the newest back to `WTF` |
| `WTF` and `WTF-pre-restore-<ts>` | swap finished, cleanup didn't | delete the leftover |
| `.WTF-restore-<ts>` | died while extracting | delete it |
| `*.zip.partial` | died while backing up | delete it |

Idempotent; a no-op while a job is running.

## Restore dialog (UI)

Restore opens our own modal (`RestoreBackupModal.tsx`), not Steam's `ConfirmModal`, so it can carry
the per-restore toggle **Keep this device's graphics & display settings** (`Config.wtf`). It states
what is replaced and that a safety backup is made first, shows a **green "From this device" or red
"From another computer"** line (also on each row of the backup list), and adds the which-WoW-version
warning for desktop WowUp backups (which sends `acceptUnknownFlavor`). The toggle starts at the
engine's `keepConfigSuggested`: **off** for a backup made on this device (it is restored whole),
**on** for one from another computer or desktop WowUp, whose `Config.wtf` describes another
machine's display (owner, 2026-10-17). It is off and disabled when the backup has no `Config.wtf`.
A finished backup or restore shows a notification ("Backup created", "Settings restored",
"Couldn't back up settings"), since the user may have left Options while the job ran; a cancel
shows none.
Text and defaults are pure functions in `src/wtfText.ts` (unit-tested).

## Settings copy

A Settings copy restores one WoW version's current settings or one of its backups into another
version's installation (see
`GLOSSARY.md`). Manage backups shows **Copy settings from another version…** only when
`wtf.copySources` lists something. The row is hidden otherwise, never disabled, so it can't
trap focus (#12).

- **Sources.** `wtf.copySources` lists every flavor other than the target's that has something to
  copy: an installed version with a WTF folder, or a flavor folder in the backup root that holds a
  valid backup. Installed versions report their installation id and `current` (when their WTF
  folder was last changed, and whether it has a Config.wtf). The rest are "Not installed · backups
  only". Related versions come first, then the newest settings first, and the first is the
  default. "Newest" compares the newest valid backup with the current settings' date, which is
  Config.wtf's mtime (WoW rewrites it on every logout) or else the WTF folder's. Display names are
  the client names (Forever Beta), never folder names.
- **Version families.** `backend/src/wow/wtf/VersionFamilies.ts` alone decides "related". The
  families are Retail (`_retail_`, `_ptr_`, `_xptr_`, `_beta_`), Classic progression
  (`_classic_`, `_classic_ptr_`), Classic Era (`_classic_era_`, `_classic_era_ptr_`,
  `_anniversary_`), Forever (`_forever_`, `_classic_beta_`). A coarse fallback key (`retail` for an oddly named folder) is related to
  nothing.
- **Copy.** `wtf.copy` starts a job of kind `copy`. It runs the restore pipeline above, unchanged,
  and reads the backup from the named source flavor's folder. The backup must record that flavor,
  or none. Config.wtf is kept unless `keepCurrentConfig` is false. The safety snapshot lands in
  the target's list, and the source's files are only read.
  `wtf.completed` carries `sourceName` for the notification ("Settings copied from Forever Beta").
  Plain `wtf.restore` keeps refusing another flavor's backup (`flavor_mismatch`).
- **Current settings.** `wtf.copy` without `fileName` copies the current settings of
  `sourceInstallationId`, which must be the named `sourceFlavor`. One `copy` job runs two phases.
  It first backs up the source's WTF as a manual backup in the source's own list, reported as
  `scan` and `compress`. It then restores that backup into the target as a backup copy does, with
  the target's safety snapshot reported as `snapshot`. Progress and cancel work across both
  phases. The source backup stays afterwards as the record of what was copied. If the copy doesn't
  happen (cancelled or failed), the engine deletes that backup again, so neither side changes. The
  source's WTF is only read. WoW running for the source isn't checked. WoW running for the target
  blocks with `game_running` before anything is written. The process scan can't tell which
  installation is running, so on the Deck any running WoW blocks a copy.- **Dialog.** The Restore dialog, worded for a copy. **Keep this device's graphics & display
  settings** starts on. A related version adds a plain line saying characters on the old realms
  won't match and addons you don't have keep their settings unused. An unrelated version gets a
  red warning and **Copy anyway**. Below the dropdown, **Current settings** comes first for an
  installed version that has a WTF folder, then the backups. For a current-settings copy the
  dialog says the source is backed up first and kept in its backups. While WoW runs, it adds the
  warning Back up now shows: a copy made now won't include this session's changes.

## Protocol (engine ⇄ UI)

The engine serves one request at a time and the bridge times out after 120 s, so create and
restore are background **jobs** (UI rule A10): `wtf.create` / `wtf.restore` return `{jobId}`
at once; `wtf.progress` (throttled to ≤ 4/s) and `wtf.completed` events report; `wtf.list`
includes the running `job` so a reopened UI re-attaches. One job at a time
(`job_in_progress`); `wtf.cancel` works until a restore starts swapping (`too_late_to_cancel`).
Contract: `backend/src/api/contracts.ts`. Error codes are stable; the UI maps each to plain text
(`src/wtfText.ts`). The UI calls them through `rpc` (`src/services/backend.ts`); `main.py` forwards them unchanged.

## Privacy and safety

WTF contains account folder names, character and realm names and sometimes addon-stored
tokens. Backups stay on the device. Nothing inside WTF (names, paths) is written to logs,
diagnostics or error text; failures are recorded by code only. A backup folder may not be
inside any installation's `WTF` or `Interface` folder.

## Moving settings between computers

Nothing syncs: copy a `wtf_*.zip` into the other machine's backup folder (for a Deck:
`<plugin data>/wtf-backups/<flavor>/`, or the chosen folder). `Config.wtf` and the layout files
are machine-specific; the restore keeps this device's `Config.wtf` for backups made elsewhere.
Manage backups > **Import from file…** (file picker) validates a zip (readable, WowUp-style
metadata, right flavor if it records one) and copies it into this flavor's list; importing the same
file again is a no-op. Options > Settings backup lets you choose the backup folder (e.g. an SD card; it
must exist and be writable and not be inside a game's `WTF`/`Interface`) and how many automatic
safety backups to keep (1-10, default 3).

## Open items

- Verified on a Deck (2026-10-17, regression W-1 to W-11), including running-WoW detection
  under Proton (spike S2, W-6) and a backup folder on the SD card (W-9).
- Never tried against a real desktop WowUp install (W-12): Deck backups opening in WowUp, and
  WowUp backups restoring here, are proven only with WowUp's own zip code (spike S6).
