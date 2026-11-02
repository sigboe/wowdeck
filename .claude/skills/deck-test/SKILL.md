---
name: deck-test
description: Deploy to the owner's Steam Deck and test there through tools/deck-ui/deck. Use whenever the owner asks to test, verify, check, look at or reproduce something on the Deck or on device. Pass a brief as the argument: the build (branch or commit, engine change or not), every claim to verify, and anything the owner said about the run.
context: fork
---

# Test on the Steam Deck

You run in a fresh context. The brief from the caller:

$ARGUMENTS

An empty brief → verify the newest commit's change on `next` (`git log -1`),
and say in the report that the brief was empty.

The owner's request is the approval: deploy, read and drive without asking
again. Scope (from `AGENTS.md`): the WoW installation and our plugin's files.
Leave Steam, Decky, other plugins and the system as they were.

Every tool call re-sends this whole context, so the run's cost is calls ×
context. Do the test in few calls: batch steps into one `deck run`, and read
answers from probes instead of screenshots.

## The tool

`tools/deck-ui/deck` (`node deck.mjs help` lists every step). Machine-local
details (Deck address, Wake-on-LAN) live in `tools/deck-ui/local.env`;
missing → copy `local.env.example` and fill it from `local.md` beside this
file.

```sh
tools/deck-ui/deck up            # wake, tunnel, build, back up, guard autoUpdate, deploy, reload
tools/deck-ui/deck up --engine   # the same with the engine (patchelf, smoke test, atomic swap)
tools/deck-ui/deck run 'open; wait plugin = WoWDeck; probe tab focus'
tools/deck-ui/deck down          # restore autoUpdate
```

- An action step (`open close nav press key seek rpc eval`) prints what changed
  once the UI settles: `focus`, `tree` (the active nav tree;
  `ModalDialogOverlay_*` = a modal is up), `route`, `plugin`. `no change` after a
  press is a finding.
- `seek` matches visible focusable labels. Inactive tabs show only icons;
  seek the current tab by its label, then use `key left` or `key right`.
- `wait <probe> ~ <text>` replaces sleeps; `expect` checks once. A failed check
  stops the run and prints where the UI stands.
- `rpc <method> '{json}' --pick=a.b[].c` calls the engine and checks the method
  name against `contracts.ts`; `rpc --list` lists them.
- `shot` writes a PNG capped at 800 px (`--clip=<css>` crops) and prints its
  path. Read it only for a visual claim (layout, glyphs, colour).
- `press` drives a real pad that lives for the whole run. B, X, Y, L1/R1 and
  Options (= **Y**) exist only on the pad. Presses on our plugin's controls
  are fine; Steam's and other plugins' controls get navigation only.
- `log [n] [pattern]` tails the newest plugin log; `journalctl -u
  plugin_loader` over SSH covers Decky.

## Steps

1. **Up.** `deck up` (add `--engine` for an engine change). It prints one line
   per thing it did and stops on what needs the owner: a Deck still asleep
   after Wake-on-LAN, or "Allow Remote CEF Debugging" switched off (Decky →
   Developer). Done when it prints `up: deployed … reloaded <version>` or
   `already runs this build`.
2. **Drive and observe.** One `deck run` per claim where you can. Done when
   every claim in the brief has an observed result.
3. **Down and report.** `deck down`, remove any in-memory hooks, then report
   each claim with what you observed, tagged `DEVICE`, with date and method.
   Run `down` after a failed deployment or test too, if `up` changed autoUpdate.
   Backups live under `~/homebrew/data/wowdeck/test-backups/`.
   Leave the tested build installed. A step that needs the owner (waking the
   Deck, a press only they can make, the on-screen keyboard) → stop and
   report exactly what they must do; the caller relays it.

## Beyond deck.mjs

- Motion, profiles, per-press walks and recordings: `walk.mjs --diff`,
  `step.mjs --diff`, `film.mjs`, `profile.mjs`, `capture.mjs` (wrap in
  `timeout -s INT`), `render.mjs`. `node tools/deck-ui/help.mjs` lists them.
- The `deck-cef` MCP (`mcp__deck-cef__*`, pass `pageId` on every call) covers
  console and network history and views no step reaches. Leave Steam's
  windows where they are: `navigate_page`, `new_page`, reload traces and
  navigation-mode Lighthouse replace Steam's UI. The `chrome-devtools` plugin
  drives a local Chrome and never reaches the Deck.
- CDP reaches the whole Steam client: cookies, tokens and account data stay
  unread.

Rarer cases (engine-only runs, test URLs, file-manager and clipboard actions,
a TV-sized Big Picture) are in [reference.md](reference.md).
