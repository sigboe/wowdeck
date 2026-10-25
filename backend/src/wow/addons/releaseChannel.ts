/**
 * Which provider file to install or offer for a release channel.
 *
 * `latestFile` is upstream WowUp's `getLatestFile`
 * (wowup-electron/src/app/utils/search-result.utils.ts): the newest file
 * whose channel is at most the chosen one (Beta also takes Stable files,
 * Alpha takes all), or the newest file of any channel when none qualifies.
 * Providers order `files` differently (CurseForge stable-first, WowUp Hub
 * newest-first), so nothing may rely on `files[0]`.
 */
import type { AddonSearchResultFile, WowAddon } from "../models";
import { AddonChannelType } from "../types";

export type WireChannel = "stable" | "beta" | "alpha";

const WIRE: Record<AddonChannelType, WireChannel> = {
  [AddonChannelType.Stable]: "stable",
  [AddonChannelType.Beta]: "beta",
  [AddonChannelType.Alpha]: "alpha",
};

export function channelToWire(channel: AddonChannelType): WireChannel {
  return WIRE[channel] ?? "stable";
}

export function channelFromWire(channel: WireChannel): AddonChannelType {
  return channel === "alpha" ? AddonChannelType.Alpha : channel === "beta" ? AddonChannelType.Beta : AddonChannelType.Stable;
}

function releaseTime(file: AddonSearchResultFile): number {
  const t = Date.parse(file.releaseDate);
  return Number.isNaN(t) ? 0 : t;
}

function newest(files: AddonSearchResultFile[]): AddonSearchResultFile | undefined {
  // Stable sort: equal dates keep the provider's own order.
  return [...files].sort((a, b) => releaseTime(b) - releaseTime(a))[0];
}

export function latestFile(
  files: AddonSearchResultFile[] | undefined,
  channel: AddonChannelType,
): AddonSearchResultFile | undefined {
  if (!files?.length) {
    return undefined;
  }
  return newest(files.filter((f) => f.channelType <= channel)) ?? newest(files);
}

/**
 * Whether the channels offer a real choice: some pre-release is newer than
 * the newest stable file, so Alpha would install something Stable would
 * not. Many CurseForge addons list an old beta or alpha behind a newer
 * stable; a channel menu there would offer the same file three times.
 */
export function hasNewerPrerelease(files: AddonSearchResultFile[] | undefined): boolean {
  const stable = latestFile(files, AddonChannelType.Stable);
  const newest = latestFile(files, AddonChannelType.Alpha);
  return !!stable && !!newest && stable !== newest;
}

/**
 * The file an installed addon should be offered as its update: the
 * channel's latest, unless that is older than what is installed (the user
 * moved Beta -> Stable while a newer beta is installed). Then the installed
 * file stays "latest", so no downgrade shows up as an update; a reinstall
 * is the explicit way back to the channel's own release.
 */
export function updateCandidate(
  files: AddonSearchResultFile[] | undefined,
  addon: Pick<WowAddon, "channelType" | "installedExternalReleaseId">,
): AddonSearchResultFile | undefined {
  const candidate = latestFile(files, addon.channelType);
  const installed = addon.installedExternalReleaseId
    ? files?.find((f) => f.externalId === addon.installedExternalReleaseId)
    : undefined;
  if (candidate && installed && releaseTime(candidate) < releaseTime(installed)) {
    return installed;
  }
  return candidate;
}
