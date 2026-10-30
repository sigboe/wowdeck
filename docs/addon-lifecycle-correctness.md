# Install/update correctness

## Contents

- [The pipeline, traced](#the-pipeline-traced)
- [Root cause 1: install never set `externalLatestReleaseId`](#root-cause-1-install-never-set-externallatestreleaseid)
- [Root cause 2: CurseForge scan-matching never had release-id evidence to begin with](#root-cause-2-curseforge-scan-matching-never-had-release-id-evidence-to-begin-with)
- [Acceptance criteria mapping](#acceptance-criteria-mapping)
- [Tests](#tests)
- [Broader "managed/unmanaged state corruption" audit](#broader-managedunmanaged-state-corruption-audit)
- [Record writes](#record-writes)
- [Ignored and "needs attention" states (WF-04, 2026-10-15)](#ignored-and-needs-attention-states-wf-04-2026-10-15)

Investigation of a "install an addon, immediately see a false update,
pressing Update reinstalls the same version forever" bug, and the related
"unmanaged addon becomes managed and reports a bogus update" bug.

## The pipeline, traced

```
provider search result (AddonSearchResult, files[])
  -> AddonInstaller.install(): downloads files[0], extracts, swaps folders
  -> readInstalledToc(): re-parses the REAL .toc now on disk
  -> addon.installedVersion  = toc.version (ground truth from disk)
  -> addon.latestVersion     = file.version (provider's own string)
  -> needsUpdate(addon): release-id check, then version-string fallback
```

Two separate call sites populate `WowAddon`'s release-id fields:
`AddonInstaller.install()` (fresh install / explicit update) and each
provider's `scan()`/`createWowAddon()` (TOC-based matching of an
already-installed, previously-unmanaged addon).

## Root cause 1: install never set `externalLatestReleaseId`

`needsUpdate()` (ported from WowUp's `addon.utils.ts`) checks release ids
first, falling back to comparing `installedVersion` against `latestVersion`
as plain strings. Upstream's own comment on that function says why the
release-id check exists: *"Sometimes authors push out new builds without
changing the toc version."* — it's there to catch updates that a naive
version-string comparison would **miss**.

It cannot also catch false positives, because upstream's install flow
(`addon-install.service.ts`): `addon.installedVersion = addon.latestVersion`
— copies the provider's own version string straight across, so
`installedVersion` and `latestVersion` are trivially equal by construction
after any install, upstream never hits the string-mismatch case at all.

Our installer makes the (correct, more rigorous) choice to re-read the
**actual installed TOC** for `installedVersion` instead of trusting the
provider's metadata — which means the TOC's version string and the
provider's version string can legitimately disagree for the exact same
release (addon authors format these independently — "13.34" vs
"ElvUI-13.34", a stray leading zero, a build suffix, whatever). Our
`AddonInstaller.install()` never set `addon.externalLatestReleaseId` at
all (only `installedExternalReleaseId`), so the release-id check in
`needsUpdate()` could never engage, leaving every such addon permanently
stuck on the string-mismatch false positive — reinstalling the identical
file forever, since each reinstall just reproduces the same two
non-matching strings.

**Fix**: `AddonInstaller.install()` now sets `externalLatestReleaseId` from
the same `file.externalId` it already used for `installedExternalReleaseId`
— the just-installed file is, by definition, the current known-latest
release. **Also**: `needsUpdate()` itself was changed to make a matching
release-id pair authoritative in *both* directions (not just "ids differ ⇒
true", but "ids present and equal ⇒ false", skipping the string fallback
entirely) — a deliberate, documented deviation from upstream's verbatim
logic, justified by our different `installedVersion` source. See the doc
comments on `needsUpdate` (`AddonService.ts`) and the install step
(`AddonInstaller.ts`) for the full reasoning.

Classification: **our bug**, introduced when porting WowUp's pattern to an
architecture that (correctly) re-derives installed state from disk instead
of trusting provider metadata. Not an upstream bug, not a provider
limitation.

## Root cause 2: CurseForge scan-matching never had release-id evidence to begin with

This is the "unmanaged addon becomes managed, reports an update equal to
what's already installed" report. Only CurseForge is affected:

- **WowUpHubProvider** matches via its backend's fingerprint lookup, which
  returns a `matched_release` — the *exact* release that was fingerprinted
  against the files on disk. `installedVersion`/`installedExternalReleaseId`
  and `latestVersion`/`externalLatestReleaseId` are initially set from that
  **same** matched release, so they start out equal and a real update is
  only detected after a subsequent `refresh()` finds something newer. No
  bug here.
- **TukUiAddonProvider** has no release-id concept at all (its API returns
  one rolling `version` string per addon, period — confirmed against
  upstream's own `tukui-addon-provider.ts`, which has the identical gap).
  The version-string comparison is the *only* signal available, by design,
  for both WowUp and us. Not a bug — a provider limitation, documented in
  `docs/wow-client-identity.md`.
- **CurseForgeProvider** matches only by **TOC project id** (an addon-level
  identifier) — CurseForge's Core API has no fingerprint endpoint we use
  (see the provider's file header). `scan()` then had no evidence at all
  about *which specific file* is actually installed, yet set
  `latestVersion`/`externalLatestReleaseId` from `files[0]` (the newest
  compatible file in the catalog) while `installedVersion` came from the
  real TOC — the exact same string-mismatch trap as root cause 1, except
  here there was no install-time fix available because `installedExternalReleaseId`
  was never set *anywhere* for a scan-matched CurseForge addon.

**Fix**: `CurseForgeProvider.createWowAddon()` now searches the addon's
known `files[]` for one whose `version` string equals the installed TOC's
declared version. A match is hard evidence of which release is actually on
disk, so its id becomes `installedExternalReleaseId` — if that id happens
to equal `files[0]`'s id (the latest), `needsUpdate()` correctly reports no
update; if it's an older file, a real update is correctly reported. When no
file's version matches at all (an unlisted/delisted/very old release), the
field is left unset and the system honestly falls back to the string
heuristic rather than guessing — consistent with the required invariant
("provider association should require sufficiently strong identity
evidence").

Classification: **our bug** (a gap in the CurseForge port specifically —
WowUpHub already does this correctly via a different, stronger matching
mechanism upstream doesn't give CurseForge).

## Acceptance criteria mapping

| Criterion | Status |
| --- | --- |
| installed version equals the selected release | Already correct — `readInstalledToc` reads the real file. |
| the latest compatible release is selected | Already correct — `files[0]` convention, verified per-provider. |
| update is not immediately offered unless a genuinely newer compatible release exists | Fixed (see root causes 1 and 2 above). |
| pressing Update installs a newer release | Unaffected — already worked when a real update existed. |
| repeated Update does not reinstall the same version forever | Fixed as a consequence of the above — covered by the existing `addon-service.test.ts` lifecycle test plus the new mismatch-specific tests. |

## Tests

- `backend/tests/installer.test.ts`: "fresh install with a TOC/provider
  version mismatch does not need an update" — the install-time case.
- `backend/tests/addon-service.test.ts`: `needsUpdate` unit tests, updated
  to assert the new (intentionally non-upstream-verbatim) semantics.
- `backend/tests/curseforge-provider.test.ts`: two scan-matching cases —
  TOC version recognized as the latest file (no false update) and TOC
  version not recognized at all (honest fallback, real update reported).

## Broader "managed/unmanaged state corruption" audit

Beyond the two concrete bugs above, audited the rest of
`AddonService.reconcileRecords()` / `scanInstallation()` against the full
matrix of ways installed/managed state could get corrupted:

- **Duplicate scan / re-scan**: `reconcileRecords` upserts by
  `providerName:externalId` (falling back to shared installed-folder
  names), looking for an existing record before creating one — re-running
  a scan cannot create a second record for the same match. Confirmed with
  a regression test (`scan-reconciliation.test.ts`) rather than just
  reading the code.
- **Same addon claimable by multiple providers**: `scanInstallation` runs
  providers in `SCAN_ORDER` (upstream's: WowUp Hub, CurseForge, TukUI,
  WowInterface), not registration order. Each `scan()` returns matches and
  is given only the folders no earlier provider matched, and AddonService
  keeps the first match for a folder, so the first provider to claim a
  folder wins and none can double-claim it into a second record. Providers
  don't build records; `scannedAddonRecord` does. Confirmed with a test
  using two providers both able to claim the same folder, registered in
  either order.
- **Unmanaged addon promoted by weak name similarity**: the only provider
  with a fuzzy name-matching fallback (no toc id available) is TukUI
  (`scanAddonsWithNames`), ported verbatim from upstream's own
  `string-similarity`-based approach (0.7 threshold + substring-contains
  fallback). Confirmed this does **not** fire for a representative
  unrelated addon (`tukui-provider.test.ts`, "fuzzy name matching does not
  claim a clearly unrelated addon"). TukUI's catalog is small, so the
  practical blast radius is narrow; left unchanged since there's no
  concrete evidence of a false match today and this logic is
  upstream-shared, not something introduced here — flagged as a watch
  item if TukUI's catalog ever grows significantly.
- **Provider ID mismatch / version mismatch**: covered directly by the
  root cause 2 fix and its tests above.

No further changes were made beyond the two root causes above; the rest
of the matrix was confirmed correct-by-construction rather than needing
a fix.

## Record writes

A record is written only through `AddonRecords` (`docs/architecture.md`),
so a change made in memory and never saved cannot exist. Before this, a
failed install or update of an existing addon left its new channel,
`hasNewerPrerelease` and `dependencies` on the in-memory record, and the
next unrelated write saved them; an update that found the addon current
saved its fresh metadata only by that same accident. Covered by
`addon-service.test.ts`, "records are written only through AddonRecords",
which reads each result back from the state file.

Every write also runs in the gate (`docs/architecture.md`). Before, Ignore,
Pause, an import's library flags and Update's provider read ran outside it:
Pause set while an update installed was cleared by the install. The same
suite covers Pause and Ignore set during an update, and an addon paused or
ignored while Update all or an automatic run is busy with another.

## Ignored and "needs attention" states (WF-04, 2026-10-15)

The `Addon` wire type says *why* an addon is ignored or needs attention,
instead of only `ignored` / `broken`:

| Field | Value | Set when | Cleared when |
|---|---|---|---|
| `ignoreReason` | `"user"` | the user picks Ignore updates | Stop ignoring updates |
| `ignoreReason` | `"git_repo"` | an AddOns folder contains `.git` (listed as an unmanaged, ignored row with no actions; never matched or updated, and the engine refuses to remove or adopt it) | the `.git` folder is gone |
| `problem` | `"folders_missing"` | any folder in the record's `installedFolderList` is absent. Checked live on every `addons.list` and on rescan | the folders are back, or a (re)install rewrites them |
| `problem` | `"not_on_provider"` | `refresh()` got a clean answer (no errors) that did not include the addon, or `updateAddon()` found no file | a later refresh returns it, or a reinstall/update succeeds |

`broken` stays as `problem !== null` for older readers. `folders_missing`
wins over `not_on_provider` (it is the one the user can fix here).

Persisted as `WowAddon.warningType` (`folders-missing` / `not-on-provider`).
Older builds wrote `missing-on-provider` for what was really "folders
missing"; it is read as folders missing and replaced on the next list.
`missing_dependency` from upstream's `AddonIgnoreReason` is never produced.

**Reinstall (WF-05).** `addons.reinstall` installs the addon's current
release again over what is on disk and reports status `installed`. Offered
when `Addon.canReinstall` (managed, provider enabled and `allowReinstall`).
Unlike upstream it is allowed while folders are missing, since that is the
main repair case. It keeps `isDependency`, so autoremove still treats a
reinstalled dependency as one; a direct install from Get Addons marks a
dependency as the user's own instead.
