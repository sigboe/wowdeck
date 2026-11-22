/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-electron/src/common/constants.ts (folder names)
 *       + wowup/wowup-electron/app/services/warcraft/warcraft-platform.service.ts
 *         (getClientTypeForFolderName)
 *       + wowup/wowup-lib/src/utils/wow-client.utils.ts (WowGameType, getWowGameType)
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — upstream's folder constants, folder switch and game type
 *   switch folded into one record per client, with the plugin's names,
 *   wire game type and Battle.net launch code beside them.
 * See docs/wowup-provenance.md.
 */

import { CLASSIC_LAUNCH_TARGET, type GameType } from "../api/contracts";
import { WowClientType } from "./types";

/** The WowUp Hub's game type, which groups clients that share addon lists. */
export enum WowGameType {
  Retail = "retail",
  Classic = "classic",
  BurningCrusade = "burningCrusade",
  WOTLK = "wotlk",
  Cata = "cata",
  Mists = "mists",
  Forever = "forever",
}

/**
 * How WoWDeck asks Battle.net for a client: `--exec="launch <code>"`.
 * `WoW` starts Retail, `WoWF` Forever, and `WoWC` the Classic version
 * Battle.net has active, so Mists of Pandaria Classic, Classic Era and
 * Anniversary share the one Classic row. Sources: docs/steam-launch-targets.md.
 */
export interface BattleNetLaunch {
  code: string;
  /** Set on clients that share one Play menu row: that row's target id. */
  row?: typeof CLASSIC_LAUNCH_TARGET;
}

const CLASSIC_ROW: BattleNetLaunch = { code: "WoWC", row: CLASSIC_LAUNCH_TARGET };

export interface WowClient {
  clientType: WowClientType;
  /** The flavor folder under the WoW root, e.g. `_forever_`. */
  folder: string;
  /**
   * The wire game type: the addon family. Several clients share one, and
   * WTF backup flavor keys derive from it, so values must never change.
   * The first client in the table with a game type is the one that game
   * type maps back to.
   */
  gameType: GameType;
  wowGameType: WowGameType;
  /** Short, CurseForge-style player-facing name. */
  shortName: string;
  /** WowUp's full name, shown in Installation details. */
  fullName: string;
  /**
   * Names the plugin once generated for this client and no longer does.
   * On a rename, move the old short or full name here; a detected
   * installation still carrying it is refreshed to the new short name.
   */
  formerNames: readonly string[];
  /** Absent: the Play menu has no row for it; Battle.net's own Play starts it. */
  launch?: BattleNetLaunch;
}

/**
 * One record per WoW client: the single source of truth for folders,
 * names, game types and Play menu rows. Add a client here and nowhere else.
 * The order is the order clients are listed in.
 *
 * `ClassicBeta` -> "Forever Beta" matches WowUp's rename in v2.24.1
 * (upstream 41352f97), once WoW Forever took the name "Forever".
 */
export const WOW_CLIENTS: readonly WowClient[] = [
  {
    clientType: WowClientType.Retail,
    folder: "_retail_",
    gameType: "retail",
    wowGameType: WowGameType.Retail,
    shortName: "Retail",
    fullName: "World of Warcraft",
    formerNames: [],
    launch: { code: "WoW" },
  },
  {
    clientType: WowClientType.Classic,
    folder: "_classic_",
    gameType: "classic",
    wowGameType: WowGameType.Mists,
    shortName: "Classic",
    fullName: "Mists of Pandaria Classic",
    formerNames: [],
    launch: CLASSIC_ROW,
  },
  {
    clientType: WowClientType.ClassicEra,
    folder: "_classic_era_",
    gameType: "classic_era",
    wowGameType: WowGameType.Classic,
    shortName: "Classic Era",
    fullName: "World of Warcraft Classic",
    formerNames: [],
    launch: CLASSIC_ROW,
  },
  {
    clientType: WowClientType.RetailPtr,
    folder: "_ptr_",
    gameType: "ptr",
    wowGameType: WowGameType.Retail,
    shortName: "Retail PTR",
    fullName: "PTR (Midnight)",
    formerNames: [],
  },
  {
    clientType: WowClientType.ClassicPtr,
    folder: "_classic_ptr_",
    gameType: "classic",
    wowGameType: WowGameType.Mists,
    shortName: "Classic PTR",
    fullName: "PTR (MoP Classic)",
    formerNames: [],
  },
  {
    clientType: WowClientType.ClassicEraPtr,
    folder: "_classic_era_ptr_",
    gameType: "classic_era",
    wowGameType: WowGameType.Classic,
    shortName: "Classic Era PTR",
    fullName: "PTR (Classic Era)",
    formerNames: [],
  },
  {
    clientType: WowClientType.Beta,
    folder: "_beta_",
    gameType: "beta",
    wowGameType: WowGameType.Retail,
    shortName: "Retail Beta",
    fullName: "The War Within Beta",
    formerNames: [],
  },
  {
    clientType: WowClientType.ClassicBeta,
    folder: "_classic_beta_",
    gameType: "classic_beta",
    wowGameType: WowGameType.Forever,
    shortName: "Forever Beta",
    fullName: "World of Warcraft: Forever Beta",
    formerNames: ["Forever", "World of Warcraft: Forever"],
  },
  {
    clientType: WowClientType.RetailXPtr,
    folder: "_xptr_",
    gameType: "ptr",
    wowGameType: WowGameType.Retail,
    shortName: "Retail XPTR",
    fullName: "PTR (TWW 11.2.7)",
    formerNames: [],
  },
  {
    clientType: WowClientType.Anniversary,
    folder: "_anniversary_",
    gameType: "classic_era",
    wowGameType: WowGameType.BurningCrusade,
    shortName: "Anniversary",
    fullName: "Burning Crusade Anniversary",
    formerNames: [],
    launch: CLASSIC_ROW,
  },
  {
    clientType: WowClientType.Forever,
    folder: "_forever_",
    gameType: "forever",
    wowGameType: WowGameType.Forever,
    shortName: "Forever",
    fullName: "World of Warcraft: Forever",
    formerNames: [],
    launch: { code: "WoWF" },
  },
  {
    clientType: WowClientType.ClassicTitan,
    folder: "_classic_titan_",
    gameType: "classic_titan",
    wowGameType: WowGameType.WOTLK,
    shortName: "Titan Reforged",
    fullName: "World of Warcraft Titan Reforged Classic",
    formerNames: [],
  },
  {
    clientType: WowClientType.ClassicCnBeta,
    folder: "_cn_beta_",
    gameType: "cn_beta",
    wowGameType: WowGameType.Forever,
    shortName: "China Beta",
    // WowUp has no full name for it.
    fullName: "China Beta",
    formerNames: [],
  },
];

const byType = new Map(WOW_CLIENTS.map((c) => [c.clientType, c]));
const byFolder = new Map(WOW_CLIENTS.map((c) => [c.folder, c]));

/** A client's record; undefined for `WowClientType.None`. */
export function wowClient(clientType: WowClientType): WowClient | undefined {
  return byType.get(clientType);
}

/** The client installed in a flavor folder (exact, lower-case name). */
export function wowClientForFolder(folder: string): WowClient | undefined {
  return byFolder.get(folder);
}

/** The main client of a wire game type: the first in the table that carries it. */
export function wowClientForGameType(gameType: string): WowClient | undefined {
  return WOW_CLIENTS.find((c) => c.gameType === gameType);
}
