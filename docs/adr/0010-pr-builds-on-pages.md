# PR builds are hosted on Pages and unlisted by a stranger's push

Owner decision, grilling of PR builds, 2026-11-09.

Owners can install a build of an open pull request from Options › Updates ›
WoWDeck › channel picker › "PR builds…". A maintainer opts a PR in by putting
the `pr-build` label on it; only people with triage access can. CI then builds
the PR, with the bundled CurseForge key, and publishes the zip to GitHub
Pages under `/pr/<number>/WoWDeck.zip`, beside an `index.json` the app reads.
The build is not a GitHub release and has no tag, so neither update channel
sees it. Its version is `X.Y.Z-pr.N` (`-pr.N.K` from the second build on).

A label means a maintainer reviewed the PR's head commit, and users install
these zips on their devices. So a push by the PR's maintainer rebuilds; a
push by anyone else removes the label, and the PR leaves the list until a
maintainer labels it again. Merging or closing the PR, or removing the label,
unlists it.

Two jobs split the work. The build job runs the PR's code with read-only
permissions. The publish job runs none of that code, checks the artifact's
sha256, writes Pages and edits the PR's one comment. Only it can write to the
repository. The app checks the downloaded zip against the sha256 in
`index.json`.

Read-only permissions do not cover the Actions cache. The PR's code in the
build job can reach the runner's cache token and write any entry into the
base branch's cache, which betas on `next` and releases on `main` could
restore. So no job that publishes, holds a write token or feeds one
restores a cache: the beta and release builds, and the PR build workflow's
own jobs. Pushes and PRs that publish nothing keep their caches. We
rejected keying caches so that a PR's writes can't match, because the
attacker picks the key.

Pages is the `pr-builds` branch, kept to one commit: each publish amends it
and force-pushes, which uploads only the new zip and keeps the history from
growing. A publish refuses an 11th build, because each zip is about 73 MB.

We rejected Decky Loader's route: list open PRs through the GitHub API and
download the Actions artifact through the third-party nightly.link proxy. It
needs no hosting, but a proxy outage would end PR builds and the app would
fetch code through a service we do not run. We rejected the Actions-based
Pages deploy, which re-uploads every zip on every build. We rejected a
pre-release per PR, because the owner wants PR builds kept out of the
release list.
