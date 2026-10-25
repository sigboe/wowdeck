import { describe, expect, test } from "bun:test";
import { hasNewerPrerelease, latestFile, updateCandidate } from "../src/wow/addons/releaseChannel";
import type { AddonSearchResultFile } from "../src/wow/models";
import { AddonChannelType } from "../src/wow/types";

const file = (externalId: string, channelType: AddonChannelType, releaseDate: string): AddonSearchResultFile => ({
  externalId,
  channelType,
  releaseDate,
  version: externalId,
  folders: [],
  gameVersion: "",
  downloadUrl: `https://example.invalid/${externalId}`,
});

// Provider order deliberately not by date (CurseForge lists stable first).
const files = [
  file("stable-1", AddonChannelType.Stable, "2026-01-01"),
  file("stable-2", AddonChannelType.Stable, "2026-03-01"),
  file("beta-1", AddonChannelType.Beta, "2026-04-01"),
  file("alpha-1", AddonChannelType.Alpha, "2026-05-01"),
];

describe("latestFile (upstream getLatestFile)", () => {
  test("picks the newest file at or below the channel", () => {
    expect(latestFile(files, AddonChannelType.Stable)?.externalId).toBe("stable-2");
    expect(latestFile(files, AddonChannelType.Beta)?.externalId).toBe("beta-1");
    expect(latestFile(files, AddonChannelType.Alpha)?.externalId).toBe("alpha-1");
  });

  test("a newer stable wins over an older beta on the beta channel", () => {
    const withNewStable = [...files, file("stable-3", AddonChannelType.Stable, "2026-06-01")];
    expect(latestFile(withNewStable, AddonChannelType.Beta)?.externalId).toBe("stable-3");
  });

  test("falls back to the newest of any channel when the channel has nothing", () => {
    const betaOnly = [file("b1", AddonChannelType.Beta, "2026-01-01"), file("a1", AddonChannelType.Alpha, "2026-02-01")];
    expect(latestFile(betaOnly, AddonChannelType.Stable)?.externalId).toBe("a1");
  });

  test("no files, no file", () => {
    expect(latestFile([], AddonChannelType.Stable)).toBeUndefined();
    expect(latestFile(undefined, AddonChannelType.Stable)).toBeUndefined();
  });
});

describe("updateCandidate", () => {
  test("offers the channel's newer release", () => {
    const addon = { channelType: AddonChannelType.Beta, installedExternalReleaseId: "stable-2" };
    expect(updateCandidate(files, addon)?.externalId).toBe("beta-1");
  });

  test("moving back to Stable with a newer beta installed offers no downgrade", () => {
    const addon = { channelType: AddonChannelType.Stable, installedExternalReleaseId: "beta-1" };
    expect(updateCandidate(files, addon)?.externalId).toBe("beta-1");
  });

  test("an installed file the provider no longer lists does not block the update", () => {
    const addon = { channelType: AddonChannelType.Stable, installedExternalReleaseId: "gone" };
    expect(updateCandidate(files, addon)?.externalId).toBe("stable-2");
  });
});

describe("hasNewerPrerelease", () => {
  test("only when a pre-release is newer than the newest stable", () => {
    expect(hasNewerPrerelease(files)).toBe(true);
    expect(hasNewerPrerelease([...files, file("stable-9", AddonChannelType.Stable, "2026-09-01")])).toBe(false);
    expect(hasNewerPrerelease([file("s", AddonChannelType.Stable, "2026-01-01")])).toBe(false);
    expect(hasNewerPrerelease([file("b", AddonChannelType.Beta, "2026-01-01")])).toBe(false);
    expect(hasNewerPrerelease(undefined)).toBe(false);
  });
});
