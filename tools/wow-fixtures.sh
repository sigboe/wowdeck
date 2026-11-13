#!/usr/bin/env bash
# Builds fake WoW installations (one per client folder) so every client type
# can be tested without installing the real game. Nothing here is a real game:
# the executables are empty files, so a fixture is detected as "confirmed".
#
# Layout: <root>/World of Warcraft/<flavor>/ with a stub executable,
# .flavor.info, Interface/AddOns/FixtureAddon and WTF/, plus the shared
# .build.info. Keep the folder list in step with WOW_FLAVOR_FOLDERS in
# backend/src/wow/toc/toc.ts (backend/tests/wow-fixtures-script.test.ts
# checks it). Documented in docs/development.md "Fixture installations".
#
# Usage:
#   tools/wow-fixtures.sh [--root DIR] [--only a,b,...] [--clean]
#   --root DIR   fixture root (default: $WOWDECK_FIXTURES or ~/wowdeck-fixtures)
#   --only LIST  comma-separated flavor folders or product codes
#                (e.g. _classic_titan_,wow_cn_beta); default: all
#   --clean      remove the fixture root first (only a root made by this script)
#
# Register the result with the engine, never mixed with real installs:
#   installations.add {"path": "<root>"}   (custom path; real installs untouched)
# On a device, run it there: ssh host 'bash -s -- --root DIR' < tools/wow-fixtures.sh
set -euo pipefail

# folder:product:executable
CLIENTS=(
  "_retail_:wow:Wow.exe"
  "_ptr_:wowt:WowT.exe"
  "_xptr_:wowxptr:WowT.exe"
  "_beta_:wow_beta:WowB.exe"
  "_classic_:wow_classic:WowClassic.exe"
  "_classic_ptr_:wow_classic_ptr:WowClassicT.exe"
  "_classic_beta_:wow_classic_beta:WowClassicB.exe"
  "_classic_era_:wow_classic_era:WowClassic.exe"
  "_classic_era_ptr_:wow_classic_era_ptr:WowClassicT.exe"
  "_anniversary_:wow_anniversary:WowClassic.exe"
  "_forever_:wowf:WowClassic.exe"
  "_classic_titan_:wow_classic_titan:WowClassic.exe"
  "_cn_beta_:wow_cn_beta:WowB.exe"
)
MARKER=".wowdeck-fixtures"

root="${WOWDECK_FIXTURES:-$HOME/wowdeck-fixtures}"
only=""
clean=0
while (($#)); do
  case "$1" in
    --root) root="${2:?--root needs a directory}"; shift 2 ;;
    --only) only="${2:?--only needs a list}"; shift 2 ;;
    --clean) clean=1; shift ;;
    -h|--help) sed -n '2,/^set -/p' "$0" | sed '$d;s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ((clean)) && [[ -e "$root" ]]; then
  [[ -f "$root/$MARKER" ]] || { echo "refusing to remove $root: not made by this script" >&2; exit 1; }
  rm -rf -- "$root"
fi

wow="$root/World of Warcraft"
# Never write into a tree this script did not make (a real install would get
# its executables truncated and its .build.info replaced).
if [[ -e "$wow" && ! -f "$root/$MARKER" ]]; then
  echo "refusing to use $root: it has a World of Warcraft folder not made by this script" >&2
  exit 1
fi
mkdir -p "$wow"
touch "$root/$MARKER"

wanted() { # folder product
  [[ -z "$only" ]] && return 0
  case ",$only," in *",$1,"*|*",$2,"*) return 0 ;; esac
  return 1
}

selected=()
rows=""
for entry in "${CLIENTS[@]}"; do
  IFS=: read -r folder product exe <<<"$entry"
  wanted "$folder" "$product" || continue
  selected+=("$folder")
  dir="$wow/$folder"
  mkdir -p "$dir/Interface/AddOns/FixtureAddon" "$dir/WTF" "$dir/Data"
  : > "$dir/$exe"
  printf 'Product Flavor!STRING:0\n%s\n' "$product" > "$dir/.flavor.info"
  printf '## Interface: 110002\n## Title: Fixture Addon\n## Version: 1.0.0\nFixtureAddon.lua\n' \
    > "$dir/Interface/AddOns/FixtureAddon/FixtureAddon.toc"
  : > "$dir/Interface/AddOns/FixtureAddon/FixtureAddon.lua"
done

if ((${#selected[@]} == 0)); then
  echo "no client matches --only $only" >&2
  exit 1
fi

# .build.info is shared by every flavor; rewrite it for every flavor present
# (a fixture's game version is "1.0.0.99999", so it is easy to spot).
rows=""
for entry in "${CLIENTS[@]}"; do
  IFS=: read -r folder product _ <<<"$entry"
  [[ -d "$wow/$folder" ]] && rows+="US|1|1|$product|0|1.0.0.99999|$product"$'\n'
done
{
  printf 'Region!STRING:0|Active!DEC:1|Armadillo!DEC:1|Product!STRING:0|Build!DEC:4|Version!STRING:0|Branch!STRING:0\n'
  printf '%s' "$rows"
} > "$wow/.build.info"

printf 'fixtures: %d client(s) under %s\n' "${#selected[@]}" "$wow"
printf '  %s\n' "${selected[@]}"
