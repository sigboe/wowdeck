/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/toc.ts
 *       + wowup/wowup-electron/src/common/constants.ts (folder names)
 *       + wowup/wowup-electron/app/services/warcraft/warcraft-platform.service.ts
 *         (getClientTypeForFolderName)
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — merged TOC tag constants, Toc shape, flavor folder names
 *   and folder-name -> client-type mapping into one module.
 * See docs/wowup-provenance.md.
 */

import { WowClientType } from "../types";

export const TOC_AUTHOR = "Author";
export const TOC_DEPENDENCIES = "Dependencies";
export const TOC_INTERFACE = "Interface";
export const TOC_NOTES = "Notes";
export const TOC_REQUIRED_DEPS = "RequiredDeps";
export const TOC_TITLE = "Title";
export const TOC_VERSION = "Version";
export const TOC_WEBSITE = "Website";
export const TOC_X_ADDON_PROVIDER = "X-AddonProvider"; // Raider.IO
export const TOC_X_CURSE_PROJECT_ID = "X-Curse-Project-ID"; // CurseForge
export const TOC_X_LOADONDEMAND = "LoadOnDemand";
export const TOC_X_PART_OF = "X-Part-Of";
export const TOC_X_TUKUI_PROJECTID = "X-Tukui-ProjectID";
export const TOC_X_TUKUI_PROJECTFOLDERS = "X-Tukui-ProjectFolders";
export const TOC_X_WEBSITE = "X-Website";
export const TOC_X_WOWI_ID = "X-WoWI-ID"; // WowInterface
export const TOC_X_WAGO_ID = "X-Wago-ID";

export interface Toc {
  fileName: string;
  filePath: string;
  interface: string[];
  title?: string;
  author?: string;
  website?: string;
  version?: string;
  partOf?: string;
  dependencies?: string;
  curseProjectId?: string;
  wowInterfaceId?: string;
  wagoAddonId?: string;
  tukUiProjectId?: string;
  tukUiProjectFolders?: string;
  loadOnDemand?: string;
  dependencyList: string[];
  addonProvider?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// WoW installation flavor folders
// ---------------------------------------------------------------------------

export const WOW_BETA_FOLDER = "_beta_";
export const WOW_CLASSIC_FOLDER = "_classic_";
export const WOW_CLASSIC_BETA_FOLDER = "_classic_beta_";
export const WOW_CLASSIC_ERA_FOLDER = "_classic_era_";
export const WOW_CLASSIC_ERA_PTR_FOLDER = "_classic_era_ptr_";
export const WOW_CLASSIC_PTR_FOLDER = "_classic_ptr_";
export const WOW_RETAIL_PTR_FOLDER = "_ptr_";
export const WOW_RETAIL_XPTR_FOLDER = "_xptr_";
export const WOW_RETAIL_FOLDER = "_retail_";
export const WOW_ANNIVERSARY_FOLDER = "_anniversary_";
export const WOW_FOREVER_FOLDER = "_forever_";
export const WOW_ADDON_FOLDER_NAME = "AddOns";
export const WOW_INTERFACE_FOLDER_NAME = "Interface";

export const WOW_FLAVOR_FOLDERS = [
  WOW_RETAIL_FOLDER,
  WOW_CLASSIC_FOLDER,
  WOW_CLASSIC_ERA_FOLDER,
  WOW_RETAIL_PTR_FOLDER,
  WOW_CLASSIC_PTR_FOLDER,
  WOW_CLASSIC_ERA_PTR_FOLDER,
  WOW_BETA_FOLDER,
  WOW_CLASSIC_BETA_FOLDER,
  WOW_RETAIL_XPTR_FOLDER,
  WOW_ANNIVERSARY_FOLDER,
  WOW_FOREVER_FOLDER,
] as const;

export function getClientTypeForFolderName(folderName: string): WowClientType {
  switch (folderName) {
    case WOW_RETAIL_FOLDER:
      return WowClientType.Retail;
    case WOW_RETAIL_PTR_FOLDER:
      return WowClientType.RetailPtr;
    case WOW_RETAIL_XPTR_FOLDER:
      return WowClientType.RetailXPtr;
    case WOW_CLASSIC_ERA_FOLDER:
      return WowClientType.ClassicEra;
    case WOW_CLASSIC_FOLDER:
      return WowClientType.Classic;
    case WOW_CLASSIC_PTR_FOLDER:
      return WowClientType.ClassicPtr;
    case WOW_BETA_FOLDER:
      return WowClientType.Beta;
    case WOW_CLASSIC_BETA_FOLDER:
      return WowClientType.ClassicBeta;
    case WOW_CLASSIC_ERA_PTR_FOLDER:
      return WowClientType.ClassicEraPtr;
    case WOW_ANNIVERSARY_FOLDER:
      return WowClientType.Anniversary;
    case WOW_FOREVER_FOLDER:
      return WowClientType.Forever;
    default:
      return WowClientType.None;
  }
}

export function getFolderNameForClientType(clientType: WowClientType): string | null {
  switch (clientType) {
    case WowClientType.Retail:
      return WOW_RETAIL_FOLDER;
    case WowClientType.RetailPtr:
      return WOW_RETAIL_PTR_FOLDER;
    case WowClientType.RetailXPtr:
      return WOW_RETAIL_XPTR_FOLDER;
    case WowClientType.ClassicEra:
      return WOW_CLASSIC_ERA_FOLDER;
    case WowClientType.Classic:
      return WOW_CLASSIC_FOLDER;
    case WowClientType.ClassicPtr:
      return WOW_CLASSIC_PTR_FOLDER;
    case WowClientType.Beta:
      return WOW_BETA_FOLDER;
    case WowClientType.ClassicBeta:
      return WOW_CLASSIC_BETA_FOLDER;
    case WowClientType.ClassicEraPtr:
      return WOW_CLASSIC_ERA_PTR_FOLDER;
    case WowClientType.Anniversary:
      return WOW_ANNIVERSARY_FOLDER;
    case WowClientType.Forever:
      return WOW_FOREVER_FOLDER;
    default:
      return null;
  }
}
