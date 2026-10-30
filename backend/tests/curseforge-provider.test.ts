/**
 * CurseForge provider tests (deterministic, network-free). Fixture shapes
 * follow the CurseForge Core API v2 wire format as consumed by WowUp's
 * curse-addon-provider.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  CurseForgeProvider,
  gameVersionTypeIdFor,
} from "../src/wow/providers/curseforge/CurseForgeProvider";
import type { CfAddon, CfFile } from "../src/wow/providers/curseforge/curseforge-models";
import { NetworkClient, NetworkError as NetworkErrorClass } from "../src/wow/net/network";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonChannelType, WowClientType } from "../src/wow/types";
import type { AddonFolder, WowInstallation } from "../src/wow/models";
import { scannedAddonRecord } from "../src/wow/addons/AddonService";

const ROOT = "/tmp/opencode/wowdeck-tests/curseforge";

function cfFile(over: Partial<CfFile> & Pick<CfFile, "id">): CfFile {
  return {
    displayName: `file-${over.id}`,
    downloadUrl: `https://mediafilez.example/${over.id}.zip`,
    fileDate: "2026-09-01T00:00:00.000Z",
    releaseType: 1,
    gameVersions: ["11.0.2"],
    sortableGameVersions: [{ gameVersionTypeId: 517, name: "Retail" }],
    modules: [{ foldername: "MockAddon", name: "MockAddon" }],
    ...over,
  };
}

function cfAddon(over: Partial<CfAddon> & Pick<CfAddon, "id" | "name">): CfAddon {
  return {
    slug: over.name?.toLowerCase() ?? "mock",
    summary: "mock summary",
    downloadCount: 1000,
    links: { websiteUrl: "https://www.curseforge.com/wow/addons/mock" },
    logo: { thumbnailUrl: "https://img.example/t.png" },
    authors: [{ id: 1, name: "MockAuthor" }, { id: 2, name: "_ForgeUser123" }],
    latestFiles: [cfFile({ id: over.id! * 100 })],
    ...over,
  };
}

const retail: WowInstallation = {
  id: "retail",
  clientType: WowClientType.Retail,
  location: "/x/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};
const era: WowInstallation = {
  ...retail,
  id: "era",
  clientType: WowClientType.ClassicEra,
  location: "/x/_classic_era_",
  label: "_classic_era_",
};

interface Recorded {
  gets: string[];
  posts: Array<{ url: string; body: unknown }>;
}

function fakeNet(responses: {
  search?: Record<string, CfAddon[]>;
  mod?: Record<string, CfAddon>;
  mods?: CfAddon[];
  /** Stubs GET /mods/{id}/files — checked before the /mods/{id} prefix match. */
  files?: Record<string, CfFile[]>;
  /** Throw instead of resolving for /mods/{id}/files, to test the fallback path. */
  filesError?: boolean;
}): { net: NetworkClient; recorded: Recorded } {
  const recorded: Recorded = { gets: [], posts: [] };
  const net = {
    getJson: async <T>(url: string | URL, opts?: { query?: Record<string, string> }): Promise<T> => {
      const full = `${url}${opts?.query ? "?" + new URLSearchParams(opts.query).toString() : ""}`;
      recorded.gets.push(full);
      const key = Object.keys(responses.search ?? {}).find((k) => full.includes(k));
      if (key && full.includes("/mods/search")) {
        return { data: responses.search![key]! } as T;
      }
      const filesMatch = Object.keys(responses.files ?? {}).find((k) => full.includes(`/mods/${k}/files`));
      if (full.includes("/files") && (filesMatch || responses.filesError)) {
        if (responses.filesError) {
          throw new Error("files endpoint down");
        }
        return { data: responses.files![filesMatch!]!, pagination: { index: 0, pageSize: 50, resultCount: responses.files![filesMatch!]!.length, totalCount: responses.files![filesMatch!]!.length } } as T;
      }
      const modMatch = Object.keys(responses.mod ?? {}).find((k) => full.includes(`/mods/${k}`) && !full.includes("/files"));
      if (modMatch) {
        return { data: responses.mod![modMatch]! } as T;
      }
      throw new Error(`unexpected GET ${full}`);
    },
    postJson: async <T>(url: string | URL, opts?: { body?: unknown }): Promise<T> => {
      recorded.posts.push({ url: String(url), body: opts?.body });
      if (String(url).endsWith("/mods")) {
        return { data: responses.mods ?? [] } as T;
      }
      throw new Error(`unexpected POST ${url}`);
    },
  } as unknown as NetworkClient;
  return { net, recorded };
}

let key = "test-key-123";

describe("CurseForge provider", () => {
  test("gameVersionTypeId mapping matches upstream GAME_TYPE_LISTS", () => {
    expect(gameVersionTypeIdFor(WowClientType.Retail)).toBe(517);
    expect(gameVersionTypeIdFor(WowClientType.Beta)).toBe(517);
    expect(gameVersionTypeIdFor(WowClientType.RetailPtr)).toBe(517);
    expect(gameVersionTypeIdFor(WowClientType.ClassicEra)).toBe(67408);
    expect(gameVersionTypeIdFor(WowClientType.ClassicEraPtr)).toBe(67408);
    expect(gameVersionTypeIdFor(WowClientType.Classic)).toBe(79434);
    expect(gameVersionTypeIdFor(WowClientType.ClassicPtr)).toBe(79434);
    expect(gameVersionTypeIdFor(WowClientType.Anniversary)).toBe(73246);
  });

  // The beta slot (_classic_beta_) is not Mists — verified live against
  // CurseForge's /v1/games/1/version-types. See docs/wow-client-identity.md.
  test("ClassicBeta maps to CurseForge's 'WoW Forever' category, not Mists", () => {
    expect(gameVersionTypeIdFor(WowClientType.ClassicBeta)).toBe(88568);
    expect(gameVersionTypeIdFor(WowClientType.ClassicBeta)).not.toBe(gameVersionTypeIdFor(WowClientType.Classic));
  });

  test("Forever shares Forever Beta's 'WoW Forever' category", () => {
    expect(gameVersionTypeIdFor(WowClientType.Forever)).toBe(88568);
  });

  test("search is scoped by gameVersionTypeId and filters files", async () => {
    const questie = cfAddon({
      id: 3194,
      name: "Questie",
      latestFiles: [
        cfFile({ id: 900, sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }] }),
        // alternative-enum files are excluded
        cfFile({ id: 901, exposeAsAlternative: true, sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }] }),
      ],
    });
    const { net, recorded } = fakeNet({ search: { "searchFilter=questie": [questie] } });
    const provider = new CurseForgeProvider(net, () => key);

    const results = await provider.searchByQuery("questie", era);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Questie");
    expect(results[0]!.files).toHaveLength(1);
    expect(results[0]!.author).toBe("MockAuthor"); // _ForgeUser filtered
    // the request carried the gameVersionTypeId + api key header
    expect(recorded.gets[0]).toContain("gameVersionTypeId=67408");
    expect(recorded.gets[0]).toContain("sortField=1");
  });

  test("files without sortableGameVersions are incompatible (upstream semantics)", async () => {
    const addon = cfAddon({
      id: 1,
      name: "Legacy",
      latestFiles: [cfFile({ id: 10, sortableGameVersions: [] })],
    });
    const { net } = fakeNet({ search: { "searchFilter=legacy": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    expect(await provider.searchByQuery("legacy", retail)).toEqual([]);
  });

  test("stable channel sorts first regardless of file id", async () => {
    const addon = cfAddon({
      id: 2,
      name: "Channels",
      latestFiles: [
        cfFile({ id: 300, releaseType: 3 }), // alpha, newer id
        cfFile({ id: 200, releaseType: 1 }), // stable
        cfFile({ id: 100, releaseType: 2 }), // beta
      ],
    });
    const { net } = fakeNet({ mod: { "2": addon } });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("2", retail);
    expect(result!.files![0]!.version).toBe("file-200"); // newest stable
    expect(result!.files!.map((f) => f.channelType)).toEqual([
      AddonChannelType.Stable,
      AddonChannelType.Beta,
      AddonChannelType.Alpha,
    ]);
  });

  // The official API returns `downloadUrl: null` for a file when the API
  // key (or the mod) isn't granted third-party distribution, even though
  // the file is otherwise perfectly real and installable — CurseForge's
  // own website still serves it to an anonymous visitor at a separate,
  // unauthenticated endpoint. Falling back to that is what actually lets
  // an install succeed in that case.
  test("falls back to the unauthenticated website download URL when the API's downloadUrl is null", async () => {
    const addon = cfAddon({
      id: 46,
      name: "NoDistributionGrant",
      latestFiles: [cfFile({ id: 4601, downloadUrl: null })],
    });
    const { net } = fakeNet({ mod: { "46": addon } });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("46", retail);
    expect(result!.files![0]!.downloadUrl).toBe(
      "https://www.curseforge.com/api/v1/mods/46/files/4601/download",
    );
  });

  test("keeps the official downloadUrl when the API actually provides one", async () => {
    const addon = cfAddon({ id: 47, name: "NormalGrant", latestFiles: [cfFile({ id: 4701 })] });
    const { net } = fakeNet({ mod: { "47": addon } });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("47", retail);
    expect(result!.files![0]!.downloadUrl).toBe("https://mediafilez.example/4701.zip");
  });

  // getById must prefer the authoritative /mods/{id}/files list over
  // the mod object's latestFiles snapshot, which can lag behind for
  // addons that publish many files a day.
  test("getById picks the newer file from the authoritative files list over a stale latestFiles snapshot", async () => {
    const addon = cfAddon({
      id: 42,
      name: "ControllerForever",
      latestFiles: [cfFile({ id: 100, displayName: "3.9.25" })], // stale snapshot
    });
    const { net } = fakeNet({
      mod: { "42": addon },
      files: {
        "42": [
          cfFile({ id: 101, displayName: "3.9.26" }), // authoritative: newer file exists
          cfFile({ id: 100, displayName: "3.9.25" }),
        ],
      },
    });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("42", retail);
    expect(result!.files![0]!.externalId).toBe("101");
    expect(result!.files![0]!.version).toBe("3.9.26");
  });

  test("getById sorts correctly regardless of the files endpoint's own ordering (oldest-first)", async () => {
    const addon = cfAddon({ id: 44, name: "OldestFirst", latestFiles: [] });
    const { net } = fakeNet({
      mod: { "44": addon },
      files: {
        "44": [
          cfFile({ id: 100, displayName: "1.0.0" }),
          cfFile({ id: 102, displayName: "1.0.2" }),
          cfFile({ id: 101, displayName: "1.0.1" }),
        ],
      },
    });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("44", retail);
    expect(result!.files![0]!.externalId).toBe("102");
  });

  test("getById skips a newer-but-incompatible file in favor of the newest compatible one", async () => {
    const addon = cfAddon({ id: 45, name: "MixedCompat", latestFiles: [] });
    const { net } = fakeNet({
      mod: { "45": addon },
      files: {
        "45": [
          cfFile({ id: 200, displayName: "classic-only", sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }] }),
          cfFile({ id: 199, displayName: "retail-compatible" }), // default sgv is Retail (517)
        ],
      },
    });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("45", retail); // retail client
    expect(result!.files![0]!.externalId).toBe("199");
    expect(result!.files![0]!.version).toBe("retail-compatible");
  });

  test("getById falls back to the latestFiles snapshot if the files endpoint fails", async () => {
    const addon = cfAddon({
      id: 43,
      name: "FallbackCase",
      latestFiles: [cfFile({ id: 200, displayName: "1.0.0" })],
    });
    const { net } = fakeNet({ mod: { "43": addon }, filesError: true });
    const provider = new CurseForgeProvider(net, () => key);
    const result = await provider.getById("43", retail);
    expect(result!.files![0]!.externalId).toBe("200");
  });

  // sortField/pagination plumbing.
  test("getLatestAddons requests sortField=3 (LastUpdated) with real pagination params", async () => {
    const addon = cfAddon({ id: 50, name: "LatestOne" });
    const { net, recorded } = fakeNet({ search: { "sortField=3": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    const { results, pagination } = await provider.getLatestAddons(retail, 5, 10);
    expect(results).toHaveLength(1);
    expect(recorded.gets[0]).toContain("sortField=3");
    expect(recorded.gets[0]).toContain("index=5");
    expect(recorded.gets[0]).toContain("pageSize=10");
    expect(pagination.resultCount).toBe(1);
  });

  test("getPopularAddons requests sortField=2 (Popularity)", async () => {
    const addon = cfAddon({ id: 51, name: "PopularOne" });
    const { net, recorded } = fakeNet({ search: { "sortField=2": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    const { results } = await provider.getPopularAddons(retail, 0, 5);
    expect(results).toHaveLength(1);
    expect(recorded.gets[0]).toContain("sortField=2");
  });

  // categoryId passed through to the search request, popularity
  // sorting remaining active alongside it.
  test("getPopularAddons passes categoryId through while keeping sortField=2", async () => {
    const addon = cfAddon({ id: 59, name: "CategoryScopedPopular" });
    const { net, recorded } = fakeNet({ search: { "sortField=2": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    const { results } = await provider.getPopularAddons(retail, 0, 5, "1019");
    expect(results).toHaveLength(1);
    expect(recorded.gets[0]).toContain("sortField=2");
    expect(recorded.gets[0]).toContain("categoryId=1019");
  });

  test("getPopularAddons omits categoryId entirely for All Categories", async () => {
    const addon = cfAddon({ id: 58, name: "AllCategoriesPopular" });
    const { net, recorded } = fakeNet({ search: { "sortField=2": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    await provider.getPopularAddons(retail, 0, 5);
    expect(recorded.gets[0]).not.toContain("categoryId");
  });

  // Category retrieval.
  test("getCategories fetches gameId=1/classId=1, keeps only top-level categories, sorted by name", async () => {
    const net = {
      getJson: async <T>(url: string | URL, opts?: { query?: Record<string, string> }) => {
        expect(String(url)).toContain("/categories");
        expect(opts?.query).toEqual({ gameId: "1", classId: "1" });
        return {
          data: [
            { id: 1020, gameId: 1, name: "Class", slug: "class", parentCategoryId: 1 },
            { id: 1028, gameId: 1, name: "Warrior", slug: "warrior", parentCategoryId: 1020 }, // sub-category — excluded
            { id: 1019, gameId: 1, name: "Combat", slug: "combat", parentCategoryId: 1 },
          ],
        } as T;
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    const categories = await provider.getCategories(retail);
    expect(categories).toEqual([
      { id: "1020", name: "Class" },
      { id: "1019", name: "Combat" },
    ]);
  });

  test("getCategories returns an empty array (not undefined/error) when CurseForge genuinely has none", async () => {
    const net = {
      getJson: async <T>() => ({ data: [] }) as T,
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    expect(await provider.getCategories(retail)).toEqual([]);
  });

  test("getCategories propagates an HTTP/network error instead of resolving empty", async () => {
    const net = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 500", 500, "x");
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    await expect(provider.getCategories(retail)).rejects.toThrow(/500/);
  });

  test("getCategories caches after the first successful fetch", async () => {
    let calls = 0;
    const net = {
      getJson: async <T>() => {
        calls++;
        return { data: [{ id: 1019, gameId: 1, name: "Combat", slug: "combat", parentCategoryId: 1 }] } as T;
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    await provider.getCategories(retail);
    await provider.getCategories(retail);
    expect(calls).toBe(1);
  });


  // Details modal Description/Changelog/Gallery.
  test("getDescription fetches /mods/{id}/description", async () => {
    const net = {
      getJson: async <T>(url: string) => {
        expect(String(url)).toContain("/mods/77/description");
        return { data: "<p>Hello</p>" } as T;
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    // Returned raw, not flattened to plain text — the frontend has a
    // real sanitizing HTML/Markdown renderer (src/markdown.ts) to
    // render this richly instead.
    expect(await provider.getDescription("77")).toBe("<p>Hello</p>");
  });

  test("getDescription returns empty string (not an error) when CurseForge has none", async () => {
    const net = {
      getJson: async <T>() => ({ data: "" }) as T,
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    expect(await provider.getDescription("77")).toBe("");
  });

  test("getDescription propagates HTTP errors instead of resolving empty", async () => {
    const net = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 500", 500, "x");
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => key);
    await expect(provider.getDescription("77")).rejects.toThrow(/500/);
  });

  test("getChangelog resolves the latest compatible file id, then fetches its changelog", async () => {
    const addon = cfAddon({ id: 60, name: "ChangelogAddon", latestFiles: [] });
    const { net } = fakeNet({
      mod: { "60": addon },
      files: { "60": [cfFile({ id: 601, displayName: "2.0.0" })] },
    });
    const originalGetJson = net.getJson.bind(net) as (url: string, opts?: unknown) => Promise<unknown>;
    const spiedNet = {
      ...net,
      getJson: async <T>(url: string, opts?: { query?: Record<string, string> }) => {
        if (url.includes("/changelog")) {
          expect(url).toContain("/mods/60/files/601/changelog");
          return { data: "- fixed stuff" } as T;
        }
        return originalGetJson(url, opts) as Promise<T>;
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(spiedNet, () => key);
    expect(await provider.getChangelog("60", retail)).toBe("## 2.0.0\n\n_Release · 2026-09-01_\n\n- fixed stuff");
  });

  test("getChangelog composes only the most recent files, newest first, not stable-first", async () => {
    const addon = cfAddon({ id: 63, name: "ManyReleases", latestFiles: [] });
    const { net } = fakeNet({
      mod: { "63": addon },
      files: {
        "63": [
          cfFile({ id: 631, displayName: "1.0.0", fileDate: "2026-01-01T00:00:00.000Z" }),
          cfFile({ id: 632, displayName: "1.1.0", fileDate: "2026-02-01T00:00:00.000Z" }),
          cfFile({ id: 633, displayName: "1.2.0-beta", releaseType: 2, fileDate: "2026-03-01T00:00:00.000Z" }),
          cfFile({ id: 634, displayName: "1.2.0", fileDate: "2026-04-01T00:00:00.000Z" }),
        ],
      },
    });
    const originalGetJson = net.getJson.bind(net) as (url: string, opts?: unknown) => Promise<unknown>;
    const changelogUrls: string[] = [];
    const spiedNet = {
      ...net,
      getJson: async <T>(url: string, opts?: { query?: Record<string, string> }) => {
        const match = /\/files\/(\d+)\/changelog/.exec(url);
        if (match) {
          changelogUrls.push(url);
          return { data: `notes for ${match[1]}` } as T;
        }
        return originalGetJson(url, opts) as Promise<T>;
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(spiedNet, () => key);
    const text = (await provider.getChangelog("63", retail))!;
    expect(changelogUrls).toHaveLength(3);
    expect(changelogUrls.some((u) => u.includes("/files/631/"))).toBe(false);
    expect(text.indexOf("## 1.2.0\n")).toBeLessThan(text.indexOf("## 1.2.0-beta"));
    expect(text.indexOf("## 1.2.0-beta")).toBeLessThan(text.indexOf("## 1.1.0"));
    expect(text).toContain("_Beta · 2026-03-01_");
    expect(text).toContain("notes for 634");
    expect(text).not.toContain("## 1.0.0");
  });

  test("getChangelog returns empty string when the addon has no resolvable file", async () => {
    const addon = cfAddon({ id: 61, name: "NoFiles", latestFiles: [] });
    const { net } = fakeNet({ mod: { "61": addon }, filesError: true });
    const provider = new CurseForgeProvider(net, () => key);
    expect(await provider.getChangelog("61", retail)).toBe("");
  });

  test("toSearchResult maps screenshots for the Details modal Gallery", async () => {
    const addon = cfAddon({
      id: 62,
      name: "GalleryAddon",
      screenshots: [{ url: "https://img.example/full.png", thumbnailUrl: "https://img.example/thumb.png", title: "Screenshot 1" }],
    });
    const { net } = fakeNet({ search: { "searchFilter=gallery": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    const results = await provider.searchByQuery("gallery", retail);
    expect(results[0]!.screenshots).toEqual([
      { url: "https://img.example/full.png", thumbnailUrl: "https://img.example/thumb.png", title: "Screenshot 1" },
    ]);
  });

  test("toSearchResult defaults screenshots to an empty array when absent", async () => {
    const addon = cfAddon({ id: 63, name: "NoGallery" });
    const { net } = fakeNet({ search: { "searchFilter=nogallery": [addon] } });
    const provider = new CurseForgeProvider(net, () => key);
    const results = await provider.searchByQuery("nogallery", retail);
    expect(results[0]!.screenshots).toEqual([]);
  });

  test("getAll batches ids and reports removed addons", async () => {
    const addon = cfAddon({ id: 5, name: "Five" });
    const { net, recorded } = fakeNet({ mods: [addon] });
    const provider = new CurseForgeProvider(net, () => key);
    const { searchResults, errors } = await provider.getAll(retail, ["5", "6"]);
    expect(searchResults.map((r) => r.externalId)).toEqual(["5"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error & { code?: string }).code).toBe("source_removed");
    expect(recorded.posts[0]!.body).toEqual({ modIds: [5, 6] });
  });

  test("scan matches folders by TOC curse project id", async () => {
    const addon = cfAddon({
      id: 3194,
      name: "Questie",
      latestFiles: [
        cfFile({
          id: 900,
          modules: [{ foldername: "Questie", name: "Questie" }],
          sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }],
        }),
      ],
    });
    const { net } = fakeNet({ mods: [addon] });
    const provider = new CurseForgeProvider(net, () => key);

    const dir = join(ROOT, "Questie");
    mkdirSync(join(dir, "Questie"), { recursive: true });
    writeFileSync(
      join(dir, "Questie", "Questie.toc"),
      "## Title: Questie\n## Version: 10.0.0\n## Interface: 11505\n## X-Curse-Project-ID: 3194\n",
    );
    void readFileSync;
    const folder: AddonFolder = {
      name: "Questie",
      path: join(dir, "Questie"),
      tocs: [],
      loadOnDemand: false,
      fileStats: undefined,
    } as unknown as AddonFolder;
    // minimal toc shape the scanner normally produces
    folder.tocs = [
      {
        fileName: "Questie.toc",
        filePath: join(dir, "Questie", "Questie.toc"),
        interface: [11505],
        title: "Questie",
        version: "10.0.0",
        curseProjectId: "3194",
        loadOnDemand: undefined,
      },
    ] as never;

    const match = (await provider.scan(era, [folder])).get("Questie");
    expect(match?.addon.providerName).toBe("Curse");
    expect(match?.addon.externalId).toBe("3194");
    expect(match?.latestFile.version).toBe("file-900");
    expect(scannedAddonRecord(match!, era, [folder], folder.tocs[0])).toMatchObject({
      isIgnored: false,
      isLoadOnDemand: false,
      channelType: 0,
      latestVersion: "file-900",
    }); // RF-08: shared record defaults
  });

  // CurseForge matches by TOC project id only (no fingerprint, no
  // exact-file evidence) — scan() must recover installedExternalReleaseId
  // from the file whose version string equals what's actually in the TOC,
  // not just assume files[0] is installed. Otherwise a freshly-matched
  // unmanaged addon reports a permanent false update the instant it's
  // scanned, even when the installed file genuinely is the latest.
  test("scan match recovers installedExternalReleaseId when the TOC version is the latest file", async () => {
    const addon = cfAddon({
      id: 4001,
      name: "UpToDateAddon",
      latestFiles: [cfFile({ id: 500, displayName: "2.0.1", sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }], modules: [{ foldername: "UpToDateAddon", name: "UpToDateAddon" }] })],
    });
    const { net } = fakeNet({ mods: [addon] });
    const provider = new CurseForgeProvider(net, () => key);

    const dir = join(ROOT, "UpToDateAddon");
    mkdirSync(join(dir, "UpToDateAddon"), { recursive: true });
    const folder: AddonFolder = {
      name: "UpToDateAddon",
      path: join(dir, "UpToDateAddon"),
      tocs: [
        {
          fileName: "UpToDateAddon.toc",
          filePath: join(dir, "UpToDateAddon", "UpToDateAddon.toc"),
          interface: [11505],
          title: "UpToDateAddon",
          version: "2.0.1",
          curseProjectId: "4001",
          loadOnDemand: undefined,
        },
      ],
      loadOnDemand: false,
      fileStats: undefined,
    } as unknown as AddonFolder;

    const matched = scannedAddonRecord((await provider.scan(era, [folder])).get("UpToDateAddon")!, era, [folder], folder.tocs[0]);
    expect(matched.installedExternalReleaseId).toBe("500");
    expect(matched.externalLatestReleaseId).toBe("500");
    const { needsUpdate } = await import("../src/wow/addons/addonStatus");
    expect(needsUpdate(matched)).toBe(false);
  });

  // Seen on a Deck: Details has the id in Details.toc but not in the TOC the
  // era client loads. Its undefined id became NaN in the batch, CurseForge
  // answered 400 and no folder of the installation was matched.
  test("scan skips a folder whose flavor TOC has no project id, and still matches the rest", async () => {
    const addon = cfAddon({
      id: 4003,
      name: "Matched",
      latestFiles: [cfFile({ id: 700, sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }] })],
    });
    const { net, recorded } = fakeNet({ mods: [addon] });
    const provider = new CurseForgeProvider(net, () => key);
    const toc = (fileName: string, curseProjectId?: string) => ({ fileName, filePath: `/x/${fileName}`, interface: [11505], dependencyList: [], curseProjectId });
    const folders = [
      { name: "Details", path: "/x/Details", status: "", tocs: [toc("Details.toc", "61284"), toc("Details_Vanilla.toc")] },
      { name: "Matched", path: "/x/Matched", status: "", tocs: [toc("Matched.toc", "4003")] },
    ] as unknown as AddonFolder[];

    const matches = await provider.scan(era, folders);
    expect(recorded.posts.map((p) => p.body)).toEqual([{ modIds: [4003] }]);
    expect([...matches.keys()]).toEqual(["Matched"]);
  });

  test("scan match with no recognizable installed file falls back to the version-string heuristic", async () => {
    const addon = cfAddon({
      id: 4002,
      name: "StaleAddon",
      latestFiles: [cfFile({ id: 600, displayName: "3.0.0", sortableGameVersions: [{ gameVersionTypeId: 67408, name: "Classic" }], modules: [{ foldername: "StaleAddon", name: "StaleAddon" }] })],
    });
    const { net } = fakeNet({ mods: [addon] });
    const provider = new CurseForgeProvider(net, () => key);

    const dir = join(ROOT, "StaleAddon");
    mkdirSync(join(dir, "StaleAddon"), { recursive: true });
    const folder: AddonFolder = {
      name: "StaleAddon",
      path: join(dir, "StaleAddon"),
      tocs: [
        {
          fileName: "StaleAddon.toc",
          filePath: join(dir, "StaleAddon", "StaleAddon.toc"),
          interface: [11505],
          title: "StaleAddon",
          version: "1.0.0", // not in latestFiles — genuinely outdated
          curseProjectId: "4002",
          loadOnDemand: undefined,
        },
      ],
      loadOnDemand: false,
      fileStats: undefined,
    } as unknown as AddonFolder;

    const matched = scannedAddonRecord((await provider.scan(era, [folder])).get("StaleAddon")!, era, [folder], folder.tocs[0]);
    expect(matched.installedExternalReleaseId).toBeUndefined();
    const { needsUpdate } = await import("../src/wow/addons/addonStatus");
    expect(needsUpdate(matched)).toBe(true);
  });

  test("missing key fails loudly and download auth is absent", async () => {
    const { net } = fakeNet({});
    const provider = new CurseForgeProvider(net, () => undefined);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.searchByQuery("x", retail)).rejects.toThrow(/CurseForge isn't available/i);
    expect(await provider.getDownloadAuth()).toBeUndefined();
  });

  test("download auth carries the api key and the trusted-host allowlist", async () => {
    const { net } = fakeNet({});
    const provider = new CurseForgeProvider(net, () => key);
    expect(await provider.getDownloadAuth()).toEqual({
      headers: { "X-Api-Key": "test-key-123" },
      trustedHostsForHeaders: ["api.curseforge.com", "forgecdn.net", "curseforge.com"],
    });
  });

  test("testApiKey: UUID-shaped keys still get validated against the API", async () => {
    const failNet = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 403", 403, "x");
      },
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(failNet, () => key);
    const result = await provider.testApiKey("c7b31234-5678-4abc-9def-0123456789ab");
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(403);
    expect(result.message).toMatch(/403/);
    expect(result.message).toMatch(/UUID/);
  });

  test("testApiKey: 403 reports key rejection, 200 reports success", async () => {
    const okNet = {
      getJson: async () => ({ data: [] }),
    } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(okNet, () => key);
    const good = await provider.testApiKey("a-real-looking-key-value");
    expect(good.ok).toBe(true);
    expect(good.httpStatus).toBe(200);

    const failNet = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 403", 403, "x");
      },
    } as unknown as NetworkClient;
    const failProvider = new CurseForgeProvider(failNet, () => key);
    const bad = await failProvider.testApiKey("some-key");
    expect(bad.ok).toBe(false);
    expect(bad.httpStatus).toBe(403);
    expect(bad.message).toMatch(/403/);
  });

  // A 403 from the dedicated health-check endpoint IS confirmed
  // evidence (unlike a 403 from any other endpoint — see
  // classifyCurseForgeError), but a
  // network/5xx/429 failure here must be reported as inconclusive so a
  // save flow built on this never falsely rejects a good key just
  // because CurseForge (or the network) had a blip.
  test("testApiKey: a confirmed 403 rejection is marked confirmed, a network failure is not", async () => {
    const rejectNet = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 403", 403, "x");
      },
    } as unknown as NetworkClient;
    const rejected = await new CurseForgeProvider(rejectNet, () => key).testApiKey("bad-key");
    expect(rejected.ok).toBe(false);
    expect(rejected.confirmed).toBe(true);

    const networkDownNet = {
      getJson: async () => {
        throw new NetworkErrorClass("request failed: timeout", undefined, "x");
      },
    } as unknown as NetworkClient;
    const inconclusive = await new CurseForgeProvider(networkDownNet, () => key).testApiKey("maybe-good-key");
    expect(inconclusive.ok).toBe(false);
    expect(inconclusive.confirmed).toBe(false);
    expect(inconclusive.message).not.toMatch(/rejected/i);

    const serverErrorNet = {
      getJson: async () => {
        throw new NetworkErrorClass("GET x failed: HTTP 503", 503, "x");
      },
    } as unknown as NetworkClient;
    const serverDown = await new CurseForgeProvider(serverErrorNet, () => key).testApiKey("maybe-good-key");
    expect(serverDown.ok).toBe(false);
    expect(serverDown.confirmed).toBe(false);
  });

  test("testApiKey: a successful check never sets confirmed: false", async () => {
    const okNet = { getJson: async () => ({ data: [] }) } as unknown as NetworkClient;
    const result = await new CurseForgeProvider(okNet, () => key).testApiKey("good-key");
    expect(result.ok).toBe(true);
    expect(result.confirmed).not.toBe(false);
  });

  // A key can authenticate fine (passes /v1/games) while still lacking
  // CurseForge's third-party distribution grant — the official API then
  // returns a null downloadUrl for every file. The website fallback
  // normally papers over that for real installs, but testApiKey must
  // still verify live that the fallback itself currently works, rather
  // than assuming forever that it does — otherwise a key that's silently
  // non-functional for both paths would keep reporting as "valid".
  describe("testApiKey: download capability (official-grant-missing cases)", () => {
    function noGrantNet(headOkResult: "ok" | "failed" | "inconclusive"): NetworkClient {
      return {
        getJson: async (url: string) => {
          if (String(url).includes("/mods/search")) {
            return {
              data: [{ id: 1, latestFiles: [{ id: 2, downloadUrl: null }] }],
            };
          }
          return { data: [] }; // /games ping
        },
        headOk: async () => headOkResult,
      } as unknown as NetworkClient;
    }

    test("fails closed when the website fallback is also confirmed broken", async () => {
      const result = await new CurseForgeProvider(noGrantNet("failed"), () => key).testApiKey("auth-ok-no-grant");
      expect(result.ok).toBe(false);
      expect(result.confirmed).toBe(true);
      expect(result.message).toMatch(/distribution|download/i);
    });

    test("still reports ok when the website fallback itself works", async () => {
      const result = await new CurseForgeProvider(noGrantNet("ok"), () => key).testApiKey("auth-ok-no-grant");
      expect(result.ok).toBe(true);
    });

    test("stays ok (fails open) when the fallback probe is merely inconclusive", async () => {
      const result = await new CurseForgeProvider(noGrantNet("inconclusive"), () => key).testApiKey(
        "auth-ok-no-grant",
      );
      expect(result.ok).toBe(true);
    });

    test("never even probes the fallback when the official downloadUrl is present", async () => {
      let headOkCalled = false;
      const net = {
        getJson: async (url: string) => {
          if (String(url).includes("/mods/search")) {
            return {
              data: [{ id: 1, latestFiles: [{ id: 2, downloadUrl: "https://mediafilez.example/2.zip" }] }],
            };
          }
          return { data: [] };
        },
        headOk: async () => {
          headOkCalled = true;
          return "failed" as const;
        },
      } as unknown as NetworkClient;
      const result = await new CurseForgeProvider(net, () => key).testApiKey("fully-granted-key");
      expect(result.ok).toBe(true);
      expect(headOkCalled).toBe(false);
    });
  });

  test("registry defaults: unconfigured key keeps Curse disabled", () => {
    rmSync(join(ROOT, "reg"), { recursive: true, force: true });
    const store = createStateStore(join(ROOT, "reg"));
    const registry = new ProviderRegistry();
    let currentKey: string | undefined = undefined;
    const provider = new CurseForgeProvider(fakeNet({}).net, () => currentKey);
    registry.register(provider);
    registry.attachStore(store);
    expect(provider.enabled).toBe(false); // auth required, no key

    currentKey = "k";
    registry.refreshDefaults();
    expect(provider.enabled).toBe(true);

    // explicit user choice wins over defaults
    registry.setEnabled("Curse", false);
    currentKey = undefined;
    registry.refreshDefaults();
    expect(provider.enabled).toBe(false);
    const infos = registry.providerInfos();
    const curse = infos.find((p) => p.id === "Curse")!;
    expect(curse.configured).toBe(false);
    expect(curse.requiresApiKey).toBe(true);
  });

  // "enabled but unconfigured" is reachable through normal use (enable
  // Curse with a key present, then clear the key later via Settings —
  // clearing a key doesn't touch the enabledProviders list).
  // registry.available() must exclude it so search doesn't attempt and
  // fail against it on every single query.
  test("registry.available() excludes an enabled-but-unconfigured auth provider", () => {
    const registry = new ProviderRegistry();
    const curse = new CurseForgeProvider(fakeNet({}).net, () => undefined);
    curse.enabled = true; // explicit user choice, independent of key state
    registry.register(curse);
    expect(registry.enabled().map((p) => p.name)).toContain("Curse");
    expect(registry.available().map((p) => p.name)).not.toContain("Curse");
  });

  test("search silently skips an enabled-but-unconfigured provider instead of reporting a failure", async () => {
    const { ProviderRegistry: Reg } = await import("../src/wow/providers/provider-registry");
    const { Catalogue } = await import("../src/wow/catalogue/Catalogue");

    const registry = new Reg();
    const curse = new CurseForgeProvider(fakeNet({}).net, () => undefined);
    curse.enabled = true;
    registry.register(curse);
    const catalogue = new Catalogue(registry);

    const { results, providerErrors } = await catalogue.search("anything", retail);
    expect(results).toEqual([]);
    expect(providerErrors).toEqual([]); // not attempted, so no failure to report
  });

  test("discover throws a clear error when the source isn't available", async () => {
    const { ProviderRegistry: Reg } = await import("../src/wow/providers/provider-registry");
    const { Catalogue } = await import("../src/wow/catalogue/Catalogue");

    const registry = new Reg(); // no Curse registered at all
    const catalogue = new Catalogue(registry);

    await expect(catalogue.discover("latest", "Curse", retail, 0, 5)).rejects.toThrow(/isn't available/i);
    await expect(catalogue.discover("popular", "Curse", retail, 0, 5)).rejects.toThrow(/isn't available/i);
  });

  test("discover works once a key is configured and the provider is enabled", async () => {
    const { ProviderRegistry: Reg } = await import("../src/wow/providers/provider-registry");
    const { Catalogue } = await import("../src/wow/catalogue/Catalogue");

    const registry = new Reg();
    const curse = new CurseForgeProvider(fakeNet({ search: { "sortField=3": [] } }).net, () => "real-key");
    curse.enabled = true;
    registry.register(curse);
    const catalogue = new Catalogue(registry);

    const { results, totalCount } = await catalogue.discover("latest", "Curse", retail, 0, 5);
    expect(results).toEqual([]);
    expect(totalCount).toBe(0);
  });

  // Catalogue.getCategories is generic across providers (same
  // "undefined means unsupported" convention as
  // getDescription/getChangelog), not a Curse-specific gate.
  test("getCategories: unknown provider throws, unsupported provider resolves null, supported provider passes through", async () => {
    const { ProviderRegistry: Reg } = await import("../src/wow/providers/provider-registry");
    const { Catalogue } = await import("../src/wow/catalogue/Catalogue");
    const { AddonProvider: Base } = await import("../src/wow/providers/addon-provider");

    const registry = new Reg();

    class NoCategoriesProvider extends Base {
      constructor() {
        super();
        this.name = "WowUpHub";
        this.enabled = true;
      }
    }
    registry.register(new NoCategoriesProvider());

    const curseNet = {
      getJson: async <T>() =>
        ({ data: [{ id: 1019, gameId: 1, name: "Combat", slug: "combat", parentCategoryId: 1 }] }) as T,
    } as unknown as NetworkClient;
    const curse = new CurseForgeProvider(curseNet, () => key);
    curse.enabled = true;
    registry.register(curse);

    const catalogue = new Catalogue(registry);

    await expect(catalogue.getCategories("NoSuchProvider", retail)).rejects.toThrow();
    expect(await catalogue.getCategories("WowUpHub", retail)).toBeNull();
    expect(await catalogue.getCategories("Curse", retail)).toEqual([{ id: "1019", name: "Combat" }]);
  });
});
