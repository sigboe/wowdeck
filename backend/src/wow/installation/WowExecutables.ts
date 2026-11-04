/**
 * Upstream executable list: wowup-electron/app/services/warcraft/warcraft-platform.win.ts:15-45.
 * GPL-3.0, commit 4fdae600d94ad7dd187a6bc93b517e657100b01a.
 * Modified: ARM64 spelling and launcher names observed on the reference devices.
 * See docs/wowup-provenance.md.
 */
/**
 * Known WoW client executable names (case-sensitive, as shipped by
 * Battle.net). Derived from WowUp warcraft-platform.win.ts lines 15-45
 * (identical list is used by the linux platform since the Windows client
 * runs unchanged under Wine/Proton). Presence of any of these in a flavor
 * directory is the strongest evidence of a real installation.
 */
export const WOW_EXECUTABLE_NAMES: readonly string[] = [
  "Wow.exe",
  "WowT.exe",
  "WowB.exe",
  "WowClassic.exe",
  "WowClassicT.exe",
  "WowClassicB.exe",
  "Wow-arm64.exe",
  "Wow-ARM64.exe",
  "WowT-arm64.exe",
  "WowB-arm64.exe",
  "WowClassic-arm64.exe",
  "WowClassicT-arm64.exe",
  "WowClassicB-arm64.exe",
];

/** Launchers observed on the reference Deck. They never confirm a game installation. */
export const WOW_LAUNCHER_EXECUTABLE_NAMES: readonly string[] = [
  "World of Warcraft Launcher.exe",
  "Battle.net.exe",
  "Battle.net Launcher.exe",
];

export function isWowClientExecutable(name: string): boolean {
  return WOW_EXECUTABLE_NAMES.some(exe => exe.toLowerCase() === name.toLowerCase());
}

export function isWowLaunchExecutable(name: string): boolean {
  return isWowClientExecutable(name) || WOW_LAUNCHER_EXECUTABLE_NAMES.some(exe => exe.toLowerCase() === name.toLowerCase());
}
