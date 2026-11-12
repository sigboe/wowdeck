---
name: deck-test
description: >-
  Automatically wake, deploy to and test the owner's Steam Deck through tools/deck-ui/deck under standing device-test approval. Use whenever the owner asks to test, verify, check, look at or reproduce something on the Deck or on device. Pass a brief as the argument: the build (branch or commit, engine change or not), every claim to verify, and anything the owner said about the run.
context: fork
---

# Test on the Steam Deck

Use the caller's brief, or the current user request in Codex. Claude Code
runs this skill in a fresh context and supplies the brief through:

$ARGUMENTS

An empty brief → verify the newest commit's change on `next` (`git log -1`),
and say in the report that the brief was empty.

The owner's device-test request is the approval: wake, deploy, read and drive
without asking again. Outside a test request, the device stays read-only.
Scope (from `AGENTS.md`): the WoW installation and our plugin's files.
Leave Steam, Decky, other plugins and the system as they were.
Use bounded, isolated SSH connections; leave the owner's existing SSH masters
and sessions untouched, including during cleanup.

Every tool call re-sends this whole context, so the run's cost is calls ×
context. Do the test in few calls: batch steps into one `deck run`, and read
answers from probes instead of screenshots.

## The tool

`tools/deck-ui/deck` (`node deck.mjs help` lists every step). Machine-local
details (Deck address, Wake-on-LAN) live in `tools/deck-ui/local.env`;
missing → copy `local.env.example` and fill it from `local.md` beside this
file. `DECK` is the primary SSH host; `DECK_HOSTS` adds comma-separated
Wi-Fi/Ethernet candidates.

```sh
tools/deck-ui/deck up            # wake, tunnel, build, back up, guard autoUpdate, deploy, reload
tools/deck-ui/deck up --engine   # the same with the engine (patchelf, smoke test, atomic swap)
tools/deck-ui/deck run 'open; wait plugin = WoWDeck; probe tab focus'
tools/deck-ui/deck down          # restore autoUpdate
```

- An action step (`open close nav press key seek rpc eval`) prints what changed
  once the UI settles: `focus`, `tree` (the active nav tree;
  `ModalDialogOverlay_*` = a modal is up), `tab`, `route`, `plugin`. `no change` after a
  press is a finding.
- `seek` matches visible focusable labels. Inactive tabs show only icons;
  seek the current tab by its label, then use `key left` or `key right`.
- `wait <probe> ~ <text>` replaces sleeps; `expect` checks once. A failed check
  stops the run and prints where the UI stands.
- `rpc <method> '{json}' --pick=a.b[].c` calls the engine and checks the method
  name against `contracts.ts`; `rpc --list` lists them.
- `toast-start` installs an observer in the notification DOM before the
  action; `toast-read` returns every retained notice in order (`INCOMPLETE`
  when the history limit overflowed), `toast-reset` drops earlier evidence,
  `toast-stop` removes the observer. Whichever way the run ends — last step,
  failed check, Ctrl-C — cleanup removes the observer and prints the capture;
  a lost CEF connection reports an incomplete capture, never a pass.
- `eval --t=<ms>` bounds evaluation time. Use `eval --file=<path>` or
  `eval --stdin` for literal JavaScript input rather than shell interpolation.
- `eval --active '<expr>'` evaluates in the document focus navigation walks —
  the QAM panel's or the focused modal's — exposed to the expression as `doc`,
  re-resolved on every call. With no active navigation tree it fails rather
  than evaluating some other document.
- `shot` writes a PNG capped at 800 px (`--clip=<css>` crops) and prints its
  path. Read it only for a visual claim (layout, glyphs, colour).
- `press` drives a real pad that lives for the whole run. B, X, Y, L1/R1 and
  Menu exist only on the pad. On an installed-addon row **Menu** opens the
  Options menu and X runs the quick action (Update, Find online source); Y
  does nothing there. Other controls give X and Y their own actions — Get
  Addons rows: X = Install, Menu = release channel; details modal: X =
  Install, Y = View on provider. Presses on our plugin's controls are fine;
  Steam's and other plugins' controls get navigation only.
- Start an investigation with `diagnose`; it returns bounded UI, engine,
  selected-installation and error summaries. `methods-check` runs locally.
  For reproduction-scoped logs, run `log-mark; <trigger>; log-wait <regex>
  --since=mark` in one batch. `react <css>` inspects component names and patch
  markers. Reload details and limits: [tool reference](../../../tools/deck-ui/README.md#diagnostics).

## Steps

1. **Up.** Automatically wake with `deck up` (add `--engine` for an engine
   change); no separate wake permission is needed. Before asking the owner to
   wake it, try configured Wake-on-LAN and bounded connection attempts to
   `DECK` and every configured Wi-Fi/Ethernet candidate in `DECK_HOSTS`.
   It prints one line per thing it did; stop for the owner only after those
   attempts fail, or when "Allow Remote CEF Debugging" is off (Decky →
   Developer). Done when it prints `up: deployed … reloaded <version>` or
   `already runs this build`.
2. **Drive and observe.** One `deck run` per claim where you can. Done when
   every claim in the brief has an observed result.
3. **Down and report.** `deck down`, remove any in-memory hooks, then write
   the effort's [continuation report](#continuation-report). Run `down`
   after a failed deployment or test too, if `up` changed autoUpdate.
   Backups live under `~/homebrew/data/wowdeck/test-backups/`.
   Leave the tested build installed. A step that needs the owner (waking the
   Deck, a press only they can make, the on-screen keyboard) → stop and
   report exactly what they must do; the caller relays it.

## Continuation report

One report per test effort, written when the run ends — finished, failed, or
stopped for the owner — and updated by every follow-up pass. It lives under
`docs/hardware/<date>-<name>/` when the effort may resume; a report in the
reply serves an effort that is done. Follow-up notes link to the report; a
second pass checklist beside it is how evidence gets lost.

The report names:

- **Build**: branch or commit, engine change or not, and how the installed
  build was identified (version string alone can be ambiguous; use hashes).
- **Fixture installation**: what was installed, from which source, into
  which installation, and the state the Deck was left in.
- **Each claim** from the brief with one result and its evidence:

| Result | Meaning |
| --- | --- |
| passed | Observed as claimed |
| partial | Part observed; the report says what remains untested |
| failed | Observed otherwise; the report says what happened instead |
| pending | Untested; the report says why, and what would test it |

Evidence is what was observed — command output, probe answer, log excerpt —
tagged `DEVICE` with date and method. State the method per claim: **UI**
(driven controls), **RPC** (an engine call; establishes engine behaviour
only), or **unavailable** (no path on this device: missing source,
hardware, or an owner-only action). Known limitations — for example, no
alternate online source for these addons — stay in the report even when
every available path passed.

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
