# PR 1: finish dependency handling in WowUp

## Contents

- [Goal](#goal)
- [Current code (pinned commit)](#current-code-pinned-commit)
- [Changes](#changes)
- [Acceptance tests](#acceptance-tests)
- [PR text](#pr-text)

Read `README.md` in this folder first (pinned commit, rules). Open the issue
(`wowup-issue-library-tracking.md`) first, and follow the maintainers' answer on
autoremove vs. a narrowed prompt. This brief assumes autoremove. With the
prompt, step 4 lists `orphanedLibraries` in the prompt instead of removing them
silently.

## Goal

Required dependencies install with their addon and are remembered as libraries.
A library goes when nothing installed needs it any more. Nothing the user chose
is ever removed as a side effect.

## Current code (pinned commit)

| What | Where |
| --- | --- |
| `Addon` model, has `dependencies?: AddonDependency[]`, no flag | `wowup-lib/src/addons.ts:64` (`AddonDependency` at :59) |
| Provider dependencies written to the addon | `addon.service.ts:1698` (`createAddon`) |
| Required filter | `addon.service.ts:411` `getRequiredDependencies` |
| Dependency installer (dead code) | `addon.service.ts:421` `installDependencies` |
| Its call, commented out | `addon-install.service.ts:232` |
| Remove used by the UI | `addon.service.ts:724` `removeAddon(addon, removeDependencies, removeDirectories)` |
| Blunt dependency removal | `addon.service.ts:775` `removeDependencies` |
| Second copy (used internally for reinstall at :516) | `addon-install.service.ts:528` `removeAddon`, :602 `removeDependencies` |
| Remove prompt + "remove N dependencies?" prompt | `addon-ui.service.ts:27` `handleRemoveAddon` |
| Bulk remove (parallel `zip` of removeAddon calls) | `pages/my-addons/my-addons.component.ts:837` |
| Record-only removals (must not autoremove) | `addon.service.ts:1552`, `:1563`, `:1573` (`removeAddon(addon, false, false)`) |

All paths are under `wowup-electron/src/app/services/addons/` unless shown
otherwise. History: the call worked from 7186d0f0 (2020-11-10) until eafc7b4f
(2023-01-11).

## Changes

1. **Model.** Add `isDependency?: boolean` to `Addon` in `wowup-lib`. Absent
   means the user chose it, so stored addons need no migration. `wowup-electron`
   uses the published `wowup-lib-core` package: either release the lib first
   (separate small PR if the maintainers prefer) or extend the type locally
   until the bump.
2. **Library rules in one place.** Add a small pure module (for example
   `wowup-electron/src/app/utils/addon-libraries.utils.ts`) with:
   - `dependantsOf(addons)`: index from `providerName + externalId` to the
     installed addons whose *required* `dependencies` list it. Always key on
     provider and id together, because numeric ids from different providers
     collide.
   - `orphanedLibraries(addons)`: `isDependency === true` and no dependants.

   Port it from this repo's `backend/src/wow/addons/libraries.ts`.
3. **Install.**
   - Re-enable dependency install after a user-initiated install, update,
     reinstall or channel change. Install each missing required dependency from
     the same provider and mark it `isDependency: true`. Do not chain from the
     dependency's own install: one level, which bounds the work. Revisit only if
     the maintainers want transitive installs.
   - A failed dependency must not fail the main install. Report it, the way
     `installDependencies` logs today.
   - A user-initiated install of an addon that is currently `isDependency` sets
     it to `false` (apt "manual"). Updates, reinstalls, channel changes and
     dependency installs keep the flag.
4. **Autoremove.**
   - After a user-initiated remove (`removeDirectories === true`), loop: remove
     every `orphanedLibraries` entry of that installation, and repeat until none
     is left. A library only another library needed goes too. The loop ends
     because each round removes at least one addon.
   - Never autoremove from the record-only removals listed above.
   - For bulk remove, run the sweep once after all removes finish, not per
     parallel call, so two sweeps never race.
   - Delete the blunt `removeDependencies` in both services, and make the
     `addon-install.service.ts` copy agree with (or delegate to) `addon.service.ts`.
5. **UI.** Drop the dependencies prompt (or narrow it, per the issue). Remove
   or reword the unused `PAGES.MY_ADDONS.UNINSTALL_POPUP.*` strings in every
   locale under `wowup-electron/src/assets/i18n/` (`npm run test:locales` checks
   them). Showing a "library" label or "needed by X" in My Addons is a separate
   follow-up.

## Acceptance tests

Angular/Karma specs (`npm test`). Use stubbed storage and providers.

1. Installing an addon with a required dependency installs the dependency with
   `isDependency: true`. An optional dependency is not installed.
2. Removing that addon removes the library. With a second addon still requiring
   the library, the library stays until that one is removed too.
3. Chain: A requires L1, L1 requires L2 (L2 marked, installed via another
   addon). Removing A, then the other addon, leaves nothing.
4. A library installed directly by the user, before or after its dependant, is
   never autoremoved.
5. A Curse library with id "5" is not kept alive by a Wago addon requiring "5".
6. Updating a library keeps `isDependency: true`.
7. `reconcileOrphanAddons` and the other record-only removals autoremove
   nothing.
8. `npm run lint` and `npm run test:locales` pass.

## PR text

Title: "Install required dependencies again and remove them only when unused".
Link the issue. Name the two commits (7186d0f0, eafc7b4f) and the bug in (2) of
the issue. Say that no stored data changes (the new flag is optional) and that
the PR adds tests.
