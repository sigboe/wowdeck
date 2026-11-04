/**
 * WoWDeck's own version strings: a dotted release ("0.3.0", "v0.1"), a
 * beta build of the next one ("0.3.1-beta.40") or a test build
 * ("0.3.1-test.114", `make version-set` on a device-test branch). Shared by
 * the update check (which build is newer) and the settings normalizers
 * (which stored versions are trusted), so both accept exactly the same
 * forms.
 *
 * Ordering is semver precedence restricted to those forms: a pre-release
 * sorts below the same X.Y.Z, and betas order by N. A test build of the
 * same X.Y.Z sorts below the release but above every beta: it is built from
 * a branch past the newest beta, so it knows everything the beta does, and
 * it is superseded only by the shipped release or a newer X.Y.Z. Anything
 * else — "banana", "1.2.3.4", "1.2.3-rc.1" — is not a WoWDeck version, and
 * comparing it is "can't tell" rather than a guessed order.
 */

interface ParsedVersion {
  release: number[];
  /** The pre-release's kind and N; null for a release. */
  pre: { kind: "beta" | "test"; n: number } | null;
}

const VERSION = /^v?(\d+(?:\.\d+){0,2})(?:-(beta|test)\.(\d+))?$/;

function parseVersion(v: string): ParsedVersion | null {
  const m = VERSION.exec(v.trim());
  if (!m) return null;
  return {
    release: m[1]!.split(".").map(Number),
    pre: m[2] === undefined ? null : { kind: m[2] as "beta" | "test", n: Number(m[3]) },
  };
}

/** The version without its leading v, or null when it is not a WoWDeck version. */
export function normalizeVersion(v: string): string | null {
  const trimmed = v.trim();
  return parseVersion(trimmed) ? trimmed.replace(/^v/, "") : null;
}

/** Whether a WoWDeck version is a beta build (X.Y.Z-beta.N). */
export function isBetaVersion(v: string): boolean {
  return parseVersion(v)?.pre?.kind === "beta";
}

/** Whether a WoWDeck version is a test build (X.Y.Z-test.N). */
export function isTestVersion(v: string): boolean {
  return parseVersion(v)?.pre?.kind === "test";
}

/** Pre-release precedence within one X.Y.Z: a release beats test, test beats beta. */
function preRank(pre: ParsedVersion["pre"]): number {
  if (pre === null) return 2;
  return pre.kind === "test" ? 1 : 0;
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
  if (preRank(pa.pre) !== preRank(pb.pre)) return Math.sign(preRank(pa.pre) - preRank(pb.pre));
  if (pa.pre === null || pb.pre === null) return 0;
  if (pa.pre.n !== pb.pre.n) return Math.sign(pa.pre.n - pb.pre.n);
  return 0;
}
