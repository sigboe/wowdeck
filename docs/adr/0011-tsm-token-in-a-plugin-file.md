# The TradeSkillMaster token is kept in a plugin file, not a keyring

Owner decision, grilling of the TradeSkillMaster source, 2026-11-09.

Signing in to TradeSkillMaster gives WoWDeck an offline refresh token. It does
not expire with the browser session, so it is worth as much as the account
password until it is revoked. WoWDeck keeps only that token, in its own file
in the plugin data directory, readable by the owner alone (mode 0600). It is
not in the settings file, so diagnostics, settings export and backups never
carry it, and it is never logged. Signing out revokes it at TradeSkillMaster
and deletes the file. The access token lives in memory only.

We rejected the system keyring, which tsm-app-linux and TradeSkillMaster's own
app use. SteamOS game mode, where WoWDeck runs, has no unlocked Secret
Service; KWallet exists only in desktop mode. A keyring requirement would
make sign-in fail for most players. We also rejected encrypting the file with
a key stored on the same disk: anyone who can read the file can read the key,
so it would only look safer. The file is plain, and the permission bit is
what protects it.
