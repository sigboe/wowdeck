# Funding links and supporters are fetched live from `next`

Owner decision, design session 2026-10-30.

Options › About shows funding links (from `.github/FUNDING.yml`) and
Supporters (from `SUPPORTERS.md`). The engine downloads both files from the
`next` branch together with the daily WoWDeck update check, and Check again
refreshes them too. It keeps the last good copy on disk, and a snapshot
bundled in the zip covers the first run with no network.

We considered baking both files into each release instead. It is simpler,
but a Supporter would wait weeks for their name to appear, and thanking
someone only works if it shows up soon. Reading from `main` would keep
half-finished links away from players, but it would mean data commits on
`main`, which only receives releases.

Consequences:

- Every installed WoWDeck keeps fetching these two paths on `next` for as
  long as it runs. Renaming or moving either file, or renaming the branch,
  quietly breaks older versions. They fall back to their cached copy.
- The QR codes are made at runtime because the URLs aren't known at build
  time.
- The downloaded files are untrusted input. Links must be `https://`, or a
  `bitcoin:` address whose checksum holds. Names show as plain text, never
  as Markdown. The engine caps the number of links and names and the length
  of each name.
