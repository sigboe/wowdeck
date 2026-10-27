import { describe, expect, test } from "bun:test";
import { TukUiAddonProvider } from "../src/wow/providers/tukui/TukUiAddonProvider";
import type { TukUiAddon } from "../src/wow/providers/tukui/tukui-model";
import type { NetworkClient } from "../src/wow/net/network";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import { loadCassette, recorded } from "./providers/cassette";

const catalog = recorded<TukUiAddon[]>(await loadCassette("tukui"), "GET", "https://api.tukui.org/v1/addons");

function fakeNetwork(jsonForUrl: Record<string, unknown>) {
  const client = {} as NetworkClient;
  client.getJson = async <T>(url: string): Promise<T> => {
    if (!(url in jsonForUrl)) {
      throw new Error(`unexpected url ${url}`);
    }
    return jsonForUrl[url] as T;
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

const classicEraInstall: WowInstallation = {
  ...retailInstall,
  id: "classic-era",
  clientType: WowClientType.ClassicEra,
  location: "/wow/_classic_era_",
};

describe("TukUiAddonProvider", () => {
  const provider = new TukUiAddonProvider(fakeNetwork({ "https://api.tukui.org/v1/addons": catalog }));

  test("enabled by default", () => {
    expect(provider.enabled).toBe(true);
  });

  test("search is flavor aware", async () => {
    const tukui = catalog.find((a) => a.slug === "tukui")!;
    expect(tukui.patch.some((p) => p.startsWith("1."))).toBe(true);
    const era = await provider.searchByQuery("tukui", classicEraInstall);
    expect(era.some((r) => r.name === "Tukui")).toBe(true);
  });

  test("Forever and Forever Beta search by the forever patch token, which no other flavor takes", async () => {
    // The recording has no Forever addon yet: add one built on its Tukui entry.
    const tukui = catalog.find((a) => a.slug === "tukui")!;
    const foreverOnly: TukUiAddon = { ...tukui, id: 9001, slug: "questie-forever", name: "Questie Forever", patch: ["1.60.1"] };
    const withForever = new TukUiAddonProvider(fakeNetwork({ "https://api.tukui.org/v1/addons": [...catalog, foreverOnly] }));
    const names = async (clientType: WowClientType, query: string) =>
      (await withForever.searchByQuery(query, { ...retailInstall, clientType })).map((r) => r.name);

    for (const client of [WowClientType.Forever, WowClientType.ClassicBeta]) {
      expect(await names(client, "questie forever")).toContain("Questie Forever");
      expect(await names(client, "tukui")).not.toContain("Tukui");
    }
    expect(await names(WowClientType.Retail, "questie forever")).not.toContain("Questie Forever");
    expect(await names(WowClientType.ClassicEra, "questie forever")).not.toContain("Questie Forever");
    expect(await names(WowClientType.ClassicEra, "tukui")).toContain("Tukui");
  });

  test("isValidAddonId is numeric-only", () => {
    expect(provider.isValidAddonId("123")).toBe(true);
    expect(provider.isValidAddonId("abc")).toBe(false);
  });

  test("scan matches folder by tukui project id toc", async () => {
    const elvui = catalog.find((a) => a.slug === "elvui")!;
    const folders: import("../src/wow/models").AddonFolder[] = [
      {
        name: "ElvUI",
        path: "/wow/_retail_/Interface/AddOns/ElvUI",
        status: "",
        tocs: [
          {
            fileName: "ElvUI.toc",
            filePath: "/wow/_retail_/Interface/AddOns/ElvUI/ElvUI.toc",
            interface: ["110005"],
            dependencyList: [],
            tukUiProjectId: String(elvui.id),
          },
        ],
      },
      {
        name: "ElvUI_Libraries",
        path: "/wow/_retail_/Interface/AddOns/ElvUI_Libraries",
        status: "",
        tocs: [
          {
            fileName: "ElvUI_Libraries.toc",
            filePath: "/x/ElvUI_Libraries.toc",
            interface: ["110005"],
            dependencyList: [],
          },
        ],
      },
    ];
    const matches = await provider.scan(retailInstall, folders);
    expect(matches.get("ElvUI")?.addon.externalId).toBe(String(elvui.id));
    expect(matches.get("ElvUI")?.latestFile.version).toBe(elvui.version);
    // subfolder matched via installedFolderList? (ElvUI directories list)
    // matches upstream behavior only when directories include the sub folder
  });

  test("scan gives a folder listed in the matched TOC's project folders the same match", async () => {
    const elvui = catalog.find((a) => a.slug === "elvui")!;
    const folder = (name: string, toc: object) => ({
      name,
      path: `/wow/_retail_/Interface/AddOns/${name}`,
      status: "",
      tocs: [{ fileName: `${name}.toc`, filePath: `/x/${name}.toc`, interface: ["110005"], dependencyList: [], ...toc }],
    });
    const matches = await provider.scan(retailInstall, [
      folder("ElvUI_Options", {}),
      folder("ElvUI", { tukUiProjectId: String(elvui.id), tukUiProjectFolders: "ElvUI, ElvUI_Options" }),
    ]);
    expect(matches.get("ElvUI_Options")?.addon.externalId).toBe(String(elvui.id));
  });

  // TukUI's fuzzy name-matching fallback (scanAddonsWithNames, ported
  // verbatim from upstream's string-similarity + substring-contains
  // strategy) must not silently claim an unrelated addon just because
  // it has no toc id: an unmanaged addon must not silently become
  // managed merely because it happens to have a similar name.
  test("fuzzy name matching does not claim a clearly unrelated addon", async () => {
    const folders: import("../src/wow/models").AddonFolder[] = [
      {
        name: "DeadlyBossMods",
        path: "/wow/_retail_/Interface/AddOns/DeadlyBossMods",
        status: "",
        tocs: [
          {
            fileName: "DBM-Core.toc",
            filePath: "/wow/_retail_/Interface/AddOns/DeadlyBossMods/DBM-Core.toc",
            interface: ["110005"],
            dependencyList: [],
            title: "Deadly Boss Mods",
            // no tukUiProjectId — this folder has no strong identity evidence
          },
        ],
      },
    ] as never;
    const matches = await provider.scan(retailInstall, folders);
    expect(matches.size).toBe(0);
  });
});

