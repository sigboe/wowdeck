# Debugging the Steam Deck UI with Chrome DevTools MCP

## Contents

- [Setup](#setup)
- [Verified (2026-10-18, SteamOS, Decky 3.2.10, CEF Chrome/126.0.6478.183)](#verified-2026-10-18-steamos-decky-3210-cef-chrome12606478183)
- [Rules for Steam targets](#rules-for-steam-targets)
- [Token efficiency](#token-efficiency)
- [When to use something else](#when-to-use-something-else)
- [If the MCP cannot connect](#if-the-mcp-cannot-connect)
- [Safety](#safety)

The preferred way for an agent to inspect our panel on a real Steam Deck. The
Chrome DevTools MCP connects to Steam's own CEF browser through an SSH tunnel.
Each MCP tool call returns a short structured result, so you do not need to
write throwaway CDP scripts or run `ssh … node …` batches. Use the
`tools/deck-ui/` scripts only for what the MCP cannot do (see
[When to use something else](#when-to-use-something-else)).

Deck rules: `AGENTS.md` ("The owner's Steam Deck"); the test procedure is the
`deck-test` skill (`.claude/skills/deck-test/SKILL.md`).

## Setup

1. On the Deck: Decky → Settings → Developer → enable "Allow Remote CEF
   Debugging". Steam then listens on `127.0.0.1:8080` on the Deck only. This is
   Steam's CEF (Chrome 126), not a Chrome browser.
2. Tunnel it to local port 9222. The second `-L` keeps the `tools/deck-ui`
   scripts (port 18080) working through the same connection:

   ```bash
   ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
     -L 9222:localhost:8080 -L 18080:localhost:8080 deck@<deck-ip>
   curl -s localhost:9222/json/version   # must show "webSocketDebuggerUrl"
   ```

3. Point an MCP server at the tunnel with `--browser-url`. Without it,
   chrome-devtools-mcp starts its own local Chrome. That includes the default
   `chrome-devtools-mcp` Claude Code plugin. Claude Code, for this project
   only:

   ```bash
   claude mcp add --scope local deck-cef -- \
     npx -y chrome-devtools-mcp@1.11.0 --browser-url=http://127.0.0.1:9222 \
     --no-usage-statistics --no-performance-crux
   ```

   OpenCode or another client: run the same command line as a stdio MCP
   server. Restart the client so it loads the server.

## Verified (2026-10-18, SteamOS, Decky 3.2.10, CEF Chrome/126.0.6478.183)

- `list_pages` lists every Steam window:

  ```
  1: data:text/html,<body></body>   [selected]  ← an empty page, not ours
  2: notificationtoasts_uid2
  3: MainMenu_uid2
  4: QuickAccess_uid2               ← the QAM and our panel
  5: SharedJSContext                ← SteamClient, window.DFL, DeckyPluginLoader
  6: Steam Big Picture Mode         ← routes and modals
  ```

- `evaluate_script` works on `QuickAccess_uid2` and `SharedJSContext`
  (`window.DFL` is defined there).
- `take_snapshot` works, including on a hidden QAM.
- `take_screenshot` of a visible window returns in about 0.3 s.

## Rules for Steam targets

- **Always pass `pageId`.** The selected page by default is the empty `data:`
  page. Page IDs are per MCP session, so find them by title with
  `list_pages`.
- **Never reload or navigate a Steam window.** Do not call `navigate_page`, do
  not call `new_page`, do not run `performance_start_trace` with
  `reload: true`, and do not run `lighthouse_audit` in navigation mode. Any of
  these reloads or replaces part of the Steam UI. To move around, use the
  `window.DFL.Navigation` one-liners from `tools/deck-ui/README.md` through
  `evaluate_script` on `SharedJSContext`.
- **Do not screenshot a hidden window.** `take_screenshot` on
  `QuickAccess_uid2` with the QAM closed hung until the client timed out. Open
  the QAM first
  (`window.DFL.Navigation.OpenQuickAccessMenu(999)` on `SharedJSContext`).
- **Input is device input.** `press_key`, `click`, `fill`, `type_text` and
  `drag` act on the owner's Steam UI. `press_key` has not been verified on
  CEF yet. Data-changing presses stay inside our plugin; check what has
  `.gpfocus` before any Enter.

## Token efficiency

1. Ask `evaluate_script` for exactly the fields you need, and return compact
   JSON (counts, boxes, class names, focused element). Do not dump
   `outerHTML`.
2. Prefer `evaluate_script` over `take_snapshot`. A snapshot of the open
   panel lists every node in the a11y tree.
3. Take a screenshot only when the question is visual (layout, clipping,
   motion end state). Pass `format: "jpeg"` with a `quality`, and pass
   `filePath` so the image is saved to disk instead of being sent inline.
4. Filter `list_console_messages` and `list_network_requests` by `types` or
   `resourceTypes`, and page through them, instead of reading all history.
5. Run `list_pages` once per session. Repeat it only after a Steam UI reload
   or a Decky reload.
6. After an action, check the outcome once with a targeted query. Do not
   repeat the whole workflow.
7. Summarize findings. Do not paste raw tool output into the conversation.

## When to use something else

- **`tools/deck-ui/` scripts** (through the `18080` forward): `film.mjs`
  (frame-by-frame motion), `profile.mjs` (CPU profile of a trigger),
  `step.mjs`/`walk.mjs` (measure after each key press), `render.mjs` (render
  one @decky/ui component in memory) and `audit-view.mjs`/`audit-focus.js`
  (guideline audits). These are bundles of many CDP calls that the MCP has
  no single tool for. You can also pass `audit.js` or a measure file's
  contents to `evaluate_script`.
- **SSH**: tunnel management, process checks, logs
  (`journalctl -u plugin_loader`, `~/homebrew/logs/<plugin>/`), reading
  Steam's `sp.js`/`sp.css`, and deploys. Do not use SSH to run browser
  JavaScript when the MCP is connected.

## If the MCP cannot connect

1. Run `curl -s localhost:9222/json/version`. If it fails, the tunnel is
   down: check `pgrep -af 'ssh.*9222'` and open the tunnel again.
2. If the tunnel is up but the Deck refuses connections, CEF debugging is
   off, or Steam restarted with it off. Ask the owner to enable it again.
3. Retry the MCP call once. If it still fails, fall back to the deck-ui
   scripts. Do not write new ad-hoc CDP scripts.

## Safety

- The debugging port stays bound to `127.0.0.1` on the Deck. Reach it only
  through the SSH tunnel and never expose it on the network.
- CDP has full control over the Steam client. Do not read or print cookies,
  tokens, or Steam account or session data.
