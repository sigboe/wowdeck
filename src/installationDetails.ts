/**
 * Pure formatting helpers for the Installation details dialog. No React, no
 * @decky imports; tested in installationDetails.test.ts.
 */

/** "1.60.1.70338" -> { version: "1.60.1", build: "70338" }; "11.0.2" keeps its whole text. */
export function splitGameVersion(version: string | null): {
  version: string | null;
  build: string | null;
} {
  if (!version) {
    return { version: null, build: null };
  }
  const parts = version.split(".");
  if (parts.length === 4) {
    return { version: parts.slice(0, 3).join("."), build: parts[3] };
  }
  return { version, build: null };
}

/** Replaces a leading /home/<user> with ~ so long paths fit one line. */
export function homePath(path: string): string {
  const match = /^\/home\/[^/]+/.exec(path);
  return match ? `~${path.slice(match[0].length)}` : path;
}

/** Last path segment ("…/_classic_beta_/" -> "_classic_beta_"), tolerating a trailing slash. */
export function gameFolder(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last || trimmed;
}

/** "16 installed, 15 managed"; "None installed" when nothing is there. */
export function addonCountText(installed: number, managed: number): string {
  if (installed === 0) {
    return "None installed";
  }
  return `${installed} installed, ${managed} managed`;
}
