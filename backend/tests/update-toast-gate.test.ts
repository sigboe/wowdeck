/**
 * The SteamOS update-toast decision — on/off setting, at-most-once-a-
 * day rate limiting, checking every installation, and the worded
 * toast returned to the frontend.
 */

import { beforeEach, afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonProvider, type GetAllResult } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore, type StateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";
import { UpdateCheck } from "../src/wow/notifications/UpdateCheck";
import { UpdateToastGate } from "../src/wow/notifications/UpdateToastGate";
import type { AddonProviderType } from "../src/wow/types";
import type { WowAddon, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/update-toast";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

function makeInstallation(id: string, version: string): WowInstallation {
  const location = join(ROOT, id);
  mkdirSync(join(location, "Interface", "AddOns"), { recursive: true });
  return {
    id,
    clientType: WowClientType.Retail,
    location,
    label: id,
    displayName: id,
    selected: false,
    defaultAddonChannelType: 0,
    version,
    source: "manual",
  };
}

function makeAddon(overrides: Partial<WowAddon> & { id: string; name: string; installationId: string }): WowAddon {
  return {
    channelType: 0,
    isIgnored: false,
    isLoadOnDemand: false,
    ...overrides,
  };
}

function setup(): { service: AddonService; store: StateStore; gate: UpdateToastGate; provider: FakeProvider } {
  const dataDir = join(ROOT, "data");
  const store = createStateStore(dataDir);
  const registry = new ProviderRegistry();
  const provider = new FakeProvider();
  registry.register(provider);
  registry.attachStore(store);
  const service = new AddonService(store, registry, new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  const gate = new UpdateToastGate(service, store, new UpdateCheck(service, new CompanionSyncCoordinator(service)));
  return { service, store, gate, provider };
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("UpdateToastGate", () => {
  test("reports an eligible update across all installations on a first-ever check", async () => {
    const { store, gate } = setup();
    const retail = makeInstallation("retail", "11.0.2");
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

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: { title: "1 addon update available", body: "Open WoWDeck Manager to update" } });
    expect(store.settings.lastUpdateCheckAt).not.toBeNull();
  });

  test("never toasts when there are no eligible updates, but still records the check", async () => {
    const { store, gate } = setup();
    const retail = makeInstallation("retail", "11.0.2");
    store.setInstallations([retail]);

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: null });
    expect(store.settings.lastUpdateCheckAt).not.toBeNull();
  });

  test("never checks again within the same day", async () => {
    const { store, gate, provider } = setup();
    const retail = makeInstallation("retail", "11.0.2");
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

    await gate.checkNow();
    expect(provider.getAllCalls).toBe(1);

    // simulated second trigger (e.g. a resume-from-suspend minutes later)
    const second = await gate.checkNow();
    expect(second).toEqual({ toast: null });
    expect(provider.getAllCalls).toBe(1); // no second network pass
  });

  test("checks again once a full day has actually passed", async () => {
    const { store, gate, provider } = setup();
    const retail = makeInstallation("retail", "11.0.2");
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

    await gate.checkNow();
    expect(provider.getAllCalls).toBe(1);

    store.updateSettings({ lastUpdateCheckAt: Date.now() - ONE_DAY_MS - 1000 });
    const second = await gate.checkNow();
    expect(second.toast).not.toBeNull();
    expect(provider.getAllCalls).toBe(2);
  });

  test("a stamp in the future (the clock moved back) runs one check, then the day holds again", async () => {
    const { store, gate, provider } = setup();
    store.setInstallations([makeInstallation("retail", "11.0.2")]);
    store.addons.create(
      makeAddon({ id: "a1", name: "Bagnon", installationId: "retail", providerName: "TukUI", externalId: "1" }),
    );
    store.updateSettings({ lastUpdateCheckAt: Date.now() + ONE_DAY_MS * 30 });

    // Trusting the stamp would silence the check for a month; it runs once
    // and replaces the stamp with now…
    await gate.checkNow();
    expect(provider.getAllCalls).toBe(1);
    expect(store.settings.lastUpdateCheckAt!).toBeLessThanOrEqual(Date.now());

    // …so the next trigger is inside the day, not another run.
    await gate.checkNow();
    expect(provider.getAllCalls).toBe(1);
  });

  test("disabled: never checks, never touches lastUpdateCheckAt, no network", async () => {
    const { store, gate, provider } = setup();
    const retail = makeInstallation("retail", "11.0.2");
    store.setInstallations([retail]);
    store.updateSettings({ updateToastEnabled: false });

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: null });
    expect(store.settings.lastUpdateCheckAt).toBeNull();
    expect(provider.getAllCalls).toBe(0);
  });

  test("toast off but auto-update on: the check runs and is stamped, no toast", async () => {
    const { store, gate, provider } = setup();
    store.setInstallations([makeInstallation("retail", "11.0.2")]);
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
    store.updateSettings({ updateToastEnabled: false, autoUpdate: true });

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: null });
    expect(store.settings.lastUpdateCheckAt).not.toBeNull();
    expect(provider.getAllCalls).toBe(1);
  });

  test("ignored addons never count toward the toast", async () => {
    const { store, gate } = setup();
    const retail = makeInstallation("retail", "11.0.2");
    store.setInstallations([retail]);
    store.addons.create(
      makeAddon({
        id: "a1",
        name: "Ignored",
        installationId: "retail",
        providerName: "TukUI",
        externalId: "1",
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        isIgnored: true,
      }),
    );

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: null });
  });

  test("sums eligible updates across multiple installations independently", async () => {
    const { store, gate } = setup();
    const retail = makeInstallation("retail", "11.0.2");
    const era = makeInstallation("era", "1.15.7");
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
        name: "WeakAuras",
        installationId: "era",
        providerName: "TukUI",
        externalId: "2",
        installedVersion: "5.0",
        latestVersion: "5.1",
      }),
    );
    store.addons.create(
      makeAddon({
        id: "a3",
        name: "AlsoOnEra",
        installationId: "era",
        providerName: "TukUI",
        externalId: "3",
        installedVersion: "1.0",
        latestVersion: "1.1",
      }),
    );

    const result = await gate.checkNow();
    expect(result).toEqual({ toast: { title: "3 addon updates available", body: "In retail and era" } });
  });

  test("concurrent checkNow calls never duplicate the network refresh", async () => {
    const { store, gate, provider } = setup();
    const retail = makeInstallation("retail", "11.0.2");
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

    const [first, second] = [gate.checkNow(), gate.checkNow()];
    expect(await Promise.all([first, second])).toEqual([{ toast: null }, { toast: null }]);
    expect(provider.getAllCalls).toBe(1);
  });
});
