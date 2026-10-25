#!/usr/bin/env bash
# Press gamepad buttons on the Deck from this machine: a virtual Xbox 360 pad
# (pad.py, run on the Deck over SSH with its own Python; nothing is installed).
#
#   DECK=deck@<ip> tools/deck-ui/pad.sh [--delay MS] [--settle MS] BUTTON...
#   e.g. pad.sh down down a        pad.sh rb        pad.sh menu wait:500 b
#
# Same rules as key.mjs: navigation by default; a button that changes data
# (X on an addon, A on Install/Remove/Restore) needs the owner's go-ahead.
set -euo pipefail
: "${DECK:?set DECK=deck@<deck-ip>}"
exec ssh -o BatchMode=yes "$DECK" python3 - "$@" <"$(dirname "$0")/pad.py"
