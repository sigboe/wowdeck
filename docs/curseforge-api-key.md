# CurseForge API key: bundling, fallback, and release configuration

## Contents

- [Overview](#overview)
- [Local development](#local-development)
- [CI / release builds](#ci--release-builds)
- [How the key reaches the running plugin](#how-the-key-reaches-the-running-plugin)
- [Selection priority (CurseForgeAuthService)](#selection-priority-curseforgeauthservice)
- [Download permission vs. authentication — and the website fallback](#download-permission-vs-authentication--and-the-website-fallback)
- [Known limitations](#known-limitations)

## Overview

This project ships with an authorized CurseForge API key bundled into
release builds, falling back to a user-provided key when the bundled one
is absent or confirmed invalid (forks, dev builds, or a revoked key).
**The bundled key is never committed to source.** It only ever exists as:

1. A local, Git-ignored file literally named `CURSEFORGE_API_KEY` at the
   repo root, for local development/packaging.
2. A GitHub Actions repository secret also named `CURSEFORGE_API_KEY`,
   for CI packaging runs.
3. A generated runtime resource (`wowdeck/bin/bundled-curseforge-key`
   inside `build/WoWDeck Addon Manager.zip`, written only at package time in
   the Git-ignored `build/` directory) that the packaged plugin actually
   ships.

**`curseForgeAPIKey-dontcommit` is a different file and is never read
for this purpose.** It holds a separate key (the maintainer's own,
used for other local testing) that this project is explicitly **not**
authorized to ship — direct correction after an earlier draft of this
feature mistakenly treated that file as the shippable-key source. It
stays gitignored and untouched by `tools/package.py`'s key resolution;
only a local file literally named `CURSEFORGE_API_KEY` counts.

## Local development

Create a file literally named `CURSEFORGE_API_KEY` at the repo root
(gitignored) containing just the key the project is authorized to ship,
nothing else:

```
your-authorized-to-ship-key-value
```

`tools/package.py` reads and trims it (empty/whitespace-only is treated
as "no key", same as a missing file) when the `CURSEFORGE_API_KEY`
*environment variable* isn't set — the env var always wins if both
happen to be present, so a CI-style local run (`CURSEFORGE_API_KEY=...
python3 tools/package.py`) behaves exactly like real CI. Never commit
this file. Verify the ignore rule yourself at any time with:

```sh
git check-ignore -v CURSEFORGE_API_KEY
```

Running `make package` (or `python3 tools/package.py` directly, after
building both the frontend and backend) with this file present produces
a package with the bundled key baked in. Without it — and without the
`CURSEFORGE_API_KEY` env var set — packaging still succeeds, just
without a bundled key; the plugin falls back to a user-provided key,
exactly like a fork or a fresh clone with no local key file at all.

## CI / release builds

The `package` job in `.github/workflows/ci.yml` reads the
`CURSEFORGE_API_KEY` repository secret and passes it to
`tools/package.py` as an environment variable of the same name — the
env var always takes precedence over a same-named local *file* (not
that both would realistically be present in a CI runner, but the local
file is checked second either way, and a CI runner has no such file
regardless).

**To configure it:** a repository admin adds a secret named
`CURSEFORGE_API_KEY` under **Settings → Secrets and variables →
Actions → New repository secret**, with the authorized key as its
value. This document deliberately does not, and must never, contain
that value. Until the secret is configured, every run — including ones
on `main` — must produce a correct, fully-functional no-bundled-key
package, not a broken one.

GitHub Actions itself (not any configuration in this repo) withholds
repository secrets from a `pull_request` run triggered by a fork, so
those runs automatically produce a no-bundled-key package too — this
is a platform guarantee, not something this project implements.

The tag-triggered release workflow (`.github/workflows/release.yml`,
documented in `docs/development.md` → Releases) wires `CURSEFORGE_API_KEY`
into its own packaging step exactly the same way: the env var is optional,
a run without it produces a correct no-bundled-key package, and the zip it
uploads to the GitHub Release carries the key only when the secret is
configured. `ci.yml`'s `package` job — every push to `main`, every PR, and
manual `workflow_dispatch` — remains the other pipeline that produces a
distributable zip.

## How the key reaches the running plugin

`tools/package.py` writes the resolved key (if any) to
`bin/bundled-curseforge-key` in the staging folder `build/wowdeck/`
(deleted after zipping unless `--keep-stage`), a plain file sitting
next to the engine binary inside the package — never printed, logged,
or otherwise displayed by the build. A stale resource from a previous
build is always removed or overwritten, so an old/revoked key can never
silently keep shipping.

`main.py` (the thin Decky-side process) reads that file at the moment it
spawns the engine binary and injects it as the
`WOWDECK_BUNDLED_CURSEFORGE_API_KEY` environment variable — the same
pattern already used for every other piece of engine runtime config
(`WOWDECK_DATA_DIR`, etc.). The engine (`backend/src/main.ts`) reads
that env var once at startup to construct `CurseForgeAuthService`
(`backend/src/wow/providers/curseforge/CurseForgeKeyAuth.ts`), which
owns the bundled-vs-user selection logic described below. A build with
no bundled key simply never sets that env var — `main.py` and the engine
both treat that as a normal, fully-supported configuration, never an
error.

## Selection priority (CurseForgeAuthService)

1. A bundled key that's present and not confirmed invalid is always
   preferred.
2. Otherwise, a configured user key that's not confirmed invalid is used.
3. Otherwise, there is no active key — Options exposes the user-key
   entry section.

Status for either key is one of `unvalidated` (never checked this
runtime), `valid`, `invalid` (confirmed — the *only* status that
actually excludes a key from being used), or `unknown` (a transient
network/rate-limit/server issue — deliberately *not* treated the same
as `invalid`). Status is in-memory only, scoped to one engine run — an
engine restart (plugin reload/update) re-checks the bundled key from
scratch, which is also the only way a key that was marked `invalid`
earlier in a session gets a fresh chance (besides the "Recheck bundled
key" button Options shows while it's in that state).

A `403` from CurseForge's API only counts as proof of an invalid key
when it comes from the dedicated health-check request
(`CurseForgeProvider.testApiKey`'s own `GET /v1/games` ping) — this
project has already observed a `403` from the unrelated Featured
endpoint for an otherwise-good key, so a `403` from any other endpoint
is treated as an endpoint-specific restriction, never a verdict on the
key itself. See `classifyCurseForgeError`
(`backend/src/wow/providers/curseforge/CurseForgeKeyAuth.ts`) for the
full classification.

## Download permission vs. authentication — and the website fallback

A key can authenticate fine (pass `GET /v1/games`) while CurseForge
still withholds third-party *distribution* permission from it — the
official API then returns `downloadUrl: null` for every file, same as
when a mod author disables third-party downloads. This is a real,
observed condition, independent of whether the key is otherwise valid.

Two things handle this:

1. **`websiteDownloadUrl()` fallback** (`CurseForgeProvider.ts`): when
   the official API's `downloadUrl` is null, the provider falls back to
   `https://www.curseforge.com/api/v1/mods/{id}/files/{id}/download` —
   the same unauthenticated endpoint CurseForge's own website uses for
   a logged-out visitor's download button, confirmed live to serve the
   real file with no API key at all. Same approach as
   [julius-retzer/forever-addons](https://github.com/julius-retzer/forever-addons)'s
   own no-key CurseForge fallback. This is **unofficial and could change
   without notice** — it's a fallback specifically because the official,
   documented path is tried first whenever it's available.
2. **`testApiKey`'s download-capability check**: rather than trust the
   fallback forever, every key validation (bundled startup check, the
   "Recheck bundled key" button, and Options' save-candidate check for
   a user key) also looks up the single most popular WoW addon right
   now and verifies a real download URL resolves for it — the official
   one if present, otherwise a live probe of the website fallback. If
   *neither* works, the key reports `ok: false, confirmed: true` —
   exactly the same signal as an outright-rejected key, so it's treated
   identically everywhere that signal is used (bundled/user priority in
   `CurseForgeAuthService.resolveActive()`, and Options' fallback
   section visibility). This is what keeps a user from ever being stuck
   silently: if a currently-working key (bundled or user) loses download
   permission later, *and* the website fallback has also stopped
   working by then, this check catches it and exposes the other key
   source instead of reporting a falsely healthy "valid".

## Known limitations

- There's no automated schedule to re-check a bundled key marked
  `invalid` mid-session beyond the explicit "Recheck bundled key"
  Options button and the next engine restart — by design, to never
  retry a known-invalid credential automatically/repeatedly.
- The companion addon notification feature and this key system are
  unrelated; nothing here changes that feature's behavior.
