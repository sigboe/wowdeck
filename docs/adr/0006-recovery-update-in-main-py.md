# The Recovery screen stages updates in main.py

Owner decision, 2026-11-04. Scope is a release whose engine does not start,
not a crash after a working start.

WoWDeck's own update check and download normally run in the engine
(`PluginUpdateCheck`, `UpdateStager`). When a shipped engine cannot start, the
panel shows the Recovery screen and those RPCs are unreachable, so the only
escape was reinstalling by hand. The Recovery screen now offers the latest
Stable and Beta builds. `main.py` asks GitHub, downloads the release's
`WoWDeck.zip`, checks the package and stages it with a sha256; the frontend
hands the `file://` path to Decky's installer, as the normal update does.

`main.py` owns this because it is the layer that both runs and can write a
file when the engine is dead. The frontend cannot stage. It is browser-only,
and the loader's remote path installs before its hash check (decky-loader
#984 and #985). The engine cannot help by definition.

A recovery install does not record a staged version, so the installed build
selects its channel on first start. Recovering from a broken Beta to Stable
returns the user to Stable, which is the point. This deliberately differs
from the normal updater, where a staged stable build keeps a beta user on
Beta.

## Consequences

- The release and package rules exist twice: in `PluginVersion`,
  `BuildSource` and `UpdateStager`, and in the Python recovery path. A change
  to version forms, the zip layout or the asset name must update both.
- The recovery path asks GitHub without a token. If the repository ever goes
  private again, it cannot fetch a build until it reuses the addon source's
  token.
- `main.py` is no longer only a forwarder. The recovery path must not depend
  on the engine, so this growth is deliberate.
- It covers only an engine that fails to start. A broken frontend bundle or a
  broken `main.py` leaves the user with Decky's own install-from-URL.

## Considered options

- **Frontend check and download.** The plugin is browser-only and the loader
  takes a path or URL, so the frontend cannot write the verified file.
- **Decky plugin-source catalog.** It survives engine and plugin failures and
  is the better long-term route (BEYOND-04), but it is not on this screen and
  needs a public repository plus a Store channel switch.
- **A version picker.** Out of scope. Each channel's latest build is enough
  to replace a broken one; older builds belong to the catalog.
