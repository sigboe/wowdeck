import { describe, expect, test } from "bun:test";
import { WowUpHubProvider } from "../src/wow/providers/wowup-hub/WowUpHubProvider";
import type { NetworkClient } from "../src/wow/net/network";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import type { WowUpSearchAddonsResponse } from "../src/wow/providers/wowup-hub/wowup-hub-models";

const searchResponse: WowUpSearchAddonsResponse = await Bun.file(
  import.meta.dir + "/fixtures/providers/wowup-hub/search-elvui.json",
).json();

const BASE = "https://hub.example";
const WEB = "https://hub.example";

function fakeNetwork(calls: Record<string, unknown>) {
  const client = { calls: [] as string[] } as unknown as NetworkClient & { calls: string[] };
  client.getJson = async <T>(url: string | URL): Promise<T> => {
    const key = url.toString();
    (client as unknown as { calls: string[] }).calls.push(key);
    if (!(key in calls)) {
      throw new Error(`unexpected url: ${key}`);
    }
    return calls[key] as T;
  };
  client.postJson = async <T>(url: string | URL): Promise<T> => {
    const key = url.toString();
    if (!(key in calls)) {
      throw new Error(`unexpected url: ${key}`);
    }
    return calls[key] as T;
  };
  return client;
}

const retailInstall: WowInstallation = {
  id: "retail",
  clientType: WowClientType.Retail,
  location: "/wow/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

describe("WowUpHubProvider", () => {
  const client = fakeNetwork({
    [`${BASE}/addons/search/retail?query=elvui&limit=10`]: searchResponse,
  });
  const provider = new WowUpHubProvider(BASE, WEB, client);

  test("search maps representations to search results", async () => {
    const results = await provider.searchByQuery("elvui", retailInstall);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.providerName).toBe("WowUpHub");
      expect(r.files!.length).toBeGreaterThan(0);
      expect(r.files![0]!.downloadUrl).toMatch(/^https?:\/\//);
    }
    const first = results[0]!;
    expect(first.externalId).toBe(String(searchResponse.addons[0]!.id));
    expect(first.externalUrl).toContain(`/addons/${first.externalId}`);
  });

  test("Latest and Popular page through upstream's featured lists, fetched once", async () => {
    const featured = { addons: searchResponse.addons, recent: searchResponse.addons.slice(0, 2) };
    const featuredClient = fakeNetwork({
      [`${BASE}/addons/featured/retail?count=60&recent=30`]: featured,
    });
    const hub = new WowUpHubProvider(BASE, WEB, featuredClient);
    const all = await provider.searchByQuery("elvui", retailInstall);

    const first = await hub.getDiscoverPage("popular", retailInstall, 0, 3);
    const next = await hub.getDiscoverPage("popular", retailInstall, 3, 3);
    expect(first.totalCount).toBe(all.length);
    expect([...first.results, ...next.results].map((r) => r.externalId)).toEqual(
      all.slice(0, 6).map((r) => r.externalId),
    );
    const latest = await hub.getDiscoverPage("latest", retailInstall, 0, 10);
    expect(latest.results.map((r) => r.externalId)).toEqual(
      all.filter((r) => featured.recent.some((a) => String(a.id) === r.externalId)).map((r) => r.externalId),
    );
    expect((featuredClient as unknown as { calls: string[] }).calls).toHaveLength(1);
  });

  test("a CurseForge category has nothing from the Hub", async () => {
    const hub = new WowUpHubProvider(BASE, WEB, fakeNetwork({}));
    expect(await hub.getDiscoverPage("popular", retailInstall, 0, 10, "1019")).toEqual({
      results: [],
      totalCount: 0,
    });
  });

  test("isValidAddonId is positive-numeric", () => {
    expect(provider.isValidAddonId("2797823")).toBe(true);
    expect(provider.isValidAddonId("-1")).toBe(false);
    expect(provider.isValidAddonId("abc")).toBe(false);
  });

  test("scan matches folders by fingerprint", async () => {
    const rep = structuredClone(searchResponse.addons[0]!);
    const release = rep.releases![0]!;
    // give the release a folder fingerprint equal to our fake scan result
    release.addonFolders = [{ id: 1, folder_name: rep.repository_name, fingerprint: "fp-abc" }];
    rep.matched_release = release;

    const scanClient = fakeNetwork({
      [`${BASE}/addons/fingerprint`]: { exactMatches: [rep] },
    });
    const scanProvider = new WowUpHubProvider(BASE, WEB, scanClient);

    const folders: import("../src/wow/models").AddonFolder[] = [
      {
        name: rep.repository_name,
        path: `/wow/_retail_/Interface/AddOns/${rep.repository_name}`,
        status: "",
        tocs: [],
        scanResults: {
          wowup: {
            source: "wowup" as const,
            fileCount: 3,
            fingerprint: "fp-abc",
            fingerprintNum: 0,
            folderName: rep.repository_name,
          },
        },
      },
    ];
    const match = (await scanProvider.scan(retailInstall, folders)).get(rep.repository_name);
    expect(match?.addon.providerName).toBe("WowUpHub");
    expect(match?.addon.externalId).toBe(String(rep.id));
    // a fingerprint names the exact release on disk
    expect(match?.installedFile?.externalId).toBe(String(release.id));
    expect(match?.latestFile.externalId).toBe(String(release.id));
  });

  test("getAll posts batch and reports missing ids", async () => {
    const rep = searchResponse.addons[0]!;
    const batchClient = fakeNetwork({
      [`${BASE}/addons/batch/retail`]: { addons: [rep] },
    });
    const batchProvider = new WowUpHubProvider(BASE, WEB, batchClient);
    const { searchResults, errors } = await batchProvider.getAll(retailInstall, [String(rep.id), "42"]);
    expect(searchResults.map((r) => r.externalId)).toContain(String(rep.id));
    expect(errors.some((e) => e.message.includes("42"))).toBe(true);
  });
});
