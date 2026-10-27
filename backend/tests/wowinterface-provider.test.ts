/**
 * WowInterface provider tests (deterministic, network-free).
 * Fixture shapes follow the real mmoui.com API.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { WowInterfaceProvider, parseWowInterfaceQuery } from "../src/wow/providers/wowinterface/WowInterfaceProvider";
import type { WowiFileDetailsV3, WowiFileDetailsV4 } from "../src/wow/providers/wowinterface/wowinterface-models";
import { NetworkClient, NetworkError } from "../src/wow/net/network";
import { WowClientType } from "../src/wow/types";
import { scannedAddonRecord } from "../src/wow/addons/AddonService";
import type { AddonFolder, WowInstallation } from "../src/wow/models";

const ROOT = "/tmp/opencode/wowdeck-tests/wowinterface";

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

function v4(over: Partial<WowiFileDetailsV4> & Pick<WowiFileDetailsV4, "id">): WowiFileDetailsV4 {
  return {
    categoryId: 18,
    version: "1.0",
    lastUpdate: 1700000000000,
    checksum: `checksum-${over.id}`,
    fileName: `addon-${over.id}.zip`,
    downloadUri: `https://cdn.wowinterface.com/downloads/getfile.php?id=${over.id}`,
    title: `Addon${over.id}`,
    author: "SomeAuthor",
    description: "A mock addon",
    changeLog: "- fixed stuff",
    downloads: 1000,
    downloadsMonthly: 10,
    favorites: 5,
    images: [],
    ...over,
  };
}

function fakeNet(byUrl: Record<string, unknown>, failUrls: Set<string> = new Set()): NetworkClient {
  return {
    getJson: async <T>(url: string): Promise<T> => {
      if (failUrls.has(url)) {
        throw new NetworkError(`GET ${url} failed: HTTP 404`, 404, url);
      }
      const key = Object.keys(byUrl).find((k) => url.includes(k));
      if (key) {
        return byUrl[key] as T;
      }
      throw new NetworkError(`GET ${url} failed: HTTP 404`, 404, url);
    },
  } as unknown as NetworkClient;
}

describe("parseWowInterfaceQuery", () => {
  test("accepts an addon page URL (/info<id>)", () => {
    expect(parseWowInterfaceQuery("https://www.wowinterface.com/downloads/info24449-JWRepBar.html")).toEqual({
      id: "24449",
    });
  });

  test("accepts a download URL (/download<id>), checked before /info per upstream order", () => {
    expect(parseWowInterfaceQuery("https://www.wowinterface.com/downloads/download24449-JWRepBar")).toEqual({
      id: "24449",
    });
  });

  test("accepts the bare host without www", () => {
    expect(parseWowInterfaceQuery("https://wowinterface.com/downloads/info24449.html")).toEqual({ id: "24449" });
  });

  test("rejects a host that merely resembles wowinterface.com, unlike upstream's loose endsWith check", () => {
    expect(parseWowInterfaceQuery("https://notwowinterface.com/downloads/info24449.html")).toBeNull();
    expect(parseWowInterfaceQuery("https://evil-wowinterface.com/downloads/info24449.html")).toBeNull();
  });

  test("rejects a wowinterface.com URL with no recognizable id path", () => {
    expect(parseWowInterfaceQuery("https://www.wowinterface.com/forums/")).toBeNull();
  });

  test("rejects plain text that isn't a URL", () => {
    expect(parseWowInterfaceQuery("questie")).toBeNull();
  });

  test("rejects a github URL (provider boundaries are deterministic, not overlapping)", () => {
    expect(parseWowInterfaceQuery("https://github.com/owner/repo")).toBeNull();
  });

  // Tolerate a missing https://.
  test("accepts www.wowinterface.com/downloads/info<id> with no scheme at all", () => {
    expect(parseWowInterfaceQuery("www.wowinterface.com/downloads/info24449.html")).toEqual({ id: "24449" });
  });

  test("still rejects a schemeless non-wowinterface host", () => {
    expect(parseWowInterfaceQuery("notwowinterface.com/downloads/info24449.html")).toBeNull();
  });
});

describe("WowInterfaceProvider.getById / API fallback", () => {
  test("v4 success maps to AddonSearchResult with checksum as the file's externalId", async () => {
    const net = fakeNet({ "v4/game/WOW/filedetails/24449.json": [v4({ id: 24449, checksum: "abc123" })] });
    const provider = new WowInterfaceProvider(net);
    const result = await provider.getById("24449", retail);
    expect(result!.name).toBe("Addon24449");
    expect(result!.externalId).toBe("24449");
    expect(result!.files![0]!.externalId).toBe("abc123");
    expect(result!.files![0]!.downloadUrl).toContain("getfile.php?id=24449");
  });

  test("falls back to v3 when v4 fails, mapping UI*-prefixed fields correctly", async () => {
    const v3Response: WowiFileDetailsV3[] = [
      {
        UID: "24449",
        UICATID: "18",
        UIVersion: "0.9",
        UIDate: 1503189573000,
        UIMD5: "b3e02f6c873d099926604f7e40087f2f",
        UIFileName: "JWRepBar.zip",
        UIDownload: "https://cdn.wowinterface.com/downloads/getfile.php?id=24449",
        UIName: "JWRepBar",
        UIAuthorName: "JDoubleU00",
        UIDescription: "desc",
        UIChangeLog: "None",
        UIHitCount: "578",
        UIHitCountMonthly: "7",
        UIFavoriteTotal: "1",
      },
    ];
    const net = fakeNet(
      { "v3/game/WOW/filedetails/24449.json": v3Response },
      new Set(["https://api.mmoui.com/v4/game/WOW/filedetails/24449.json"]),
    );
    const provider = new WowInterfaceProvider(net);
    const result = await provider.getById("24449", retail);
    expect(result!.name).toBe("JWRepBar");
    expect(result!.author).toBe("JDoubleU00");
    expect(result!.files![0]!.externalId).toBe("b3e02f6c873d099926604f7e40087f2f");
    expect(result!.downloadCount).toBe(578);
  });

  test("returns undefined for a nonexistent id (404 from both v4 and v3)", async () => {
    const net = fakeNet({}, new Set());
    const provider = new WowInterfaceProvider(net);
    expect(await provider.getById("999999999", retail)).toBeUndefined();
  });

  test("returns undefined for a non-numeric id without making any request", async () => {
    let called = false;
    const net = {
      getJson: async () => {
        called = true;
        throw new Error("should not be called");
      },
    } as unknown as NetworkClient;
    const provider = new WowInterfaceProvider(net);
    expect(await provider.getById("not-a-number", retail)).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe("WowInterfaceProvider.getAll — batch + missing ids", () => {
  // A mixed valid/invalid batch request returns HTTP 200 with only the
  // valid entries present — never a partial-failure exception.
  test("missing ids in a batch response are reported as source_removed errors, valid ones still returned", async () => {
    const net = fakeNet({ "filedetails/1,2.json": [v4({ id: 1 })] }); // id 2 silently absent
    const provider = new WowInterfaceProvider(net);
    const { searchResults, errors } = await provider.getAll(retail, ["1", "2"]);
    expect(searchResults.map((r) => r.externalId)).toEqual(["1"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error & { code?: string }).code).toBe("source_removed");
  });

  test("invalid (non-numeric) ids are filtered out before the request is made", async () => {
    const net = fakeNet({ "filedetails/5.json": [v4({ id: 5 })] });
    const provider = new WowInterfaceProvider(net);
    const { searchResults } = await provider.getAll(retail, ["5", "not-a-number"]);
    expect(searchResults.map((r) => r.externalId)).toEqual(["5"]);
  });

  test("an empty id list makes no request and returns empty", async () => {
    let called = false;
    const net = { getJson: async () => { called = true; return []; } } as unknown as NetworkClient;
    const provider = new WowInterfaceProvider(net);
    const { searchResults, errors } = await provider.getAll(retail, []);
    expect(searchResults).toEqual([]);
    expect(errors).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("WowInterfaceProvider.scan — X-WoWI-ID matching", () => {
  test("scan matches a folder by TOC wowInterfaceId and sets installedExternalReleaseId from the checksum", async () => {
    const net = fakeNet({ "filedetails/24449.json": [v4({ id: 24449, checksum: "abc123", version: "1.0" })] });
    const provider = new WowInterfaceProvider(net);

    const dir = join(ROOT, "JWRepBar");
    mkdirSync(join(dir, "JWRepBar"), { recursive: true });
    const folder: AddonFolder = {
      name: "JWRepBar",
      path: join(dir, "JWRepBar"),
      status: "",
      tocs: [
        {
          fileName: "JWRepBar.toc",
          filePath: join(dir, "JWRepBar", "JWRepBar.toc"),
          interface: ["110000"],
          title: "JWRepBar",
          version: "1.0",
          wowInterfaceId: "24449",
          loadOnDemand: undefined,
          dependencyList: [],
        },
      ],
    };

    const match = (await provider.scan(retail, [folder])).get("JWRepBar");
    expect(match?.addon.providerName).toBe("WowInterface");
    expect(match?.addon.externalId).toBe("24449");
    expect(match?.installedFile?.externalId).toBe("abc123");
    expect(match?.latestFile.externalId).toBe("abc123");
    const record = scannedAddonRecord(match!, retail, [folder], folder.tocs[0]);
    expect(record).toMatchObject({ isIgnored: false, isLoadOnDemand: false, channelType: 0 }); // RF-08: shared record defaults
    // Compatibility comes entirely from the local TOC's own Interface tag
    // — WowInterface's API carries no per-flavor data at all.
    expect(record.gameVersion).toBe("110000");
    const { needsUpdate } = await import("../src/wow/addons/addonStatus");
    expect(needsUpdate(record)).toBe(false);
  });

  test("load-on-demand folders are excluded from scan matching, matching upstream", async () => {
    const net = fakeNet({ "filedetails/1.json": [v4({ id: 1 })] });
    const provider = new WowInterfaceProvider(net);
    const folder: AddonFolder = {
      name: "LoadOnDemandAddon",
      path: "/x/LoadOnDemandAddon",
      status: "",
      tocs: [
        {
          fileName: "LoadOnDemandAddon.toc",
          filePath: "/x/LoadOnDemandAddon.toc",
          interface: ["110000"],
          wowInterfaceId: "1",
          loadOnDemand: "1",
          dependencyList: [],
        },
      ],
    };
    expect((await provider.scan(retail, [folder])).size).toBe(0);
  });

  test("folders with no X-WoWI-ID TOC tag are left unmatched, no request made", async () => {
    let called = false;
    const net = { getJson: async () => { called = true; return []; } } as unknown as NetworkClient;
    const provider = new WowInterfaceProvider(net);
    const folder: AddonFolder = {
      name: "NoIdAddon",
      path: "/x/NoIdAddon",
      status: "",
      tocs: [
        {
          fileName: "NoIdAddon.toc",
          filePath: "/x/NoIdAddon.toc",
          interface: ["110000"],
          dependencyList: [],
        },
      ],
    };
    expect((await provider.scan(retail, [folder])).size).toBe(0);
    expect(called).toBe(false);
  });
});

describe("WowInterfaceProvider capability flags", () => {
  test("has no catalog search, participates in scan, is toggleable", () => {
    const provider = new WowInterfaceProvider(fakeNet({}));
    expect(provider.catalogSearch).toBe(false);
    expect(provider.allowEdit).toBe(true);
  });

  test("searchByQuery returns [] for plain text", async () => {
    const provider = new WowInterfaceProvider(fakeNet({}));
    expect(await provider.searchByQuery("some addon name", retail)).toEqual([]);
  });

  test("isValidAddonId accepts only numeric strings", () => {
    const provider = new WowInterfaceProvider(fakeNet({}));
    expect(provider.isValidAddonId("24449")).toBe(true);
    expect(provider.isValidAddonId("owner/repo")).toBe(false);
    expect(provider.isValidAddonId("abc")).toBe(false);
  });
});

describe("WowInterfaceProvider.getDescription/getChangelog", () => {
  test("getDescription and getChangelog return the API's description/changeLog fields", async () => {
    const net = fakeNet({
      "filedetails/1.json": [v4({ id: 1, description: "full description", changeLog: "- did a thing" })],
    });
    const provider = new WowInterfaceProvider(net);
    expect(await provider.getDescription("1")).toBe("full description");
    expect(await provider.getChangelog("1", retail)).toBe("- did a thing");
  });
});

