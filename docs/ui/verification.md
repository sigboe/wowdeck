# Testing and verification

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

Test tiers T1–T6, the hardware-claim policy, the verification report template and the human regression checklist.

## Contents

- [8. Testing and verification](#8-testing-and-verification)
- [8.1 Tooling that exists (verified by running)](#81-tooling-that-exists-verified-by-running)
- [8.2 What each tier can and cannot prove](#82-what-each-tier-can-and-cannot-prove)
- [8.3 Hardware-claim policy](#83-hardware-claim-policy)
- [8.4 How to get higher tiers (for humans)](#84-how-to-get-higher-tiers-for-humans)
- [8.5 Verification report template](#85-verification-report-template)
- [8.6 Regression checklist (human, on device)](#86-regression-checklist-human-on-device)

## 8. Testing and verification

## 8.1 Tooling that exists (verified by running)

Run all of T1–T3 with `make lint typecheck test build` (`AGENTS.md`)
before every commit. Checked against the repository on 2026-11-12.

| Tier | Command | What runs |
|---|---|---|
| T1 static | `make lint typecheck` | eslint and prettier on `src/`, `tsc` for the frontend, `tools/*.ts` and the engine |
| T2 automated | `make test` | `bun test --isolate ./src ./tools` (every `*.test.ts` and `*.test.tsx`, found automatically), the engine suite and the packaging tests |
| T3 build | `make build` | rollup to `dist/` and the compiled engine |
| T4 visual | none local | component tests render to jsdom, which proves structure and focus wiring, never layout. Layout needs the device tools below. |
| T5 keyboard/controller | none automated | manual, or synthetic key events through `tools/deck-ui/` |
| T6 hardware | the `deck-test` skill | a real Steam Deck; see "Hardware-claim policy" below |

Notes:

- Component tests (`*.test.tsx`) render real React trees against a
  stubbed `@decky/ui` (`src/testing/`, `src/testSupport/`). They prove which
  rows, buttons and focus targets exist and what a press does. They cannot
  show how Steam's CSS lays them out.
- A new test file runs without being registered anywhere.
- `dist/` is gitignored.

Added since (device tools, `tools/deck-ui/`, 2026-10-16):

- **Render a Steam component on the Deck without building or deploying:**
  `node render.mjs <Component> '<props JSON>' [out.png]` mounts any @decky/ui
  component in memory in our QAM panel (inside a PanelSectionRow, under the
  list's heading), prints its box against the panel's, runs the guideline
  audit, takes a screenshot and removes it again. This is the rendering test:
  real Steam components and CSS, seconds per try, nothing saved.
- **Why not render locally:** @decky/ui does not ship Steam's components; it
  finds them in Steam's own webpack modules at runtime, so off the Deck there is
  nothing to render. A local Chromium can only show a static copy of DOM and
  CSS taken from the Deck ([§6](focus.md#6-focus-controller-navigation-modals-and-forms) "Preview without a Deck"): good for comparing
  styles, blind to props, layout logic and focus.
- **Audit rule OVERFLOW** (S32) in `audit.js`: anything in the QAM panel that
  reaches past its edge.

## 8.2 What each tier can and cannot prove

| Tier | Can prove | Cannot prove |
|---|---|---|
| T1 | Syntax, types, style, lint rules | Anything about runtime behavior or appearance |
| T2 | Pure fit/scroll/state logic | That the logic is wired to the right element or matches Steam's real layout |
| T3 | The bundle builds | That `@decky/ui` exports exist at runtime in Steam |
| T4 (manual / CDP) | Layout and clipping at a given size | Controller behavior |
| T5 | Key/mouse operation in a desktop browser or Steam desktop mode | Real gamepad nav tree behavior |
| T6 | Everything above on the real device | Other firmware/Steam versions |

## 8.3 Hardware-claim policy

**V1 MUST NOT** state or imply a change was verified on a Steam Deck unless
a human reports it. An LLM agent without hardware access reaches **T3 at
most**. Say so explicitly. Acceptable wording: "Static checks, tests and build
pass; no visual, controller or hardware verification was performed."
Device access follows `AGENTS.md` ("The owner's Steam Deck") and the
`deck-test` skill. Record device observations as in [§8.4a](device-notes.md#84a-device-observations-2026-10-13); synthetic keys or
`pad.sh` presses count as synthetic input, **not** as controller verification
by a human ([§1.3](README.md#13-authority-markers) `DEVICE`).

**V2 MUST** label recollected-from-history observations as `LIVE (prior
maintainer, commit <hash>)`, not as your own verification.

## 8.4 How to get higher tiers (for humans)

- Remote debugging (OFFICIAL, Decky developer settings): enable CEF debugging.
  DEVICE ([§8.4a](device-notes.md#84a-device-observations-2026-10-13)): on SteamOS 3.8.28 the `steamwebhelper` command line has
  `--remote-debugging-address=127.0.0.1 --remote-debugging-port=8080` and
  `ss -ltn` shows the only listener on `127.0.0.1:8080`. So: reach it with an
  SSH tunnel (`ssh -L 18080:localhost:8080 deck@<ip>`), or `localhost:8080` on
  the device itself. The Decky docs also mention `DECK_IP:8081` for
  `chrome://inspect` from another machine; nothing listened on 8081 on the
  observed device in its default state, so treat 8081 as UNVERIFIED.
  Targets of interest: `QuickAccess_uid2` (the plugin panel),
  `Steam Big Picture Mode` (where modals render) and `SharedJSContext`.
  `window.DFL` is exposed for inspecting `@decky/ui`.
  Agents: drive that tunnel with the `tools/deck-ui/` scripts
  (`tools/deck-ui/README.md`), not ad-hoc CDP scripts. The Chrome DevTools MCP
  (`docs/remote-browser.md`) covers console and network history and views no
  script reaches.
- `docs/steam-deck.md` gives SSH instructions and the pre-release checklist
  (Game Mode and Desktop Mode, suspend/resume, Wi-Fi loss, Decky reload, SD
  card). Another person's device is read-only.

## 8.5 Verification report template

Copy into the PR/commit notes for any UI change:

```
UI change verification
- T1 lint / format:check / typecheck: pass | fail | not run
- T2 pnpm test (N pass): pass | fail | not run
- T3 pnpm run build: pass | fail | not run
- T4 visual (screenshot/CDP, width 300): done by <who> | not done
- T5 keyboard/controller: done by <who> | not done
- T6 Steam Deck hardware: done by <human> on <model/OS/Decky version> | not done
- Nav contract rows touched: <list from §6.6>
- UNVERIFIED claims remaining: <list>
```

## 8.6 Regression checklist (human, on device)

The checklist lives in `docs/regression-test-plan.md` (gates, smoke subset,
full run, result record); section 7 there lists the likeliest failures first.
Kept in one place on purpose: the short list that used to be here went stale
within a day of the Steam-native rework (it still described L1/R1 glyphs that
dim at the ends). Methods that worked on the device (2026-10-15), for anyone
continuing: synthetic arrow keys over CDP (`Input.dispatchKeyEvent`, arrow keys
only; Enter only after checking that the focused element is a harmless one
such as a tab), a per-press measurement of the focused row, the scroller's
`scrollTop` and the floating panes, and frame recording for animations. Steam's
screensaver swallows synthetic input (it does not count as activity); ask the
owner to disable it for a test run.
