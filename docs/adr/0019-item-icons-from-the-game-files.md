# Item icons come from the game's files, and nothing is saved

Owner decision, 26 November 2026, for #335. The owner asked for a reader
that is fast, needs no new dependency and leaves no cache growing on the
player's disk.

The Ledger's icons are read from the WoW install itself on each request.
TradeSkillMaster's item cache already stores each item's icon as a
FileDataID (its `texture` field), so the engine parses no game database.
The engine finds that ID in Battle.net's local storage under
`<WoW root>/Data`, decodes the BLP texture at the size the slot needs, and
answers a PNG data URL.

The rules this pins down:

- The engine writes nothing to disk. For each installation it keeps in
  memory only where each looked-up ID sits: archive, offset and size. It
  drops them when the build key in `.build.info` changes, and decodes the
  pixels again on every request.
- The first request for an account looks up every icon its item cache
  records in one pass through the root, encoding and index files, so later
  pages make one read per icon and no second pass.
- An install without Battle.net's storage, an encrypted file or an ID the
  build lacks gives no icon. The row then takes no room for one.
- No download. Wowhead or Blizzard's API would bring network use, caching
  and recorded fixtures for every test, and they would not work offline.

We measured on the owner's Deck over sshfs, which reads across the network
and is slower than the Deck's own disk. The first pass for 1,639 icons took
2.5 s, and a warm page of 40 rows took 173 ms. Decoding one 64 px icon and
writing its PNG takes about 1 ms. Nobody has timed a page on the Deck
itself yet.
