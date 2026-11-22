/**
 * TradeSkillMaster's folder rules (project-owned): which folders it owns,
 * which are developer addons, how its scan match takes over another
 * source's record, and what removing its addons may take. The addon service
 * asks at its own checks and does every record and filesystem change
 * itself; these functions only decide.
 * Whether the source is usable (on and signed in) is the provider
 * registry's answer, passed in.
 */
import { PROVIDER_ID } from "../../api/providers";
import type { OperationResult } from "../../api/contracts";
import type { AddonService } from "../addons/AddonService";
import { ValidationError } from "../errors";
import type { AddonFolder, WowInstallation } from "../models";
import type { ScanMatch } from "../providers/addon-provider";

/** The folders TradeSkillMaster owns. */
export const tradeSkillMasterFolders: readonly string[] = ["TradeSkillMaster", "TradeSkillMaster_AppHelper"];

/** A TOC version a release never carries: the packager's placeholder or a dev label. */
const DEVELOPMENT_VERSION = /@project-version@|^dev(?:elopment)?$/i;

/**
 * Whether `providerId` is kept off this folder: TradeSkillMaster owns it
 * while its source is usable, against every other source.
 */
export function isReservedFolder(folderName: string, providerId: string | undefined, sourceUsable: boolean): boolean {
  return sourceUsable && providerId !== PROVIDER_ID.TradeSkillMaster && tradeSkillMasterFolders.includes(folderName);
}

/**
 * A TradeSkillMaster folder whose TOC carries a development version. The
 * scan skips it, whether the source is on or not.
 */
export function isTradeSkillMasterDevelopmentVersion(folder: AddonFolder): boolean {
  return tradeSkillMasterFolders.includes(folder.name) &&
    folder.tocs.some((toc) => DEVELOPMENT_VERSION.test(toc.version ?? ""));
}

/**
 * A developer addon (GLOSSARY): a TradeSkillMaster folder that is a git
 * checkout or carries a development version. Installs over it are refused,
 * whether the source is on or not. The scan asks only
 * isTradeSkillMasterDevelopmentVersion: it skips git checkouts already, by
 * their ignore reason.
 */
export function isDeveloperAddon(folder: AddonFolder): boolean {
  return tradeSkillMasterFolders.includes(folder.name) &&
    (folder.ignoreReason === "git_repo" || isTradeSkillMasterDevelopmentVersion(folder));
}

/**
 * Whether removing TradeSkillMaster's addons stops at this folder: a
 * TradeSkillMaster development version, or a git checkout of any folder.
 * Unlike isDeveloperAddon, the git check covers every folder the removal
 * would take, not only TradeSkillMaster's own.
 */
export function blocksTradeSkillMasterRemoval(folder: AddonFolder): boolean {
  return folder.ignoreReason === "git_repo" || isTradeSkillMasterDevelopmentVersion(folder);
}

/**
 * Remove TradeSkillMaster's addons (tradeskillmaster.removeAddons): each
 * listed addon whose main folder is one of tradeSkillMasterFolders, in one
 * turn of the addon gate (AddonService.removeEach), so the checks below and
 * the removals see the same folders. Grouped consent names exactly these
 * folders: an addon that also owns another folder, or that would take a
 * developer copy, is refused as a failed result and left in place.
 */
export function removeTradeSkillMasterAddons(
  addons: Pick<AddonService, "removeEach">,
  installation: WowInstallation,
): Promise<OperationResult[]> {
  return addons.removeEach(
    installation,
    (folderName) => tradeSkillMasterFolders.includes(folderName),
    (owned, onDisk) => {
      if (onDisk.some(blocksTradeSkillMasterRemoval)) {
        throw new ValidationError("Cannot remove a developer addon");
      }
      if (owned.some((name) => !tradeSkillMasterFolders.includes(name))) {
        throw new ValidationError("This addon also owns folders not named in the confirmation. Remove it from My Addons.");
      }
    },
  );
}

/**
 * Whether an incoming scan match takes a record over from another source:
 * a TradeSkillMaster match replacing a record that isn't TradeSkillMaster's.
 * The record keeps its ID and the user's choices; its source, release and
 * archive identity become the match's.
 */
export function takesOverRecord(incoming: ScanMatch, recordProvider: string | undefined): boolean {
  return incoming.addon.providerName === PROVIDER_ID.TradeSkillMaster && recordProvider !== PROVIDER_ID.TradeSkillMaster;
}

/**
 * Whether a record keeps `folderName` when `incoming` lands on it. A
 * TradeSkillMaster match drops only the folders matched to a different
 * TradeSkillMaster ID; any other match keeps them all.
 */
export function retainsFolder(incoming: ScanMatch, folderName: string, matches: ReadonlyMap<string, ScanMatch>): boolean {
  const owner = matches.get(folderName);
  return incoming.addon.providerName !== PROVIDER_ID.TradeSkillMaster || !owner ||
    owner.addon.externalId === incoming.addon.externalId;
}
