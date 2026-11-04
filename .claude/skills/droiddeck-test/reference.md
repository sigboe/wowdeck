# DroidDeck test reference

## Serving files to the phone

The phone reaches a server on the dev machine through adb's reverse port:
`adb -s <serial> reverse tcp:8765 tcp:8765`, then
`python3 -I .claude/skills/droiddeck-test/serve.py <dir> 8765` (adds the CORS
header a module import from Steam's origin needs). Inside the container and
in Steam, the server is `http://127.0.0.1:8765/`. Undo with
`adb reverse --remove tcp:8765` and stop the server.

## Frontend in memory (no wedge, no restart)

The bundle takes its plugin name from an inline manifest, so it imports from
any URL. On `SharedJSContext`, with `dist/` served:

    (async () => {
      const L = DeckyPluginLoader;
      if (L.reloadLock) return "reload in progress";
      DFL.Navigation.CloseSideMenus();
      const old = L.plugins.find((p) => p.name === "WoWDeck");
      L.unloadPlugin("WoWDeck", true);
      const m = await import("http://127.0.0.1:8765/index.js?t=" + Date.now());
      L.plugins.push({ ...m.default(), name: "WoWDeck", version: old.version, loadType: old.loadType });
      L.deckyState.setPlugins(L.plugins);
    })()

The QAM keeps rendering the old bundle's panel until you leave WoWDeck with
Decky's back arrow and open it again. Until then the old panel runs against
unloaded hooks (Get Addons shows its collapsed fallback). The engine and
`main.py` stay the installed ones.

## Zip through Decky's installer

The real update path. Serve `build/` and call on `SharedJSContext`:
`DeckyBackend.call("utilities/install_plugin", "http://127.0.0.1:8765/WoWDeck.zip", "WoWDeck", "<version>", false, 2)`
(2 is an update). Decky shows its own "Update WoWDeck" prompt; `ddc input pad a`
confirms. The files land, then Decky wedges (SKILL.md) and the new frontend
never loads: the session restart afterwards loads it.

The installer drops file modes: `bin/wowdeck-*` arrive at 0600. `main.py`
restores the execute bit before it starts the engine (#67); a build without
that fix logs "Starting engine binary" three times and gives up, so `chmod
+x` the engine by hand. A chmod does not set off the wedge.

## Recognising and clearing the wedge

    ddc guest -- bash -c 'L=/root/homebrew/services/PluginLoader.log; a=$(grep -c "to not be re-loaded" $L); sleep 10; echo $a $(grep -c "to not be re-loaded" $L)'

A count that grows while nothing is being installed is the wedge. A
`fetch("http://127.0.0.1:1337/…")` from `SharedJSContext` with a 5 s abort
times out, and `DeckyPluginLoader.plugins` is empty. Calling
`DeckyPluginLoader.importPlugin` by hand makes it worse: it unloads the
running frontend first and then waits forever. Only a session restart clears
it (ask the owner; `ddc stop`, then `ddc start steam --wait`).

## What this Steam client changed

The phone runs the native arm64 Steam client, a younger steamui than SteamOS
3.8. Measured differences that bit us:

- The QAM widens only while Friends' store flag is set **and** the Friends tab
  is active. WoWDeck adds Steam's `Expanded` class to the view's placeholder
  itself (`src/steamDom/qamExpandHook.tsx`, ADR 0001 revision 7).
- Big Picture's window is 1062×490 CSS px and the QAM window 855×411, where
  the Deck has 854 for both.

## Device

Galaxy S25 (SM-S931B), aarch64, 4 KB pages. DroidDeck 0.6.7, runtime
ubuntu-r1-rc4, gamescope Wayland at 1560×720@120. No WoW installation: every
WoW-dependent call answers `not_found`, which is fine for UI work and makes
the install paths untestable here.
