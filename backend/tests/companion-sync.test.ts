/**
 * End-to-end coverage of the WowUp.Addon companion-data bridge across
 * fixture installations — real directories on disk, no network, no
 * real World of Warcraft required.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonProvider, type GetAllResult } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore, type StateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";
import { companionDataPath } from "../src/wow/notifications/CompanionWriter";
import type { AddonProviderType } from "../src/wow/types";
import type { WowAddon, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/companion-sync";

class FakeProvider extends AddonProvider {
  name: AddonProviderType = "TukUI";
  enabled = true;
  getAllCalls = 0;

  override async getAll(): Promise<GetAllResult> {
    this.getAllCalls += 1;
    return { searchResults: [], errors: [] };
  }

  override isConfigured(): boolean {
    return true;
  }
}

function makeInstallation(id: string, clientType: WowClientType, version: string | undefined): WowInstallation {
  const location = join(ROOT, id);
  mkdirSync(join(location, "Interface", "AddOns"), { recursive: true });
  return {
    id,
    clientType,
    location,
    label: id,
    displayName: id,
    selected: false,
    defaultAddonChannelType: 0,
    version,
    source: "manual",
  };
}

function writeAddonFolder(installation: WowInstallation, folderName: string, tocLines: string[]): void {
  const dir = join(installation.location, "Interface", "AddOns", folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${folderName}.toc`), `${tocLines.join("\n")}\n`);
}

/** Simulates the real WowUp companion addon being installed (identified by folder name). */
function installCompanion(installation: WowInstallation): void {
  writeAddonFolder(installation, "WowUp", [
    "## Interface: 110000",
    "## Title: Addon Update Notifications",
    "## Version: 1.9.0",
  ]);
}

function makeAddon(overrides: Partial<WowAddon> & { id: string; name: string; installationId: string }): WowAddon {
  return {
    channelType: 0,
    isIgnored: false,
    isLoadOnDemand: false,
    ...overrides,
  };
}

function setup(): { service: AddonService; store: StateStore; registry: ProviderRegistry; provider: FakeProvider } {
  const dataDir = join(ROOT, "data");
  const store = createStateStore(dataDir);
  const registry = new ProviderRegistry();
  const provider = new FakeProvider();
  registry.register(provider);
  registry.attachStore(store);
  const service = new AddonService(store, registry, new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  return { service, store, registry, provider };
}

function readDataLua(installation: WowInstallation): string {
  return readFileSync(join(companionDataPath(join(installation.location, "Interface", "AddOns")), "data.lua"), "utf8");
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("CompanionSyncCoordinator.regenerate", () => {
  test("writes an eligible update and a correct Interface line when the companion is present", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
      }),
    );

    const coordinator = new CompanionSyncCoordinator(service);
    await coordinator.regenerate();

    const lua = readDataLua(retail);
    expect(lua).toContain('["Bagnon"] = {"1.0.0", "1.1.0"}');
    const toc = readFileSync(
      join(companionDataPath(service.addonsPathFor(retail)), "wowup_data_addon.toc"),
      "utf8",
    );
    expect(toc).toContain("## Interface: 110002");
    expect(toc).toContain("## RequiredDeps: WowUp");
  });

  test("never creates the data folder when the companion addon isn't installed", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    // no installCompanion() call — "WowUp" folder absent
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
      }),
    );

    const coordinator = new CompanionSyncCoordinator(service);
    await coordinator.regenerate();

    expect(existsSync(companionDataPath(service.addonsPathFor(retail)))).toBe(false);
  });

  test("excludes an ignored addon", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        isIgnored: true,
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).not.toContain("Bagnon");
  });

  test("excludes an addon whose provider is currently disabled, even with stale latestVersion still stored", async () => {
    const { service, store, registry } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
      }),
    );
    registry.setEnabled("TukUI", false);

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).not.toContain("Bagnon");
  });

  test("excludes an addon whose installed and available versions already match", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.0.0",
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).not.toContain("Bagnon");
  });

  test("an addon with no installed version is treated as no update, not a crash", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Mystery",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        latestVersion: "1.0.0",
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).not.toContain("Mystery");
  });

  test("escapes addon names with quotes/backslashes end-to-end", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: 'Weird "Addon"\\Name',
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0",
        latestVersion: "2.0",
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).toContain('["Weird \\"Addon\\"\\\\Name"] = {"1.0", "2.0"}');
  });

  test("two installations with the same addon name but different versions never leak into each other", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    const era = makeInstallation("era", WowClientType.ClassicEra, "1.15.7");
    installCompanion(retail);
    installCompanion(era);
    store.setInstallations([retail, era]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
      }),
    );
    store.addons.create(
      makeAddon({
        id: "a2",
        name: "Bagnon",
        installationId: "era",
        providerName: "TukUI",
        externalId: "2",
        installedVersion: "9.0.0",
        latestVersion: "9.1.0",
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();

    const retailLua = readDataLua(retail);
    const eraLua = readDataLua(era);
    expect(retailLua).toContain('{"1.0.0", "1.1.0"}');
    expect(retailLua).not.toContain("9.0.0");
    expect(eraLua).toContain('{"9.0.0", "9.1.0"}');
    expect(eraLua).not.toContain("1.0.0");

    const eraToc = readFileSync(join(companionDataPath(service.addonsPathFor(era)), "wowup_data_addon.toc"), "utf8");
    expect(eraToc).toContain("## Interface: 11507");
  });

  test("an installation with no eligible updates gets an empty, not stale, list", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "UpToDate",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.0.0",
      }),
    );

    await new CompanionSyncCoordinator(service).regenerate();
    expect(readDataLua(retail)).toContain("WOWUP_DATA.updateAddonsList = {");
    expect(readDataLua(retail)).not.toContain("UpToDate");
  });

  test("skips an installation whose WoW version can't be parsed into an Interface number, without crashing", async () => {
    const { service, store } = setup();
    const broken = makeInstallation("broken", WowClientType.Retail, undefined);
    installCompanion(broken);
    store.setInstallations([broken]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Bagnon",
        installationId: "broken",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
      }),
    );

    await expect(new CompanionSyncCoordinator(service).regenerate()).resolves.toBeUndefined();
    expect(existsSync(companionDataPath(service.addonsPathFor(broken)))).toBe(false);
  });

  test("a removed installation never receives a write at a stale path", async () => {
    const { service, store } = setup();
    const retail = makeInstallation("retail", WowClientType.Retail, "11.0.2");
    installCompanion(retail);
    store.setInstallations([retail]);

    const coordinator = new CompanionSyncCoordinator(service);
    // installation removed from the store entirely (service.removeInstallation
    // semantics) before a regenerate aimed at its old id ever runs
    store.setInstallations([]);
    await expect(coordinator.regenerate(["retail"])).resolves.toBeUndefined();
    expect(existsSync(companionDataPath(service.addonsPathFor(retail)))).toBe(false);
  });
});
