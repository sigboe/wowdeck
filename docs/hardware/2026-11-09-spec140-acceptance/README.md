# Spec 140 acceptance pass: toast evidence and active-document evaluation, 9 November 2026

One Deck acceptance pass for the runner features of spec #140 (toast
capture, active-document evaluation, observer cleanup), run on the owner's
x86_64 Steam Deck over SSH and CEF with `tools/deck-ui/deck`. Effort
complete; this report is the single record for the pass.

## Build

Branch `impl/171-acceptance-pass` at `c374c0f`, the tip of
`spec/140-deck-toast-evidence` (tickets #166–#170 merged there). Engine and
frontend unchanged by the branch; the code under test is the runner in
`tools/deck-ui/`. `deck up` reported `up: the Deck already runs this build
(--reload to reload anyway)`, which compares the built artifacts, so the
installed plugin is the build the branch's `make build` produces; `deck down`
afterwards reported `nothing to restore` because `up` had not touched the
auto-update guard.

## Fixture installation

A disposable installation inside the plugin's own data, registered through
the Options UI and removed again the same way:

- `~/homebrew/data/wowdeck/test-fixture/fixture/_retail_` with `Data` and
  `Interface/AddOns`; the AddOns folder held hand-made unmanaged
  `SpeedyAutoLoot` and `Details` TOCs.
- `BNetToast.zip` (the reference test archive) at
  `~/homebrew/data/wowdeck/test-fixture/BNetToast.zip`, installed through
  Get Addons → Manual Install → Browse… and the Steam file picker.
- The WoW folder was filled into Options with the native value setter
  (reference.md "Text fields") because the row's Browse control is
  icon-only; Add installation added it as "Retail" (id `4011705e6db7`), and
  the Active installation dropdown selected it.

State left behind: none. The installation was removed via Options →
Installation details (Y on Active installation) → Remove this installation…
→ Remove, which deletes no files; the selection was restored to the owner's
original "Forever" (`5e80311f078e`); the fixture folder, the zip and the
helper pad script (`/tmp/pad2.py`) were deleted over SSH. Steam, Decky and
system settings untouched; no game launched; no owner addon changed.

## Claims

Every row is DEVICE evidence dated 2026-11-09 for the build above. UI means
rendered Steam/Decky controls driven by the runner's virtual controller.

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | Source-change notice captured complete, in order (`toast-start` before, `toast-read` after) | passed (UI) | X on the unmanaged Speedy AutoLoot row opened the source dialog (modal `ModalDialogOverlay_Modal_74`), X on the focused best source installed it; capture ended `["Speedy AutoLoot now updates from CurseForge Your files are kept: Roll back returns to 1.0.0.","Removed BNetToast"]`; evidence in [toast-capture.log](evidence/toast-capture.log) |
| 2 | Unrelated-addon removal notice captured in the same window | passed (UI) | Menu → Remove… → Remove on the BNetToast row (installed from the local archive); the removal notice is the second entry of the same capture, after the source-change notice and in action order |
| 3 | … while controller notifications occur | passed (UI, follow-up) | The original pass captured plugin notices while a second pad connected and disconnected, but missed controller text. The review fix uses alert-container children as well as plugin toast classes. The follow-up captured real controller text with no button input: `Controller Connected Xbox 360 controller` on explicit stop, and a connected notice during failed-expectation cleanup. See [controller-selector-success.log](evidence/controller-selector-success.log) and [controller-selector-failure.log](evidence/controller-selector-failure.log). The original plugin-action evidence remains in the logs linked by claims 1 and 2; those installation actions were not repeated in this follow-up. |
| 4 | A control evaluated in the active file-picker or modal document via the new evaluation mode | passed (UI) | In the Steam file picker (Manual Install → Browse…, `ModalDialogOverlay_Modal_73`): `eval --active` counted 41 focusable entries and named the first ("Show Hidden Files / A-Z / zip, rar, 7z …"); the same document focus navigation then walked (homebrew → data → wowdeck → test-fixture → BNetToast.zip, Enter on the archive closed the picker). In the source dialog (`Modal_74`), `eval --active` read the focused control's full label ("Speedy AutoLoot CurseForge · by Yuyuli · 125 Loot …") in doc "Steam Big Picture Mode"; evidence in [toast-capture.log](evidence/toast-capture.log) |
| 5 | Observer cleanup after a successful run | passed (UI) | The capture run ended normally; its exit cleanup printed `toast cleanup → 2 notice(s) […]` then `toast cleanup: observer removed`; evidence in [toast-capture.log](evidence/toast-capture.log) |
| 6 | Observer cleanup after a deliberately failed expectation | passed (UI) | A batch whose `expect tab = My Addons` failed on Options stopped at the check with exit 1; cleanup retained and printed the notice captured before the failure (`Enter a folder path first`) and removed the observer; evidence in [failed-expectation-cleanup.log](evidence/failed-expectation-cleanup.log) |
| 7 | No leftover observer after either exit | passed (UI) | A later `toast-read` failed with `no observer; run toast-start first` after both runs; an explicit `toast-start; toast-stop` reported `observer removed; 1 notice(s) retained` and a following `toast-read` failed the same way; evidence in [no-leftover-and-toast-stop.log](evidence/no-leftover-and-toast-stop.log) |
| 8 | Source change to an addon with **no** alternate online source (the 2026-11-07 Baganator/Syndicator shape) | pending (unavailable) | No alternate online source exists for those addons: the available source-change path (claim 1) went through an addon CurseForge serves. The no-online-source path (conflict card, "No online source found.") was not exercised on device this pass; the deterministic fixture tests added by #167 cover the capture side of it. The limitation stands even though claim 1 passed |

## Observations (not claims)

- `seek` cannot match inactive plugin tabs by label (icon-only), which is
  known; the runner's own guidance says to seek the current tab and use `key left`/`key
  right`. Two early batches failed on exactly that before being corrected
  ([early-failed-batch.log](evidence/early-failed-batch.log)); the failed
  batch still demonstrated exit cleanup.
- The Options "Browse for the WoW folder" control is icon-only; `seek`
  matched its accessible name once and not again. Filling the field with the
  native setter (reference.md) worked every time.
- The Add installation click had to happen in the same batch as the fill:
  the module-scope draft survives panel rebuilds, but a fresh batch that
  re-reads the field after the QAM cycled saw it empty.
- `rpc` with inline JSON cannot carry double quotes through the run
  tokenizer; this pass drove every engine-visible action through the UI
  instead.

Continuation (same day, review fixes for #171): `CHANGELOG.md` was
deliberately not touched for #171 — the changes are dev/test tooling and
docs, which `docs/changelog.md` excludes from the players' release notes.

## Review-fix continuation, 9 November 2026

The runner changes on `spec/140-deck-toast-evidence` following `a262ae8` fix reset history corruption,
explicit-stop evidence loss and successful exits after overflow. The fake
CEF now uses jsdom for CSS matching and batched mutation delivery. Its
controller markup uses the alert container and hashed classes observed on
the Deck. CLI regression tests cover reset with an old notice still
visible, unread history on explicit stop, overflow on explicit stop, and
controller/plugin notices added and removed in one delivery batch. Removal
preserves previously captured rendered text, including when hidden descendants
exist. A node reused within one mutation batch reports incomplete capture
because its earlier contents may already be lost. That synthetic edge case
is covered by CLI tests, not a device claim.

DEVICE, UI: the runner follow-up used the same installed plugin.
`deck up` compared the artifacts and reported that the Deck already ran
this build. No engine or frontend code changed. `press wait:1000` created a
virtual pad without sending buttons. Explicit stop printed controller
text. A deliberately wrong route expectation failed and cleanup printed
the history and removed the observer. A later bare `toast-read` reported
no observer. `deck down` reported nothing to restore.
See [controller-selector-cleanup.log](evidence/controller-selector-cleanup.log).
The tested runner source hashes are in
[controller-selector-source.sha256](evidence/controller-selector-source.sha256).
No addon, fixture installation or Steam setting changed in this follow-up.
The unavailable source path in claim 8 remains untested on device.

## Second review-fix continuation, 9 November 2026

The runner changes following `564f1b2` use the final stop response as the
authoritative cleanup history and overflow result. An earlier read remains
available if stopping fails. Signals during the final step or cleanup exit
with status 130. Moving an already observed notice within one mutation batch
keeps one entry. Reuse with changed text preserves earlier evidence and
reports the uncertain new occurrences as incomplete.

CLI tests cover a notice arriving between cleanup read and stop, including
overflow at that point; SIGINT and SIGTERM during the final step; a signal
during cleanup; and DOM movement. Unseen notices removed before the observer
runs now report incomplete capture. This replaces the earlier detached-text
reconstruction, which could include CSS-hidden content. The fixture tests
exercise that refusal directly. Earlier rendered text is still retained when
an observed notice disappears.

The frontend CI job installs root dependencies and runs the full tool suite.
The backend job runs only the release helpers that need no frontend
dependencies. Its exact tool-test command also passed locally without root
`node_modules`. These are developer-tool changes, so the player changelog
has no entry.

DEVICE, UI, 2026-11-09: `deck up` again reported that the installed plugin
already matched the build. A failed route expectation retained the real
controller notice and removed the observer. A second runner received SIGINT
after its pad step, during the final timed step. It printed the retained
controller notice, removed the observer, and exited 130. A later bare
`toast-read` reported no observer, and `deck down` had nothing to restore.
The signal was sent only to the local test runner. No buttons were sent and
no addon installation changed.

Evidence: [failed expectation](evidence/second-review-failure.log),
[interruption](evidence/second-review-interrupt.log),
[cleanup](evidence/second-review-cleanup.log), and
[runner source hashes](evidence/second-review-source.sha256).
The remaining unavailable source path in claim 8 is unchanged.
