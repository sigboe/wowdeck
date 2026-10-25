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
