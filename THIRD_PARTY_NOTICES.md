# Third-party notices

## WowUp (https://github.com/WowUp/WowUp)

- License: GPL-3.0 (repository root). The `wowup-lib` package declares ISC
  in its package.json; treat extracted `wowup-lib` code as GPL-3.0 unless a
  per-file header says otherwise — the audited provenance lives in
  `docs/wowup-provenance.md`.
- Used as: read-only reference checkout at `wowup/`, untracked and recreated
  on demand with `make wowup`; pinned at commit
  `4fdae600d94ad7dd187a6bc93b517e657100b01a`. Selected components
  extracted and adapted into `backend/src/wow/`.

## decky-plugin-template (https://github.com/SteamDeckHomebrew/decky-plugin-template)

- License: BSD-3-Clause; the full text is appended to `LICENSE`.
- Used as: project bootstrap (commit `90d0780e882a17f5714fc6de044c645f22608290`).
- Derived files: `plugin.json` structure, `rollup.config.js`, `tsconfig.json`
  base, `src/types.d.ts`, `decky.pyi`, the Deck Debug settings kept in
  `deck-debug/`, backend build conventions (`backend/out`).

## Decky ecosystem runtime

- `@decky/ui`, `@decky/api`, `@decky/rollup` — decky-frontend-lib / decky
  tooling (BSD-3-Clause / GPL-3.0 as published by SteamDeckHomebrew).
- decky-loader runs `main.py` on device (Python).

## Bun (https://bun.sh)

- The engine binary is compiled with Bun (`bun build --compile`).
- Bun is MIT licensed; the compiled binary embeds the Bun runtime.

## fflate (https://github.com/101arrowz/fflate)

- License: MIT. Used for zip extraction in the engine (`fflate` npm 0.8.x);
  archive entries are additionally validated against path traversal
  (see `backend/src/wow/archives/ArchiveExtractor.ts`).

## xclip (https://github.com/astrand/xclip)

- License: GPL-2.0 — full text at `backend/vendor/xclip-LICENSE.txt`.
- Used as: a prebuilt, unmodified binary (`backend/vendor/xclip`,
  bundled into the packaged plugin's `bin/`) for Copy Diagnostics —
  SteamOS does not ship `xclip` system-wide, and
  Decky plugins have no other supported way to write plain text to the
  system clipboard from this webview runtime. Invoked by `main.py` as a
  subprocess, writing only the current diagnostics text; no prior
  clipboard contents are read or restored. The exact binary already
  proven to work in this environment — copied from the installed
  Decktation plugin (itself bundling the same unmodified upstream
  binary for an unrelated feature), not independently built or
  modified.

## pstack `unslop` skill (https://github.com/cursor/plugins/tree/main/pstack)

- License: MIT, Copyright (c) 2026 Lauren Tan; full text at
  `.claude/skills/unslop/LICENSE`.
- Used as: the agent skill at `.claude/skills/unslop/SKILL.md`, copied from
  `pstack/skills/unslop/SKILL.md` at commit
  `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`. Changed only in its
  frontmatter: a description naming this repo's docs replaces the original
  one, and `disable-model-invocation` is removed so agents load it
  themselves. It is development tooling and does not ship in the plugin.

## README glyphs (`docs/glyphs/`)

The README shows the Deck's buttons and the plugin's icons as small SVGs.
They are the paths the UI draws, recoloured grey so they read on light
and dark GitHub themes. None of them ship in the plugin.

- `button-x.svg`, `button-y.svg`, `button-qam.svg`: Steam's own button
  glyphs (the `ABXYButton` X/Y cases and the `Dots` icon), © Valve
  Corporation. Copied from `steamui/sp.js` of the Steam Deck stable
  client, version `1792618285`, to show which button to press.
- `decky-settings.svg`: the gear on Decky Loader's settings button
  (Decky v3.3.1), which is `BsGearFill` from
  [Bootstrap Icons](https://github.com/twbs/icons), MIT.
- `wowdeck-box.svg`, `ellipsis.svg`, `options.svg`: `FaBoxOpen`,
  `FaEllipsisH` and `FaCog` from Font Awesome Free 5 as packaged by
  `react-icons` 5.7.0, the same icons the plugin draws. Fonticons, Inc.
  licenses the Font Awesome Free icons under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
