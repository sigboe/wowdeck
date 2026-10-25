# Deck UI tools

## Contents

- [Connect](#connect)
- [Scripts](#scripts)
- [Rules](#rules)

Small Node scripts (Node 22, no dependencies) for studying Steam's own UI and
checking ours on a real Steam Deck over the Chrome DevTools Protocol. They are
how the findings in `docs/UI_DEVELOPMENT_BEST_PRACTICES.md` (S15–S25, case 12)
were measured. Run them from a machine that can SSH to the Deck.

For evaluating JS, screenshots and DOM checks, prefer the Chrome DevTools MCP
(`docs/remote-browser.md`). It uses the same CEF endpoint and costs fewer
tokens. Use these scripts for what it cannot do: `film`, `profile`, `step`,
`walk`, `render` and the audits.

## Connect

1. On the Deck: Decky → Settings → Developer → enable "Allow Remote CEF Debugging".
   Steam then listens on `127.0.0.1:8080` on the Deck only.
2. Tunnel it: `ssh -f -N -o ServerAliveInterval=15 -L 9222:localhost:8080 -L 18080:localhost:8080 deck@<deck-ip>`
   (9222 is for the MCP, 18080 for these scripts)
3. List targets: `curl -s localhost:18080/json | grep title`. The useful ones:
   `QuickAccess_uid…` (the QAM and our panel), `Steam Big Picture Mode` (pages,
   modals), `SharedJSContext` (where Steam's and Decky's JS run: `SteamClient`,
   `window.DFL` = @decky/ui, `DeckyPluginLoader`).

Every script takes a target by a substring of its title.

## Scripts

| Script | Use |
|---|---|
| `eval.mjs <target> <expr\|file.js>` | Evaluate JS and print the result (measure DOM, computed styles, nav tree) |
| `shot.mjs <target> <out.png>` | Screenshot one window |
| `key.mjs <target> <ArrowUp\|ArrowDown\|ArrowLeft\|ArrowRight\|Escape> [count] [delayMs]` | Send navigation keys (Escape = B) |
| `wheel.mjs <target> [count] [deltaY]` | Send real CDP mouse-wheel notches (default 6 × −120) at screen center |
| `DECK=deck@<ip> pad.sh [--delay ms] [--settle ms] <button…>` | Real controller input: a virtual Xbox 360 pad on the Deck (`pad.py` over SSH, `/dev/uinput`, system Python, nothing installed). Buttons `a b x y lb rb lt rt view menu guide l3 r3 up down left right`, plus `wait:ms` and `hold:button:ms`. Reaches what keys can't: X, Y, Menu, L1/R1. Steam may show Xbox glyphs while it was the last controller used, and each call pops Steam's controller connected/disconnected toasts (the pad lives for one call) |
| `step.mjs <target> <ArrowUp\|ArrowDown> <count> <delayMs> <measure.js>` | Press, wait, run a measurement, print, repeat: the per-press test used for scrolling |
| `enter-if.mjs <target> <css-selector>` | Press Enter only if the focused element matches the selector (e.g. a tab) |
| `film.mjs <target> <ms> <outDir> [triggerTarget trigger.js]` | Record every rendered frame (screencast) while running a trigger: animations, flashes, stalls; frame timestamps show hitches |
| `capture.mjs [--start a] [--stop b] [--tail 1500] [--film <targets>] [--out dir]` | Record what Steam does between two presses the owner makes on the Deck (A starts, B stops, plus a tail): every button, the on-screen keyboard state, the QAM view's native bounds per frame and every `SetBounds` call with its stack, the QAM window's size/visibility, windows opening and closing, and screencast frames. Writes `events.jsonl` and `summary.txt`. `--learn` prints button codes. Armed before the press, undone at the end |
| `profile.mjs <target> <ms> <trigger.js> <out.json>` | CPU-profile a trigger and print the top functions and scripts |
| `walk.mjs <target> <measure.js> <keys…>` | Press each arrow key in turn and print the measurement after it |
| `audit-view.mjs <target>` | Guideline audit of the view on screen (`audit.js`): content too close to a highlight's edge, touching focus targets, text under 12 px, clipped text, anything wider than the QAM panel (OVERFLOW) |
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
