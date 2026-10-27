/**
 * Provider enable/disable must be real — persisted, applied at
 * startup, and actually affect search/scan participation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { WowClientType, type AddonProviderType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/providers";

class CountingProvider extends AddonProvider {
  searchCalls = 0;

  constructor(name: AddonProviderType) {
    super();
    this.name = name;
    this.enabled = true;
  }

  override async searchByQuery(): Promise<AddonSearchResult[]> {
    this.searchCalls += 1;
    return [];
  }
}

function makeStack(dataDir: string) {
  const store = createStateStore(dataDir);
  const registry = new ProviderRegistry();
  const hub = new CountingProvider("WowUpHub");
  const tukui = new CountingProvider("TukUI");
  registry.register(hub);
  registry.register(tukui);
  registry.attachStore(store);
  const service = new AddonService(store, registry, new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  return { store, registry, service, hub, tukui };
}

const installation: WowInstallation = {
  id: "inst1",
  clientType: WowClientType.Retail,
  location: join(ROOT, "_retail_"),
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "_retail_", "Interface", "AddOns"), { recursive: true });
  writeFileSync(join(ROOT, "_retail_", ".build.info"), "Product,Branch,Timestamp,BuildVersion,Version\nWoW,wow,2026-09-01,11.0.2.56013,11.0.2\n");
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("provider enable/disable", () => {
  test("defaults: all providers enabled, list reflects state", () => {
    const { registry } = makeStack(join(ROOT, "d1"));
    expect(registry.enabled().map((p) => p.name).sort()).toEqual(["TukUI", "WowUpHub"]);
    expect(registry.providerInfos()).toHaveLength(2);
  });

  test("disabling a provider removes it from search participation", async () => {
    const { registry, service, hub, tukui } = makeStack(join(ROOT, "d2"));
    registry.setEnabled("TukUI", false);

    await service.search("anything", installation);
    expect(hub.searchCalls).toBe(1);
    expect(tukui.searchCalls).toBe(0);

    // re-enable restores participation
    registry.setEnabled("TukUI", true);
    await service.search("anything", installation);
    expect(tukui.searchCalls).toBe(1);
  });

  test("enabled state persists across engine restart", () => {
    const dataDir = join(ROOT, "d3");
    const first = makeStack(dataDir);
    first.registry.setEnabled("WowUpHub", false);
    expect(first.registry.enabled().map((p) => p.name)).toEqual(["TukUI"]);

    const second = makeStack(dataDir);
    expect(second.registry.enabled().map((p) => p.name)).toEqual(["TukUI"]);
    expect(second.hub.enabled).toBe(false);
    expect(second.tukui.enabled).toBe(true);
  });

  test("unknown provider fails loudly", () => {
    const { registry } = makeStack(join(ROOT, "d4"));
    expect(() => registry.setEnabled("CurseForge", true)).toThrow(/isn't available|isn't in your list|weren't found|wasn't found/i);
  });

  test("null enabledProviders keeps provider defaults", () => {
    const { registry, store } = makeStack(join(ROOT, "d5"));
    expect(store.settings.enabledProviders).toBeNull();
    expect(registry.enabled()).toHaveLength(2);
  });
});

// allowEdit — a provider that can never be toggled (GitHub).
class NonEditableProvider extends CountingProvider {
  constructor(name: AddonProviderType) {
    super(name);
    this.allowEdit = false;
  }
}

describe("allowEdit enforcement", () => {
  test("setEnabled refuses to toggle a non-editable provider", () => {
    const store = createStateStore(join(ROOT, "d6"));
    const registry = new ProviderRegistry();
    const github = new NonEditableProvider("GitHub");
    registry.register(github);
    registry.attachStore(store);
    expect(() => registry.setEnabled("GitHub", false)).toThrow(/cannot be enabled or disabled/i);
    expect(github.enabled).toBe(true); // unchanged
  });

  test("a stale persisted enabledProviders list excluding a non-editable provider is ignored on load", () => {
    const dataDir = join(ROOT, "d7");
    // Simulate a settings file written before this provider existed/was
    // made non-editable, listing only one genuinely editable provider —
    // both GitHub (absent from the list) and WowUpHub (also absent) are
    // editable/non-editable respectively, to show the two react
    // differently to the same stored list.
    const first = createStateStore(dataDir);
    first.updateSettings({ enabledProviders: ["TukUI"] }); // GitHub and WowUpHub both absent
    const registry = new ProviderRegistry();
    const github = new NonEditableProvider("GitHub");
    const hub = new CountingProvider("WowUpHub"); // editable, absent from the list
    const tukui = new CountingProvider("TukUI"); // editable, present in the list
    registry.register(github);
    registry.register(hub);
    registry.register(tukui);
    registry.attachStore(createStateStore(dataDir));
    expect(github.enabled).toBe(true); // never disabled despite being absent from the stored list
    expect(hub.enabled).toBe(false); // a genuinely editable provider absent from the list IS disabled
    expect(tukui.enabled).toBe(true); // present in the list, stays enabled
  });

  test("providerInfos() exposes allowEdit so the Settings UI can filter its toggle list", () => {
    const store = createStateStore(join(ROOT, "d8"));
    const registry = new ProviderRegistry();
    registry.register(new NonEditableProvider("GitHub"));
    registry.register(new CountingProvider("TukUI"));
    registry.attachStore(store);
    const infos = registry.providerInfos();
    expect(infos.find((p) => p.id === "GitHub")?.allowEdit).toBe(false);
    expect(infos.find((p) => p.id === "TukUI")?.allowEdit).toBe(true);
  });

  test("enabled but not set up is not usable: no search, install, update or reinstall, and the wire says so", async () => {
    const dataDir = join(ROOT, "d9");
    rmSync(dataDir, { recursive: true, force: true });
    const { store, registry, service, tukui } = makeStack(dataDir);
    tukui.isConfigured = () => false;
    tukui.allowReinstall = true;
    expect(registry.usable("TukUI")).toBeUndefined();
    expect(registry.usable("WowUpHub")?.name).toBe("WowUpHub");
    expect(registry.providerInfos().find((p) => p.id === "TukUI")).toMatchObject({ enabled: true, available: false });

    await service.search("anything", installation, "TukUI");
    expect(tukui.searchCalls).toBe(0);
    await expect(service.install({ intent: "install", providerId: "TukUI", externalId: "1", installation })).rejects.toThrow(
      "That addon source isn't available",
    );

    store.setInstallations([installation]);
    store.addons.createMany([
      {
        id: "a1",
        name: "Old",
        installationId: installation.id,
        providerName: "TukUI",
        externalId: "1",
        channelType: 0,
        isIgnored: false,
        isLoadOnDemand: false,
        installedVersion: "1",
        latestVersion: "2",
      } as never,
    ]);
    const record = store.addons.require("a1");
    expect(service.eligibleUpdatesFor(installation)).toEqual([]);
    expect(service.canReinstall(record)).toBe(false);
    tukui.isConfigured = () => true;
    expect(service.eligibleUpdatesFor(installation).map((a) => a.id)).toEqual(["a1"]);
    expect(service.canReinstall(record)).toBe(true);
  });

  test("a source turned off still installs by hand, and its addons say Source off with no update on offer", async () => {
    const dataDir = join(ROOT, "d10");
    rmSync(dataDir, { recursive: true, force: true });
    const { store, registry, service, tukui } = makeStack(dataDir);
    registry.setEnabled("TukUI", false);
    // Past the provider gate: the (fake) provider just has no such addon.
    await expect(service.install({ intent: "install", providerId: "TukUI", externalId: "1", installation })).rejects.not.toThrow(
      "That addon source isn't available",
    );

    store.setInstallations([installation]);
    store.addons.createMany([
      {
        id: "a1",
        name: "Old",
        installationId: installation.id,
        providerName: "TukUI",
        externalId: "1",
        channelType: 0,
        isIgnored: false,
        isLoadOnDemand: false,
        installedVersion: "1",
        latestVersion: "2",
      },
    ]);
    const record = store.addons.require("a1");
    expect(service.wire(record)).toMatchObject({ sourceOff: true, updateAvailable: false, availableVersion: null });
    tukui.enabled = true;
    expect(service.wire(record)).toMatchObject({ sourceOff: false, updateAvailable: true, availableVersion: "2" });
  });

  test("Update all leaves out an addon whose source is off, and counts what the summary and toast count", async () => {
    const dataDir = join(ROOT, "d11");
    rmSync(dataDir, { recursive: true, force: true });
    const { store, registry, service } = makeStack(dataDir);
    registry.setEnabled("TukUI", false);
    store.setInstallations([installation]);
    store.addons.createMany([
      {
        id: "off",
        name: "From a source that is off",
        installationId: installation.id,
        providerName: "TukUI",
        externalId: "1",
        channelType: 0,
        isIgnored: false,
        isLoadOnDemand: false,
        installedVersion: "1",
        latestVersion: "2",
      },
      {
        id: "on",
        name: "From a source that is on",
        installationId: installation.id,
        providerName: "WowUpHub",
        externalId: "2",
        channelType: 0,
        isIgnored: false,
        isLoadOnDemand: false,
        installedVersion: "1",
        latestVersion: "2",
      },
    ]);

    const operations = await service.updateAll(installation);

    expect(operations.map((o) => o.addonId)).toEqual(["on"]);
    expect(service.eligibleUpdatesFor(installation).map((a) => a.id)).toEqual(["on"]);
    expect(service.updateSummary()[0]?.updates).toBe(1);
  });
});
