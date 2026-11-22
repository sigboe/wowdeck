import type { GameVersionClient } from "../../api/contracts";
import { wowClient } from "../clients";
import { WowClientType } from "../types";

/**
 * The Details header's version tags. Client names live in the client
 * table (wow/clients.ts); this file holds only the tags, which are keyed
 * by game version, not by client.
 */

const shortName = (clientType: WowClientType) => wowClient(clientType)!.shortName;

/**
 * A version tag's two colors: the background it is painted with
 * (`primary`) and the text drawn on it (`secondary`). Every pair is
 * validated at 7:1 or better by src/gameVersionTags.test.ts, per WCAG 2.2
 * AAA for normal text; the table, its origin and the method for adding an
 * expansion are in docs/game-version-tags.md.
 */
export type GameVersionTagColors = { primary: string; secondary: string };
export type GameVersionTag = GameVersionTagColors & { label: string };

/**
 * The expansion each game version belongs to, for the Details header's
 * version tags: the short label to show and the expansion's two tag
 * colors. Keyed by version prefix, so "11" covers every 11.x release.
 * Retail spans several expansions, so its versions take the expansion's
 * name instead of the client's ("War Within", "Midnight"); the classic
 * flavors reuse the client table's short names. Edit by hand when Blizzard
 * opens a new expansion, and follow docs/game-version-tags.md: verify the
 * name, pick a color from the expansion's art, then let the contrast test
 * prove the pair. A version with no entry keeps its raw string and the
 * neutral tag style (see src/gameVersionTags.ts).
 */
export const GAME_VERSION_TAGS: Record<string, GameVersionTag> = {
  "1.14": { label: shortName(WowClientType.ClassicEra), primary: "#D4AF65", secondary: "#1C1408" },
  "1.15": { label: shortName(WowClientType.ClassicEra), primary: "#D4AF65", secondary: "#1C1408" },
  "1.60": { label: shortName(WowClientType.Forever), primary: "#07566F", secondary: "#F0FCFF" },
  "2.5": { label: shortName(WowClientType.Anniversary), primary: "#63C56B", secondary: "#09210F" },
  "3.4": { label: "Wrath", primary: "#68B7DA", secondary: "#0B2232" },
  "4.4": { label: "Cataclysm", primary: "#8B321E", secondary: "#FFF5EC" },
  "5.5": { label: "MoP", primary: "#78BDA5", secondary: "#0B2823" },
  "6": { label: "Warlords", primary: "#704432", secondary: "#FFF5E9" },
  "7": { label: "Legion", primary: "#91C83E", secondary: "#18230B" },
  "8": { label: "BfA", primary: "#205678", secondary: "#F2FAFF" },
  "9": { label: "Shadowlands", primary: "#564580", secondary: "#FCF8FF" },
  "10": { label: "Dragonflight", primary: "#773D1E", secondary: "#FFF6E8" },
  "11": { label: "War Within", primary: "#87383E", secondary: "#FFF4F2" },
  "12": { label: "Midnight", primary: "#4C399D", secondary: "#F9F5FF" },
  // Provisional until Blizzard publishes official Last Titan branding.
  "13": { label: "Last Titan", primary: "#D6AB4B", secondary: "#201809" },
};

/**
 * Tags for a version whose client the provider identified, keyed by that
 * client (see GameVersionClient in api/contracts.ts). Retail is absent on
 * purpose: it spans expansions, so its tag comes from the version's
 * major.minor in GAME_VERSION_TAGS above (11.x = War Within, 12.x =
 * Midnight, …). Titan Reforged — also written "Titanforged" — is the
 * China-only Classic+ built on Wrath that CurseForge lists as 3.80.x; it
 * keeps its own antique-gold tag.
 */
export const GAME_VERSION_CLIENT_TAGS: Record<
  Exclude<GameVersionClient, "retail">,
  GameVersionTag
> = {
  classic_era: GAME_VERSION_TAGS["1.15"]!,
  anniversary: GAME_VERSION_TAGS["2.5"]!,
  wrath: GAME_VERSION_TAGS["3.4"]!,
  cataclysm: GAME_VERSION_TAGS["4.4"]!,
  mists: GAME_VERSION_TAGS["5.5"]!,
  titan_reforged: { label: "Titan Reforged", primary: "#594728", secondary: "#FFF4D9" },
  forever: GAME_VERSION_TAGS["1.60"]!,
};
