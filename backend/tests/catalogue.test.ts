/**
 * The catalogue: search, Latest/Popular, details and source lookup, through
 * a provider registry of in-memory fake providers. No filesystem, no
 * network; each test builds its own registry.
 */

import { describe, expect, test } from "bun:test";
import { Catalogue } from "../src/wow/catalogue/Catalogue";
import { AddonProvider, type DiscoverList } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import type { AddonSearchResult, ProviderCategory, WowInstallation } from "../src/wow/models";
import type { Toc } from "../src/wow/toc/toc";
import { AddonChannelType, WowClientType, type AddonProviderType } from "../src/wow/types";

const installation: WowInstallation = {
  id: "inst",
  clientType: WowClientType.Retail,
  location: "/nowhere/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: true,
  defaultAddonChannelType: AddonChannelType.Stable,
  source: "detected",
};

interface Entry {
  id: string;
  name: string;
  folders: string[];
  downloads?: number;
  /** Fails a search for this name, after the provider has answered earlier queries. */
  failOn?: string;
  prerelease?: boolean;
  description?: string;
  changelog?: string;
}

function result(provider: AddonProviderType, e: Entry): AddonSearchResult {
  const file = (channelType: AddonChannelType, version: string, releaseDate: string) => ({
    externalId: `${e.id}-${version}`,
    channelType,
    version,
    folders: e.folders,
    gameVersion: "110005",
    downloadUrl: `https://example.invalid/${e.id}.zip`,
    releaseDate,
  });
  return {
    author: "someone",
    externalId: e.id,
    externalUrl: `https://example.invalid/${e.id}`,
    name: e.name,
    providerName: provider,
    downloadCount: e.downloads,
    files: [
      file(AddonChannelType.Stable, "1.0.0", "2026-06-01T00:00:00.000Z"),
      ...(e.prerelease ? [file(AddonChannelType.Beta, "1.1.0-beta", "2026-07-01T00:00:00.000Z")] : []),
    ],
  };
}

/** A provider answering from a fixed list: a search matches names containing the query. */
class FakeProvider extends AddonProvider {
  failure: Error | null = null;
  override allowChannelChange = true;
  /** The TOC field naming this provider's id, if any. */
  tocField: keyof Toc | null = null;

  constructor(
    name: AddonProviderType,
    public entries: Entry[],
  ) {
    super();
    this.name = name;
    this.enabled = true;
  }

  override async searchByQuery(query: string): Promise<AddonSearchResult[]> {
    if (this.failure || this.entries.some((e) => e.failOn === query)) {
      throw this.failure ?? new Error(`${this.name} broke on ${query}`);
    }
    return this.entries
      .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
      .map((e) => result(this.name, e));
  }

  override async getById(id: string): Promise<AddonSearchResult | undefined> {
    if (this.failure) {
      throw this.failure;
    }
    const entry = this.entries.find((e) => e.id === id);
    return entry && result(this.name, entry);
  }

  override isValidAddonId(id: string): boolean {
    return /^\d+$/.test(id);
  }

  override tocId(toc: Toc): string | undefined {
    return this.tocField ? (toc[this.tocField] as string | undefined) : undefined;
  }

  override async getDiscoverPage(list: DiscoverList, _installation: WowInstallation, offset: number, count: number) {
    const ordered = list === "popular" ? [...this.entries].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0)) : this.entries;
    return { results: ordered.slice(offset, offset + count).map((e) => result(this.name, e)), totalCount: ordered.length };
  }

  override async getDescription(id: string): Promise<string | undefined> {
    return this.entries.find((e) => e.id === id)?.description;
  }

  override async getChangelog(id: string): Promise<string | undefined> {
    return this.entries.find((e) => e.id === id)?.changelog;
  }

  override async getCategories(): Promise<ProviderCategory[] | undefined> {
    return this.categories;
  }

  categories: ProviderCategory[] | undefined = undefined;
}

/** A provider that resolves pasted addresses (GitHub): any query names its one addon. */
class UrlProvider extends FakeProvider {
  override catalogSearch = false;
  override async searchByQuery(): Promise<AddonSearchResult[]> {
    return this.entries.map((e) => result(this.name, e));
  }
}

function catalogueOf(...providers: AddonProvider[]): Catalogue {
  const registry = new ProviderRegistry();
  for (const provider of providers) {
    registry.register(provider);
  }
  return new Catalogue(registry);
}

describe("search", () => {
  test("merges every catalog provider's results by downloads; a failing one is reported, not fatal", async () => {
    const hub = new FakeProvider("WowUpHub", [
      { id: "1", name: "Bag Alpha", folders: ["BagA"], downloads: 10 },
      { id: "2", name: "Bag Beta", folders: ["BagB"], downloads: 300 },
    ]);
    const tukui = new FakeProvider("TukUI", [{ id: "3", name: "Bag Gamma", folders: ["BagG"], downloads: 50 }]);
    const curse = new FakeProvider("Curse", []);
    curse.failure = new Error("HTTP 403");

    const { results, providerErrors } = await catalogueOf(hub, tukui, curse).search("bag", installation);

    expect(results.map((r) => `${r.providerId}:${r.externalId}`)).toEqual(["WowUpHub:2", "TukUI:3", "WowUpHub:1"]);
    expect(providerErrors).toEqual([{ providerId: "Curse", error: "HTTP 403" }]);
  });
});

describe("search results", () => {
  test("show the installation's channel versions, with a choice only where the source has channels", async () => {
    const hub = new FakeProvider("WowUpHub", [
      { id: "750", name: "Chan", folders: ["Chan"], prerelease: true },
      { id: "751", name: "Chan Stable", folders: ["ChanStable"] },
    ]);
    const catalogue = catalogueOf(hub);
    expect((await catalogue.search("chan", installation)).results[0]).toMatchObject({
      latestVersion: "1.0.0",
      channel: "stable",
      channelReleases: [
        { channel: "stable", version: "1.0.0", fileChannel: "stable" },
        { channel: "beta", version: "1.1.0-beta", fileChannel: "beta" },
        { channel: "alpha", version: "1.1.0-beta", fileChannel: "beta" },
      ],
    });
    // No pre-release newer than stable: nothing to choose.
    expect((await catalogue.search("chan stable", installation)).results[0]!.channelReleases).toBeNull();
    const beta = { ...installation, defaultAddonChannelType: AddonChannelType.Beta };
    expect((await catalogue.search("chan", beta)).results[0]).toMatchObject({ latestVersion: "1.1.0-beta", channel: "beta" });

    hub.allowChannelChange = false;
    expect((await catalogue.search("chan", installation)).results[0]!.channelReleases).toBeNull();
  });

  test("a search of one source asks only it; a source turned off or not set up is not asked", async () => {
    const hub = new FakeProvider("WowUpHub", [{ id: "1", name: "Bag", folders: ["Bag"] }]);
    const tukui = new FakeProvider("TukUI", [{ id: "2", name: "Bag Too", folders: ["BagToo"] }]);
    const github = new UrlProvider("GitHub", [{ id: "a/Bag", name: "Bag", folders: ["Bag"] }]);
    const catalogue = catalogueOf(hub, tukui, github);
    // GitHub only resolves addresses; it is never in the name search.
    expect((await catalogue.search("bag", installation)).results.map((r) => r.providerId).sort()).toEqual(["TukUI", "WowUpHub"]);
    expect((await catalogue.search("bag", installation, "TukUI")).results.map((r) => r.externalId)).toEqual(["2"]);
    expect(await catalogue.search("   ", installation)).toEqual({ results: [], providerErrors: [] });

    tukui.isConfigured = () => false;
    expect(await catalogue.search("bag", installation, "TukUI")).toEqual({ results: [], providerErrors: [] });
    hub.enabled = false;
    expect((await catalogue.search("bag", installation)).results).toEqual([]);
  });
});

describe("findSources", () => {
  const toc = (fields: Partial<Toc>): Toc => ({ fileName: "x.toc", filePath: "/x.toc", interface: ["110005"], dependencyList: [], ...fields });

  test("keeps releases that install the folder: exact name first, then downloads", async () => {
    const hub = new FakeProvider("WowUpHub", [
      { id: "501", name: "Zeta Frames", folders: ["Zeta"], downloads: 900 },
      { id: "502", name: "Zeta Frames Classic", folders: ["ZetaClassic"], downloads: 5000 },
      { id: "503", name: "Zeta", folders: ["Zeta", "ZetaLib"], downloads: 1 },
      { id: "504", name: "Zeta Frames Plus", folders: ["Zeta"], downloads: 50 },
    ]);
    const { results, providerErrors } = await catalogueOf(hub).findSources({
      installation,
      folderName: "Zeta",
      toc: toc({ title: "Zeta Frames" }),
      queries: ["Zeta Frames", "Zeta"],
    });
    expect(providerErrors).toEqual([]);
    // 502 installs another folder; 501 and 503 match a query by name exactly.
    expect(results.map((r) => r.externalId)).toEqual(["501", "503", "504"]);
  });

  test("the addon the TOC names by id comes first; the addon's own provider is left out", async () => {
    const hub = new FakeProvider("WowUpHub", [{ id: "501", name: "Zeta", folders: ["Zeta"], downloads: 900 }]);
    const tukui = new FakeProvider("TukUI", [
      { id: "601", name: "Zeta", folders: ["Zeta", "ZetaLib"], downloads: 10 },
      // Named only by the TOC's X-Tukui-ProjectID: no search finds it.
      { id: "602", name: "Reborn", folders: ["Zeta"], downloads: 1 },
    ]);
    tukui.tocField = "tukUiProjectId";
    const { results } = await catalogueOf(hub, tukui).findSources({
      installation,
      folderName: "Zeta",
      toc: toc({ title: "Zeta", tukUiProjectId: "602" }),
      queries: ["Zeta"],
      ownProvider: "WowUpHub",
    });
    expect(results.map((r) => `${r.providerId}:${r.externalId}`)).toEqual(["TukUI:602", "TukUI:601"]);
  });

  test("a release listing no folders may install it (WoWInterface); the installer checks its archive", async () => {
    const wowi = new FakeProvider("WowInterface", [
      { id: "605", name: "Zeta Unlisted", folders: [] },
      { id: "606", name: "Zeta Elsewhere", folders: ["ZetaClassic"] },
    ]);
    const { results } = await catalogueOf(wowi).findSources({ installation, folderName: "Zeta", toc: undefined, queries: ["Zeta"] });
    expect(results.map((r) => r.externalId)).toEqual(["605"]);
  });

  test("a provider failing on a later name keeps what it found for the earlier ones, and is reported", async () => {
    const hub = new FakeProvider("WowUpHub", [
      { id: "501", name: "Zeta Frames", folders: ["Zeta"] },
      { id: "0", name: "Broken", folders: [], failOn: "Zeta" },
    ]);
    const { results, providerErrors } = await catalogueOf(hub).findSources({
      installation,
      folderName: "Zeta",
      toc: undefined,
      queries: ["Zeta Frames", "Zeta"],
    });
    expect(results.map((r) => r.externalId)).toEqual(["501"]);
    expect(providerErrors).toEqual([{ providerId: "WowUpHub", error: "WowUpHub broke on Zeta" }]);
  });

  test("a provider failing its TOC-id lookup is reported beside the others' results", async () => {
    const hub = new FakeProvider("WowUpHub", [{ id: "501", name: "Zeta", folders: ["Zeta"] }]);
    const tukui = new FakeProvider("TukUI", []);
    tukui.tocField = "tukUiProjectId";
    tukui.catalogSearch = false;
    tukui.failure = new Error("TukUI down");
    const { results, providerErrors } = await catalogueOf(hub, tukui).findSources({
      installation,
      folderName: "Zeta",
      toc: toc({ tukUiProjectId: "602" }),
      queries: ["Zeta"],
    });
    expect(results.map((r) => r.externalId)).toEqual(["501"]);
    expect(providerErrors).toEqual([{ providerId: "TukUI", error: "TukUI down" }]);
  });
});

describe("Latest and Popular", () => {
  test("a page of one source's list, in its order", async () => {
    const hub = new FakeProvider("WowUpHub", [
      { id: "1", name: "One", folders: ["One"], downloads: 5 },
      { id: "2", name: "Two", folders: ["Two"], downloads: 50 },
      { id: "3", name: "Three", folders: ["Three"], downloads: 500 },
    ]);
    hub.discovers = true;
    const catalogue = catalogueOf(hub);
    const popular = await catalogue.discover("popular", "WowUpHub", installation, 0, 2);
    expect(popular.results.map((r) => r.name)).toEqual(["Three", "Two"]);
    expect(popular.totalCount).toBe(3);
    expect((await catalogue.discover("latest", "WowUpHub", installation, 2, 2)).results.map((r) => r.name)).toEqual(["Three"]);
  });

  test("a source without the lists, turned off or unknown says to turn it on", async () => {
    const tukui = new FakeProvider("TukUI", []);
    const hub = new FakeProvider("WowUpHub", []);
    hub.discovers = true;
    hub.enabled = false;
    const catalogue = catalogueOf(tukui, hub);
    for (const providerId of ["TukUI", "WowUpHub", "Curse"]) {
      await expect(catalogue.discover("latest", providerId, installation, 0, 5)).rejects.toThrow(/isn't available/);
    }
  });
});

describe("addon details", () => {
  test("description, changelog and categories pass through; unsupported is null; an unknown source throws", async () => {
    const curse = new FakeProvider("Curse", [{ id: "7", name: "Seven", folders: ["Seven"], description: "<p>Hi</p>", changelog: "Fixed" }]);
    curse.categories = [{ id: "1019", name: "Combat" }];
    const hub = new FakeProvider("WowUpHub", [{ id: "8", name: "Eight", folders: ["Eight"] }]);
    const catalogue = catalogueOf(curse, hub);

    expect(await catalogue.getDescription("Curse", "7")).toBe("<p>Hi</p>");
    expect(await catalogue.getChangelog("Curse", "7", installation)).toBe("Fixed");
    expect(await catalogue.getCategories("Curse", installation)).toEqual([{ id: "1019", name: "Combat" }]);

    expect(await catalogue.getDescription("WowUpHub", "8")).toBeNull();
    expect(await catalogue.getChangelog("WowUpHub", "8", installation)).toBeNull();
    expect(await catalogue.getCategories("WowUpHub", installation)).toBeNull();

    await expect(catalogue.getDescription("NoSuch", "1")).rejects.toThrow();
    await expect(catalogue.getChangelog("NoSuch", "1", installation)).rejects.toThrow();
    await expect(catalogue.getCategories("NoSuch", installation)).rejects.toThrow();
  });
});

describe("Install from URL", () => {
  test("resolves an address through its source, also while that source is off", async () => {
    const github = new UrlProvider("GitHub", [{ id: "author/Addon", name: "Addon", folders: ["Addon"] }]);
    github.enabled = false;
    const result = await catalogueOf(github).resolveUrlImport("  https://github.com/author/Addon  ", installation);
    expect(result).toMatchObject({ providerId: "GitHub", externalId: "author/Addon", name: "Addon" });
  });

  test("refuses a blank entry, an address no source resolves, and an address with nothing behind it", async () => {
    const catalogue = catalogueOf(new UrlProvider("GitHub", []));
    await expect(catalogue.resolveUrlImport("   ", installation)).rejects.toThrow(/enter a url/i);
    await expect(catalogue.resolveUrlImport("https://www.curseforge.com/wow/addons/x", installation)).rejects.toThrow(
      /isn't a GitHub or WoWInterface address/,
    );
    await expect(catalogue.resolveUrlImport("https://github.com/author/Gone", installation)).rejects.toThrow(/no addon was found/i);
  });
});
