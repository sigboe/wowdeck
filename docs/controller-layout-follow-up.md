# Controller layout follow-up for #261

The production adapter now establishes a bounded scope, and the preview pane
offers Apply inside it. A revision that publishes `previewMappings` must match
them. A revision without them previews through Steam's native decoder too:
the browser also decodes the target's `default://<lowercased name>` layout,
and refuses the preview when the two match, because an unreadable layout
decodes silently as the defaults. Apply then requires the readback to equal
the fingerprint of that preview. This check doesn't catch a layout that
decodes wrongly into something other than the defaults.

## Changes covered by local tests

Active readback now calls Steam without a preview URL. Personal export previews
accept bounded usercloud paths and reject traversal and foreign schemes. Tests
exercise the production adapter with Steam and the protobuf decoder replaced at
the external boundary, rather than replacing the adapter itself.

Explicit restoration can deliver retained original bytes under
`usercloud://wowdeck-recovery/<operation>/<sha256>`. It never overwrites the
original source or a conflicting delivery file. The restored snapshot retains
absent overrides and substitutes URLs only for present overrides. Restoration
checks independently retained decoded mappings and the resulting selection
snapshot. Inherited controls whose source changed still refuse recovery if
restoring the bytes would require adding an override that was originally absent.
That refusal retains the archive.

A durable browser claim prevents restoration or a new Apply while native work
remains owned. Owners release only after native promises settle, including late
results after a timeout. A dead browser's claim never expires into replay
permission. This prevents concurrent replay, but does not implement automatic
reconciliation of abandoned native calls. The engine cannot prove that a native
request from a dead browser has finished. The recovery row stays unavailable
while such a claim exists. Operator reconciliation requires evidence of native
quiescence; deleting the claim file is not a supported recovery action.

Preview rows retain focus by layout and row identity across pane teardown.
Library choices use list positions to distinguish duplicate names; native app
numbers remain internal. Preview and recovery share the account-folder resolver.

## Publication artifact contract

A published revision without `previewMappings` cannot produce a verified preview.
The client must not treat the first successful native decode as approval, because
Steam can silently decode defaults. The VDF and native protobuf mapping trees
have different representations. The recorded source does not supply a standalone
converter that can establish expected conversion without running Steam.

For each supported native controller type, maintainers must provide:

1. The exact approved VDF and its SHA-256.
2. An expected JSON mapping tree with `controller_type`, complete `sets` and
   complete `modes`. Review the expected bindings against the VDF, including
   action-set layers and controller conversion. Record that review alongside
   the source revision. A dump from Steam preview alone does not satisfy this.
3. The fingerprint of canonical `{type, sets, modes}` in the revision's
   `previewMappings`, keyed by the numeric native controller type.

The offline helper prints the catalogue fields from the reviewed artifacts:

```sh
bun tools/controller-layouts/publication.ts approved.vdf independently-reviewed.json REVIEWED_VDF_SHA256
```

This helper verifies byte identity and canonicalizes the reviewed expectation.
It does not perform the semantic review or approve converted bindings. Keep the
expected JSON and review record in the publication repository. Publish the exact
VDF as an immutable artifact as well; downloading a mutable Workshop item works
only while its bytes still match the approved hash. No publication was changed
in this implementation run.

## Device evidence, 17 November 2026

The owner approved writes to disposable shortcuts and WoWDeck-named
controller configs only. The test removed every target afterwards. World of
Warcraft's selection stayed `autosave` throughout. Observed in Steam's shared
JavaScript context and in the account's `configset_*.vdf` files:

- Steam keys a non-Steam shortcut's controls by its lowercased display name.
  "WoWDeck Probe A" and "wowdeck probe a" shared every change. "WoWDeck Probe
  B" never changed. Steam writes the selection to the configset at once.
- Selection type 0 is stored in `configset_controller_neptune.vdf` and covers
  every Deck controller. Type 1 is stored in the configset named after the
  controller's serial number.
- A present type-1 selection always wins. Setting type 0 removes the type-1
  entry. Clearing type 0 leaves type 1 alone. So a winning type-0 selection
  proves that type 1 is absent.
- `ExportCurrentControllerConfiguration` never settles unless an editing
  session is open. Inside one, it writes a personal copy and selects it on
  type 0.
- Re-selecting an `autosave:///…` URL restores `"autosave" "1"`, the state
  World of Warcraft has. Selecting `usercloud://wowdeck-recovery/<op>/<sha256>`
  works, and switching back restores the original.
- Preview decodes template, personal and default URLs. Readback through an
  editing session returns the same bytes as preview of the selected URL.

The adapter therefore establishes scope only when all of these hold:

- exactly one connected controller, the built-in Deck controller, with a
  serial number;
- an ASCII name;
- a winning type-0 selection whose source is a personal file or an autosave;
- the same winner for every case variant of the name.

Everything else stays "unknown", and the pane explains why Apply isn't
offered. Non-ASCII names, physical-controller overrides, and templates or
Workshop sources need more evidence before they can be supported.

## Still open

1. **Reviewed mappings.** Publishing `previewMappings` (see "Publication
   artifact contract") remains the stronger check and is still optional.
2. **The pane closes after Apply.** Confirming Apply returns the QAM to the
   Get Addons destination list. The result shows only after reopening
   Controller layouts.
3. **Abandoned native calls.** No native acknowledgement proves that a dead
   browser's call has settled, so its claim stays held and recovery stays
   unavailable until an operator steps in.
4. Restart, Steam Cloud sync of the export, and physical play are untested.

## Verification on 17 November 2026

`make lint typecheck test build` passed. The frontend/tool suite passed 1,360
tests. The backend passed 1,755 tests and skipped 5. The Python packaging,
version, bridge and updater suites passed. After the final atomic-delivery and
restoration-test changes, lint, both typechecks and both architecture builds
passed again. The six controller-layout suites passed all 45 tests.

The publication helper reproduced the recorded fixture's independent fingerprint
and rejected an invalid reviewed hash. The native read-only probe passed a syntax
check. Neither probe ran on a device. UI evidence reaches T1, T2 and T3 only;
T4 visual layout, T5 input and T6 hardware verification remain pending.
