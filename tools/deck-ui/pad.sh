#!/usr/bin/env bash
# Press gamepad buttons on the Deck from this machine: a virtual Xbox 360 pad
# (pad.py, run on the Deck over SSH with its own Python; nothing is installed).
#
#   tools/deck-ui/pad.sh [--delay MS] [--settle MS] BUTTON...
#   e.g. pad.sh down down a        pad.sh rb        pad.sh menu wait:500 b
#
# DECK=deck@<ip> comes from the environment or tools/deck-ui/local.env.
# Same rules as key.mjs: navigation by default; a button that changes data
# (X on an addon, A on Install/Remove/Restore) needs the owner's go-ahead.
set -euo pipefail
here=$(dirname "$0")
if [[ -z "${DECK:-}" && -f "$here/local.env" ]]; then
  DECK=$(sed -n 's/^DECK=//p' "$here/local.env")
fi
: "${DECK:?set DECK=deck@<deck-ip> or add it to tools/deck-ui/local.env}"
exec ssh -o BatchMode=yes "$DECK" python3 - "$@" <"$here/pad.py"
