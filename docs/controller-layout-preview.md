# Controller layout preview

WoWDeck previews approved bytes through Steam's raw preview interface. It
shows the decoded action sets and mappings in its own pane. It never opens
Steam's native preview screen, whose F3 action can apply a layout without
WoWDeck's future preservation checks. No apply or restore action is exposed.

## Publication requirements

A revision needs its existing SHA-256 plus optional `previewMappings` to
be previewable. This object maps decimal native controller types to reviewed
SHA-256 fingerprints of decoded mappings. For example, key `"4"` describes
the decoded Deck controller type observed in the November 17 experiment.
Each target controller type needs its own reviewed fingerprint. Conversion
between controller types is never assumed to preserve every mapping.

The fingerprint input is UTF-8 JSON of `{type, sets, modes}` from Steam's
decoded configuration. Sort every object's keys lexicographically, preserve
array order, use compact JSON, and omit the outer configuration's handles,
URL and other metadata. `mappingContent` in `src/controllerLayoutPreview.ts`
defines this serialization. Maintainers must establish the expected mappings
independently from the approved source, rather than approving whatever a
client preview happens to return. Revisions without this evidence remain
browsable and explain why preview is unavailable.

The current catalogue has no archived VDF locator. Preparation resolves the
original published item through Steam's public metadata endpoint, accepts
only HTTPS Steam content hosts, bounds the download, and verifies the exact
approved byte hash. A changed source fails safely. Older revisions may become
unavailable until the catalogue publishes an archive delivery contract.
Nothing follows author updates automatically.

## Operation and ownership

`controllerLayouts.preparePreview` starts an engine job and returns its ID.
`controllerLayouts.previewStatus` reports preparation, failure or the staged
snapshot. The engine resolves the account's existing controller-config root
and writes atomically into its separate `wowdeck-approved` namespace. The
content-addressed file retains the exact approved bytes and is addressed as
`usercloud://wowdeck-approved/<sha256>`. The browser receives no filesystem
path. Staged data is retained for later previews; this ticket adds no cache
cleanup action.

The browser adapter owns Steam capability checks, protobuf discovery, native
handle lifetime and selection readback. It captures the target, account,
controller index/type, complete selection metadata and library entries. The
account comes from guarded `SteamClient.User.GetSteamID`, whose availability
needs device verification. Selection metadata may name a source author, so
its account field never chooses the staging folder. A
changed readback or missing capability rejects the result. This is a
preview-only comparison, not a proof of mutation isolation for shared names
or of physical controller identity across reconnects.

The module-scope resource retains the preparation job and native outcome
across pane teardown. It polls only while viewed. Native calls have no
selection or editing-store mutation, no callback registration, and no native
navigation. Preview handles are freed after the decoded data is copied and
verified. Only one native preview handle may be owned at a time.

## Verification limits

Deterministic tests cover approved staging, changed downloads, source
rejection, missing reviewed mappings, native fallback, decoded mismatch,
account/controller/selection changes and disappearing capability. Pane tests
cover disclosure and the absence of Apply. Synthetic VDF and metadata
fixtures live under `backend/tests/fixtures/controller-layouts/`.

The current published revision has no reviewed native fingerprints. It
therefore fails safely rather than claiming a verified preview. Protobuf
discovery and direct preview-handle release follow the recorded installed
Steam source, but have not been exercised by this implementation on a Deck.
The pane currently renders complete decoded named values, including native
numeric codes, rather than Steam's graphical controller diagram.

Static checks, tests and build reach T1 through T3 only. No visual, keyboard,
physical controller, gameplay, restart, cloud or hardware verification is
claimed. Apply and recovery belong to #268 and #269 and must stay unavailable
until preservation and rollback are connected.

## Target choice and guarded application

The pane prefers a unique detected shortcut for the active installation
only when its account and exact library name match the current Steam
account and library. Detection now retains the account that supplied each
shortcut. Legacy links without account evidence and the global manual
Options link do not establish this preference. Multiple matching shortcuts
leave the choice to the player. Change library entry reopens the picker
without renaming anything.

The pane lists equal-name entries as possibly sharing controls and warns
that other names may share them too. A complete native scope needs separate
evidence for every affected target and equivalent controller. The current
native adapter cannot establish that scope or a physical controller's
identity, so it reports unknown scope. It cannot apply a layout. Browsing
and raw preview remain available when their own capabilities are present.

`applyLayout` is the operation interface for connecting recovery in #269.
It requires a native adapter and a preservation implementation with both
capture and verified restore. Without that connection it returns blocked
before any native work. No player Apply action invokes it yet. Tests use
fake native outcomes through this interface, including silent fallback,
changed scope, changed account and reconnected controller identity.

The engine owns the durable operation under its data directory's
`controller-layouts/operation.json`. `beginOperation` returns a validating
operation while approval is rechecked. `operationStatus` allows the browser
to reattach. The approved byte hash and reviewed decoded fingerprints stay
separate. The operation retains original published-item provenance even
though the delivered URL addresses a local copy.

Before capture, the browser verifies decoded preview mappings and rereads
its installation, account, controller, selection and complete scope.
Before application it repeats context checks and the engine checks staged
bytes again. Success requires independently reviewed decoded mappings from
active native readback and unchanged account, controller and affected scope.
All selection callbacks, including app ID 0, invalidate state only. A
callback never establishes success. The adapter owns callback disposal.

## Preservation handoff to #269

Capture receives an already persisted intent because exporting previous
controls can itself change Steam selection. It must persist complete previous
bytes, decoded mappings and explicit or inherited selection semantics under
that operation's identity. It returns an opaque recovery reference only
after persistence succeeds. It must leave selection semantics matching the
captured context before approved application can proceed.

Restore receives the retained operation and recovery reference. It must
verify previous decoded mappings and selection semantics before resolving.
A changed account, physical controller or affected scope prevents automatic
restore onto that new context. Capture failures, restore failures and
interrupted work retain recovery-required intent. A restarted engine never
replays native work. #269 must add explicit recovery actions for these
records; this ticket supplies read-only status and blocks another mutation.

The engine serializes operation transitions and synchronizes the intent file
and its directory before acknowledging each phase. Browser operation and
callback lifetimes are independent of pane teardown. The shipped pane has
no application operation to resume yet. #269 must connect its module-lifetime
operation resource and recovery UI before exposing Apply.

These are deterministic interface tests and static checks only. No device,
visual layout, controller navigation, offline, restart durability of Steam
selections, cloud or gameplay result is claimed. Native scope resolution,
physical controller identity, preservation and real apply/readback still
need bounded device evidence before activation.
