# Game-version tag colors

The Details header paints each game version as a tag. A tag has two colors:
`primary` fills the background and `secondary` is the text drawn on it.

The source of truth is `GAME_VERSION_TAGS` and `GAME_VERSION_CLIENT_TAGS` in
`backend/src/wow/utils/client-display-names.ts`, next to the other hand-edited
client-name tables. This page records where the colors came from and how to
add one. The colors themselves stay in that file so a player-facing change is
a one-file edit.

## The palette

| Tag            | Expansion              | Primary   | Secondary | Contrast |
| -------------- | ---------------------- | --------- | --------- | -------- |
| Classic Era    | Classic                | `#D4AF65` | `#1C1408` | 8.78:1   |
| Anniversary    | The Burning Crusade    | `#63C56B` | `#09210F` | 7.87:1   |
| Wrath          | Wrath of the Lich King | `#68B7DA` | `#0B2232` | 7.27:1   |
| Cataclysm      | Cataclysm              | `#8B321E` | `#FFF5EC` | 7.59:1   |
| MoP            | Mists of Pandaria      | `#78BDA5` | `#0B2823` | 7.17:1   |
| Warlords       | Warlords of Draenor    | `#704432` | `#FFF5E9` | 7.61:1   |
| Legion         | Legion                 | `#91C83E` | `#18230B` | 8.20:1   |
| BfA            | Battle for Azeroth     | `#205678` | `#F2FAFF` | 7.47:1   |
| Shadowlands    | Shadowlands            | `#564580` | `#FCF8FF` | 7.82:1   |
| Dragonflight   | Dragonflight           | `#773D1E` | `#FFF6E8` | 7.93:1   |
| War Within     | The War Within         | `#87383E` | `#FFF4F2` | 7.31:1   |
| Midnight       | Midnight               | `#4C399D` | `#F9F5FF` | 8.21:1   |
| Last Titan     | The Last Titan         | `#D6AB4B` | `#201809` | 8.18:1   |
| Forever        | WoW: Forever           | `#07566F` | `#F0FCFF` | 7.81:1   |
| Titan Reforged | Titan Reforged         | `#594728` | `#FFF4D9` | 8.14:1   |

Titan Reforged is also written Titanforged. It is the China-only Classic+
client built on Wrath of the Lich King, not a Wrath patch.

## Origin

The palette is an unofficial, manually curated set. Each primary color comes
from the expansion's art and branding, and someone picked it by eye. The
colors are approximations, not Blizzard brand colors.

Examples of the theme behind each pick.

- Classic is Warcraft gold.
- The Burning Crusade is fel green.
- Wrath of the Lich King is ice blue.
- Cataclysm is molten orange and dark red.
- Mists of Pandaria is jade green.
- Warlords of Draenor is iron and rust.
- Legion is fel lime.
- Battle for Azeroth is naval blue.
- Shadowlands is spectral violet.
- Dragonflight is bronze.
- The War Within is deep crimson.
- Midnight is void purple.
- The Last Titan is celestial gold.
- WoW: Forever is Azeroth teal.
- Titan Reforged is antique Titan gold.

Some colors differ from the first pick so the pair could reach the contrast
requirement below.

## Accessibility

Every pair meets WCAG 2.2 AAA for normal text, a contrast ratio of at least
7:1. `src/gameVersionTags.test.ts` computes the ratio from the sRGB channels
for all 15 pairs and fails the build if any pair drops below 7, or if two
expansions reuse a primary color.

Do not treat a look at the Deck as proof that a pair passes. Change a color,
then run the test.

## Adding an expansion or version

1. Confirm the official name and release status from Blizzard or Warcraft
   Wiki.
2. Look at the expansion's logo and key art.
3. Pick the most recognizable thematic color as `primary`.
4. Pick a dark or light `secondary` that reads on it.
5. Add the entry to `GAME_VERSION_TAGS` under its version prefix, or to
   `GAME_VERSION_CLIENT_TAGS` if the provider identifies the client.
6. Run `bun test src/gameVersionTags.test.ts`. Adjust brightness before hue
   until the pair passes 7:1 and the primary is distinct from the others.

## Provisional color

The Last Titan keeps a provisional gold (`#D6AB4B`) until Blizzard publishes
official branding. Replace it when that arrives, then rerun the test.
