---
name: droiddeck-test
description: Deploy to the owner's Android phone running DroidDeck (arm64 Steam in a proot container) and test there over adb and droiddeckctl. Use whenever the owner asks to test, verify, check or reproduce something on the phone, on DroidDeck, or on arm64.
---

# Test on DroidDeck

The owner's request is the approval: deploy, read and drive without asking
again. Scope (from `AGENTS.md`): our plugin's files and data. The phone is
the owner's daily driver, so every Steam session stop or start is a question
to the owner first; DroidDeck's settings, other apps and Android stay as they
were.

- Phone: wireless adb, address and the TV to avoid in `local.md` beside this
  file (git-ignored). Always pass the serial: another device is attached.
- Inside the container (`ddc guest`): plugin `/root/homebrew/plugins/wowdeck`,
  data `/root/homebrew/data/wowdeck`, plugin logs
  `/root/homebrew/logs/wowdeck/`, Decky's log
  `/root/homebrew/services/PluginLoader.log` (no timestamps; it keeps every
  session, split them on `Starting Decky`).
- Tools: `droiddeckctl`, `adb_device.py`, `proot_profile.py` from
  Droid-Deck/DroidDeck `tools/` on main (its `docs/agent-control.md` is the
  API reference), copied into `.scratch/droiddeck/`. The wrapper every step
  below uses:

      ddc() { nix shell nixpkgs#android-tools -c env PYTHONPATH=.scratch/droiddeck \
        ADB_SERIAL=<ip>:5555 python3 .scratch/droiddeck/droiddeckctl "$@"; }

## The wedge

Decky under DroidDeck wedges whenever it loads WoWDeck again inside a running
session: a write into the plugin folder, `loader/reload_plugin`, or an update
through Decky's own installer. Its log then repeats "Plugin WoWDeck (…) is
already loaded and has requested to not be re-loaded" about 10 times a
second, port 1337 stops answering and WoWDeck is gone from the QAM until the
session restarts. A fresh session start is clean. So the deploy path is
"files in place, then one session restart", and quick frontend iterations
load the bundle in memory instead (reference.md).

## Steps

1. **Connect.** `adb connect <ip>:5555`. Refused → ask the owner for the
   wireless-debugging port (Developer options; it changes every time
   wireless debugging turns on, and it turns off when the screen locks),
   connect to it, then `adb -s <ip>:<port> tcpip 5555` so it stays 5555
   until a reboot. Done when `adb devices` lists `<ip>:5555 device`.
2. **Check the session.** `ddc state`: `session.phase` READY and `suspended`
   false. SUSPENDED shows the owner a black Steam screen: `ddc resume`.
   Debugging tools off (`ddc access`) → the owner turns on Setup ›
   Diagnostics › Debugging tools; the bridge refuses to do it remotely.
   Done when `ddc cdp targets` lists `SharedJSContext`.
3. **Build.** Frontend only: `make build`, then load it in memory
   (reference.md). Engine, `main.py` or a real update path: build the
   universal zip on a throwaway branch that has every needed branch merged
   (arm64 engine included), with `CURSEFORGE_API_KEY` linked in and a test
   version (`make version-set VERSION=x.y.z-test.n`, `make package`).
4. **Back up** `/root/homebrew/data/wowdeck/state.json` and every file you
   replace into `/root/homebrew/data/wowdeck/backups/<date>/`.
5. **Deploy.** In memory, or the zip through Decky's installer
   (reference.md), which wedges Decky: ask the owner for a session restart
   right after. Done when the new build's behaviour shows up, or its version
   is in `plugin.json` and `DeckyPluginLoader.plugins` after the restart.
6. **Drive and observe.** See [Driving](#driving). Done when every claim in
   the request has an observed result.
7. **Restore and report.** Remove in-memory hooks, stop `adb reverse` and the
   local server, leave the tested build installed, then report what you
   observed, tagged `DEVICE`, with date and method.

## Driving

- `ddc cdp eval --target <title> '<js>'`: targets `SharedJSContext`
  (`DFL`, `DeckyPluginLoader`, `DeckyBackend`, Steam's webpack),
  `QuickAccess` (our panel), `Steam Big Picture Mode` (the QAM view's
  placeholder, modals). Timeout is in seconds. Pipe stdout through
  `python3 -c "import json,sys;print(json.load(sys.stdin)['value'])"` with
  stderr dropped; long scripts go in a file passed as `"$(cat f.js)"` (one
  argument tops out near 128 KB).
- Open the QAM with `ddc input pad qam`. Opened from script
  (`DFL.Navigation.OpenQuickAccessMenu`) it gets no gamepad focus and every
  press goes nowhere.
- Real buttons: `ddc input pad <a|b|x|y|lb|rb|up|down|left|right|qam|guide>`.
  Touch: `ddc input tap X Y` in session output pixels (1560×720), not
  screenshot pixels (2340×1080, ×1.5).
- `ddc screenshot <png>` is the phone's screen, DroidDeck's on-screen pad
  included; Read it to see it.
- Is the engine up: `ps -eo pid,args | grep "[b]in/wowdeck-aarch64$"`
  (`pgrep -f` matches the guest command's own line and always says yes).
- Logs: `ddc guest -- bash -c '<cmd>'`; the JSON answer carries
  `stdout.text`. A guest command can hang for 40 s when the session is
  suspended or Decky is wedged; check `ddc state` before retrying.
- QAM widening on this client: the view's placeholder in `Steam Big Picture
  Mode` is the element carrying Steam's `ViewPlaceholder` class; its x is
  715 collapsed and 209 widened (Big Picture is 1062 CSS px wide here, not
  854).
- CDP reaches the whole Steam client: cookies, tokens and account data stay
  unread.

Rarer cases (in-memory loading, zip install, the wedge's recovery, what this
client changed in steamui) are in [reference.md](reference.md).
