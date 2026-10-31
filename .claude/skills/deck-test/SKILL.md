---
name: deck-test
description: Deploy to the owner's Steam Deck and test there through the deck-cef MCP tools, SSH and tools/deck-ui. Use whenever the owner asks to test, verify, check, look at or reproduce something on the Deck or on device.
---

# Test on the Steam Deck

The owner's request is the approval: deploy, read and drive without asking
again. Scope (from `AGENTS.md`): the WoW installation and our plugin's files.
Leave Steam, Decky, other plugins and the system as they were.

- Deck: `$DECK`, a `deck@<host>` SSH target (key auth; no sudo). Export it in
  your shell, or keep machine-local details — address, TV geometry, personal
  test files — in `local.md` beside this file (git-ignored, never committed).
- Plugin: `~/homebrew/plugins/wowdeck` (dir root-owned, files deck-owned);
  state `~/homebrew/data/wowdeck/state.json`; logs
  `~/homebrew/logs/wowdeck/`.
- Browser tools: the `deck-cef` MCP server (`mcp__deck-cef__*`), Steam's own
  CEF over the SSH tunnel. The `chrome-devtools` plugin drives a local Chrome
  instead, so it never reaches the Deck.

## Steps

1. **Wake.** `ssh -o ConnectTimeout=5 -o BatchMode=yes $DECK true` failing
   with "No route to host" means the Deck is asleep. Send a magic packet
   from the dev shell: `wakeonlan -i <broadcast> <MAC>`, with the USB
   Ethernet adapter's MAC and the LAN broadcast address from `local.md`.
   Poll the SSH check every 30 s for 2 minutes. Wake-on-LAN works only
   through that adapter, and only when it was plugged in before the Deck
   went to sleep. Still asleep → ask the owner to wake the Deck. Done when
   the SSH check succeeds.
2. **Connect.** `curl -s --max-time 3 localhost:9222/json/version` shows
   `webSocketDebuggerUrl`. If not, open the tunnel:
   `ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -L 9222:localhost:8080 -L 18080:localhost:8080 $DECK`.
   Still refused → ask the owner to enable Decky → Developer → "Allow Remote
   CEF Debugging". No `deck-cef` tools → set it up per `docs/remote-browser.md`.
   Done when `list_pages` returns the Steam windows.
3. **Build.** `make build`. For an engine change, patch a copy of
   `backend/out/wowdeck`:
   `nix shell nixpkgs#patchelf -c patchelf --set-interpreter /lib64/ld-linux-x86-64.so.2 <copy>`
   (the Nix loader path does not exist on SteamOS: the plugin dies).
   Smoke-test the copy on the Deck from `/tmp` with a throwaway
   `WOWDECK_DATA_DIR` before it replaces the live one.
4. **Back up** `state.json`, the logs and every file you replace into
   `~/wowdeck-backups/<date>/` on the Deck.
5. **Guard auto-update.** The owner runs auto-update. A reload after a
   scan/matching change or with an extra source switched on updates newly
   matched addons within seconds. For those, set `autoUpdate` off first and
   restore it at the end.
6. **Deploy in place**, over SSH:
   `ssh $DECK "cat > /home/deck/homebrew/plugins/wowdeck/dist/index.js" < dist/index.js`
   (scp mangles the path). `main.py` the same way. The engine binary goes to a
   temp name in `bin/`, then `mv` (it is running).
7. **Reload.** On `SharedJSContext`: `DFL.Navigation.CloseSideMenus()`, then
   `DeckyBackend.call("loader/reload_plugin","WoWDeck")`. An open or
   reopened QAM keeps rendering the old bundle: in the QAM, click Decky's back
   arrow, then "WoWDeck". Done when a behaviour only the new build
   has shows up.
8. **Drive and observe.** See [Driving](#driving). Done when every claim in
   the request has an observed result.
9. **Restore and report.** Restore `autoUpdate` and anything else you changed
   for the test, remove in-memory hooks, then report what you observed, tagged
   `DEVICE`, with date and method.

## Driving

- `list_pages` once per session (and after a reload); pass `pageId` on every
  call. Targets: `QuickAccess_uid2` (QAM and our panel), `SharedJSContext`
  (`SteamClient`, `window.DFL`, `DeckyPluginLoader`, `DeckyBackend`),
  `Steam Big Picture Mode` (routes, modals, Details), `notificationtoasts_uid2`.
- Move around with `evaluate_script` on `SharedJSContext`:
  `DFL.Navigation.OpenQuickAccessMenu(999)`,
  `DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck')`,
  `DFL.Navigation.Navigate('/wowdeck/get-addons')`. `navigate_page`,
  `new_page`, reload traces and navigation-mode Lighthouse replace Steam's UI;
  leave them unused.
- Engine calls without the UI:
  `DeckyBackend.call('loader/call_plugin_method','WoWDeck','rpc','<method>',{…})`,
  raced against a timeout; method names come from `contracts.ts` (an unknown
  name hangs).
- Real buttons: `DECK=$DECK tools/deck-ui/pad.sh wait:1500 <buttons>` (the first
  press after connect is lost). B/X/Y/L1/R1 and Options (= **Y**) need the pad;
  keyboard Escape is not B. Presses on our plugin's controls are fine;
  Steam's and other plugins' controls get navigation only.
- Query, don't dump: `evaluate_script` returning compact JSON beats
  `take_snapshot`. `.gpfocus` text is in `textContent`.
- Screenshots only of visible windows (a hidden QAM or `MainMenu` hangs):
  `format: "jpeg"`, `filePath` on disk. Details hides the QAM.
- Measure motion, profiles, per-press walks and guideline audits with the
  `tools/deck-ui/` scripts (port 18080; table in `tools/deck-ui/README.md`).
  Wrap `capture.mjs` in `timeout -s INT`.
- Logs and processes over SSH: `~/homebrew/logs/wowdeck/`,
  `journalctl -u plugin_loader`.
- CDP reaches the whole Steam client: cookies, tokens and account data stay
  unread.

Rarer cases (engine-only runs, test URLs, file-manager and clipboard actions,
a TV-sized Big Picture) are in [reference.md](reference.md).
