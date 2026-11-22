# Recovery updater stages packages without the engine

Accepted 2026-11-16. Supersedes the parked 0010 draft on
`docs/recovery-update-adr`. ADR-0004 and ADR-0005 stand.

The Recovery screen must be able to replace a build whose engine cannot
start. `recovery_updater.py` ships beside `main.py` and exposes asynchronous
`stage(url, version, digest)`. Its worker downloads and verifies the package,
then returns its local path, version and sha256. Wiring the Recovery screen
to this module belongs to the Recovery screen work.

The caller supplies the release asset URL, canonical version and GitHub's
sha256 digest. The module uses Python's standard library. It writes no
settings, discovers no releases and sends no credentials. Update checks,
channels, release notes and normal staging stay in the engine. A recovery
install does not record a staged version in engine settings.

The download requires HTTPS, including redirects, with certificate and host
verification enabled. The default system trust store is used when populated;
if empty, the module loads Decky's bundled certifi store. It never disables
verification. On 2026-11-16, probes in the actual frozen Decky Python
3.14.8 runtime on both the Steam Deck and DroidDeck returned HTTP 200 from
GitHub and rejected a self-signed certificate with
`SSLCertVerificationError`. Both default stores contained 120 CAs, with
hostname checking enabled and certificate verification required. The probes
used the recovery updater's TLS context. The original plugin files were
restored afterward. The certifi fallback was not needed on either device.
Device evidence is recorded in
[the hardware report](../hardware/2026-11-16-arch-review-229/README.md).

Blocking work runs in a thread with a ten-second socket timeout, a
120-second deadline checked between chunks, a 256 MiB download limit and a
512 MiB expanded archive limit. The worker reads archive members to check
CRCs without extracting or executing them. It checks the same required
files, engine entries and plugin identity/version as the engine stager.
Both suites consume `tests/fixtures/recovery-packages`. The recovery module
also rejects duplicate names and bounds member count and manifest size.

Only a verified archive becomes a staged `.zip`, through one atomic rename
of a private mode-0600 temporary file. Failure removes the partial file;
cancellation waits for worker cleanup. Error text is fixed and contains no
request URL or underlying exception. The module does not log.
