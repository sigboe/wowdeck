/**
 * Extracted from WowUp (GPL-3.0).
 * Upstream: wowup-lib/src/utils/addon.utils.ts (getGameVersion/getGameVersionList)
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: no.
 * See docs/wowup-provenance.md.
 */

export function getGameVersionList(interfaceStrs: (string | undefined)[]): string[] {
  return interfaceStrs.map((x) => getGameVersion(x));
}

export function getGameVersion(interfaceStr: string | undefined): string {
  if (typeof interfaceStr !== "string" || interfaceStr.length === 0) {
    return Array(3).fill("0").join(".");
  }

  if (interfaceStr.toString().includes(".")) {
    return interfaceStr;
  }

  // split the long interface into 3 chunks, major minor patch
  const chunks = [
    interfaceStr.substring(0, interfaceStr.length - 4),
    interfaceStr.substring(interfaceStr.length - 4, interfaceStr.length - 2),
    interfaceStr.substring(interfaceStr.length - 2),
  ];

  return chunks.filter((c) => !!c).join(".");
}

/**
 * Inverse of getGameVersion: "11.0.2" -> "110002". Loosely ported from
 * wowup-electron/src/app/utils/addon.utils.ts (toInterfaceVersion) at
 * 4fdae600 (local wowup/ reference checkout; confirmed byte-identical to
 * upstream master as of 2026-10-11) for the companion-data
 * Interface line — deviates from verbatim for Battle.net's 4-part
 * `.build.info` Version strings (e.g. "11.0.2.56177"): only the first
 * three dot-separated parts are used, matching the Interface number
 * WoW's own client actually expects. Upstream never has to handle a
 * trailing build number itself — its only caller always feeds it a
 * 3-part string already (the installed companion addon's own TOC
 * Interface value, round-tripped through getGameVersion above).
 * Returns undefined (never throws) for anything that isn't a clean
 * 3-part numeric version, so a missing/malformed installation version
 * safely skips companion-data generation instead of writing a bogus
 * Interface line.
 */
export function toInterfaceVersion(version: string): string | undefined {
  const parts = version.split(".").slice(0, 3);
  if (parts.length < 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return undefined;
  }
  return parts
    .map((part, idx) => {
      const num = parseInt(part, 10);
      return idx === 0 ? String(num) : num >= 10 ? String(num) : `0${num}`;
    })
    .join("");
}

/**
 * The one game version of a TOC's `## Interface` list that this installation
 * runs. A multi-client TOC lists one interface per client (DBM: 11509,
 * 16001, 20506, … 120105); shown raw, Details read "WoW 11509, 16001, …"
 * (on-device, 2026-10-16). Matches the installation's version ("1.60.1.70338")
 * on major.minor.patch, then major.minor, then major; a single interface is
 * returned as is; null when nothing fits (better no version than a wrong one).
 */
export function gameVersionForInstallation(
  interfaces: (string | undefined)[],
  installationVersion: string | undefined,
): string | null {
  // getGameVersion is upstream's and keeps the padding ("50504" -> "5.05.04").
  const versions = interfaces
    .filter((i): i is string => !!i && i.trim() !== "")
    .map((i) => getGameVersion(i.trim()).split(".").map((part) => String(Number(part))).join("."));
  if (versions.length <= 1) {
    return versions[0] ?? null;
  }
  const want = (installationVersion ?? "").split(".").filter(Boolean);
  for (let depth = Math.min(3, want.length); depth >= 1; depth--) {
    const prefix = want.slice(0, depth).join(".");
    const match = versions.find((v) => v.split(".").slice(0, depth).join(".") === prefix);
    if (match) {
      return match;
    }
  }
  return null;
}
