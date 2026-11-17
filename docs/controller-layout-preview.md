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
