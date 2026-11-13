# PR build live verification

DEVICE 2026-11-13. This continues the #165 and #158 live run on the owner's
Steam Deck. It covers PR builds; the separate release assessment is
not part of this report.

| Claim | Result | Evidence and method |
| --- | --- | --- |
| Contributor approval and install | passed | Prior pass, UI and SSH: #225 appeared and installed through WoWDeck and Decky's confirmations as `1.1.2-pr.225`. Installed file hashes matched the published ZIP. |
| Contributor push revokes approval | passed | Workflow 43325853134 logged `test-spec-158 (read), synchronize: strip-label`. The label, index entry and hosted ZIP disappeared. |
| Unlisted return offer | passed | Prior pass, UI: the installed PR offered Stable 1.1.1. The prior operator accepted the prompt accidentally. Stable installed; the PR was subsequently restored through the native installer. |
| Restore reviewed PR | passed | UI, RPC and SSH: accepted the pending native prompt for `1.1.2-pr.225.2`. Engine reported that version. Manifest, package, bridge, frontend and engine hashes matched the published ZIP. Stored channel remained Stable, active PR remained 225. |
| Maintainer push retains approval and rebuilds | passed | Workflow 43389704784 logged `sender sigboe (admin), synchronize: build` for `e6f815b513610132a5caaf864b270fc47d8aa84e`. No relabel occurred. The label stayed applied and Pages published `1.1.2-pr.225.3` at that head. |
| Follow newer PR build, PU-34 | partial | UI and RPC: `.2` offered `.3`. The native prompt named `.3`, and accepting it installed engine `.3`. Stored Stable and active PR 225 persisted. Published ZIP SHA-256 was `275cabff32d7e9479611c32be072c2f562e008535d6f8659d21f94a1a91478e0`. Notification deduplication and visual dot checks were not established by this pass. |
| Merge removes listing and ZIP | passed | #225 merged as `d61ad5cbdae26eaa6e40addc5bcf5b278e2414c8`. Pages returned an empty builds list and the hosting branch had no files under `pr/225/`. |
| Merged PR waits for containing beta, PU-35 and PU-41 | passed | RPC forced check returned `prMergedBuilding`, installable false. UI Check again showed "PR #225 was merged. A beta with it is still building" with no Update button. Stable remained stored and PR 225 active. |
| Return to containing beta, PU-35, PU-40 and PU-42 | pending | The beta workflow skips documentation-only merges, including #225. No containing beta was produced. Resume after a qualifying beta contains `d61ad5c`, verify the offer and native install, then check persistence and subsequent beta updates. |

The resumed pass changed no addon installation or account follows. Forever
`5e80311f078e` stayed selected. The final installed engine is
`1.1.2-pr.225.3`, with Stable stored and PR 225 active. No sudo or permission
changes ran. The tested PR build remains installed for the beta continuation.

The local two-line maintainer documentation change passed
`make lint typecheck test build` before commit. #225's CI passed before its
merge. `make tidy` ran in dry-run mode after the merge and removed nothing.
The separate release PR remains unmerged.

Raw evidence remains locally under `.scratch/spec-158-live/`, including
`maintainer-build.log`, `maintainer-index.json`, `merged-index.json`, and
`evidence/follow-native.txt`, `follow-installed.txt`, `merged-forced.txt`
and `merged-ui-settled.txt`. Those ignored files are supplemental; the
observations and limits above are the durable continuation record.
