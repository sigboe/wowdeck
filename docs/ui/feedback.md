# Async state, errors, feedback and copy

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Rules A1–A11 on async state and feedback, and the copy rules C01–C12.

## Contents

- [7. Async state, errors and feedback](#7-async-state-errors-and-feedback)
- [7.1 Current feedback model [PROJECT]](#71-current-feedback-model-project)
- [7.2 Rules](#72-rules)
- [7.3 Copy rules (C01–C12) [PROJECT]](#73-copy-rules-c01c12-project)

## 7. Async state, errors and feedback

## 7.1 Current feedback model [PROJECT]

- Toasts go through `pluginToast` (S17). Search outcomes and URL-import errors
  are **inline** (`urlImportErrors.ts`, COMMIT 46e71b9).
- Loading: a `Spinner` at the end of a list or in a row's right column;
  long jobs use `ProgressBarWithInfo` (Update all, WTF jobs).
- Update-available toast: created in the `definePlugin` factory and on
  resume-from-suspend, rate-limited once a day by the backend. It is
  deliberately **not** shown on entering My Addons (COMMITS 7858f64, 06081bf).

## 7.2 Rules

**A1 [GENERAL] MUST** use a request-id/ref guard for any fetch whose result
can arrive after the user changed the inputs ([§4.5](architecture.md#45-async-patterns-that-are-working)).

**A2 [GENERAL] MUST** distinguish loading / error / empty / success as four
rendered states. `DetailsText` does; a thrown error must never render like
"no changelog".

**A3 [GENERAL] MUST** wrap every `await api.*` in `try/catch/finally` when it
is triggered by a click, so busy flags reset and the user gets feedback.
Exception noted in backlog U-7 (`getDiagnostics` in Settings' Show button).

  Applied in the audit pass and accepted by the owner (2026-10-13): every
  click handler that awaits the backend (diagnostics load, both clipboard
  copies, Re-scan) now has `try/catch` plus a busy flag that disables the
  button and shows a `Spinner`; a failed startup `getStatus` falls back to the
  "Engine is not running" + Retry state instead of a blank panel.

**A4 [GENERAL] MUST NOT** fire toasts from effects that run on every mount
(the original My Addons toast fired on every remount, COMMIT 7858f64).
**MUST NOT** toast raw identifiers such as operation UUIDs (COMMIT 46f4921).

**A8 [PROJECT] MUST** put a confirmation (`ConfirmModal`, `confirmRemoveAddon`)
in front of any action that deletes data from disk, and say in the text what is
deleted and whether it can be undone. Source (adapted, not mandated): Xbox
Accessibility Guideline 115, "Offer players a mechanism to review, confirm, and
undo permanent or destructive actions". Because opening the modal remounts the
panel (G4), the action must not depend on the opener's React state; it runs
through the module-scope addon session, which reads the list again when it
ends, so the remounted list is current. Accepted by the owner after
on-device use (2026-10-13). Known limitation: the left stick did not move
focus in this Steam-owned dialog, only the D-pad (not investigated; not our
code).

**A9 [PROJECT] MUST NOT** show a failed load as an empty state: Latest
Addons / Popular keep a separate red inline error line (via
`friendlySearchError`) distinct from the muted "No addons found." The Import
modal preview takes a request-id guard like other fetches (A1), since a pasted
string and a loaded file can overlap. Removing a WoW installation also
confirms (A8), because it drops the installation's addon records and ignore
flags (WoW files stay). Found in the audit pass; accepted by the owner on the Deck (2026-10-13): flight-mode red error, Remove-installation dialog and Import preview verified; the My Addons empty-text wording was not tested.

**A10 [PROJECT] MUST** run anything that can take more than a few seconds as an
engine **job**, never as one long call. The engine serves requests strictly one
at a time and the Python bridge times a request out after 120 s, so a long RPC
freezes every other call and then fails. The pattern (WTF backup/restore, see
`docs/wtf-backup.md`): the RPC validates, starts the work without awaiting it
and returns a job id at once; progress and the outcome are pushed as events
(`wtf.progress`, `wtf.completed`); the engine allows one such job at a time. The
UI keeps job state in a **module-scope store** fed by an event subscription made
once per plugin load (never in a component: a modal unmounts the panel, G4),
shows progress and the result **inline** (A6), and on every list load takes the
engine's own view of the running job (`job` in `wtf.list`) so a reopened UI or a
reloaded plugin re-attaches instead of showing a stale or missing spinner. A
failed load of the list is an error with Retry, never an empty list (A9), and a
user-chosen folder that has disappeared (SD card) is its own state, not "no
backups". Destructive steps confirm (A8), saying what is replaced and what is
kept as a way back. Status: implemented and unit-tested; NOT yet verified on a
Deck (verification list: `ActionItems.yaml` WF-01 `deck_verification`).

**A5 [PROJECT] SHOULD** truncate error text before display (existing code
uses `String(e).slice(0, 120–160)`), and prefer user-facing mapped messages
for errors that have codes.

**A5b [PROJECT] MUST** run every caught backend error through
`backendErrorMessage` (`src/errors.ts`) before showing or mapping it. DEVICE
(owner, 2026-10-13): a failed call otherwise put Python exception text in the
UI. The helper drops a traceback, the exception class and the engine's
`[code]` prefix; `friendlySearchError` then turns the result into an
actionable sentence. Unit-tested on sample strings; the exact string Decky
delivers on the Deck was not captured, so the fix is defensive.
  Root cause (DEVICE, owner, 2026-10-13): Decky replaces any exception raised
  in `main.py` with the text "Python Exception", so the engine's message never
  reached the UI at all. `Plugin._rpc` now returns a failure as
  `{"__error": {code, message}}` and `src/services/backend.ts` rethrows it with
  the real message (`unwrapBackendResult`, unit-tested). New bridge methods
  MUST call `self._rpc(...)`, not `self.backend.request(...)`, unless they
  handle `BackendError` themselves (as `get_status` does). A `main.py` change
  needs a Decky plugin reload, not just a Steam UI reload.

**A6 [PROJECT] SHOULD** prefer inline feedback when the user's attention is
already on the control (forms, URL import) and toasts for events that happen
away from the control (background update checks, completed installs from
modals). The current code is not fully consistent with this (U-8).
  Applied to Search (accepted by the owner): "No results" is a muted inline
  line, a provider failure a red one, and raw errors go through
  `friendlySearchError` (`src/search.ts`) so the text says what to do, e.g.
  "check your internet connection" (Xbox Accessibility Guideline 115, adapted).
  The UI stops waiting after 20 s; the backend still retries up to 3 x 30 s.
  Applied to settings backups (owner, 2026-10-17): a backup or restore is a
  background job (A10), so its end is a notification as well as the inline
  line; the inline line alone was missed on the Deck. A cancel, which the user
  just did, gets no notification.

**A7 [PROJECT] MUST** guard SteamClient APIs with a `typeof ... === "function"`
check and run them outside `Content` effects when they must happen once per
session (COMMIT 01bffce).

---

## 7.3 Copy rules (C01–C12) [PROJECT]

Every word a player reads: labels, descriptions, toasts, dialogs, and
engine messages that reach the screen. Agreed with the owner in the string
review of 2026-10-16 (StringReview.yaml, G01–G12 approved). Helpers live in
`src/text.ts` (`plural`, `dayMonth`, `dayAndTime`, `updateAllToast`) and
`src/errors.ts` (`backendErrorMessage`).

- **C01 MUST** word every failure "Couldn't <verb> <thing>" ("Couldn't
  install DBM", "Couldn't save"). Why: four patterns were in use ("Failed
  to…", "… failed", "Could not…", "Operation failed") for one situation;
  the contraction matches the rest of the UI. How: toast titles and inline
  errors; an unknown action is "Something went wrong".
- **C02 MUST** count with real plurals ("1 addon", "3 addons"), never
  "addon(s)". Why: "(s)" reads unfinished, and "Added 1 installations" had
  shipped. How: `plural(n, "addon")`.
- **C03 MUST** end only full multi-sentence text with periods. One-line
  descriptions and toast bodies have none (Steam's own settings rows);
  empty states and inline errors that are full sentences keep theirs. Why:
  mixed punctuation is the most visible sign of unpolished copy.
- **C04 MUST NOT** join clauses with dashes; use two short sentences. Why:
  em dashes and " - " were both in use for the same message, and two
  sentences read better at QAM width.
- **C05 MUST NOT** show internal words: engine, provider, flavor, job,
  Proton prefix, bundled key, toast, HTTP codes, ids, engine names like
  "Curse". Say WoWDeck Addon Manager, addon source, version folder, backup,
  built-in access, notification, and a provider's real name
  (`providerLabel` in the UI, `providerDisplayName` in the engine). Why:
  players do not think in implementation terms.
- **C06 MUST NOT** put a raw error in front of the user. Engine errors are
  user sentences at the source (`NotFoundError` maps what was not found to a
  sentence; `plainSystemError` keeps "Not enough free space" / "No
  permission" and logs the rest; `ProviderError` carries no "[Curse]"
  prefix). The UI passes every backend error through `backendErrorMessage`,
  which turns network, timeout, HTTP and disk errors into plain words; code
  that must classify the raw text uses `rawErrorText`. Raw detail goes to
  the log and Diagnostics.
- **C07 MUST** use sentence case for every title, dialog and button
  ("Export addon list", "Restore backup?"), like Steam's own dialogs.
  Proper names keep their capitals (My Addons, Get Addons, CurseForge).
- **C08 MUST** use curly quotes (“dbm”) around quoted user input.
- **C09 SHOULD** use contractions (can't, isn't, weren't); only warnings
  that must sound firm stay uncontracted ("World of Warcraft must be
  closed").
- **C10 MUST** write dates and times one way: "14 Oct" this year, "14 Oct
  2024" before (`dayMonth`); "5 hours ago", "3 minutes ago" (`formatWhen`);
  "today at 14:32" (`dayAndTime`). Never ISO dates, never "5 h".
- **C11 MUST** title a toast with what happened to what ("Updated DBM",
  "Removed Bagnon", "Updated 3 addons", "Installation removed"); the body
  only adds what the user needs next. Why: titles like "Removed" with the
  name in the body, or "Update all complete", made the reader do the work.
- **C12 MUST** call the WTF feature "Settings backup", naming the folder in
  the description ("Addon settings, keybinds, macros and UI layout (the WTF
  folder)"). Why: players know the folder, but as a heading it reads as
  slang to everyone else; WowUp also leads with what the feature does.
