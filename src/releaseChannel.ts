import type { ReleaseChannel, SearchResult } from "./types";

/** Release channels (WF-03), in WowUp's order and words. */
export const CHANNEL_LABEL: Record<ReleaseChannel, string> = {
  stable: "Stable",
  beta: "Beta",
  alpha: "Alpha",
};

const CHANNELS: ReleaseChannel[] = ["stable", "beta", "alpha"];

export interface ChannelChoice {
  value: ReleaseChannel;
  label: string;
}

/**
 * The Release channel menu on a result (Get Addons rows, Details): one
 * "Install <channel> · <version>" per channel, null when the provider has no
 * channels. When a channel resolves to a file of another channel (Beta to a
 * newer Stable, or an empty channel falling back), the file's own channel is
 * named, so the version is never mistaken for a pre-release or vice versa.
 */
export function installChannelChoices(result: SearchResult): ChannelChoice[] | null {
  if (!result.channelReleases?.length) {
    return null;
  }
  return result.channelReleases.map(({ channel, version, fileChannel }) => ({
    value: channel,
    label:
      `Install ${CHANNEL_LABEL[channel]} · ${version}` +
      (fileChannel !== channel ? ` (${CHANNEL_LABEL[fileChannel]})` : ""),
  }));
}

/** The Release channel menu on an installed addon (My Addons): which channel it follows. */
export function followChannelChoices(): ChannelChoice[] {
  return CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));
}

/** Status tag for an addon on a pre-release channel; none for Stable. */
export function channelTag(channel: ReleaseChannel | undefined): string | null {
  return channel === "beta" || channel === "alpha" ? CHANNEL_LABEL[channel] : null;
}
