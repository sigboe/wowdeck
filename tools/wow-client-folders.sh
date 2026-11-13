#!/usr/bin/env bash
# Lists the WoW product codes Blizzard publishes, with the install folder each
# one uses (`shared_container_default_subfolder` in the product's config).
#
# Hash discovery uses BlizzTrack (third party) to find each product's latest
# config hash; the config itself comes from Blizzard's CDN (primary source).
# Use it to verify a client's folder name before adding it to
# backend/src/wow/toc/toc.ts. Documented in docs/wow-client-identity.md.
#
# Usage: tools/wow-client-folders.sh   (needs curl and jq; read-only)
set -uo pipefail

products=(
  wow
  wowt
  wowxptr
  wow_beta
  wow_classic
  wow_classic_ptr
  wow_classic_beta
  wow_classic_era
  wow_classic_era_ptr
  wow_anniversary
  wowf
  wow_classic_titan
  wow_cn_beta
)

failed=0

printf '%-24s %-24s %s\n' "PRODUCT" "FOLDER" "CONFIG HASH"

for product in "${products[@]}"; do
  page=$(curl -fsSL --retry 2 --max-time 20 \
    "https://www.blizztrack.com/view/$product") || {
      printf 'ERROR: Cannot fetch %s\n' "$product" >&2
      ((failed+=1))
      continue
    }

  hash=$(
    printf '%s' "$page" |
      grep -oE "/config/${product}/pc/[a-f0-9]{32}" |
      head -n 1 |
      grep -oE '[a-f0-9]{32}$'
  )

  if [[ ! "$hash" =~ ^[a-f0-9]{32}$ ]]; then
    printf 'ERROR: No config hash for %s\n' "$product" >&2
    ((failed+=1))
    continue
  fi

  url="https://level3.blizzard.com/tpr/configs/data/${hash:0:2}/${hash:2:2}/$hash"

  config=$(curl -fsSL --retry 2 --max-time 20 "$url") || {
    printf 'ERROR: CDN fetch failed for %s\n' "$product" >&2
    ((failed+=1))
    continue
  }

  folder=$(printf '%s' "$config" |
    jq -er '.all.config.shared_container_default_subfolder | select(type == "string" and length > 0)') || {
      printf 'ERROR: Missing folder for %s\n' "$product" >&2
      ((failed+=1))
      continue
    }

  printf '%-24s %-24s %s\n' "$product" "$folder" "$hash"
done

printf '\nVerified: %d/%d\n' \
  "$((${#products[@]} - failed))" "${#products[@]}"

((failed == 0))
