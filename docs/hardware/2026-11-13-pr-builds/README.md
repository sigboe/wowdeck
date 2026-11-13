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
| Return to containing beta, PU-35 and PU-40 | passed | UI and RPC: Beta .52 contains merge `d61ad5c`, established by GitHub comparison with behind_by 0. The engine offered `prMergedBeta`, selected and persisted Beta and cleared the active PR. The panel showed "WoWDeck 1.1.2-beta.52 available", Update and orange dots. Decky confirmed the exact beta version and installed it. Engine PID 159092 reported Beta .52; after a plugin restart PID 159235 still reported Beta .52, saved channel Beta and active PR null. The subsequent check was current. |
| Subsequent Beta updates, PU-42 | passed | UI and RPC: Beta .52 offered .53 as a normal `update` on Beta. The exact-version native prompt installed .53. Engine PID 159462 reported Beta .53, the saved channel stayed Beta and the active PR stayed null. The next check was current and diagnostics reported no errors. |

The resumed pass changed no addon installation or account follows. Forever
`5e80311f078e` stayed selected. After the containing-beta pass, the installed engine is
`1.1.2-beta.53`, with Beta stored and the active PR cleared. No sudo or permission
changes ran. The tested beta remains installed.

The local two-line maintainer documentation change passed
`make lint typecheck test build` before commit. #225's CI passed before its
merge. `make tidy` ran in dry-run mode after the merge and removed nothing.
Release preparation #223 has merged into next. The Stable release PR #222
remains for human approval.

Raw evidence remains locally under `.scratch/spec-158-live/`, including
`maintainer-build.log`, `maintainer-index.json`, `merged-index.json`, and
`evidence/follow-native.txt`, `follow-installed.txt`, `merged-forced.txt`
and `merged-ui-settled.txt`. Those ignored files are supplemental; the
observations and limits above are the durable continuation record.


## Release readiness continuation

The containing-beta check resolves the earlier pending prerequisite. The first
UI wait expected the older "Switch to beta" wording and timed out; RPC
classification and the actual Update button established the current behavior.
The screenshot confirmed orange dots. No product failure was reproduced.
Raw evidence includes `beta-offer.png`, `beta-return-native.txt` and
`beta-installed.txt` under the same ignored evidence directory.

Notification deduplication on the earlier PR-follow path remains partial.
The report does not claim that the later beta-dot observation established
that earlier path's dot or notification behavior.


The first RPC immediately after plugin reload exceeded the runner's 15-second
budget. The next bounded call succeeded with a new engine PID and the saved
Beta selection. Diagnostics then reported no engine errors. This transient
startup timeout is retained as a test limitation, not a reproduced failure.


The subsequent Beta update completed the return-path continuation. Installed
Beta .53 manifest SHA-256 is
`b1e8f580607194727888c5be7748911b119b1afc9ff95e04fe0e3b8d10181dfb`;
the x86_64 engine SHA-256 is
`f0b54ab7d8e9e673c56825833d088712da2f3d1351df713790f681da8ece8f33`.
The final active installation stayed Forever. The panel was closed and the
owned tunnel was removed. No addon, credential or account-follow mutation
was part of these update checks.

[Continuation evidence](evidence/) contains the native prompts, installed
identity, restart result, normal subsequent-beta offer and orange-dot image.
