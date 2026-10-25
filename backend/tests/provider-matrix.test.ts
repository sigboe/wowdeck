/**
 * Provider fixture matrix for WowUpHub and TukUI: capabilities asserted
 * explicitly, with unsupported operations asserted explicitly too
 * (better than the UI inferring capabilities from names). CurseForge,
 * GitHub and WowInterface have their own dedicated test files.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WowUpHubProvider } from "../src/wow/providers/wowup-hub/WowUpHubProvider";
import { TukUiAddonProvider } from "../src/wow/providers/tukui/TukUiAddonProvider";
import { NetworkClient } from "../src/wow/net/network";
import type { AddonProvider } from "../src/wow/providers/addon-provider";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const FIXTURES = join(import.meta.dir, "fixtures", "providers");

const hubSearchFixture = JSON.parse(readFileSync(join(FIXTURES, "wowup-hub", "search-elvui.json"), "utf-8"));
const tukuiCatalogFixture = JSON.parse(readFileSync(join(FIXTURES, "tukui", "addons.json"), "utf-8"));

function fixtureNet(): NetworkClient {
  return {
    getJson: async <T>(): Promise<T> => hubSearchFixture as T,
    postJson: async <T>(): Promise<T> => hubSearchFixture as T,
    getText: async () => "",
    downloadToFile: async () => 0,
  } as unknown as NetworkClient;
}

function tukuiNet(): NetworkClient {
  return {
    getJson: async <T>(): Promise<T> => tukuiCatalogFixture as T,
    postJson: async <T>(): Promise<T> => tukuiCatalogFixture as T,
    getText: async () => "",
    downloadToFile: async () => 0,
  } as unknown as NetworkClient;
}

const installation: WowInstallation = {
  id: "inst1",
  clientType: WowClientType.Retail,
  location: "/x/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

interface Row {
  provider: string;
  search: boolean;
  install: boolean;
  update: boolean;
  scan: boolean;
  authRequired: boolean;
}

function capabilityRow(p: AddonProvider): Row {
  return {
    provider: p.name,
    search: typeof p.searchByQuery === "function" && p.name !== "Unknown",
    install: typeof p.getById === "function",
    update: typeof p.getAll === "function",
    scan: typeof p.scan === "function",
    authRequired: p.authRequired,
  };
}

describe("provider capability matrix", () => {
  test("WowUpHub: search/install/update/scan supported, no auth", () => {
    const provider = new WowUpHubProvider("https://hub.invalid", "https://hub.invalid", fixtureNet());
    const row = capabilityRow(provider);
    expect(row).toEqual({
      provider: "WowUpHub",
      search: true,
      install: true,
      update: true,
      scan: true,
      authRequired: false,
    });
  });

  test("TukUI: search/install/update/scan supported, no auth", () => {
    const provider = new TukUiAddonProvider(tukuiNet());
    const row = capabilityRow(provider);
    expect(row).toEqual({
      provider: "TukUI",
      search: true,
      install: true,
      update: true,
      scan: true,
      authRequired: false,
    });
  });

  test("both providers produce search results from fixtures", async () => {
    const hub = new WowUpHubProvider("https://hub.invalid", "https://hub.invalid", fixtureNet());
    const tukui = new TukUiAddonProvider(tukuiNet());

    const hubResults = await hub.searchByQuery("elvui", installation);
    expect(hubResults.length).toBeGreaterThan(0);
    const tukuiResults = await tukui.searchByQuery("elvui", installation);
    expect(tukuiResults.map((r) => r.name)).toContain("ElvUI");
  });

  test("no registered provider advertises URL installs yet", () => {
    const hub = new WowUpHubProvider("https://hub.invalid", "https://hub.invalid", fixtureNet());
    const tukui = new TukUiAddonProvider(tukuiNet());
    for (const p of [hub, tukui]) {
      expect((p as unknown as { searchByUrl?: unknown }).searchByUrl).toBeUndefined();
    }
  });

  // Neither provider has its own category system — the base class's
  // default (undefined, not an invented or CurseForge-borrowed list)
  // must be what callers see.
  test("WowUpHub/TukUI report category retrieval as unsupported", async () => {
    const hub = new WowUpHubProvider("https://hub.invalid", "https://hub.invalid", fixtureNet());
    const tukui = new TukUiAddonProvider(tukuiNet());
    expect(await hub.getCategories(installation)).toBeUndefined();
    expect(await tukui.getCategories(installation)).toBeUndefined();
  });

  test("registry.all() reflects exactly the providers registered with it", async () => {
    const { ProviderRegistry } = await import("../src/wow/providers/provider-registry");
    const registry = new ProviderRegistry();
    const hub = new WowUpHubProvider("https://hub.invalid", "https://hub.invalid", fixtureNet());
    const tukui = new TukUiAddonProvider(tukuiNet());
    registry.register(hub);
    registry.register(tukui);
    const registered = registry.all().map((p) => p.name).sort();
    expect(registered).toEqual(["TukUI", "WowUpHub"]);
  });
});
