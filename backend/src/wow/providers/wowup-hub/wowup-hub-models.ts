/**
 * Wire models for hub.wowup.io (the "WowUpHub" provider).
 * Extracted from WowUp (GPL-3.0).
 * Upstream: wowup-lib/src/models/wowup.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — trimmed to search/get/fingerprint surfaces; dates as
 *   strings (JSON wire format).
 * See docs/wowup-provenance.md.
 */

import type { WowGameType } from "../../utils/gametype";

export interface WowUpAddonReleaseFolderRepresentation {
  id: number;
  folder_name: string;
  fingerprint: string;
}

export interface AddonReleaseGameVersion {
  interface: string;
  title: string;
  game_type: WowGameType;
  version: string;
  authors: string;
}

export interface WowUpAddonReleaseRepresentation {
  id: number;
  url: string;
  name: string;
  tag_name: string;
  external_id: string;
  prerelease: boolean;
  body: string;
  game_versions: AddonReleaseGameVersion[];
  toc_title?: string;
  download_url: string;
  published_at: string;
  addonFolders?: WowUpAddonReleaseFolderRepresentation[];
}

export interface WowUpAddonRepresentation {
  id: number;
  repository: string;
  repository_name: string;
  source: string;
  owner_name?: string;
  owner_image_url?: string;
  image_url?: string;
  description?: string;
  homepage?: string;
  total_download_count: number;
  current_release?: WowUpAddonReleaseRepresentation;
  matched_release?: WowUpAddonReleaseRepresentation;
  releases?: WowUpAddonReleaseRepresentation[];
}

export interface WowUpGetAddonResponse {
  addon: WowUpAddonRepresentation;
}

/** GET /addons/featured/<gameType>?count&recent: popular, then recently updated. */
export interface WowUpGetFeaturedAddonsResponse {
  addons: WowUpAddonRepresentation[];
  recent?: WowUpAddonRepresentation[];
}

export interface WowUpSearchAddonsResponse {
  addons: WowUpAddonRepresentation[];
  count: number;
}

export interface GetAddonsByFingerprintResponse {
  exactMatches: WowUpAddonRepresentation[];
}

export interface GetAddonBatchResponse {
  addons: WowUpAddonRepresentation[];
}
