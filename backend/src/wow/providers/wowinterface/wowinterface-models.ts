/**
 * WowInterface/MMOUI "filedetails" API response shapes.
 * Not ported from WowUp — written fresh against the real, live API
 * (confirmed via a direct request during investigation) and against
 * WowUp's own model file for field names/types, since the shapes
 * themselves are the real third-party API's, not an implementation
 * detail WowUp invented.
 *
 * The endpoint always returns a JSON array, even for a single id.
 */

/** Current (v4) response shape. */
export interface WowiFileDetailsV4 {
  id: number;
  categoryId: number;
  version: string;
  /** Epoch milliseconds. */
  lastUpdate: number;
  checksum: string;
  fileName: string;
  downloadUri: string;
  title: string;
  author: string;
  description: string;
  changeLog: string;
  downloads: number;
  downloadsMonthly: number;
  favorites: number;
  images?: Array<{ thumbUrl: string; imageUrl: string; description?: string }>;
}

/** Legacy (v3) fallback response shape — live-confirmed field names. */
export interface WowiFileDetailsV3 {
  UID: string;
  UICATID: string;
  UIVersion: string;
  /** Epoch milliseconds, as a number despite the sibling fields being strings. */
  UIDate: number;
  UIMD5: string;
  UIFileName: string;
  UIDownload: string;
  UIName: string;
  UIAuthorName: string;
  UIDescription: string;
  UIChangeLog: string;
  UIHitCount: string;
  UIHitCountMonthly: string;
  UIFavoriteTotal: string;
}

export interface WowiErrorResponse {
  ERROR: string;
}
