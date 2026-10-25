import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonInstaller, AddonRemover } from "../src/wow/addons/AddonInstaller";
import type { WowAddon, WowInstallation, AddonSearchResult } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { needsUpdate } from "../src/wow/addons/addonStatus";

const ROOT = "/tmp/opencode/wowdeck-tests/install";

function makeInstallation(location: string): WowInstallation {
  return {
    id: "inst",
    clientType: WowClientType.Retail,
    location,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
}

/** Fake provider whose download serves a zip built on the fly. */
class FakeProvider extends AddonProvider {
  name = "WowUpHub" as const;
  enabled = true;

  constructor(public zipFiles: Record<string, Uint8Array>) {
    super();
  }

  override async getById(): Promise<AddonSearchResult | undefined> {
    return undefined;
  }
}

function fakeNetworkServingZip(zipFiles: Record<string, Uint8Array>): NetworkClient {
  const zipped = zipSync(zipFiles);
  const client = {
    getJson: async () => {
      throw new Error("not expected");
    },
    postJson: async () => {
      throw new Error("not expected");
    },
    downloadToFile: async (_url: string, dest: string) => {
      writeFileSync(dest, Buffer.from(zipped));
      return zipped.length;
    },
  } as unknown as NetworkClient;
  return client;
}

const searchResult = (folders: string[], version = "2.0"): AddonSearchResult => ({
  author: "Author",
  externalId: "123",
  externalUrl: "https://example/a/123",
  name: "TestAddon",
  providerName: "WowUpHub",
  files: [
    {
      channelType: 0,
      folders,
      gameVersion: "11.0.2",
      downloadUrl: "https://example/download/TestAddon.zip",
      version,
      releaseDate: new Date().toISOString(),
      externalId: "456",
    },
  ],
});

function baseAddon(): WowAddon {
  return {
    id: "addon-1",
    name: "TestAddon",
    installationId: "inst",
    channelType: 0,
    isIgnored: false,
    isLoadOnDemand: false,
    providerName: "WowUpHub",
    externalId: "123",
  };
}

describe("AddonInstaller", () => {
  test("installs fresh addon into AddOns with toc metadata", async () => {
    const installRoot = join(ROOT, "fresh");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(addonsPath, { recursive: true });

    const zipFiles = {
      "TestAddon/TestAddon.toc": new TextEncoder().encode("## Title: TestAddon\n## Version: 2.0\n## Author: Dev\n## Interface: 110005\n"),
      "TestAddon/main.lua": new TextEncoder().encode("print('hi')\n"),
      "TestLib/TestLib.toc": new TextEncoder().encode("## Title: TestLib\n## Version: 1.0\n## Interface: 110005\n"),
    };
    const downloads = new DownloadService(fakeNetworkServingZip(zipFiles), join(ROOT, "dl-fresh"));
    const installer = new AddonInstaller(downloads);
    const provider = new FakeProvider(zipFiles);

    const { patch } = await installer.install({
      installation: makeInstallation(installRoot),
      addon: baseAddon(),
      searchResult: searchResult(["TestAddon", "TestLib"]),
      provider,
      operationId: "op1",
    });

    expect(existsSync(join(addonsPath, "TestAddon", "TestAddon.toc"))).toBe(true);
    expect(existsSync(join(addonsPath, "TestLib", "TestLib.toc"))).toBe(true);
    expect([...patch.installedFolderList!].sort()).toEqual(["TestAddon", "TestLib"]);
    expect(patch.installedVersion).toBe("2.0");
    expect(patch.installedExternalReleaseId).toBe("456");
    expect(patch.gameVersion).toBe("110005");
    // staging dir cleaned up
    expect(existsSync(join(addonsPath, ".wowdeck"))).toBe(false);
  });

  // A freshly-installed addon must never immediately report an update,
  // even when the addon author's TOC version string disagrees
  // with the provider's own reported version for the exact same file
  // (common in the wild — see upstream's own comment on needsUpdate:
  // "Sometimes authors push out new builds without changing the toc
  // version"). The release-id pair set at install time is what protects
  // against this; this test fails if that pair is ever dropped.
  test("fresh install with a TOC/provider version mismatch does not need an update", async () => {
    const installRoot = join(ROOT, "mismatch");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(addonsPath, { recursive: true });

    const zipFiles = {
      // TOC says "2.0.1" — provider's file.version below says "2.0" —
      // same file, differently-formatted version strings.
      "TestAddon/TestAddon.toc": new TextEncoder().encode(
        "## Title: TestAddon\n## Version: 2.0.1\n## Interface: 110005\n",
      ),
    };
    const downloads = new DownloadService(fakeNetworkServingZip(zipFiles), join(ROOT, "dl-mismatch"));
    const installer = new AddonInstaller(downloads);
    const provider = new FakeProvider(zipFiles);

    const base = baseAddon();
    const { patch } = await installer.install({
      installation: makeInstallation(installRoot),
      addon: base,
      searchResult: searchResult(["TestAddon"], "2.0"),
      provider,
      operationId: "op-mismatch",
    });

    expect(patch.installedVersion).toBe("2.0.1");
    expect(patch.latestVersion).toBe("2.0");
    expect(patch.externalLatestReleaseId).toBe("456");
    expect(patch.installedExternalReleaseId).toBe("456");
    expect(needsUpdate({ ...base, ...patch })).toBe(false);
  });

  // PC-14: a reinstall of DBM renamed it to its TOC title "<DBM Core> Main
  // Core". The provider's name is what the user found and knows; a scan match
  // keeps it too, so an install must not swap it for the TOC title.
  test("keeps the provider's name over the TOC title; the TOC title only when there is none", async () => {
    const installRoot = join(ROOT, "naming");
    mkdirSync(join(installRoot, "Interface/AddOns"), { recursive: true });
    const zipFiles = {
      "TestAddon/TestAddon.toc": new TextEncoder().encode(
        "## Title: <Test Core> Main Core\n## Version: 2.0\n## Interface: 110005\n",
      ),
    };
    const downloads = new DownloadService(fakeNetworkServingZip(zipFiles), join(ROOT, "dl-naming"));
    const installer = new AddonInstaller(downloads);
    const install = async (name: string) => {
      const { patch } = await installer.install({
        installation: makeInstallation(installRoot),
        addon: { ...baseAddon(), name: "Old name" },
        searchResult: { ...searchResult(["TestAddon"]), name },
        provider: new FakeProvider(zipFiles),
        operationId: `op-naming-${name}`,
      });
      return patch.name;
    };

    expect(await install("Test Addon (Test-Core)")).toBe("Test Addon (Test-Core)");
    expect(await install("")).toBe("<Test Core> Main Core");
  });

  test("updates existing addon and removes stale folders", async () => {
    const installRoot = join(ROOT, "update");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(join(addonsPath, "TestAddon"), { recursive: true });
    mkdirSync(join(addonsPath, "OldLib"), { recursive: true });
    writeFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), "## Title: TestAddon\n## Version: 1.0\n");
    writeFileSync(join(addonsPath, "OldLib", "OldLib.toc"), "## Title: OldLib\n## Version: 0.1\n");

    const zipFiles = {
      "TestAddon/TestAddon.toc": new TextEncoder().encode("## Title: TestAddon\n## Version: 3.0\n## Interface: 110005\n"),
      "NewLib/NewLib.toc": new TextEncoder().encode("## Title: NewLib\n## Version: 1.0\n## Interface: 110005\n"),
    };
    const downloads = new DownloadService(fakeNetworkServingZip(zipFiles), join(ROOT, "dl-update"));
    const installer = new AddonInstaller(downloads);

    const { patch } = await installer.install({
      installation: makeInstallation(installRoot),
      addon: baseAddon(),
      searchResult: searchResult(["TestAddon", "NewLib"], "3.0"),
      provider: new FakeProvider(zipFiles),
      operationId: "op2",
    });

    expect(readFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), "utf-8")).toContain("3.0");
    expect(existsSync(join(addonsPath, "NewLib"))).toBe(true);
    // stale folder from previous install remains (WowUp parity: provider folders define the set)
    expect(patch.installedFolderList).toEqual(["TestAddon", "NewLib"]);
    expect(patch.installedVersion).toBe("3.0");
  });

  test("failed validation leaves previous addon untouched", async () => {
    const installRoot = join(ROOT, "fail");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(join(addonsPath, "TestAddon"), { recursive: true });
    const originalToc = "## Title: TestAddon\n## Version: 1.0\n";
    writeFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), originalToc);

    // zip whose planned folder (from release metadata) is missing + no tocs
    const zipFiles = {
      "SomethingElse/readme.txt": new TextEncoder().encode("not an addon"),
    };
    const downloads = new DownloadService(fakeNetworkServingZip(zipFiles), join(ROOT, "dl-fail"));
    const installer = new AddonInstaller(downloads);

    await expect(
      installer.install({
        installation: makeInstallation(installRoot),
        addon: baseAddon(),
        searchResult: searchResult(["TestAddon"]),
        provider: new FakeProvider(zipFiles),
        operationId: "op3",
      }),
    ).rejects.toThrow(/valid addon|contain an addon/);

    expect(readFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), "utf-8")).toBe(originalToc);
    expect(existsSync(join(addonsPath, ".wowdeck"))).toBe(false);
  });

  test("corrupt zip download leaves installation untouched", async () => {
    const installRoot = join(ROOT, "corrupt");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(join(addonsPath, "TestAddon"), { recursive: true });
    writeFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), "## Version: 1.0\n");

    const client = {
      downloadToFile: async (_url: string, dest: string) => {
        // A zip's signature, then garbage: a truncated download.
        writeFileSync(dest, "PK\x03\x04garbage");
        return 11;
      },
    } as unknown as NetworkClient;
    const installer = new AddonInstaller(new DownloadService(client, join(ROOT, "dl-corrupt")));

    await expect(
      installer.install({
        installation: makeInstallation(installRoot),
        addon: baseAddon(),
        searchResult: searchResult(["TestAddon"]),
        provider: new FakeProvider({}),
        operationId: "op4",
      }),
    ).rejects.toThrow(/damaged/);

    expect(existsSync(join(addonsPath, "TestAddon", "TestAddon.toc"))).toBe(true);
  });
});

describe("AddonRemover", () => {
  test("removes addon folders", async () => {
    const installRoot = join(ROOT, "remove");
    const addonsPath = join(installRoot, "Interface/AddOns");
    mkdirSync(join(addonsPath, "TestAddon"), { recursive: true });
    writeFileSync(join(addonsPath, "TestAddon", "TestAddon.toc"), "## Version: 1\n");

    const addon = { ...baseAddon(), installedFolderList: ["TestAddon"] };
    const removed = await new AddonRemover().remove(makeInstallation(installRoot), addon, "op5");
    expect(removed).toEqual(["TestAddon"]);
    expect(existsSync(join(addonsPath, "TestAddon"))).toBe(false);
  });

  test("missing folders are tolerated", async () => {
    const installRoot = join(ROOT, "remove-missing");
    mkdirSync(join(installRoot, "Interface/AddOns"), { recursive: true });
    const addon = { ...baseAddon(), installedFolderList: ["Gone"] };
    const removed = await new AddonRemover().remove(makeInstallation(installRoot), addon, "op6");
    expect(removed).toEqual(["Gone"]);
  });

  test("addon without folder info is rejected", async () => {
    const installRoot = join(ROOT, "remove-noinfo");
    mkdirSync(join(installRoot, "Interface/AddOns"), { recursive: true });
    await expect(new AddonRemover().remove(makeInstallation(installRoot), baseAddon(), "op7")).rejects.toThrow(
      /weren't found/,
    );
  });
});

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});
