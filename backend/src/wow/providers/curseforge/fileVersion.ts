/**
 * The version to show for a CurseForge file. CurseForge has no version
 * field: `displayName` is free text, and many authors leave it as the zip's
 * file name ("ControllerForever.zip", "AtlasLootClassic-Continued-12488.zip",
 * "Peggle+ (Flight Minigames) 2.3.1.zip"; 6 of 17 addons in one real install,
 * 2026-10-17). A display name that is not a file name is the author's own
 * version text and stays as it is ("12.1.15-3-gc539b0a", "Details.20261015…").
 * From a file name the trailing version is taken; when there is none, the
 * release day is the only honest label ("16 Oct release").
 */
const ARCHIVE = /\.(zip|rar|7z|tar\.gz)$/i;
const TRAILING_VERSION = /(?:^|[^0-9A-Za-z])[vV]?(\d+(?:\.\d+)*(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function curseForgeFileVersion(displayName: string, fileDate: string): string {
  const name = displayName.trim();
  if (!ARCHIVE.test(name)) {
    return name;
  }
  const match = TRAILING_VERSION.exec(name.replace(ARCHIVE, ""));
  if (match?.[1]) {
    return match[1];
  }
  const date = new Date(fileDate);
  return Number.isNaN(date.getTime())
    ? name.replace(ARCHIVE, "")
    : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} release`;
}
