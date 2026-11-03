# Deck UI tools

## Contents

- [Connect](#connect)
- [Scripts](#scripts)
- [Rules](#rules)

Small Node scripts (Node 22, no dependencies) that drive Steam's own CEF over
an SSH tunnel. They are the default way to inspect and measure the UI, and they
measured the findings in `docs/UI_DEVELOPMENT_BEST_PRACTICES.md` (S15–S25,
case 12). Run them from a machine that can SSH to the Deck.
`node help.mjs` prints the command list for about 500 tokens, which beats
reading this file.

They talk to the same endpoint as the Chrome DevTools MCP, so they see the same
data for far fewer tokens. Measured 2026-11-02 in one session: a state line is
42 tokens against about 250 for the equivalent MCP calls, a 12-node
accessibility tree is 51 against 752 for `take_snapshot`, and an audit is 15
against about 4,400, because the 7.4 KB of audit code is read from disk instead
of pasted into a tool call. The MCP also adds 6,549 tokens of tool schemas to
every request. Use it for what a one-off script would cost more to write than
to call: console and network history, an accessibility tree of an unfamiliar
view, exploration. `docs/remote-browser.md` has the setup and the rules.

Run the local regression checks with `nix develop -c bun test tools/deck-ui`.
They simulate CEF and SSH without contacting a device.

## Connect

For a device test, run `tools/deck-ui/deck up` from the repository root.
It tries `DECK`, then the comma-separated fallback addresses in `DECK_HOSTS`.
Put the Wi-Fi and Ethernet addresses of the same Deck in `local.env`.
If none answers, it sends configured Wake-on-LAN and retries before asking
for manual wake. The USB Ethernet adapter must be connected before sleep.
SSH commands have a 30-second process limit and do not reuse or stop existing
SSH control sessions. The selected address is used for deployment, controller
input and new debugger tunnels. No live device access is needed for the tests.

For long evaluations, set a budget with `deck eval --t=120000 --file=script.js`.
Use `--file=script.js` or `--stdin` to pass literal JavaScript without the
batch parser removing quotes. For example:

```sh
tools/deck-ui/deck eval --t=120000 --stdin <<'JS'
DeckyBackend.call("loader/reload_plugin", "WoWDeck").then(() => "reloaded")
JS
```

The default evaluation budget is 10 seconds. A timeout stops waiting, not the
page-side operation. Inspect its state before retrying an install or scan.

For a manual debugger connection without deployment:

1. On the Deck: Decky → Settings → Developer → enable "Allow Remote CEF Debugging".
   Steam then listens on `127.0.0.1:8080` on the Deck only.
2. Tunnel it: `ssh -f -N -o ServerAliveInterval=15 -L 9222:localhost:8080 -L 18080:localhost:8080 deck@<deck-ip>`
   (9222 is for the MCP, 18080 for these scripts; `deck up` opens it when it is down)
3. Check it with `node state.mjs`. One line: page count, route, active plugin,
   QAM state, focus and view size. `--pages` adds the target titles.
   `curl -s localhost:18080/json | grep title` lists the same targets. The
   useful ones: `QuickAccess_uid…` (the QAM and our panel),
   `Steam Big Picture Mode` (pages, modals), `SharedJSContext` (where Steam's
   and Decky's JS run: `SteamClient`, `window.DFL` = @decky/ui,
   `DeckyPluginLoader`).

Every script takes a target by a substring of its title.

## Scripts

| Script | Use |
|---|---|
| `deck` / `deck.mjs` | Start here. `deck up` wakes the Deck, opens the tunnel, builds, backs up, turns autoUpdate off, deploys what changed and reloads (`--engine` also patches, smoke-tests and swaps the engine; `--dry-run` lists what would deploy); `deck down` restores autoUpdate. `deck run 'open; wait plugin = WoWDeck; probe tab focus; shot'` runs steps in one call: every action prints what changed (focus, active nav tree, plugin tab, route, panel), `wait`/`expect` check probes, `rpc` calls the engine by its contract name, `shot` caps screenshots at 800 px, and `press` uses one virtual pad for the whole run. `deck help` lists the steps |
| `help.mjs` | The command list, compact. Read this instead of the file |
| `state.mjs [--pages]` | One line: pages, route, active plugin, QAM open/closed, focused text, view size. `--pages` adds the target titles |
| `seek.mjs <target> <label> [--press] [--list] [--enter] [--reset]` | Focus the element whose text matches, in one call: it walks Steam's navigation tree and calls `BTakeFocus` on the match, so it crosses columns, scroll regions and text fields that arrow keys cannot. `--list` prints the matches, `--enter` presses Enter after, `--reset` opens the QAM on our panel first, `--press` steps there with real keys and checks after every press |
| `tree.mjs <target> [--roles=a,b] [--max=N]` | Accessibility tree as `role:name` lines, generic nodes dropped. Replaces an MCP `take_snapshot` at about a fifteenth of the tokens |
| `eval.mjs <target> <expr\|file.js> [-p]` | Evaluate JS and print the result (measure DOM, computed styles, nav tree). Strings print raw, everything else compact on one line; `-p` indents |
| `shot.mjs <target> <out.png> [--timeout=ms]` | Screenshot one window; prints the path and byte size. A hidden window can hang the capture, so it gives up after 10 s |
| `key.mjs <target> <ArrowUp\|ArrowDown\|ArrowLeft\|ArrowRight\|Escape> [count] [delayMs]` | Send navigation keys (Escape = B) |
| `wheel.mjs <target> [count] [deltaY]` | Send real CDP mouse-wheel notches (default 6 × −120) at screen center |
| `pad.sh [--delay ms] [--settle ms] <button…>` | Real controller input: a virtual Xbox 360 pad on the Deck (`pad.py` over SSH, `/dev/uinput`, system Python, nothing installed). Buttons `a b x y lb rb lt rt view menu guide l3 r3 up down left right`, plus `wait:ms` and `hold:button:ms`. Reaches what keys can't: X, Y, Menu, L1/R1. Steam may show Xbox glyphs while it was the last controller used, and each call pops Steam's controller connected/disconnected toasts (the pad lives for one call; `deck press` keeps one pad for a whole run). `DECK` comes from the environment or `local.env` (copy `local.env.example`) |
| `step.mjs <target> <ArrowUp\|ArrowDown> <count> <delayMs> <measure.js> [--diff]` | Press, wait, run a measurement, print, repeat: the per-press test used for scrolling. `--diff` prints only the fields that changed |
| `enter-if.mjs <target> <css-selector>` | Press Enter only if the focused element matches the selector (e.g. a tab) |
| `film.mjs <target> <ms> <outDir> [triggerTarget trigger.js]` | Record every rendered frame (screencast) while running a trigger: animations, flashes, stalls; frame timestamps show hitches |
| `capture.mjs [--start a] [--stop b] [--tail 1500] [--film <targets>] [--out dir]` | Record what Steam does between two presses the owner makes on the Deck (A starts, B stops, plus a tail): every button, the on-screen keyboard state, the QAM view's native bounds per frame and every `SetBounds` call with its stack, the QAM window's size/visibility, windows opening and closing, and screencast frames. Writes `events.jsonl` and `summary.txt`. `--learn` prints button codes. Armed before the press, undone at the end |
| `profile.mjs <target> <ms> <trigger.js> <out.json>` | CPU-profile a trigger and print the top functions and scripts |
| `walk.mjs <target> <measure.js> [--diff] <keys…>` | Press each arrow key in turn and print the measurement after it. `--diff` prints only the fields that changed |
| `audit-view.mjs <target> [--brief]` | Guideline audit of the view on screen (`audit.js`): content too close to a highlight's edge, touching focus targets, text under 12 px, clipped text, anything wider than the QAM panel (OVERFLOW). `--brief` prints one summary line |
| `render.mjs <Component> '<props JSON>' [out.png]` | Render one @decky/ui component in memory in our QAM panel (no build, no deploy), print its box against the panel's, audit, screenshot, then remove it. Use before adopting a Steam component in the QAM |
| `audit-focus.js` | Guideline audit of what lights up at the current focus; use with `walk.mjs` or `step.mjs` |

Useful one-liners (run with `eval.mjs SharedJSContext …`): open the QAM on Decky
`window.DFL.Navigation.OpenQuickAccessMenu(999)`, open our panel
`window.DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck')`,
close side menus `window.DFL.Navigation.CloseSideMenus()`, go to a route
`window.DFL.Navigation.Navigate('/wowdeck/get-addons')`.

## Rules

- **Scope.** Deck rules: `AGENTS.md` ("The owner's Steam Deck"); the test
  procedure is the `deck-test` skill (`.claude/skills/deck-test/SKILL.md`).
  Data-changing presses (Install, Update, Remove, toggles) stay inside our
  plugin; Steam's and other plugins' controls get navigation keys only. `enter-if.mjs` guards an Enter with a
  selector.
- **In-memory trials are fine, persistent changes are not.** Changing a style or
  a nav-node property in memory to test a theory is undone by a Steam UI reload;
  say so in the notes and remove it when done.
- **Steam's screensaver swallows synthetic input** (it is not "activity"). If
  focus stops moving, ask the owner to disable the screensaver for the run.
- **Read Steam's code too.** `scp deck:~/.local/share/Steam/steamui/{sp.js,css/sp.css}`
  (or the copies under a scratch directory) and search them: hashed class names
  map to readable names in `sp.js` (`Name:"hash"`), and the CSS shows the values.
- Record what you measured, with date and method, in the guide (DEVICE tag).
