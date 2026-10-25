/**
 * CurseForge Core API v2 wire models.
 *
 * Derived from the shapes consumed by WowUp's curse-addon-provider.ts via
 * the curseforge-v2 client (GPL-3.0, commit 4fdae600). Only fields the
 * engine uses are modeled. See docs/wowup-provenance.md.
 */

export interface CfSortableGameVersion {
  gameVersionTypeId: number;
  name: string;
}

export interface CfModule {
  foldername: string;
  name: string;
}

export interface CfFile {
  id: number;
  displayName: string;
  /**
   * Null when the mod author (or the API key making the request) isn't
   * granted third-party download distribution for this file — CurseForge
   * returns `isAvailable: true` and every other field normally even then.
   * See CurseForgeProvider's own fallback for this case.
   */
  downloadUrl: string | null;
  /** ISO date. */
  fileDate: string;
  /** 1 = release, 2 = beta, 3 = alpha. */
  releaseType: number;
  exposeAsAlternative?: boolean;
  gameVersions: string[];
  sortableGameVersions: CfSortableGameVersion[];
  modules: CfModule[];
  /** relationType: 1=embedded, 2=optional, 3=required, 4=tool, 5=incompatible, 6=include. */
  dependencies?: { modId: number; relationType: number }[];
}

export interface CfAuthor {
  id: number;
  name: string;
}

/** Mod.screenshots (public API field, present on search/get/batch responses alike). */
export interface CfScreenshot {
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

export interface CfAddon {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  /** People who marked it a favorite on CurseForge (thumbsUpCount is near zero for everything). */
  favoriteCount?: number;
  links?: { websiteUrl?: string };
  logo?: { thumbnailUrl?: string };
  authors: CfAuthor[];
  latestFiles: CfFile[];
  screenshots?: CfScreenshot[];
}

/** GET /v1/mods/{id}/description response. */
export interface CfDescriptionResponse {
  data: string;
}

/** GET /v1/mods/{id}/files/{fileId}/changelog response. */
export interface CfChangelogResponse {
  data: string;
}

/** GET /v1/mods/search response. */
export interface CfSearchModsResponse {
  data: CfAddon[];
}

/** GET /v1/mods/{id} response. */
export interface CfGetModResponse {
  data: CfAddon;
}

/** POST /v1/mods response. */
export interface CfGetModsResponse {
  data: CfAddon[];
}

export interface CfPagination {
  index: number;
  pageSize: number;
  resultCount: number;
  /** CurseForge caps this at 10000 for broad queries — not a trustworthy exact total. */
  totalCount: number;
}

/** GET /v1/mods/{id}/files response — the authoritative, uncached file list. */
export interface CfGetFilesResponse {
  data: CfFile[];
  pagination: CfPagination;
}

/** GET /v1/categories response element. */
export interface CfCategory {
  id: number;
  gameId: number;
  name: string;
  slug: string;
  classId?: number;
  parentCategoryId: number;
  isClass?: boolean;
  displayIndex?: number;
}

/** GET /v1/categories response. */
export interface CfCategoriesResponse {
  data: CfCategory[];
}
