/**
 * WoWDeck's own version strings: a dotted release ("0.3.0", "v0.1") or a
 * beta build of the next one ("0.3.1-beta.40"). Shared by the update check
 * (which build is newer) and the settings normalizers (which stored
 * versions are trusted), so both accept exactly the same forms.
 *
 * Ordering is semver precedence restricted to those forms: a pre-release
 * sorts below the same X.Y.Z, and betas order by N. Anything else —
 * "banana", "1.2.3.4", "1.2.3-rc.1" — is not a WoWDeck version, and
 * comparing it is "can't tell" rather than a guessed order.
 */

interface ParsedVersion {
  release: number[];
  /** The beta's N; null for a release. */
  beta: number | null;
}

const VERSION = /^v?(\d+(?:\.\d+){0,2})(?:-beta\.(\d+))?$/;

function parseVersion(v: string): ParsedVersion | null {
  const m = VERSION.exec(v.trim());
  if (!m) return null;
  return { release: m[1]!.split(".").map(Number), beta: m[2] === undefined ? null : Number(m[2]) };
}

/** The version without its leading v, or null when it is not a WoWDeck version. */
export function normalizeVersion(v: string): string | null {
  const trimmed = v.trim();
  return parseVersion(trimmed) ? trimmed.replace(/^v/, "") : null;
}

/** Whether a WoWDeck version is a beta build (X.Y.Z-beta.N). */
export function isBetaVersion(v: string): boolean {
  return parseVersion(v)?.beta != null;
}

/**
 * Compare two versions: -1, 0 or 1; null when either side is not a WoWDeck
 * version — the caller treats "can't tell" as unknown.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.release.length, pb.release.length); i++) {
    const d = (pa.release[i] ?? 0) - (pb.release[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (pa.beta === pb.beta) return 0;
  if (pa.beta === null) return 1;
  if (pb.beta === null) return -1;
  return Math.sign(pa.beta - pb.beta);
}
