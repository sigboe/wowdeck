# TradeSkillMaster account follows

Evidence for #179, reviewed 2026-11-09: #173's official-app 1.0.9
inspection reports that every account follow counts toward the displayed
allowance, including Classic faction entries. This is evidence about the
current official client's counting behaviour, not a fresh measurement of
server enforcement. The older support article describing free Classic
follows refers to the pre-1.0 API. WoWDeck always sends follow requests and
lets the server decide; its displayed count never blocks a request.

The read-only tsm-app-linux API notes at commit
1908e34930f742a3a9ce754faf4e1839431fff3a document
GET /user-realms?userIds=<sub>, POST /user-realms with userId, realmId and
uppercase auctionHouseType, and DELETE /user-realms/<id>. POST/DELETE
response bodies were not captured or used by either client. WoWDeck reloads
the account list after mutations and reads every reported page.

Automated checks replay local endpoint responses only. Character discovery
reads saved WoW settings in temporary installation trees. No external
account request is needed.

## Account follow management

The account response lists every followed realm and auction-house pair,
independent of the selected installation. Manage shows its realm name,
region, WoW version and faction. The destination identifies the account
using the name provided by authentication and shows the account-wide
allowance without a tier label. Unlimited accounts show only the count.

Unfollow requires confirmation because the account list is shared across
computers. Successful explicit unfollows persist as declined choices, so
character discovery does not recreate them. A failed service request leaves
the follow in place. Manage does not add nonlocal follows.


## Installation evidence

The destination lists only realm and auction-house pairs discovered from
the selected installation. Its regions come from those same matched pairs.
Account follows, counts and Manage remain account-wide even when there is
no local evidence. Filtering changes visibility, not follows or price delivery.

Retail discovery reads the portal in WTF/Config.wtf and character directories
under WTF/Account. Classic discovery reads the region from the account's
TradeSkillMaster_AppHelperDB and factionrealm scopes from TradeSkillMasterDB.
Classic scopes can remain after character directories disappear. Neither
source proves a character still exists on Blizzard's servers.

The help asks players to create or use a character, log in and log out to
save settings. Classic also needs TradeSkillMaster and AppHelper enabled
for those saved variables to be written. After WoW saves the settings,
reopening the destination or the next discovery scan can reveal the rows.
