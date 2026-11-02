# Driving the Deck's CEF from an agent

Steam exposes its CEF browser on a remote debugging port (`127.0.0.1:8080` on
the Deck). Two clients drive it over one SSH tunnel: the `tools/deck-ui/`
scripts and the Chrome DevTools MCP (`deck-cef`). They speak the same protocol,
so they see the same information.

Prefer the scripts. Measured 2026-11-02 in one session, same pages, tokenized
with `o200k_base`:

| task | scripts | MCP |
|---|---|---|
| state line (pages, route, plugin, QAM, focus) | 42 | about 250 |
| 12-node accessibility tree | 51 | 752 (`take_snapshot`) |
| guideline audit of our panel | 15 (`--brief`) | about 4,400 |
| fixed cost, every request | 0 | 6,549 |

The audit gap is the 7.4 KB `audit.js`: a script reads it from disk, the MCP has
to receive it inside a tool call. The fixed cost is the 32 tool schemas, which
the client injects into every request while the server is configured.

Use the MCP where writing a script would cost more than the call:
`list_console_messages`, `list_network_requests`, an accessibility snapshot of
a view you have never seen, and plain exploration. Everything else goes through
`tools/deck-ui/`; `node tools/deck-ui/help.mjs` prints the command list for
about 500 tokens.

Deck rules: `AGENTS.md` ("The owner's Steam Deck"); the test procedure is the
`deck-test` skill (`.claude/skills/deck-test/SKILL.md`).

## Setup

1. On the Deck: Decky → Settings → Developer → enable "Allow Remote CEF
   Debugging". Steam then listens on `127.0.0.1:8080` on the Deck only. This is
   Steam's CEF (Chrome 126), not a Chrome browser.
2. Tunnel it. Both forwards matter: 9222 for the MCP, 18080 for the scripts.

   ```bash
   ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
     -L 9222:localhost:8080 -L 18080:localhost:8080 deck@<deck-ip>
   curl -s localhost:18080/json        # lists targets when the tunnel works
   ```

3. Check the scripts with `node tools/deck-ui/state.mjs`. It prints one line.
4. The MCP is optional. Point it at the tunnel with `--browser-url`; without
   that flag it starts its own local Chrome, and so does the default
   `chrome-devtools-mcp` Claude Code plugin.

   ```bash
   claude mcp add --scope local deck-cef -- \
     npx -y chrome-devtools-mcp@1.11.0 --browser-url=http://127.0.0.1:9222 \
     --no-usage-statistics --no-performance-crux
   ```

   For OpenCode, the same command line as a stdio server:
   `opencode mcp add deck-cef -- npx -y chrome-devtools-mcp@1.11.0 --browser-url=http://127.0.0.1:9222 --no-usage-statistics --no-performance-crux`.

## Targets

`curl -s localhost:18080/json | grep -o '"title": "[^"]*"'` lists them:

```
notificationtoasts_uid2
MainMenu_uid2
SharedJSContext              SteamClient, window.DFL, DeckyPluginLoader
QuickAccess_uid2             the QAM and our panel
Steam Big Picture Mode       routes and modals
```

`SharedJSContext` runs Steam's and Decky's own JavaScript. `window.DFL` is
`@decky/ui` there, so `DFL.Navigation.OpenQuickAccessMenu(999)`,
`DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck')` and
`DFL.Navigation.Navigate('/wowdeck/get-addons')` work through either client.

## Verified (2026-10-18, SteamOS, Decky 3.2.10, CEF Chrome/126.0.6478.183)

- Every Steam window is its own target, including an empty `data:` page that
  some clients select by default.
- `evaluate_script` and `Runtime.evaluate` work on `QuickAccess_uid2` and
  `SharedJSContext`.
- Accessibility trees work on a hidden QAM. A screenshot of
  `QuickAccess_uid2` with the QAM closed hangs until the client times out, so
  open it first.
- `tools/deck-ui/film.mjs` and `profile.mjs` prove `Page.startScreencast` and
  `Profiler` work over the same endpoint.

## Reaching a control

`node tools/deck-ui/seek.mjs QuickAccess_uid2 "Third-party notices"` focuses the
matching element in one call and prints what it focused: `found "Third-party
notices…" (jump)`. It walks Steam's navigation tree from
`DFL.getFocusNavController().GetActiveNavTree()` and calls `BTakeFocus()` on the
best match, so it crosses columns, scroll regions and focused text fields that
arrow keys cannot: a text field in the path stops `ArrowDown` dead.

`--press` walks there with real key presses instead, checking the label after
every press, for when the navigation itself is what you are testing. `--list`
prints the matching labels, `--enter` presses Enter after, and `--reset` opens
the QAM on our panel first.

Measured 2026-11-02: the earlier "three presses, look, three more, overshoot,
one back" sequence was five calls and 258 tokens to reach an earlier row than
the target; `seek.mjs` was one call and 39.

## Rules for Steam targets

- Never reload or navigate a Steam window. Do not call `navigate_page`, do not
  call `new_page`, do not run `performance_start_trace` with `reload: true`, and
  do not run `lighthouse_audit` in navigation mode. Any of these reloads or
  replaces part of the Steam UI. Move around with the `window.DFL.Navigation`
  calls above.
- The MCP selects an empty page by default, so pass `pageId` on every call after
  one `list_pages`. Page IDs are per MCP session.
- Input is device input. `press_key`, `click`, `fill`, `type_text` and `drag` act
  on the owner's Steam UI, and so do `deck.mjs`, `key.mjs`, `walk.mjs` and `pad.sh`. Keep
  data-changing presses inside our plugin.
- Never screenshot a hidden window.

## Token efficiency

Every tool call sends the whole conversation again, so a test costs about
calls × context size. Fewer calls save more than shorter output.

1. Batch a test into one `tools/deck-ui/deck run '…'`: each action step reports
   what it changed, `wait` and `expect` replace sleeps and re-checks, and
   `deck up` does the deploy in one call.
2. Ask for the fields you need and return compact JSON. Do not dump
   `outerHTML`.
3. `deck state`, `deck probe …` and `tree.mjs --max=N` replace `list_pages`
   plus a snapshot.
4. Use `seek.mjs` to move to a control by its label in one call instead of
   pressing and looking. Use `walk.mjs --diff` and `step.mjs --diff` for
   repeated presses when the navigation itself is under test: they print only
   what changed, and the measurement expression is a file, not repeated tool
   arguments.
5. Take a screenshot only when the question is visual. `deck shot` caps it at
   800 px and `--clip=<css>` crops it to one element.
6. Run `deck state` once per session. Repeat it after a Steam UI reload or a
   Decky reload.
7. After an action, check the outcome once with a targeted query. Do not repeat
   the whole workflow.
8. Summarize findings. Do not paste raw tool output into the conversation.

## If it does not connect

1. `curl -s localhost:18080/json` fails: the tunnel is down. Check
   `pgrep -af 'ssh.*8080'` and open it again.
2. The tunnel is up but the connection is refused: CEF debugging is off, or
   Steam restarted with it off. Ask the owner to enable it again.
3. The MCP fails while the scripts work: its `--browser-url` is missing, or its
   `pageId` is stale. Re-run `list_pages`.

## Safety

- The debugging port stays bound to `127.0.0.1` on the Deck. Reach it only
  through the SSH tunnel and never expose it on the network.
- CDP has full control over the Steam client. Do not read or print cookies,
  tokens, or Steam account or session data.
