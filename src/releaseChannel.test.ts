/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { channelTag, followChannelChoices, installChannelChoices } from "./releaseChannel";
import type { SearchResult } from "./types";

const result = (channelReleases: SearchResult["channelReleases"]): SearchResult => ({
  providerId: "Curse",
  externalId: "1",
  name: "Addon",
  author: null,
  downloadCount: null,
  summary: null,
  thumbnailUrl: null,
  websiteUrl: null,
  latestVersion: "1.0",
  gameVersion: null,
  releasedAt: null,
  channel: "stable",
  channelReleases,
  requiredDependencies: 0,
  relationships: [],
  favoriteCount: null,
  screenshots: [],
});

describe("installChannelChoices", () => {
  test("one install choice per channel, naming a file from another channel", () => {
    expect(
      installChannelChoices(
        result([
          { channel: "stable", version: "1.0", fileChannel: "stable" },
          { channel: "beta", version: "1.1b", fileChannel: "beta" },
          { channel: "alpha", version: "1.1b", fileChannel: "beta" },
        ]),
      ),
    ).toEqual([
      { value: "stable", label: "Install Stable · 1.0" },
      { value: "beta", label: "Install Beta · 1.1b" },
      { value: "alpha", label: "Install Alpha · 1.1b (Beta)" },
    ]);
  });

  test("no menu for a provider without channels", () => {
    expect(installChannelChoices(result(null))).toBeNull();
  });
});

describe("followChannelChoices / channelTag", () => {
  test("three channels; a tag only off Stable", () => {
    expect(followChannelChoices().map((c) => c.label)).toEqual(["Stable", "Beta", "Alpha"]);
    expect(channelTag("stable")).toBeNull();
    expect(channelTag(undefined)).toBeNull();
    expect(channelTag("alpha")).toBe("Alpha");
  });
});
