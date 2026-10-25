import { describe, expect, test } from "bun:test";
import { toWireSearchResult } from "../src/wow/addons/wire";
import type { AddonSearchResult, AddonSearchResultFile } from "../src/wow/models";
import { AddonChannelType, AddonDependencyType } from "../src/wow/types";

function file(over: Partial<AddonSearchResultFile> = {}): AddonSearchResultFile {
  return {
    externalId: "1",
    channelType: AddonChannelType.Stable,
    version: "1.0.0",
    folders: [],
    gameVersion: "11.0.2",
    downloadUrl: "https://example.test/a.zip",
    releaseDate: "2026-09-01T12:30:00.000Z",
    ...over,
  };
}

function result(files: AddonSearchResultFile[]): AddonSearchResult {
  return {
    author: "A",
    externalId: "1",
    externalUrl: "https://example.test/a",
    name: "Addon",
    providerName: "Curse",
    summary: "s",
    thumbnailUrl: "",
    files,
    screenshots: [],
  };
}

describe("toWireSearchResult release facts", () => {
  test("reports the latest file's release day and channel", () => {
    const wire = toWireSearchResult(result([file()]));
    expect(wire.releasedAt).toBe("2026-09-01");
    expect(wire.channel).toBe("stable");
  });

  test("maps beta and alpha channels", () => {
    expect(toWireSearchResult(result([file({ channelType: AddonChannelType.Beta })])).channel).toBe("beta");
    expect(toWireSearchResult(result([file({ channelType: AddonChannelType.Alpha })])).channel).toBe("alpha");
  });

  test("treats the epoch placeholder as an unknown date", () => {
    const wire = toWireSearchResult(result([file({ releaseDate: new Date(0).toISOString() })]));
    expect(wire.releasedAt).toBeNull();
  });

  test("is null for both when there are no files", () => {
    const wire = toWireSearchResult(result([]));
    expect(wire.releasedAt).toBeNull();
    expect(wire.channel).toBeNull();
  });
});

describe("toWireSearchResult required dependencies (WF-11)", () => {
  test("counts the required dependencies of the file that would be installed", () => {
    const deps = [
      { externalAddonId: "1", type: AddonDependencyType.Required },
      { externalAddonId: "2", type: AddonDependencyType.Optional },
      { externalAddonId: "3", type: AddonDependencyType.Required },
    ];
    expect(toWireSearchResult(result([file({ dependencies: deps })])).requiredDependencies).toBe(2);
    expect(toWireSearchResult(result([file()])).requiredDependencies).toBe(0);
  });
});

describe("toWireSearchResult relationships and favorites (WF-11)", () => {
  test("lists required, optional and embedded dependencies of the file that would be installed", () => {
    const deps = [
      { externalAddonId: "1", type: AddonDependencyType.Required },
      { externalAddonId: "2", type: AddonDependencyType.Optional },
      { externalAddonId: "3", type: AddonDependencyType.Embedded },
      { externalAddonId: "4", type: AddonDependencyType.Other },
    ];
    expect(toWireSearchResult(result([file({ dependencies: deps })])).relationships).toEqual([
      { externalId: "1", relation: "required" },
      { externalId: "2", relation: "optional" },
      { externalId: "3", relation: "embedded" },
    ]);
  });

  test("favorites come through when the provider has them", () => {
    expect(toWireSearchResult({ ...result([file()]), favoriteCount: 53581 }).favoriteCount).toBe(53581);
    expect(toWireSearchResult(result([file()])).favoriteCount).toBeNull();
  });
});

