/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon } from "./types";
import { installedDetails } from "./installedDetails";

const addon = (overrides: Partial<Addon> = {}): Addon =>
  ({
    id: "a1",
    installationId: "i1",
    folderName: "Details",
    name: "Details",
    version: "1.0",
    author: "Terciob",
    notes: "Damage meter",
    thumbnailUrl: "https://example.com/d.png",
    externalUrl: "https://example.com/d",
    gameVersion: "11.0.2",
    providerId: "Curse",
    externalId: "61284",
    dependencies: ["Ace3", "LibStub"],
    missingDependencies: ["LibStub"],
    updateAvailable: false,
    availableVersion: null,
    ignored: false,
    newlyUpdated: false,
    ...overrides,
  }) as Addon;

describe("the installed-addon details mapping (My Addons)", () => {
  test("fills the result shape from the fields an installed addon has", () => {
    const { result } = installedDetails(addon());
    expect(result).toEqual({
      providerId: "Curse",
      externalId: "61284",
      name: "Details",
      author: "Terciob",
      downloadCount: null,
      summary: "Damage meter",
      thumbnailUrl: "https://example.com/d.png",
      websiteUrl: "https://example.com/d",
      latestVersion: "1.0",
      gameVersion: "11.0.2",
      gameVersions: ["11.0.2"],
      gameVersionClients: null,
      releasedAt: null,
      channel: null,
      screenshots: [],
    });
  });

  test("the latest version is the update on offer, else the installed one", () => {
    expect(
      installedDetails(addon({ updateAvailable: true, availableVersion: "1.1" })).result,
    ).toMatchObject({ latestVersion: "1.1" });
    expect(installedDetails(addon()).result).toMatchObject({ latestVersion: "1.0" });
    expect(installedDetails(addon({ version: null, availableVersion: null })).result).toMatchObject(
      { latestVersion: null },
    );
  });

  test("no provider fields without a provider, no game versions without one", () => {
    const { result } = installedDetails(addon({ providerId: null, externalId: null }));
    expect(result).toMatchObject({ providerId: "", externalId: "" });
    expect(installedDetails(addon({ gameVersion: null })).result).toMatchObject({
      gameVersion: null,
      gameVersions: null,
    });
  });

  test("the dependencies line names the TOC's required folders and the missing ones", () => {
    expect(installedDetails(addon()).dependencies).toEqual({
      text: "Requires Ace3, LibStub",
      missing: "Missing: LibStub",
    });
    expect(installedDetails(addon({ missingDependencies: [] })).dependencies).toEqual({
      text: "Requires Ace3, LibStub",
      missing: null,
    });
    expect(installedDetails(addon({ dependencies: [] })).dependencies).toBeNull();
  });

  test("the Relationships page lists the TOC's folders and which are missing", () => {
    expect(installedDetails(addon()).relationships).toEqual({
      kind: "toc",
      items: [
        { name: "Ace3", installed: true },
        { name: "LibStub", installed: false },
      ],
    });
    expect(installedDetails(addon({ dependencies: [] })).relationships).toEqual({
      kind: "toc",
      items: [],
    });
  });
});
