import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddonInstaller as CommittingInstaller, type InstallOptions } from "../src/wow/addons/AddonInstaller";
import { createStateStore } from "../src/wow/storage/StateStore";
import type { WowAddon, WowInstallation, AddonSearchResult } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { needsUpdate } from "../src/wow/addons/addonStatus";
import { unzipSync } from "fflate";
import {
  addonAndDocsZip,
  emptyTocZip,
  failTocReads,
  genericAndMainlineZip,
  looseFileZip,
  mixedCaseTocZip,
  nestedOnlyTocZip,
  orderBundleZip,
  otherClientTocZip,
  tocNamedDirectoryZip,
  upperCaseTocZip,
} from "./helpers/addon-folder-archives";

const ROOT = "/tmp/opencode/wowdeck-tests/install";

/**
 * The installer as these tests drive it: each install commits into a
 * fresh store of its own, creating the record, so a test reads the patch.
 */
class AddonInstaller extends CommittingInstaller {
  override install(opts: Omit<InstallOptions, "records" | "recordChange">) {
    const records = createStateStore(mkdtempSync(join(tmpdir(), "wowdeck-installer-"))).addons;
    return super.install({ ...opts, records, recordChange: (patch) => ({ create: [{ ...opts.addon, ...patch }] }) });
  }
}

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

/** Install the given archive bytes with the provider selecting `folders`. */
async function installArchive(
  name: string,
  zip: Uint8Array,
  folders: string[],
  seed?: string,
  extra: { requiredFolder?: string; addon?: Partial<WowAddon>; searchName?: string } = {},
) {
  const installRoot = join(ROOT, name);
  const addonsPath = join(installRoot, "Interface/AddOns");
  mkdirSync(addonsPath, { recursive: true });
  if (seed !== undefined) {
    mkdirSync(join(addonsPath, "Foo"), { recursive: true });
    writeFileSync(join(addonsPath, "Foo", "Foo.toc"), seed);
  }
  const files = unzipSync(zip);
  const downloads = new DownloadService(fakeNetworkServingZip(files), join(ROOT, `dl-${name}`));
  const installer = new AddonInstaller(downloads);
  const result = installer.install({
    installation: makeInstallation(installRoot),
    addon: { ...baseAddon(), name: "Foo", ...extra.addon },
    searchResult: { ...searchResult(folders), ...(extra.searchName !== undefined && { name: extra.searchName }) },
    provider: new FakeProvider(files),
    operationId: `op-${name}`,
    requiredFolder: extra.requiredFolder,
  });
  return { result, addonsPath };
}

describe("AddonInstaller: the Addon folder rule", () => {
  for (const [label, zip] of [
    ["an uppercase .TOC", upperCaseTocZip],
    ["a mixed-case .Toc", mixedCaseTocZip],
  ] as const) {
    test(`${label} makes a folder installable`, async () => {
      const { result, addonsPath } = await installArchive(`rule-ok-${label.replace(/\W+/g, "")}`, zip, ["Foo"]);
      const { patch } = await result;
      expect(patch.installedFolderList).toEqual(["Foo"]);
      expect(existsSync(join(addonsPath, "Foo"))).toBe(true);
      expect(existsSync(join(addonsPath, ".wowdeck"))).toBe(false);
    });
  }

  for (const [label, zip] of [
    ["a TOC only nested below the folder", nestedOnlyTocZip],
    ["a directory named like a TOC", tocNamedDirectoryZip],
  ] as const) {
    test(`${label} is refused and the previous addon stays`, async () => {
      const seed = "## Title: Foo\n## Version: 0.9\n";
      const { result, addonsPath } = await installArchive(`rule-bad-${label.replace(/\W+/g, "")}`, zip, ["Foo"], seed);
      await expect(result).rejects.toThrow("The archive doesn't contain a valid addon");
      expect(readFileSync(join(addonsPath, "Foo", "Foo.toc"), "utf-8")).toBe(seed);
      expect(existsSync(join(addonsPath, ".wowdeck"))).toBe(false);
    });
  }

  test("no selectable folders is its own refusal", async () => {
    const { result, addonsPath } = await installArchive("rule-none", looseFileZip, ["Foo"]);
    await expect(result).rejects.toThrow("The archive doesn't contain an addon");
    expect(existsSync(join(addonsPath, ".wowdeck"))).toBe(false);
  });

  // Provider metadata may select only the addon folders of a mixed archive,
  // which From a file never does: its preview refuses the same archive.
  test("selecting only the addon folder of a mixed archive installs it, leaving the other folder out", async () => {
    const { result, addonsPath } = await installArchive("rule-select-addon", addonAndDocsZip, ["Foo"]);
    const { patch } = await result;
    expect(patch.installedFolderList).toEqual(["Foo"]);
    expect(existsSync(join(addonsPath, "Docs"))).toBe(false);
  });

  test("selecting every folder of a mixed archive refuses the folder without a TOC", async () => {
    const seed = "## Title: Foo\n## Version: 0.9\n";
    const { result, addonsPath } = await installArchive("rule-select-all", addonAndDocsZip, ["Foo", "Docs"], seed);
    await expect(result).rejects.toThrow("The archive doesn't contain a valid addon");
    expect(readFileSync(join(addonsPath, "Foo", "Foo.toc"), "utf-8")).toBe(seed);
    expect(existsSync(join(addonsPath, "Docs"))).toBe(false);
  });
});

describe("AddonInstaller: TOC metadata", () => {
  // The provider names the addon in every case below; the TOC's title would
  // only matter when it does not.
  const unnamed = { searchName: "" };

  test("an empty TOC installs; the record keeps the provider's file version and its own fields", async () => {
    const { result } = await installArchive("toc-empty", emptyTocZip, ["Foo"], undefined, {
      addon: { author: "Known Author", gameVersion: "10.0.0" },
    });
    const { patch } = await result;
    expect(patch).toMatchObject({
      installedFolderList: ["Foo"],
      installedVersion: "2.0",
      author: "Known Author",
      name: "TestAddon",
    });
    expect(patch.gameVersion).toBe("");
  });

  test("a TOC meant for another client is read anyway: no compatibility check, first-TOC fallback", async () => {
    const { result } = await installArchive("toc-other-client", otherClientTocZip, ["Foo"], undefined, unnamed);
    const { patch } = await result;
    expect(patch).toMatchObject({ name: "Foo Classic", installedVersion: "1.0", gameVersion: "110005" });
  });

  test("a client-specific TOC beats the generic one", async () => {
    const { result } = await installArchive("toc-priority", genericAndMainlineZip, ["Foo"], undefined, unnamed);
    const { patch } = await result;
    expect(patch).toMatchObject({ name: "Foo Mainline", installedVersion: "2.0", author: "Mainline Author" });
  });

  test("a bundle's metadata follows the planned order: the provider's list, the required folder first", async () => {
    const zetaFirst = await (await installArchive("toc-order-zeta", orderBundleZip, ["Zeta", "Alpha"])).result;
    expect(zetaFirst.patch.installedFolderList).toEqual(["Zeta", "Alpha"]);
    expect(zetaFirst.patch).toMatchObject({ installedVersion: "2.0", author: "Zeta Author" });

    const alphaFirst = await (await installArchive("toc-order-alpha", orderBundleZip, ["Alpha", "Zeta"])).result;
    expect(alphaFirst.patch.installedFolderList).toEqual(["Alpha", "Zeta"]);
    expect(alphaFirst.patch).toMatchObject({ installedVersion: "1.0", author: "Alpha Author" });

    const promoted = await (
      await installArchive("toc-order-required", orderBundleZip, ["Alpha", "Zeta"], undefined, {
        requiredFolder: "Zeta",
      })
    ).result;
    expect(promoted.patch.installedFolderList).toEqual(["Zeta", "Alpha"]);
    expect(promoted.patch).toMatchObject({ installedVersion: "2.0", author: "Zeta Author" });
  });

  test("a TOC that cannot be read after the swap does not fail the install and leaves no partial metadata", async () => {
    // Alpha reads fine and Zeta does not: nothing of Alpha's TOC may leak in.
    const restore = failTocReads("Zeta/Zeta.toc");
    try {
      const { result, addonsPath } = await installArchive("toc-read-fails", orderBundleZip, ["Alpha", "Zeta"], undefined, {
        addon: { author: "Known Author", gameVersion: "10.0.0", installedVersion: "0.5" },
        ...unnamed,
      });
      const { patch } = await result;
      expect(patch.installedFolderList).toEqual(["Alpha", "Zeta"]);
      expect(patch).toMatchObject({
        installedVersion: "2.0", // the provider's file version, not Alpha's 1.0
        author: "Known Author",
        gameVersion: "10.0.0",
        name: "Foo",
      });
      expect(existsSync(join(addonsPath, "Zeta", "Zeta.toc"))).toBe(true);
    } finally {
      restore();
    }
  });
});

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});
