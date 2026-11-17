# Controller layout follow-up for #261

The review fixes do not complete #261. The production adapter still refuses Apply
because the affected scope and both override layers have not been established.
There is no supported end-to-end player Apply path yet. Do not close #267, #268
or #269 on the strength of deterministic tests.

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

## Exact evidence still needed

The installed Steam source recorded on 17 November shows
`GetControllers()` returning its controller inventory. Records include controller
index, type, serial and chip identity. `SetActiveConfigForApp` chooses a selection
layer based on controller-type counts. `GetConfigForAppAndController` returns the
winning selection. None of these observations proves absence of the other layer.
Equal-name grouping also cannot prove isolation from differently named shortcuts.

The parent can collect the following read-only evidence without changing Steam
selections or opening a native preview:

- Evaluate `tools/controller-layouts/read-native-scope.js` in the existing Steam
  CEF page. It returns the complete browser shortcut list and winning selections
  for each connected controller, with hashed physical identity. Missing inventory
  fields are a probe failure, not evidence of zero connected controllers. The
  probe contains account/source metadata; keep its output local.
- Run `bun tools/controller-layouts/read-account.ts STEAM_ROOT ACCOUNT_ID` on
  the device. It returns the complete binary-shortcut identities and bounded VDF
  file inventory with hashes. It prints no general Steam setting values or file
  content. Compare this list with the browser list before using either for scope.

These probes identify the files and current native state. They cannot by
themselves prove the missing semantics. The precise unanswered questions are:

1. Which persisted key maps each shortcut to its shared controller-config group,
   including differently named entries? Does Steam normalize or alias that key?
   Read the relevant selection branch of the inventoried account config, with
   general account/authentication branches excluded. Establish how it maps to
   every shortcut, rather than assuming lowercased display names are sufficient.
2. Which persisted records or native read API independently expose presence and
   absence of both selection layers for the built-in Deck controller? Establish
   their priority and how autosaves/progenitors affect the winning URL. A single
   winning selection cannot answer this question.
3. What native acknowledgement or barrier proves an abandoned mutation has
   settled before another browser can claim recovery? No such barrier was found
   in the recorded installed source. Claims therefore remain held after a crash.

If the read-only records answer the first two questions, implement one bounded
scope with exactly one built-in Deck controller, a stable physical identity,
complete shortcut membership and supported local personal source bytes. Refuse
other controllers, unknown layers and unresolved members. Then connect the
existing Apply operation with affected-entry disclosure and an explicit player
choice. The bounded device run must verify pre-export preservation, approved
preview, apply/readback, rollback, changed-source archived delivery and override
semantics. This run made no device calls. Restart, offline/cloud durability and
physical gameplay remain outside its evidence.

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
