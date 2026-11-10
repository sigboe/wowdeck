# WoWDeck signs in to TradeSkillMaster as its desktop client

Owner decision, grilling of the TradeSkillMaster source, 2026-11-09.

TradeSkillMaster offers no API for third-party apps. Its sign-in server
accepts one public client for desktops, `desktop-app`, the client of
TradeSkillMaster's own app. That client allows only the browser flow with a
`localhost` redirect: the password grant and the device grant are both
refused (the device grant probed 2026-11-09). The addon also checks the app
version it is handed, and expects the official app's.

WoWDeck does exactly what tsm-app-linux does. It signs in as `desktop-app`
through Steam's browser, sends a User-Agent that names WoWDeck and its
version, and hands the addon the official app's version in `APP_INFO`.
Followed realms live on the account and are shared with TradeSkillMaster's
own app on the player's other computers.

TradeSkillMaster can block or change this client at any time, and WoWDeck
would then lose sign-in until it adapts. We accepted that rather than wait
for a client id of our own: tsm-app-linux has run this way in the open, and
asking TradeSkillMaster can go on in parallel. Sign-in by QR code needs the
device grant, so it waits until TradeSkillMaster enables it for this client.

Optional uninstall cleanup uses recorded creation by WoWDeck for the signed-in
account. Creation does not imply exclusive use. Cleanup excludes follows needed
by another configured installation and follows without account creation records.
Players choose cleanup explicitly. Remote failures leave addon removal available;
the result reports local removal and account cleanup separately. Successful
unfollows retain the explicit decline so discovery does not recreate them.
