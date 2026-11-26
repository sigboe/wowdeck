# TradeSkillMaster provenance

WoWDeck uses tsm-app-linux's documented OIDC client configuration and auction-data protocol, reimplemented with Bun APIs. It never imports or runs tsm-app-linux.

| WoWDeck module | Upstream | Commit | Changes |
| --- | --- | --- | --- |
| `backend/src/wow/tsm/TradeSkillMasterAuth.ts` | [tsm/api/oidc.py](https://github.com/exceptionptr/tsm-app-linux/blob/1908e34930f742a3a9ce754faf4e1839431fff3a/tsm/api/oidc.py) | `1908e34930f742a3a9ce754faf4e1839431fff3a` | Bun callback listener, RPC, manual timers, plugin token file; session restoration, early refresh and account role claims. |
| `backend/src/wow/tsm/TradeSkillMasterProvider.ts` | `tsm/api/socket.py`, `docs/api.md`, `tsm/core/services/updater.py` | `1908e34930f742a3a9ce754faf4e1839431fff3a` | Bun Socket.IO frames, authenticated session lifecycle and normal addon metadata. Recorded addon fixture uses documented release names and versions, with local download URLs. |
| `backend/src/wow/tsm/AuctionDataFile.ts` | `tsm/wow/lua_writer.py`, `tsm/core/services/auction.py` | `1908e34930f742a3a9ce754faf4e1839431fff3a` | Line format, parsing and app info escaping as upstream. Keeps lines it doesn't manage, prunes unfollowed realms, replaces single keys in place and writes through a temp file and rename. Apply returns which step failed: read, write or rename. |

The MIT notice is in `THIRD_PARTY_NOTICES.md`.

The auction writer in `backend/src/wow/tsm/TradeSkillMasterData.ts` adapts
`tsm/wow/lua_writer.py` and `tsm/core/services/auction.py` at the same commit.
It uses Bun file transactions, the shared socket and plugin catalogue storage.
The file format itself is in `AuctionDataFile.ts` (see the table).
The auction fixture follows the recorded event and metadata formats in
upstream `docs/api.md`, with synthetic prices, ids and local download URLs.

Account follow requests in TradeSkillMasterData.ts use the endpoint and
payload descriptions in upstream docs/api.md at that same commit.
WoWDeck adds paginated reads, server-decided limits, persistent local choices
and destination controls. The discovery fixture uses synthetic realm IDs;
it does not capture a player's character or account information.

CharacterDiscovery.ts adapts the account, factionrealm scope and game-version
formats from `tsm/wow/accounts.py`, `saved_variables.py` and `game_versions.py`
at `1908e34930f742a3a9ce754faf4e1839431fff3a`. WoWDeck reads tables as data,
combines known installations and orders candidates by character-directory
modification time. The RPC fixtures use synthetic characters and fixed times.

SavedVariables.ts holds the table reader that character discovery and the
Ledger share. It reads the `TradeSkillMasterDB` layout described in upstream
`saved_variables.py` at the same commit. The parser is WoWDeck's own.
Upstream matches regular expressions. WoWDeck parses `Name = table`
statements, rejects anything else and never evaluates Lua. It keeps the
four files it parsed last and parses one again when its last-write time or
size changes. Together they hold at most 32 MiB of file, except
that the newest stays whatever its size, so a scan over many files keeps
few of them in memory. It refuses files over 256 MiB before
reading them and skips `TSMItemCacheDB`. The reader's fixtures are
synthetic.

ItemNames.ts reads the addon's `TSMItemInfoDB`. Its format follows
`ItemInfoSerializer.lua`, `ItemInfoCache.lua` and `LongString.lua` in
TradeSkillMaster 4.15.9. The Ledger looks up the full item string, then the
base item string, using the selected account's cache. The display falls back
to the item string when the cache has no name.

`backend/tests/fixtures/tsm/ledger-item-names-legacy.lua` contains three
public ID and name pairs verified against a local Classic Era Deck
capture. The fixture puts those pairs in short legacy chunks and omits
account records, item metadata and all other cache entries. The captured
cache uses legacy lists and its `data` field fails raw deflate. A
current-format regression fixture needs a Deck capture with a CBOR cache.

Interruption recovery extends the same socket and auction protocol with
WoWDeck's transaction completion hook, forced refresh per installation,
four download slots, cancellation and status-only diagnostics. Reconnects
use manual timers in tests, with five-second exponential delays capped at
60 seconds for drops and 300 seconds for server disconnects. Server delays
use a random multiplier between 0.8 and 1.

Classic delivery shares the region/game-version table and faction realm keys
from `tsm/wow/game_versions.py` at the same pinned commit. The writer applies
those keys to connected houses and targets each matching installation.
`backend/tests/fixtures/tsm/classic.json` records that table with synthetic
localized realm names. RPC replay uses the existing auction payload fixture
shape and tests both factions without character discovery.
