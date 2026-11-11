---
name: steam-ui-layout-check
description: Verify Steam UI layout geometry (alignment, spacing, padding) locally, in headless Chromium with Steam's captured stylesheets, before any device test. Use when changing or reviewing modal, Field, footer or any Steam-styled markup, when the owner reports misalignment or wrong spacing, or when component tests pass but rendered layout is in question. Not a replacement for the deck-test skill.
---

# Check Steam UI layout locally

Component tests stub Steam's components, so they cannot see rendered geometry.
This skill measures it: our markup, Steam's real CSS, headless Chromium,
numeric assertions. It caught a chevron 20 px off center that every component
test passed (PR #210, 2026-11-12).

## What you need

A Steam UI capture directory (read-only, taken once per Steam client build;
procedure in `tools/steamui_rules.py`'s docstring and
docs/UI_DEVELOPMENT_BEST_PRACTICES.md §5.3):

- `css/sp.css` and `css/library.css` — `scp -r deck@<ip>:.local/share/Steam/steamui/css <dir>/css`
- `classmap.js` — the semantic→hashed class map, read as text over the Deck's
  CDP port (do NOT run the module). Never fabricate hashed names; if a name is
  missing from the map, the check errors.

If no capture exists, say so and stop: this skill needs a real capture. Taking
one only needs read-only Deck access. Do not invent geometry from memory.

## Run it

```sh
nix develop -c python3 tools/steamui_layout_check.py <capture_dir> <spec_dir>
```

A spec directory has:

- `page.html` — the markup under test. Mark Steam classes with
  `data-class="Field StandardPadding"`; the tool resolves them through the
  classmap. No styling of your own: the point is Steam's CSS doing the work.
- `check.js` — `window.__layoutCheck = () => [{name, value, min, max}]`, pure
  `getBoundingClientRect` / `getComputedStyle` numbers.
- `spec.json` — optional `{"widths": [268, 576]}` (268 px = QAM row width).

Template: `tools/layout-checks/chevron-row/`. Copy it, adapt markup and checks.

Bounds come from the §5.3 token table (row gap ≥ 6 px, button padding
10 × 24 px, footer gap ~28 px, …). Cite the token in each check's name.

Chromium comes from `nix shell nixpkgs#chromium` automatically when not on
PATH; override with `--chromium` or `$CHROMIUM_BIN`.

## Rules

1. Output is numbers. Never take or attach screenshots in this skill; a
   failing check is a name, a value, and a bound.
2. Iterate here while fixing layout; do not deploy to the Deck per tweak.
3. A pass is not device verification. Say so, and name `/deck-test` as the
   follow-up for focus behaviour, fonts and wrapping. Never write "verified on
   Steam Deck" off this skill's output (§8.5).
4. If a check fails because a §5.3 token no longer matches Steam's CSS,
   re-derive the bound from the capture (`tools/steamui_rules.py`) and record
   the change in the guide.
5. Deterministic: no network beyond the nix store, no wall clock in checks.

## Report

One line per check with its value and bound, the widths used, the capture's
Steam client build if known, and the explicit caveat that the Deck remains
unverified.
