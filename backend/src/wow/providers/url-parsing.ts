/**
 * Shared URL-parsing helper for Install from URL: a pasted
 * `github.com/owner/repo` or
 * `www.wowinterface.com/downloads/info123.html` with no scheme should
 * still resolve — most people don't type `https://` when copying a
 * site's own displayed address. `new URL()` requires an absolute URL
 * with a scheme and throws without one; retried once with `https://`
 * prepended before giving up. Never tried for an input that already had
 * *some* scheme (even a wrong one) — only for the "no scheme at all"
 * failure case.
 */
export function parseUrlAllowingMissingScheme(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
}
