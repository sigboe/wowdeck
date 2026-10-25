/**
 * GitHub REST API (repos/releases) and "release.json" asset shapes.
 * Trimmed to the fields this provider actually reads —
 * GitHub's real responses carry many more. Not ported from WowUp (its
 * equivalent types live in wowup-lib/src/models/github.ts) — written
 * fresh against the public GitHub REST API docs and a handful of real
 * release.json examples.
 */

export interface GhOwner {
  login: string;
  avatar_url?: string;
}

export interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  owner: GhOwner;
}

export interface GhReleaseAsset {
  id: number;
  name: string;
  content_type: string;
  size: number;
  browser_download_url: string;
}

export interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GhReleaseAsset[];
}

/**
 * The "BigWigs convention" release.json: an uploaded release ASSET named
 * literally `release.json`, not a file in the repo tree. No version/
 * schema field exists upstream, so none is required here either.
 */
export interface GhReleaseJsonEntry {
  filename: string;
  nolib?: boolean;
  metadata?: Array<{ flavor: string; interface: number }>;
}

export interface GhReleaseJson {
  releases: GhReleaseJsonEntry[];
}
