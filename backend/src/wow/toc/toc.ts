/**
 * Extracted and adapted from WowUp (GPL-3.0).
 * Upstream: wowup/wowup-lib/src/toc.ts
 *       + wowup/wowup-electron/src/common/constants.ts (folder names)
 *       + wowup/wowup-electron/app/services/warcraft/warcraft-platform.service.ts
 *         (getClientTypeForFolderName)
 * Commit: 89a0981ad00290d40368bf2a9f60209a40198502
 * Modified: yes — merged TOC tag constants, Toc shape and the flavor folder
 *   lookups into one module; the folder names and the folder-name ->
 *   client-type mapping now live in the client table (wow/clients.ts).
 * See docs/wowup-provenance.md.
 */

import { WOW_CLIENTS, wowClient, wowClientForFolder } from "../clients";
import { WowClientType } from "../types";

export const TOC_AUTHOR = "Author";
export const TOC_DEPENDENCIES = "Dependencies";
export const TOC_INTERFACE = "Interface";
export const TOC_NOTES = "Notes";
export const TOC_OPTIONAL_DEPS = "OptionalDeps";
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
  /** `## OptionalDeps`: folder names the addon loads after when present. */
  optionalDependencyList: string[];
  addonProvider?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// WoW installation flavor folders
// ---------------------------------------------------------------------------

export const WOW_ADDON_FOLDER_NAME = "AddOns";
export const WOW_INTERFACE_FOLDER_NAME = "Interface";

/** Every flavor folder, in client table order. */
export const WOW_FLAVOR_FOLDERS: readonly string[] = WOW_CLIENTS.map((c) => c.folder);

export function getClientTypeForFolderName(folderName: string): WowClientType {
  return wowClientForFolder(folderName)?.clientType ?? WowClientType.None;
}

export function getFolderNameForClientType(clientType: WowClientType): string | null {
  return wowClient(clientType)?.folder ?? null;
}
