# PR 2: carry the library mark in the addon-list string

## Contents

- [Goal](#goal)
- [Current code (pinned commit)](#current-code-pinned-commit)
- [Wire format (must match exactly; WoWDeck Addon Manager writes and reads it)](#wire-format-must-match-exactly-wow-addon-manager-writes-and-reads-it)
- [Changes](#changes)
- [Acceptance tests](#acceptance-tests)
- [PR text](#pr-text)

Read `README.md` in this folder first. Needs PR 1 merged (or stacked on it): the
mark is `Addon.isDependency`, which PR 1 adds.

## Goal

An addon list exported and imported elsewhere keeps which addons are libraries,
so autoremove still works after the import. Old strings, and strings from older
WowUp versions, import exactly as they do today.

## Current code (pinned commit)

All in `wowup-electron/src/app/services/addons/addon-broker.service.ts`:

| What | Where |
| --- | --- |
| `ExportAddon` `{id, name, provider_name, version_id?}` | :33 |
| `getExportPayload` (all non-ignored addons) | :106 |
| `parseImportString` (bare `JSON.parse`, no schema check) | :127 |
| `installImportSummary` (parallel `installBaseAddon` per "added") | :139 |
| `getImportSummary` | :179 |
| `getExportAddon` | :288 |

`installBaseAddon` (`addon.service.ts:360`) throws "Addon already installed"
when the record exists.

## Wire format (must match exactly; WoWDeck Addon Manager writes and reads it)

```json
{
  "collection_name": "WowUp_export_1760000000000",
  "client_type": "Retail",
  "addons": [
    { "name": "Baganator", "provider_name": "Curse", "id": "914482", "version_id": "9244555" },
    { "name": "Syndicator", "provider_name": "Curse", "id": "988370", "version_id": "9162388", "dependency": true }
  ]
}
```

- Encoding: base64 of the UTF-8 JSON, as today.
- `dependency` is a boolean, written only when `true`. Every other entry stays
  byte-identical to today's.
- A reader treats anything other than `true` as absent.

The example is a real export from WoWDeck Addon Manager on a Steam Deck
(2026-10-22).

## Changes

1. Add `dependency?: boolean` to `ExportAddon`. In `getExportAddon`, add
   `dependency: true` only when `addon.isDependency`.
2. Import:
   - Install every "added" entry as today.
   - With PR 1, an earlier entry's dependency install may already have
     installed a later entry. Don't treat "Addon already installed" from
     `installBaseAddon` as a failure for an entry of this same import: skip the
     download and keep going.
   - Because `installImportSummary` runs the installs in parallel, also expect
     two installs of the same library racing. Running the "added" entries one
     at a time is the simplest fix.
3. After all installs finish, set flags once, for each entry this import
   installed: `isDependency = entry.dependency === true && dependantsOf(addons)`
   lists it (helper from PR 1). That one rule:
   - makes the list order irrelevant;
   - overrides PR 1's "user install clears the flag" for entries the list
     marks;
   - unmarks a library whose dependant was not in the list. Without that,
     autoremove would delete it at the next Remove of any addon.

   Addons the import did not install ("no-change", "conflict") keep their local
   flag. A dependency PR 1 pulled in that is not in the list keeps
   `isDependency: true`, since its dependant requires it by construction.

## Acceptance tests

1. Export writes `dependency: true` on libraries only. Other entries are equal
   to today's output.
2. Export, then import into an empty installation: same flags. Removing the
   dependant then autoremoves the library.
3. Both orders work (library first, dependant first), with no failed operation
   for the entry already installed during the import.
4. A list marking a library whose dependant is absent imports it unmarked.
5. A list without the key imports every addon as the user's, as today.
6. Interop: the base64 string from the wire-format example above imports with
   Syndicator marked. A string from this WowUp imports in WoWDeck Addon Manager.
   That repo's `backend/tests/addon-service.test.ts` ("addon list import keeps
   libraries libraries") covers its side, and its
   `backend/tests/wowup-import-compat.test.ts` runs WowUp's own import code on
   its export.

## PR text

Title: "Keep the library mark in addon-list export/import". Say that the key is
optional and ignored by older versions, and give the format and the
compatibility notes from this brief.
