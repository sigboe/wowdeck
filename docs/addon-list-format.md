# Addon-list export format (WF-21 findings)

## Contents

- [Upstream tolerates extra keys (proven)](#upstream-tolerates-extra-keys-proven)
- [Chosen shape](#chosen-shape)
- [What is not encoded: who depends on what](#what-is-not-encoded-who-depends-on-what)
- [Import semantics](#import-semantics)
- [Alternative considered: recompute without a format change](#alternative-considered-recompute-without-a-format-change)
- [Tests](#tests)

The addon-list export string is WowUp's own format: base64 of the UTF-8 JSON
`{collection_name, client_type, addons: [{name, provider_name, id, version_id}]}`
(`backend/src/wow/addons/AddonPortability.ts`, upstream
`wowup-electron/src/app/services/addons/addon-broker.service.ts` at the pinned
reference commit). Lists must keep importing in both directions.

This page records how the string also carries "installed only as a
dependency" (`AddonRecord.isDependency`) without breaking WowUp. Built in
WF-21. The upstream port is specified in
[upstream/README.md](upstream/README.md) (an issue draft and two PR briefs).

## Upstream tolerates extra keys (proven)

Reading the code:

- `parseImportString` base64-decodes (when the string does not start with `{`)
  and does `JSON.parse(...)` cast to `ExportPayload`. It has no schema check, key
  whitelist, length limit or checksum.
- `getImportSummary` reads only `addons` (array check), `client_type`,
  `addons[].provider_name`, `.id`, `.name`, `.version_id`.
- `installImportSummary` passes only `imported.id` and `imported.provider_name`
  to `installBaseAddon`.
- The manage dialog shows only `comp.imported.name`. Imported entries are never
  serialized again. Export builds its own fresh payload, so an extra key is
  dropped silently if a list goes Deck → WowUp → export.

Spike (2026-10-22): upstream's real `AddonBrokerService` from the reference
checkout, unchanged, with its Angular/Electron collaborators stubbed through
`bun:test` `mock.module` (the same approach as the WF-01 S6 plan). It got three
payloads with one already-installed entry and one new entry each:

| Payload | Upstream result |
| --- | --- |
| baseline (today's format) | no error code; `no-change` + `added`; installs the new entry |
| per-entry `"dependency": true` on the new entry | identical |
| top-level `"wowupDecky": {formatVersion, dependencies: [{provider_name, id}]}` | identical |

The encoded length for two entries was 264, 288 and 380 characters. Our own
`decodeImportString` / `computeImportSummary` also ignore unknown keys, so old
strings import exactly as today.

## Chosen shape

A per-entry optional boolean, emitted only when true:

```json
{ "name": "LibDBIcon-1.0", "provider_name": "Curse", "id": "2", "version_id": "v9", "dependency": true }
```

Why per entry rather than a top-level block: both are equally safe upstream (see
above). Per entry keeps the fact next to the addon it describes, needs no
duplicate ids, and costs about 18 characters per dependency. Entries without the
flag stay byte-identical to today's, so the string grows only by the number of
libraries.

## What is not encoded: who depends on what

Like apt, the engine stores one bit per addon: installed automatically
(`isDependency`) or chosen by the user. "Who depends on it" is never stored as a
link. Each record keeps the required-dependency list its provider returned at
install or update time (`AddonRecord.dependencies`). Autoremove derives the
reverse dependencies from the remaining records. Matching uses provider and id
together, in one module (`backend/src/wow/addons/libraries.ts`), which My
Addons' "Needed by", autoremove and import all use.

So the list does not need to carry the relation. On the importing Deck, each
dependant is installed from its provider, which writes a fresh `dependencies`
list. A copied relation would repeat the provider's data and go stale when a
new release changes its dependencies.

## Import semantics

Before WF-21, an import installed every `new` entry as the user's own, so a
library in the list ended up manual even when its dependant's install had pulled
it in a moment earlier.

`AddonService.importAddonList` installs every `new` entry with the plain
`import` intent (dependants still pull in their libraries, marked). Then it
settles flags once, with `libraryFlagsAfterImport`. For each addon the list
installed:

1. It is a library only if the list marks it `dependency: true` AND something
   installed requires it. Settling after every install makes the list order
   irrelevant.
2. A marked library that nothing requires becomes the user's own. Autoremove
   removes every library nothing requires, repeating until none is left, so
   such an orphan would vanish at the next Remove of any addon. That happens
   when its dependant was ignored at export, or was not available here.
3. `no_change` / `conflict` / `unresolved` entries are not touched. The local
   flag wins.
4. Strings without the field (old ones, and every WowUp export) keep the old
   behavior: everything the list installs is the user's own.

## Alternative considered: recompute without a format change

Flag every imported addon that another installed addon requires. This works for
WowUp exports too, but it cannot tell a library the user chose by hand
(for example LibDBIcon installed on purpose) from one pulled in automatically.
Guessing wrong makes a hand-picked addon autoremovable, which removes something
the user wanted. The explicit flag records the user's actual choice. Rule 2
is the only part of the recompute idea that is kept.

## Tests

- `backend/tests/wowup-import-compat.test.ts`: our export, with a marked
  library, run through upstream's real `AddonBrokerService` from the reference
  checkout. Skipped when `wowup/` is not present; `make setup` fetches it and
  CI fetches it too, so a reference bump that breaks interchange fails CI.
- `backend/tests/libraries.test.ts`: the graph rules (provider-and-id
  matching, orphans, flags after an import).
- `backend/tests/addon-portability.test.ts`: export writes the mark only on
  libraries, and import reads it per entry.
- `backend/tests/addon-service.test.ts` ("addon list import keeps libraries
  libraries"): Deck-to-Deck round trip plus autoremove, list order, the orphan
  rule, a library chain removed in rounds, and unmarked (WowUp) lists.
- On the Deck (2026-10-22): the same scenarios against real CurseForge
  (Baganator requiring Syndicator), in throwaway installations.
