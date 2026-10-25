# Issue draft: required dependencies are no longer installed, and Remove can delete one another addon needs

Open this on `github.com/WowUp/WowUp` before PR 1. Paste everything below the
line. Check the facts against the current `develop`/default branch first, and
update the commit hashes and line numbers if they have moved.

---

**Summary**

Since the January 2023 install refactor, WowUp no longer installs an addon's
required dependencies, and removing an addon can delete a dependency that
another installed addon still needs. I'd like to fix both. Since that changes
what Remove does, I'm asking first which behavior you want.

**What happens today**

1. Required dependencies are not installed. `AddonService.installDependencies`
   still exists (`wowup-electron/src/app/services/addons/addon.service.ts`), but
   its only call is commented out in `addon-install.service.ts`
   (`//   await this.installDependencies(addon, onUpdate);`). It was live from
   7186d0f0 "Start curse dependency support" (2020-11-10). It came across
   commented out in eafc7b4f "Addon installation changes" (2023-01-11), with no
   reason given, so this looks unintended.
2. Remove's "also remove N dependencies?" prompt (`AddonUiService.handleRemoveAddon`)
   removes every listed dependency that is installed. That includes one the user
   installed on purpose, and one another installed addon still requires, which
   breaks that other addon.
3. WowUp does not record which addons were installed only as a dependency, so it
   cannot do better than (2).

**Proposal**

Work like apt/pacman:

- Store one flag per addon, `isDependency` ("installed automatically"), and
  derive who needs it from the `dependencies` already stored on each addon.
- Installing an addon installs its missing required dependencies and marks them.
- Installing a marked addon yourself clears the mark.
- Removing an addon also removes marked addons that nothing installed requires
  any more. Addons the user chose are never removed this way.

Question: should Remove do that automatically (apt's autoremove, which drops the
prompt), or keep a prompt but list only the dependencies that are safe to
remove? Either is fine, and the stored flag is the same.

A follow-up PR would carry the flag in the addon-list export string as an
optional `"dependency": true` per entry. Today's WowUp already ignores unknown
keys, so old and new versions stay compatible both ways. WoWDeck Addon Manager (a
Steam Deck addon manager that shares this format) already writes and reads it.

I'm happy to send both PRs.
