import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonInstaller } from "../src/wow/addons/AddonInstaller";
import { needsUpdate } from "../src/wow/addons/addonStatus";
import { recordFolders } from "../src/wow/addons/AddonRecords";
import { WARNING_FOLDERS_MISSING, missingDependencies, toWireAddon } from "../src/wow/addons/wire";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";
import { UpdateCheck } from "../src/wow/notifications/UpdateCheck";

/** The check every installation goes through (UpdateCheck), as main.ts runs it. */
const checkAll = (service: AddonService, options?: { autoUpdate?: boolean }) =>
  new UpdateCheck(service, new CompanionSyncCoordinator(service)).checkAll(options);
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowAddon, WowInstallation } from "../src/wow/models";
import type { Toc } from "../src/wow/toc/toc";
import { AddonChannelType, AddonDependencyType, WowClientType, type AddonProviderType } from "../src/wow/types";
import type { OperationResult } from "../src/api/contracts";

const roots: string[] = [];

/** A fresh directory for one test's store and game folder; removed after the test. */
function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-service-${name}-`));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  releaseId: string;
  folders: string[];
  requiredDependencyIds?: string[];
  /** The provider lists no folders for its files (WoWInterface); the archive still holds `folders`. */
  unlisted?: boolean;
  /** Pre-release files besides the stable one (release channels, WF-03). */
  prereleases?: Array<{ channelType: AddonChannelType; version: string; releaseId: string; releaseDate: string }>;
}

/** The stable file's date; prerelease fixtures date themselves around it. */
const STABLE_DATE = "2026-06-01T00:00:00.000Z";

class FakeProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  failGetById = false;
  override allowReinstall = true;
  override allowChannelChange = true;
  /** Errors getAll() reports alongside its results (a partial failure). */
  getAllErrors: Error[] = [];

  constructor(public catalog: CatalogEntry[]) {
    super();
  }

  override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
    if (this.failGetById) {
      throw new Error("provider down");
    }
    const entry = this.catalog.find((c) => c.id === addonId);
    return entry ? this.toResult(entry) : undefined;
  }

  override async getAll(_installation: WowInstallation, addonIds: string[]): Promise<{ searchResults: AddonSearchResult[]; errors: Error[] }> {
    return {
      searchResults: this.catalog.filter((c) => addonIds.includes(c.id)).map((c) => this.toResult(c)),
      errors: this.getAllErrors,
    };
  }

  override async searchByQuery(query: string): Promise<AddonSearchResult[]> {
    return this.catalog.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).map((c) => this.toResult(c));
  }

  override isValidAddonId(addonId: string): boolean {
    return /^\d+$/.test(addonId);
  }

  private toResult(entry: CatalogEntry): AddonSearchResult {
    return {
      author: "Dev",
      externalId: entry.id,
      externalUrl: `https://fake/${entry.id}`,
      name: entry.name,
      providerName: this.name,
      downloadCount: 100,
      files: [
        {
          channelType: 0,
          folders: entry.unlisted ? [] : entry.folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${entry.id}.zip`,
          version: entry.version,
          releaseDate: STABLE_DATE,
          externalId: entry.releaseId,
          dependencies: (entry.requiredDependencyIds ?? []).map((externalAddonId) => ({
            externalAddonId,
            type: AddonDependencyType.Required,
          })),
        },
        ...(entry.prereleases ?? []).map((p) => ({
          channelType: p.channelType,
          folders: entry.folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${entry.id}.zip?v=${p.version}`,
          version: p.version,
          releaseDate: p.releaseDate,
          externalId: p.releaseId,
        })),
      ],
    };
  }
}

function zipFor(entry: CatalogEntry, version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of entry.folders) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
      `## Title: ${entry.name}\n## Version: ${version}\n## Interface: 110005\n`,
    );
  }
  return zipSync(files);
}

function makeNetwork(catalog: CatalogEntry[], versions: Record<string, string>): NetworkClient {
  return {
    downloadToFile: async (url: string, dest: string) => {
      const [, id, fileVersion] = url.match(/dl\/(\d+)\.zip(?:\?v=(.+))?/)!;
      const entry = catalog.find((c) => c.id === id!)!;
      const bytes = zipFor(entry, fileVersion ?? versions[id!] ?? entry.version);
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
}

let service: AddonService;
let provider: FakeProvider;
let installation: WowInstallation;
let versions: Record<string, string>;

beforeEach(() => {
  const root = tempRoot("shared");
  const installRoot = join(root, "_retail_");
  mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
  installation = {
    id: "inst1",
    clientType: WowClientType.Retail,
    location: installRoot,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };

  provider = new FakeProvider([
    { id: "111", name: "AlphaAddon", version: "1.0.0", releaseId: "r1", folders: ["AlphaAddon"] },
    { id: "222", name: "BetaSuite", version: "2.0.0", releaseId: "r2", folders: ["BetaSuite", "BetaLib"] },
  ]);
  versions = { "111": "1.0.0", "222": "2.0.0" };

  const registry = new ProviderRegistry();
  registry.register(provider);

  const store = createStateStore(root);
  store.setInstallations([installation]);

  const events = {
    addonsChanged: () => {},
    operationResult: () => {},
  };

  service = new AddonService(store, registry, new DownloadService(makeNetwork(provider.catalog, versions), join(root, "dl")), events);
});

describe("needsUpdate", () => {
  const base: WowAddon = {
    id: "a",
    name: "A",
    installationId: "i",
    channelType: 0,
    isIgnored: false,
    isLoadOnDemand: false,
  };

  test("ignored addons never update", () => {
    expect(needsUpdate({ ...base, isIgnored: true, latestVersion: "9", installedVersion: "1" })).toBe(false);
  });

  test("release id difference wins over version strings", () => {
    expect(
      needsUpdate({
        ...base,
        installedVersion: "1.0",
        latestVersion: "1.0",
        installedExternalReleaseId: "r1",
        externalLatestReleaseId: "r2",
      }),
    ).toBe(true);
  });

  // Matching release ids are authoritative in both directions —
  // deliberately NOT upstream-verbatim (see needsUpdate's doc comment).
  // Our installer re-reads the real TOC for installedVersion, so the TOC
  // and provider version strings can legitimately differ for the exact
  // same release; without this, every such addon would show a permanent
  // false "update available".
  test("matching release ids suppress a cosmetic version-string mismatch", () => {
    expect(
      needsUpdate({
        ...base,
        installedVersion: "1.0 (fun name)",
        latestVersion: "1.0",
        installedExternalReleaseId: "r1",
        externalLatestReleaseId: "r1",
      }),
    ).toBe(false);
  });

  test("version string compare with v-prefix normalization", () => {
    expect(needsUpdate({ ...base, installedVersion: "v1.0", latestVersion: "1.1" })).toBe(true);
    expect(needsUpdate({ ...base, installedVersion: "v1.0", latestVersion: "v1.0" })).toBe(false);
    expect(needsUpdate({ ...base, installedVersion: "", latestVersion: "v1.0" })).toBe(false);
  });
});

describe("AddonService lifecycle", () => {
  test("install then list then detect update then update", async () => {
    // install AlphaAddon
    const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
    const addonsPath = join(installation.location, "Interface", "AddOns");
    expect(existsSync(join(addonsPath, "AlphaAddon", "AlphaAddon.toc"))).toBe(true);
    expect(addon.version).toBe("1.0.0");
    expect(stored({ service, installation }, addon.id).installedExternalReleaseId).toBe("r1");

    // listed as managed with no update
    let addons = await service.listAddons(installation);
    const alpha = addons.find((a) => a.id === addon.id)!;
    expect(alpha.providerId).toBe("WowUpHub");
    expect(alpha.updateAvailable).toBe(false);
    // a plain install is not an update (PC-07)
    expect(alpha.newlyUpdated).toBe(false);

    // provider publishes 1.1.0 / r2
    provider.catalog[0]!.version = "1.1.0";
    provider.catalog[0]!.releaseId = "r2";
    versions["111"] = "1.1.0";

    await service.refresh(installation);
    addons = await service.listAddons(installation);
    const alphaUpdated = addons.find((a) => a.id === addon.id)!;
    expect(alphaUpdated.updateAvailable).toBe(true);
    expect(alphaUpdated.availableVersion).toBe("1.1.0");

    // update it
    const { operation, addon: updated } = await service.updateAddon(addon.id);
    expect(operation.status).toBe("updated");
    expect(updated.version).toBe("1.1.0");
    expect(stored({ service, installation }, addon.id).installedExternalReleaseId).toBe("r2");
    expect(readFileSync(join(addonsPath, "AlphaAddon", "AlphaAddon.toc"), "utf-8")).toContain("1.1.0");
    expect(stored({ service, installation }, addon.id).lastUpdatedAt).toBeNumber();
    expect(updated.newlyUpdated).toBe(true);

    // no further update
    const { operation: again } = await service.updateAddon(addon.id);
    expect(again.status).toBe("current");
  });

  test("multi-folder suite installs all folders", async () => {
    const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "222", installation: installation });
    const addonsPath = join(installation.location, "Interface", "AddOns");
    expect(existsSync(join(addonsPath, "BetaSuite", "BetaSuite.toc"))).toBe(true);
    expect(existsSync(join(addonsPath, "BetaLib", "BetaLib.toc"))).toBe(true);
    expect(stored({ service, installation }, addon.id).installedFolderList).toEqual(["BetaSuite", "BetaLib"]);
  });

  test("remove deletes folders and record", async () => {
    const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
    await service.removeAddon(addon.id);
    const addonsPath = join(installation.location, "Interface", "AddOns");
    expect(existsSync(join(addonsPath, "AlphaAddon"))).toBe(false);
    const addons = await service.listAddons(installation);
    expect(addons.find((a) => a.id === addon.id)).toBeUndefined();
  });

  test("updateAll isolates failures", async () => {
    const a1 = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
    const a2 = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "222", installation: installation });
    provider.catalog[0]!.version = "2.0.0";
    provider.catalog[0]!.releaseId = "r9";
    provider.catalog[1]!.version = "3.0.0";
    provider.catalog[1]!.releaseId = "r8";
    versions["111"] = "2.0.0";
    versions["222"] = "3.0.0";
    await service.refresh(installation);

    // make one addon unresolvable: provider loses it after refresh
    provider.catalog = provider.catalog.filter((c) => c.id !== "222");

    const operations = await service.updateAll(installation);
    expect(operations).toHaveLength(2);
    const failed = operations.find((o) => o.status === "failed");
    const updated = operations.find((o) => o.status === "updated");
    expect(failed?.addonId).toBe(a2.addon.id);
    expect(failed?.error).toBeTruthy();
    expect(updated?.addonId).toBe(a1.addon.id);
    // updated one actually has new files
    expect((await service.listAddons(installation)).find((a) => a.id === a1.addon.id)!.version).toBe("2.0.0");
  });

  test("install rejects unknown provider and invalid id", async () => {
    await expect(service.install({ intent: "install", providerId: "Nope", externalId: "1", installation: installation })).rejects.toThrow(/isn't available|isn't in your list|weren't found|wasn't found/i);
    await expect(service.install({ intent: "install", providerId: "WowUpHub", externalId: "abc", installation: installation })).rejects.toThrow(/isn't valid/i);
  });

  test("unmanaged on-disk folders are listed with provider null", async () => {
    const addonsPath = join(installation.location, "Interface", "AddOns");
    mkdirSync(join(addonsPath, "LooseAddon"), { recursive: true });
    writeFileSync(join(addonsPath, "LooseAddon", "LooseAddon.toc"), "## Title: Loose\n## Version: 0.1\n");
    const addons = await service.listAddons(installation);
    const loose = addons.find((a) => a.folderName === "LooseAddon")!;
    expect(loose.providerId).toBeNull();
    expect(loose.name).toBe("Loose");
  });

  // WF-20: the Details Folders page and Show in file manager.
  describe("addonFolders", () => {
    test("a managed addon's recorded folders, with paths and which are on disk", async () => {
      const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
      const addonsPath = join(installation.location, "Interface", "AddOns");
      const names = recordFolders(stored({ service, installation }, addon.id));
      const result = await service.addonFolders(installation, addon.id);
      expect(result.addonsPath).toBe(addonsPath);
      expect(result.folders).toEqual(names.map((name) => ({ name, path: join(addonsPath, name), present: true })));

      renameSync(join(addonsPath, names[0]!), join(installation.location, "moved-away"));
      try {
        expect((await service.addonFolders(installation, addon.id)).folders[0]!.present).toBe(false);
      } finally {
        renameSync(join(installation.location, "moved-away"), join(addonsPath, names[0]!));
      }
    });

    test("an unmanaged addon's one folder; anything else is not found", async () => {
      const addonsPath = join(installation.location, "Interface", "AddOns");
      mkdirSync(join(addonsPath, "LooseFolders"), { recursive: true });
      writeFileSync(join(addonsPath, "LooseFolders", "LooseFolders.toc"), "## Title: Loose\n");
      expect((await service.addonFolders(installation, "unmanaged:LooseFolders")).folders).toEqual([
        { name: "LooseFolders", path: join(addonsPath, "LooseFolders"), present: true },
      ]);

      const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
      for (const id of ["unmanaged:NotThere", "unmanaged:../..", `unmanaged:${addon.folderName}`, "no-such-id"]) {
        await expect(service.addonFolders(installation, id)).rejects.toThrow(/isn't in your list/);
      }
    });

    test("recordFolders reads the list, or the comma-joined field older records carry alone", () => {
      expect(recordFolders({ installedFolderList: ["A", "B"], installedFolders: "X" })).toEqual(["A", "B"]);
      expect(recordFolders({ installedFolderList: [], installedFolders: "A, B ,," })).toEqual(["A", "B"]);
      expect(recordFolders({})).toEqual([]);
    });
  });

  // Removing an unmanaged addon is a pure filesystem op with no WowAddon
  // record to key off, so it needs its own path with its own safety checks.
  describe("removeUnmanagedFolder", () => {
    test("deletes the folder and never creates a managed record", async () => {
      const addonsPath = join(installation.location, "Interface", "AddOns");
      mkdirSync(join(addonsPath, "UnmanagedToRemove"), { recursive: true });
      writeFileSync(
        join(addonsPath, "UnmanagedToRemove", "UnmanagedToRemove.toc"),
        "## Title: Loose2\n## Version: 0.1\n",
      );

      const operation = await service.removeUnmanagedFolder(installation, "UnmanagedToRemove");
      expect(operation.status).toBe("removed");
      expect(existsSync(join(addonsPath, "UnmanagedToRemove"))).toBe(false);

      const addons = await service.listAddons(installation);
      expect(addons.find((a) => a.folderName === "UnmanagedToRemove")).toBeUndefined();
      expect(service.addonsFor(installation.id).some((a) => a.id === "unmanaged:UnmanagedToRemove")).toBe(
        false,
      );
    });

    test("refuses a folder that belongs to a managed addon", async () => {
      const { addon } = await service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: installation });
      await expect(
        service.removeUnmanagedFolder(installation, addon.folderName),
      ).rejects.toThrow(/managed/i);
      // the managed addon must be untouched
      const addons = await service.listAddons(installation);
      expect(addons.find((a) => a.id === addon.id)).toBeDefined();
    });

    test("refuses folders that are never touched, whatever the caller sends", async () => {
      const addonsPath = join(installation.location, "Interface", "AddOns");
      // A git checkout may hold unpushed work; the companion bridge owns its folder.
      mkdirSync(join(addonsPath, "DevCheckout", ".git"), { recursive: true });
      writeFileSync(join(addonsPath, "DevCheckout", "DevCheckout.toc"), "## Title: Dev\n");
      mkdirSync(join(addonsPath, "wowup_data_addon"), { recursive: true });
      writeFileSync(join(addonsPath, "wowup_data_addon", "wowup_data_addon.toc"), "## Title: WowUp data\n");
      for (const name of ["DevCheckout", "wowup_data_addon", "NotThere"]) {
        await expect(service.removeUnmanagedFolder(installation, name)).rejects.toThrow(/isn't an unmanaged/);
      }
      expect(existsSync(join(addonsPath, "DevCheckout", ".git"))).toBe(true);
      expect(existsSync(join(addonsPath, "wowup_data_addon"))).toBe(true);
      rmSync(join(addonsPath, "DevCheckout"), { recursive: true });
      rmSync(join(addonsPath, "wowup_data_addon"), { recursive: true });
    });

    test("rejects a folder name shaped like a path", async () => {
      await expect(service.removeUnmanagedFolder(installation, "../evil")).rejects.toThrow(
        /invalid addon folder name/i,
      );
      await expect(service.removeUnmanagedFolder(installation, "sub/dir")).rejects.toThrow(
        /invalid addon folder name/i,
      );
    });
  });
});

describe("newly updated window (PC-07)", () => {
  test("an addon counts as newly updated until the window has passed", () => {
    const addon = {
      id: "a",
      name: "A",
      installationId: "i",
      channelType: AddonChannelType.Stable,
      isIgnored: false,
      isLoadOnDemand: false,
      lastUpdatedAt: 1_000,
    } satisfies WowAddon;
    const day = 24 * 3_600_000;
    expect(toWireAddon(addon, { newlyUpdatedMs: day, now: 1_000 + day - 1 }).newlyUpdated).toBe(true);
    expect(toWireAddon(addon, { newlyUpdatedMs: day, now: 1_000 + day }).newlyUpdated).toBe(false);
    expect(toWireAddon({ ...addon, lastUpdatedAt: undefined }, { newlyUpdatedMs: day }).newlyUpdated).toBe(false);
  });
});

describe("install()/updateAddon() broadcast status (UUID-toast regression)", () => {
  test("the broadcast operationResult for an update reports 'updated', not 'installed'", async () => {
    // Dedicated fixtures (not the module-level `service`/`provider`
    // above) so this test can capture every operationResult event
    // without interfering with the other tests sharing that instance.
    const events: OperationResult[] = [];
    const localProvider = new FakeProvider([
      { id: "333", name: "GammaWidget", version: "1.0.0", releaseId: "g1", folders: ["GammaWidget"] },
    ]);
    const localVersions: Record<string, string> = { "333": "1.0.0" };
    const registry = new ProviderRegistry();
    registry.register(localProvider);

    const localRoot = tempRoot("event-status");
    const installRoot = join(localRoot, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const localInstallation: WowInstallation = {
      id: "inst-event",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(makeNetwork(localProvider.catalog, localVersions), join(localRoot, "dl")),
      {
        addonsChanged: () => {},
        operationResult: (op) => events.push(op),
      },
    );

    const { addon } = await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "333", installation: localInstallation });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("installed"); // a genuine fresh install is still reported as such

    localProvider.catalog[0]!.version = "1.1.0";
    localProvider.catalog[0]!.releaseId = "g2";
    localVersions["333"] = "1.1.0";

    events.length = 0;
    await localService.updateAddon(addon.id);

    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("updated");
  });
});

describe("install()/updateAddon() report failures as a failed operation, never a thrown error", () => {
  test("install() returns status 'failed' with a message when the download step throws", async () => {
    const localProvider = new FakeProvider([
      { id: "444", name: "DeltaWidget", version: "1.0.0", releaseId: "d1", folders: ["DeltaWidget"] },
    ]);
    const registry = new ProviderRegistry();
    registry.register(localProvider);

    const localRoot = tempRoot("install-failure");
    const installRoot = join(localRoot, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const localInstallation: WowInstallation = {
      id: "inst-install-failure",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const failingNetwork = {
      downloadToFile: async () => {
        throw new Error("simulated CDN failure");
      },
    } as unknown as NetworkClient;
    const localService = new AddonService(store, registry, new DownloadService(failingNetwork, join(localRoot, "dl")), {
      addonsChanged: () => {},
      operationResult: () => {},
    });

    const { operation } = await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "444", installation: localInstallation });
    expect(operation.status).toBe("failed");
    expect(operation.error).toContain("simulated CDN failure");
  });

  test("updateAddon() returns status 'failed' with a message when fetching latest metadata throws", async () => {
    const localProvider = new FakeProvider([
      { id: "555", name: "EpsilonWidget", version: "1.0.0", releaseId: "e1", folders: ["EpsilonWidget"] },
    ]);
    const localVersions: Record<string, string> = { "555": "1.0.0" };
    const registry = new ProviderRegistry();
    registry.register(localProvider);

    const localRoot = tempRoot("update-failure");
    const installRoot = join(localRoot, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const localInstallation: WowInstallation = {
      id: "inst-update-failure",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(makeNetwork(localProvider.catalog, localVersions), join(localRoot, "dl")),
      { addonsChanged: () => {}, operationResult: () => {} },
    );

    const { addon } = await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "555", installation: localInstallation });

    localProvider.failGetById = true;
    try {
      const { operation } = await localService.updateAddon(addon.id);
      expect(operation.status).toBe("failed");
      expect(operation.error).toContain("provider down");
    } finally {
      localProvider.failGetById = false;
    }
  });
});

describe("required-dependency auto-install and autoremove (apt/pacman-style)", () => {
  test("installing an addon auto-installs its required dependency, marked isDependency; removing both cleans up the dependency too", async () => {
    const localProvider = new FakeProvider([
      { id: "700", name: "Core", version: "1.0.0", releaseId: "c1", folders: ["Core"] },
      {
        id: "701",
        name: "Suite",
        version: "1.0.0",
        releaseId: "s1",
        folders: ["Suite"],
        requiredDependencyIds: ["700"],
      },
    ]);
    const registry = new ProviderRegistry();
    registry.register(localProvider);
    const localRoot = tempRoot("autoinstall");
    const installRoot = join(localRoot, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const localInstallation: WowInstallation = {
      id: "inst-autoinstall",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(makeNetwork(localProvider.catalog, { "700": "1.0.0", "701": "1.0.0" }), join(localRoot, "dl")),
      { addonsChanged: () => {}, operationResult: () => {} },
    );

    const { addon: suite } = await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "701", installation: localInstallation });
    expect(suite.name).toBe("Suite");

    const core = store.addons.all().find((a) => a.externalId === "700");
    expect(core).toBeTruthy();
    expect(core!.isDependency).toBe(true);
    expect(suite.installedAsDependency).toBe(false);

    await localService.removeAddon(suite.id);
    expect(store.addons.all().find((a) => a.externalId === "701")).toBeUndefined();
    expect(store.addons.all().find((a) => a.externalId === "700")).toBeUndefined(); // orphaned dependency autoremoved
  });

  test("autoremove leaves a dependency alone while something else still needs it", async () => {
    const localProvider = new FakeProvider([
      { id: "710", name: "Core2", version: "1.0.0", releaseId: "c2", folders: ["Core2"] },
      {
        id: "711",
        name: "SuiteA",
        version: "1.0.0",
        releaseId: "sa1",
        folders: ["SuiteA"],
        requiredDependencyIds: ["710"],
      },
      {
        id: "712",
        name: "SuiteB",
        version: "1.0.0",
        releaseId: "sb1",
        folders: ["SuiteB"],
        requiredDependencyIds: ["710"],
      },
    ]);
    const registry = new ProviderRegistry();
    registry.register(localProvider);
    const localRoot = tempRoot("autoinstall-shared");
    const installRoot = join(localRoot, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const localInstallation: WowInstallation = {
      id: "inst-shared",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(
        makeNetwork(localProvider.catalog, { "710": "1.0.0", "711": "1.0.0", "712": "1.0.0" }),
        join(localRoot, "dl"),
      ),
      { addonsChanged: () => {}, operationResult: () => {} },
    );

    const { addon: suiteA } = await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "711", installation: localInstallation });
    await localService.install({ intent: "install", providerId: "WowUpHub", externalId: "712", installation: localInstallation });
    expect(store.addons.all().filter((a) => a.externalId === "710")).toHaveLength(1); // not double-installed

    await localService.removeAddon(suiteA.id);
    expect(store.addons.all().find((a) => a.externalId === "710")).toBeTruthy(); // SuiteB still needs it
  });
});

/** An addon as My Addons lists it now. */
async function listed(f: { service: AddonService; installation: WowInstallation }, id: string) {
  return (await f.service.listAddons(f.installation)).find((a) => a.id === id)!;
}

/** The stored record behind an addon, for what the wire form does not show. */
function stored(f: { service: AddonService; installation: WowInstallation }, id: string) {
  return f.service.addonsFor(f.installation.id).find((a) => a.id === id)!;
}

/** A service with its own provider, store and AddOns folder, for tests that must not share state. */
function localFixture(name: string, catalog: CatalogEntry[]) {
  const localProvider = new FakeProvider(catalog);
  const localVersions: Record<string, string> = Object.fromEntries(catalog.map((c) => [c.id, c.version]));
  const registry = new ProviderRegistry();
  registry.register(localProvider);
  const localRoot = tempRoot(name);
  const installRoot = join(localRoot, "_retail_");
  const addonsPath = join(installRoot, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  const localInstallation: WowInstallation = {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location: installRoot,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const store = createStateStore(localRoot);
  store.setInstallations([localInstallation]);
  const operations: OperationResult[] = [];
  const changed: string[][] = [];
  // Each download's URL, in order: a test waits on it to act while an install runs.
  const downloads: string[] = [];
  const network = makeNetwork(localProvider.catalog, localVersions);
  const downloadToFile = network.downloadToFile.bind(network);
  network.downloadToFile = (url, ...rest) => {
    downloads.push(url);
    return downloadToFile(url, ...rest);
  };
  const localService = new AddonService(
    store,
    registry,
    new DownloadService(network, join(localRoot, "dl")),
    {
      addonsChanged: (ids) => changed.push(ids),
      operationResult: (op) => operations.push(op),
    },
  );
  return {
    service: localService,
    provider: localProvider,
    versions: localVersions,
    store,
    installation: localInstallation,
    addonsPath,
    operations,
    changed,
    downloads,
  };
}

describe("libraries in My Addons (WF-22)", () => {
  test("a pulled-in dependency is a library needed by its dependant; a hand-installed one is not", async () => {
    const f = localFixture("libraries", [
      { id: "790", name: "LibCore", version: "1.0.0", releaseId: "l1", folders: ["LibCore"] },
      { id: "791", name: "UsesLib", version: "1.0.0", releaseId: "u1", folders: ["UsesLib"], requiredDependencyIds: ["790"] },
    ]);
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "791", installation: f.installation });
    const listed = await f.service.listAddons(f.installation);
    const lib = listed.find((a) => a.externalId === "790")!;
    const user = listed.find((a) => a.externalId === "791")!;
    expect(lib).toMatchObject({ installedAsDependency: true, neededBy: ["UsesLib"] });
    expect(user).toMatchObject({ installedAsDependency: false, neededBy: [] });

    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "790", installation: f.installation }); // the user installs it themselves
    expect((await f.service.listAddons(f.installation)).find((a) => a.externalId === "790")).toMatchObject({
      installedAsDependency: false,
      neededBy: ["UsesLib"],
    });
  });
});

describe("dependency flag after a direct install", () => {
  const catalog = (): CatalogEntry[] => [
    { id: "720", name: "Core3", version: "1.0.0", releaseId: "c3", folders: ["Core3"] },
    { id: "721", name: "Suite3", version: "1.0.0", releaseId: "s3", folders: ["Suite3"], requiredDependencyIds: ["720"] },
  ];

  test("installing a pulled-in dependency yourself keeps it when its dependent is removed", async () => {
    const f = localFixture("dep-manual", catalog());
    const { addon: suite } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "721", installation: f.installation });
    expect(f.store.addons.all().find((a) => a.externalId === "720")!.isDependency).toBe(true);

    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "720", installation: f.installation });
    expect(f.store.addons.all().find((a) => a.externalId === "720")!.isDependency).toBe(false);

    await f.service.removeAddon(suite.id);
    expect(f.store.addons.all().find((a) => a.externalId === "720")).toBeTruthy();
    expect(existsSync(join(f.addonsPath, "Core3"))).toBe(true);
  });

  test("updating a dependency keeps it marked, so autoremove still cleans it up", async () => {
    const f = localFixture("dep-update", catalog());
    const { addon: suite } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "721", installation: f.installation });
    const core = f.store.addons.all().find((a) => a.externalId === "720")!;
    f.provider.catalog[0]!.version = "1.1.0";
    f.provider.catalog[0]!.releaseId = "c3b";
    f.versions["720"] = "1.1.0";

    const { operation } = await f.service.updateAddon(core.id);
    expect(operation.status).toBe("updated");
    expect(f.store.addons.all().find((a) => a.externalId === "720")!.isDependency).toBe(true);

    await f.service.removeAddon(suite.id);
    expect(f.store.addons.all().find((a) => a.externalId === "720")).toBeUndefined();
  });
});

describe("why an addon is ignored or needs attention (WF-04)", () => {
  const catalog = (): CatalogEntry[] => [
    { id: "730", name: "Solo", version: "1.0.0", releaseId: "o1", folders: ["Solo"] },
    { id: "731", name: "Pack", version: "1.0.0", releaseId: "p1", folders: ["Pack", "PackLib"] },
  ];
  const listed = async (f: ReturnType<typeof localFixture>, id: string) =>
    (await f.service.listAddons(f.installation)).find((a) => a.id === id)!;

  test("a deleted folder of a suite is reported, and clears when the folder is back", async () => {
    const f = localFixture("why-folders", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "731", installation: f.installation });
    expect((await listed(f, addon.id)).problem).toBeNull();

    renameSync(join(f.addonsPath, "PackLib"), join(f.addonsPath, "..", "PackLib.away"));
    const missing = await listed(f, addon.id);
    expect(missing.problem).toBe("folders_missing");
    expect(missing.broken).toBe(true);

    renameSync(join(f.addonsPath, "..", "PackLib.away"), join(f.addonsPath, "PackLib"));
    const back = await listed(f, addon.id);
    expect(back.problem).toBeNull();
    expect(back.broken).toBe(false);
  });

  test("the old misnamed 'missing-on-provider' value is read as folders missing and cleared when they are present", async () => {
    const f = localFixture("why-legacy", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    f.store.addons.patch(addon.id, { warningType: "missing-on-provider" });

    expect((await listed(f, addon.id)).problem).toBeNull();
    expect(f.store.addons.all().find((a) => a.id === addon.id)!.warningType).toBeUndefined();
  });

  test("refresh marks an addon the provider no longer returns, and clears it when it comes back", async () => {
    const f = localFixture("why-provider", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    const entry = f.provider.catalog.find((c) => c.id === "730")!;

    f.provider.catalog.splice(f.provider.catalog.indexOf(entry), 1);
    await f.service.refresh(f.installation);
    expect((await listed(f, addon.id)).problem).toBe("not_on_provider");

    f.provider.catalog.push(entry);
    await f.service.refresh(f.installation);
    expect((await listed(f, addon.id)).problem).toBeNull();
  });

  test("a partial provider failure does not mark missing addons", async () => {
    const f = localFixture("why-partial", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    f.provider.catalog = f.provider.catalog.filter((c) => c.id !== "730");
    f.provider.getAllErrors = [new Error("rate limited")];

    await f.service.refresh(f.installation);
    expect((await listed(f, addon.id)).problem).toBeNull();
  });

  test("folders missing wins over not on provider", async () => {
    const f = localFixture("why-both", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    rmSync(join(f.addonsPath, "Solo"), { recursive: true });
    expect((await listed(f, addon.id)).problem).toBe("folders_missing");

    f.provider.catalog = f.provider.catalog.filter((c) => c.id !== "730");
    await f.service.refresh(f.installation);
    expect(f.store.addons.all().find((a) => a.id === addon.id)!.warningType).toBe(WARNING_FOLDERS_MISSING);
  });

  test("updateAddon records 'no longer available' as not on provider", async () => {
    const f = localFixture("why-update", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    f.provider.catalog = f.provider.catalog.filter((c) => c.id !== "730");

    const { operation } = await f.service.updateAddon(addon.id);
    expect(operation.status).toBe("failed");
    expect((await listed(f, addon.id)).problem).toBe("not_on_provider");
  });

  test("ignored from the menu says 'user'; a git checkout is listed as ignored with reason 'git_repo'", async () => {
    const f = localFixture("why-ignored", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "730", installation: f.installation });
    await f.service.setIgnored(addon.id, true);
    const ignored = await listed(f, addon.id);
    expect(ignored.ignored).toBe(true);
    expect(ignored.ignoreReason).toBe("user");

    mkdirSync(join(f.addonsPath, "MyDevAddon", ".git"), { recursive: true });
    writeFileSync(join(f.addonsPath, "MyDevAddon", "MyDevAddon.toc"), "## Title: My Dev Addon\n## Version: dev\n");
    const git = (await f.service.listAddons(f.installation)).find((a) => a.folderName === "MyDevAddon")!;
    expect(git.providerId).toBeNull();
    expect(git.ignored).toBe(true);
    expect(git.ignoreReason).toBe("git_repo");
    expect(git.name).toBe("My Dev Addon");

    const plain = (await f.service.listAddons(f.installation)).find((a) => a.id === addon.id && !a.ignored);
    expect(plain).toBeUndefined();
  });
});

describe("reinstall (WF-05)", () => {
  const catalog = (): CatalogEntry[] => [
    { id: "740", name: "Fixme", version: "1.0.0", releaseId: "f1", folders: ["Fixme", "FixmeLib"] },
    { id: "741", name: "Needs", version: "1.0.0", releaseId: "n1", folders: ["Needs"], requiredDependencyIds: ["740"] },
  ];

  test("puts deleted files and folders back, clears folders missing, reports installed", async () => {
    const f = localFixture("reinstall-repair", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "740", installation: f.installation });
    expect(addon.canReinstall).toBe(true);
    rmSync(join(f.addonsPath, "Fixme", "Fixme.toc"));
    rmSync(join(f.addonsPath, "FixmeLib"), { recursive: true });
    expect((await f.service.listAddons(f.installation)).find((a) => a.id === addon.id)!.problem).toBe("folders_missing");

    f.operations.length = 0;
    const { operation } = await f.service.reinstall(addon.id);
    expect(operation.status).toBe("installed");
    expect(f.operations.map((o) => o.status)).toEqual(["installed"]);
    expect(existsSync(join(f.addonsPath, "Fixme", "Fixme.toc"))).toBe(true);
    expect(existsSync(join(f.addonsPath, "FixmeLib", "FixmeLib.toc"))).toBe(true);
    const listed = (await f.service.listAddons(f.installation)).find((a) => a.id === addon.id)!;
    expect(listed.problem).toBeNull();
    expect(f.store.addons.all().filter((a) => a.externalId === "740")).toHaveLength(1); // same record, not a second one
  });

  test("a reinstalled dependency stays a dependency", async () => {
    const f = localFixture("reinstall-dep", catalog());
    const { addon: needs } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "741", installation: f.installation });
    const dep = f.store.addons.all().find((a) => a.externalId === "740")!;
    await f.service.reinstall(dep.id);
    expect(f.store.addons.all().find((a) => a.externalId === "740")!.isDependency).toBe(true);
    await f.service.removeAddon(needs.id);
    expect(f.store.addons.all().find((a) => a.externalId === "740")).toBeUndefined();
  });

  test("refused when the provider does not allow it; unknown id is not found", async () => {
    const f = localFixture("reinstall-refused", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "740", installation: f.installation });
    f.provider.allowReinstall = false;
    expect((await listed(f, addon.id)).canReinstall).toBe(false);
    await expect(f.service.reinstall(addon.id)).rejects.toThrow(/can't be reinstalled/);
    await expect(f.service.reinstall("nope")).rejects.toThrow(/isn't available|isn't in your list|weren't found|wasn't found/i);
  });
});

describe("dependencies on the wire (WF-11)", () => {
  test("a managed addon lists its TOC dependencies, minus its own folders", async () => {
    const f = localFixture("wire-deps", [
      { id: "750", name: "Dep", version: "1.0.0", releaseId: "d1", folders: ["DepMain", "DepLib"] },
    ]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
    writeFileSync(
      join(f.addonsPath, "DepMain", "DepMain.toc"),
      "## Title: Dep\n## Version: 1.0.0\n## Interface: 110005\n## Dependencies: Ace3, DepLib\n## RequiredDeps: LibStub\n",
    );
    const listed = (await f.service.listAddons(f.installation)).find((a) => a.id === addon.id)!;
    expect(listed.dependencies).toEqual(["Ace3", "LibStub"]);
    expect(listed.interfaceVersion).toBe("110005");
    // Neither library is in AddOns, so the addon will not load.
    expect(listed.missingDependencies).toEqual(["Ace3", "LibStub"]);

    mkdirSync(join(f.addonsPath, "libstub"), { recursive: true });
    writeFileSync(join(f.addonsPath, "libstub", "libstub.toc"), "## Title: LibStub\n## Interface: 110005\n");
    const after = (await f.service.listAddons(f.installation)).find((a) => a.id === addon.id)!;
    expect(after.missingDependencies).toEqual(["Ace3"]); // folder names compare without case
  });
});

describe("lookup (WF-11 Relationships page)", () => {
  test("names provider ids and says which are installed here; unknown ids are left out", async () => {
    const f = localFixture("lookup", [
      { id: "770", name: "Needed", version: "1.0.0", releaseId: "n1", folders: ["Needed"] },
      { id: "771", name: "Other", version: "1.0.0", releaseId: "o1", folders: ["Other"] },
    ]);
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "770", installation: f.installation });
    expect(await f.service.lookup("WowUpHub", ["770", "771", "999"], f.installation)).toEqual([
      { externalId: "770", name: "Needed", thumbnailUrl: null, installed: true },
      { externalId: "771", name: "Other", thumbnailUrl: null, installed: false },
    ]);
  });
});

describe("missingDependencies (WF-11)", () => {
  test("Blizzard's own addons are part of the game, never missing", () => {
    expect(missingDependencies(["Blizzard_AuctionHouseUI", "Ace3"], new Set())).toEqual(["Ace3"]);
  });
});

describe("release channels (WF-03)", () => {
  const catalog = (): CatalogEntry[] => [
    {
      id: "750",
      name: "Chan",
      version: "1.0.0",
      releaseId: "s1",
      folders: ["Chan"],
      prereleases: [{ channelType: AddonChannelType.Beta, version: "1.1.0-beta", releaseId: "b1", releaseDate: "2026-07-01T00:00:00.000Z" }],
    },
  ];

  test("installs the stable release by default, the beta when asked, and follows that channel", async () => {
    const f = localFixture("channel-install", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
    expect(addon).toMatchObject({ version: "1.0.0", channel: "stable" });

    const { addon: beta } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation, channel: AddonChannelType.Beta });
    expect(beta).toMatchObject({ version: "1.1.0-beta", channel: "beta", canChangeChannel: true, updateAvailable: false });
  });

  test("switching channel installs that channel's release, back to Stable included", async () => {
    const f = localFixture("channel-switch", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
    const toBeta = await f.service.setChannel(addon.id, AddonChannelType.Beta);
    expect(toBeta.operation.status).toBe("installed");
    expect(toBeta.addon.version).toBe("1.1.0-beta");
    expect(readFileSync(join(f.addonsPath, "Chan", "Chan.toc"), "utf-8")).toContain("1.1.0-beta");
    expect(toBeta.addon).toMatchObject({ channel: "beta", updateAvailable: false });

    const toStable = await f.service.setChannel(addon.id, AddonChannelType.Stable);
    expect(toStable.addon).toMatchObject({ version: "1.0.0", channel: "stable", updateAvailable: false });
    await f.service.refresh(f.installation);
    expect((await listed(f, addon.id)).updateAvailable).toBe(false);
    expect(f.store.addons.all().filter((a) => a.externalId === "750")).toHaveLength(1);
  });

  test("a failed switch keeps the old channel", async () => {
    const f = localFixture("channel-switch-fail", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
    f.provider.failGetById = true;
    await expect(f.service.setChannel(addon.id, AddonChannelType.Beta)).rejects.toThrow();
    expect((await listed(f, addon.id)).channel).toBe("stable");
  });

  test("moving to an older channel without reinstalling never offers a downgrade as an update", async () => {
    // A record on Stable with a newer beta installed (a failed switch, an
    // older build, an imported record): refresh must not offer the stable.
    const f = localFixture("channel-no-downgrade", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation, channel: AddonChannelType.Beta });
    f.store.addons.patch(addon.id, { channelType: AddonChannelType.Stable });
    await f.service.refresh(f.installation);
    expect((await listed(f, addon.id)).updateAvailable).toBe(false);
  });

  test("channel change is refused without provider support", async () => {
    const f = localFixture("channel-search", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
    f.provider.allowChannelChange = false;
    expect((await listed(f, addon.id)).canChangeChannel).toBe(false);
    await expect(f.service.setChannel(addon.id, AddonChannelType.Beta)).rejects.toThrow("no release channels");
  });

  test("no choice offered when no pre-release is newer than stable", async () => {
    const olderBeta = catalog();
    olderBeta[0]!.prereleases![0]!.releaseDate = "2026-01-01T00:00:00.000Z";
    for (const entries of [olderBeta, catalog().map((c) => ({ ...c, prereleases: [] }))]) {
      const f = localFixture(`channel-none-${entries[0]!.prereleases!.length}`, entries);
      const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation });
      expect(addon.canChangeChannel).toBe(false);
    }
  });

  test("an addon on Beta can always go back, even when Beta has nothing newer any more", async () => {
    const f = localFixture("channel-back", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "750", installation: f.installation, channel: AddonChannelType.Beta });
    f.provider.catalog[0]!.prereleases = [];
    await f.service.refresh(f.installation);
    expect(await listed(f, addon.id)).toMatchObject({ channel: "beta", canChangeChannel: true });
    const { addon: stable } = await f.service.setChannel(addon.id, AddonChannelType.Stable);
    expect(stable).toMatchObject({ version: "1.0.0", canChangeChannel: false });
  });
});

describe("update all installations (WF-13)", () => {
  test("checks every installation for updates and updates each; one failing does not stop the next", async () => {
    const f = localFixture("update-all-installations", [
      { id: "760", name: "Every", version: "1.0.0", releaseId: "e1", folders: ["Every"] },
    ]);
    const classicRoot = join(dirname(f.installation.location), "_classic_");
    mkdirSync(join(classicRoot, "Interface", "AddOns"), { recursive: true });
    const classic: WowInstallation = {
      ...f.installation,
      id: "inst-update-all-classic",
      clientType: WowClientType.Classic,
      location: classicRoot,
      label: "_classic_",
      displayName: "Classic",
    };
    f.store.setInstallations([f.installation, classic]);
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "760", installation: f.installation });
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "760", installation: classic });

    // A new release; neither installation has been refreshed since.
    f.provider.catalog[0]!.version = "1.1.0";
    f.provider.catalog[0]!.releaseId = "e2";
    f.versions["760"] = "1.1.0";

    await checkAll(f.service, { autoUpdate: false });
    const operations = await f.service.updateAllInstallations();
    expect(operations.map((o) => o.status)).toEqual(["updated", "updated"]);
    for (const inst of [f.installation, classic]) {
      expect(readFileSync(join(inst.location, "Interface", "AddOns", "Every", "Every.toc"), "utf-8")).toContain("1.1.0");
    }

    // The first installation's folder is gone (an SD card removed): the
    // second still updates.
    f.provider.catalog[0]!.version = "1.2.0";
    f.provider.catalog[0]!.releaseId = "e3";
    f.versions["760"] = "1.2.0";
    rmSync(f.installation.location, { recursive: true, force: true });
    await checkAll(f.service, { autoUpdate: false });
    const second = await f.service.updateAllInstallations();
    expect(second.map((o) => o.status)).toEqual(["failed", "updated"]);
  });
});

describe("update summary (BEYOND-05 Steam game page)", () => {
  test("counts updates per installation, refreshing first when asked", async () => {
    const f = localFixture("summary", [{ id: "780", name: "Sum", version: "1.0.0", releaseId: "s1", folders: ["Sum"] }]);
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "780", installation: f.installation });
    expect(f.service.updateSummary()).toEqual([
      { installationId: f.installation.id, displayName: "Retail", updates: 0 },
    ]);
    f.provider.catalog[0]!.version = "1.1.0";
    f.provider.catalog[0]!.releaseId = "s2";
    expect(f.service.updateSummary()[0]!.updates).toBe(0); // not checked yet
    await checkAll(f.service);
    expect(f.service.updateSummary()[0]!.updates).toBe(1);
  });
});

describe("previous version and rollback (BEYOND-02)", () => {
  const toc = (f: ReturnType<typeof localFixture>) => readFileSync(join(f.addonsPath, "Roll", "Roll.toc"), "utf-8");
  const bump = (f: ReturnType<typeof localFixture>, version: string, releaseId: string) => {
    f.provider.catalog[0]!.version = version;
    f.provider.catalog[0]!.releaseId = releaseId;
    f.versions["800"] = version;
  };

  test("an update keeps the previous version; rollback swaps back and can be undone", async () => {
    const f = localFixture("rollback", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    expect(addon.previousVersion).toBeNull(); // a fresh install has nothing before it

    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    const { addon: updated } = await f.service.updateAddon(addon.id);
    expect(updated.previousVersion).toBe("1.0.0");
    expect((await f.service.rollbackStatus()).count).toBe(1);

    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("installed");
    expect(toc(f)).toContain("1.0.0");
    expect(back.addon).toMatchObject({ version: "1.0.0", previousVersion: "1.1.0", updateAvailable: true });
    expect(back.addon.autoUpdatePaused).toBe(true); // back to an older version: paused

    const forward = await f.service.rollback(addon.id); // undo
    expect(toc(f)).toContain("1.1.0");
    expect(forward.addon.autoUpdatePaused).toBe(false); // forward to the latest: resumed
    expect(forward.addon).toMatchObject({ version: "1.1.0", previousVersion: "1.0.0" });
  });

  test("a reinstall of the same release keeps the older version for rollback (WF-05)", async () => {
    const f = localFixture("rollback-reinstall", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id);
    expect((await listed(f, addon.id)).previousVersion).toBe("1.0.0");

    const { operation } = await f.service.reinstall(addon.id);
    expect(operation.status).toBe("installed");
    expect((await listed(f, addon.id)).previousVersion).toBe("1.0.0");
    expect((await f.service.rollbackStatus()).count).toBe(1);

    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("installed");
    expect(toc(f)).toContain("1.0.0");

    // Rolled back to r1, Reinstall installs the channel's latest (r2): that is an update, so r1 is kept.
    await f.service.reinstall(addon.id);
    expect(toc(f)).toContain("1.1.0");
    expect((await listed(f, addon.id)).previousVersion).toBe("1.0.0");
  });

  test("space is counted and cleared; removing an addon drops its kept version; off keeps nothing", async () => {
    const f = localFixture("rollback-clear", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id);
    expect((await f.service.rollbackStatus()).bytes).toBeGreaterThan(0);

    expect(await f.service.clearRollback()).toEqual({ bytes: 0, count: 0 });
    expect((await listed(f, addon.id)).previousVersion).toBeNull();
    await expect(f.service.rollback(addon.id).then((r) => r.operation.status)).resolves.toBe("failed");

    bump(f, "1.2.0", "r3");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id);
    expect((await f.service.rollbackStatus()).count).toBe(1);
    await f.service.removeAddon(addon.id);
    expect((await f.service.rollbackStatus()).count).toBe(0);

    f.store.updateSettings({ keepPreviousVersions: false });
    const { addon: again } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.3.0", "r4");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(again.id);
    expect((await f.service.rollbackStatus()).count).toBe(0);
  });

  test("a label whose kept copy is gone is not offered (#33)", async () => {
    const f = localFixture("rollback-stale", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id);
    expect((await listed(f, addon.id)).previousVersion).toBe("1.0.0");

    // The kept copy goes without the label knowing (on the owner's Deck:
    // the cache folder had moved). My Addons must not offer a dead roll back.
    rmSync(join(f.addonsPath, ".wowdeck", "rollback", addon.id), { recursive: true, force: true });
    const row = await listed(f, addon.id);
    expect(row.previousVersion).toBeNull();
    expect(row.version).toBe("1.1.0"); // the row itself is as it was
    expect(stored(f, addon.id).rollbackVersion).toBeUndefined(); // the record agrees from now on
    expect((await f.service.rollbackStatus()).count).toBe(0);
    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("failed");
  });

  test("Keep previous versions off after an earlier keep leaves a working offer, not a stale one", async () => {
    const f = localFixture("rollback-off-after-keep", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id); // keeps 1.0.0
    f.store.updateSettings({ keepPreviousVersions: false });
    bump(f, "1.2.0", "r3");
    await f.service.refresh(f.installation);
    const { operation } = await f.service.updateAddon(addon.id);
    expect(operation.status).toBe("updated");

    // Nothing was kept for 1.1.0, but the 1.0.0 copy is still in the cache
    // and the label still names it: the offer is real, so it stays.
    expect((await listed(f, addon.id)).previousVersion).toBe("1.0.0");
    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("installed");
    expect(toc(f)).toContain("1.0.0");
  });

  test("a keep that fails after the old copy is gone leaves a dead label; the list drops it (#33)", async () => {
    const f = localFixture("rollback-keep-fails", [{ id: "800", name: "Roll", version: "1.0.0", releaseId: "r1", folders: ["Roll"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "800", installation: f.installation });
    bump(f, "1.1.0", "r2");
    await f.service.refresh(f.installation);
    await f.service.updateAddon(addon.id); // label 1.0.0, copy kept

    // The next keep fails and takes the old copy with it (keepPrevious
    // removes the old cache entry before writing the new one): make the
    // cache root something no keep can write to.
    rmSync(join(f.addonsPath, ".wowdeck", "rollback"), { recursive: true, force: true });
    writeFileSync(join(f.addonsPath, ".wowdeck", "rollback"), "not a directory");
    bump(f, "1.2.0", "r3");
    await f.service.refresh(f.installation);
    const { operation } = await f.service.updateAddon(addon.id);
    expect(operation.status).toBe("updated"); // the install itself is fine; only the keep failed
    expect(stored(f, addon.id).rollbackVersion).toBe("1.0.0"); // the failed keep left the old label

    expect((await listed(f, addon.id)).previousVersion).toBeNull(); // the list drops the dead offer
    expect(stored(f, addon.id).rollbackVersion).toBeUndefined();
    expect(await f.service.rollbackStatus()).toMatchObject({ count: 0 });
    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("failed");
  });
});

describe("automatic updates (WF-02)", () => {
  const catalog = (): CatalogEntry[] => [
    { id: "810", name: "AutoA", version: "1.0.0", releaseId: "a1", folders: ["AutoA"] },
    { id: "811", name: "AutoB", version: "1.0.0", releaseId: "b1", folders: ["AutoB"] },
  ];
  const publish = (f: ReturnType<typeof localFixture>) => {
    for (const [i, c] of f.provider.catalog.entries()) {
      c.version = "2.0.0";
      c.releaseId = `${c.id}-2`;
      f.versions[c.id] = "2.0.0";
      void i;
    }
  };
  const notRunning = async () => "not_running" as const;

  test("off by default: a check changes nothing", async () => {
    const f = localFixture("auto-off", catalog());
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    publish(f);
    await checkAll(f.service);
    expect(f.store.addons.all().find((a) => a.externalId === "810")!.installedVersion).toBe("1.0.0");
    expect(await f.service.autoUpdate(notRunning)).toBeNull();
  });

  test("on: updates every waiting addon except ignored ones and a rolled-back release", async () => {
    const f = localFixture("auto-on", catalog());
    const { addon: a } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    const { addon: b } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "811", installation: f.installation });
    await f.service.setIgnored(b.id, true);
    publish(f);
    await f.service.refresh(f.installation);
    f.store.updateSettings({ autoUpdate: true });
    const result = await f.service.autoUpdate(notRunning);
    expect(result).toMatchObject({ updated: ["AutoA"], failed: [], skipped: null });
    expect(f.store.addons.all().find((x) => x.id === a.id)!.installedVersion).toBe("2.0.0");
    expect(f.store.addons.all().find((x) => x.id === b.id)!.installedVersion).toBe("1.0.0");
    expect(f.store.settings.lastAutoUpdate).toMatchObject({ updated: ["AutoA"] });

    // Roll back: paused, and a newer release does not change that.
    await f.service.rollback(a.id);
    expect(await f.service.autoUpdate(notRunning)).toBeNull();
    f.provider.catalog[0]!.version = "3.0.0";
    f.provider.catalog[0]!.releaseId = "810-3";
    f.versions["810"] = "3.0.0";
    await f.service.refresh(f.installation);
    expect(await f.service.autoUpdate(notRunning)).toBeNull();
    expect(f.store.addons.all().find((x) => x.id === a.id)!.installedVersion).toBe("1.0.0");

    // Resumed by hand: the next run updates it.
    await f.service.setAutoUpdatePaused(a.id, false);
    expect(await f.service.autoUpdate(notRunning)).toMatchObject({ updated: ["AutoA"] });

    // Paused by hand; an update by hand resumes.
    await f.service.setAutoUpdatePaused(a.id, true);
    expect((await listed(f, a.id)).autoUpdatePaused).toBe(true);
    await f.service.reinstall(a.id);
    expect((await listed(f, a.id)).autoUpdatePaused).toBe(false);
  });

  test("a record with the old skip mark counts as paused", async () => {
    const f = localFixture("auto-legacy", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    publish(f);
    await f.service.refresh(f.installation);
    f.store.addons.patch(addon.id, { skipReleaseId: "anything" });
    f.store.updateSettings({ autoUpdate: true });
    expect((await listed(f, addon.id)).autoUpdatePaused).toBe(true);
    expect(await f.service.autoUpdate(notRunning)).toBeNull();
  });

  test("an addon paused while the run updates another stays paused and is left alone", async () => {
    const f = localFixture("auto-paused-mid-run", catalog());
    await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    const { addon: b } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "811", installation: f.installation });
    publish(f);
    await f.service.refresh(f.installation);
    f.store.updateSettings({ autoUpdate: true });
    f.downloads.length = 0;
    const run = f.service.autoUpdate(notRunning);
    while (f.downloads.length === 0) {
      await Bun.sleep(0);
    }
    await f.service.setAutoUpdatePaused(b.id, true);
    expect(await run).toMatchObject({ updated: ["AutoA"], failed: [] });
    expect(f.store.addons.require(b.id)).toMatchObject({ autoUpdatePaused: true, installedVersion: "1.0.0" });
  });

  test("Update all leaves alone an addon ignored while it runs", async () => {
    const f = localFixture("update-all-ignored-mid-run", catalog());
    const { addon: a } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    const { addon: b } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "811", installation: f.installation });
    publish(f);
    await f.service.refresh(f.installation);
    f.downloads.length = 0;
    const run = f.service.updateAll(f.installation);
    while (f.downloads.length === 0) {
      await Bun.sleep(0);
    }
    await f.service.setIgnored(b.id, true);
    expect((await run).map((o) => [o.addonId, o.status])).toEqual([[a.id, "updated"]]);
    expect(f.store.addons.require(b.id)).toMatchObject({ isIgnored: true, installedVersion: "1.0.0" });
  });

  test("never while WoW is running; the outcome says so", async () => {
    const f = localFixture("auto-running", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "810", installation: f.installation });
    publish(f);
    await f.service.refresh(f.installation);
    f.store.updateSettings({ autoUpdate: true });
    expect(await f.service.autoUpdate(async () => "running")).toMatchObject({ updated: [], skipped: "WoW was running" });
    expect(f.store.addons.all().find((x) => x.id === addon.id)!.installedVersion).toBe("1.0.0");
  });
});

// RF-08 pins: the repeated blocks the helpers replace.
describe("per-addon methods, failures and new records (RF-08)", () => {
  test("every per-addon method rejects an unknown id as not found", async () => {
    const f = localFixture("rf08-unknown", [{ id: "900", name: "Known", version: "1.0.0", releaseId: "k1", folders: ["Known"] }]);
    const calls: Array<[string, () => unknown]> = [
      ["updateAddon", () => f.service.updateAddon("nope")],
      ["setChannel", () => f.service.setChannel("nope", AddonChannelType.Beta)],
      ["reinstall", () => f.service.reinstall("nope")],
      ["rollback", () => f.service.rollback("nope")],
      ["setAutoUpdatePaused", () => f.service.setAutoUpdatePaused("nope", true)],
      ["removeAddon", () => f.service.removeAddon("nope")],
      ["setIgnored", () => f.service.setIgnored("nope", true)],
    ];
    for (const [name, call] of calls) {
      const err = await Promise.resolve()
        .then(call)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect([name, (err as Error | null)?.name]).toEqual([name, "NotFoundError"]);
    }
  });

  test("an update whose source fails, or no longer has the addon, emits a failed result", async () => {
    const f = localFixture("rf08-fail", [{ id: "901", name: "Gone", version: "1.0.0", releaseId: "g1", folders: ["Gone"] }]);
    const { addon } = await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "901", installation: f.installation });
    f.operations.length = 0;
    f.provider.failGetById = true;
    const down = await f.service.updateAddon(addon.id);
    expect(down.operation).toMatchObject({ status: "failed", error: "provider down", addonId: addon.id });
    f.provider.failGetById = false;
    f.provider.catalog.length = 0;
    const gone = await f.service.updateAddon(addon.id);
    expect(gone.operation).toMatchObject({ status: "failed", error: `addon no longer available on ${f.provider.name}`, addonId: addon.id });
    expect(f.operations).toEqual([down.operation, gone.operation]);
  });

  test("new records start with the same flags, for a direct install and for its dependency", async () => {
    const f = localFixture("rf08-records", [
      { id: "902", name: "Lib", version: "1.0.0", releaseId: "l1", folders: ["Lib"] },
      { id: "903", name: "App", version: "1.0.0", releaseId: "a1", folders: ["App"], requiredDependencyIds: ["902"] },
    ]);
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "903", installation: f.installation });
    const byName = (n: string) => f.store.addons.all().find((a) => a.name === n)!;
    const defaults = { isIgnored: false, isLoadOnDemand: false, channelType: AddonChannelType.Stable };
    expect(byName("App")).toMatchObject({ ...defaults, isDependency: false });
    expect(byName("Lib")).toMatchObject({ ...defaults, isDependency: true });
  });
});

// RF-12 pins: what each kind of install does, recorded at the installer.
describe("install intents (RF-12)", () => {
  type Seen = { name: string; operationId: string; keepPreviousVersion: boolean | undefined };
  let seen: Seen[] = [];
  const realInstall = AddonInstaller.prototype.install;
  beforeAll(() => {
    AddonInstaller.prototype.install = function (this: AddonInstaller, opts: Parameters<AddonInstaller["install"]>[0]) {
      seen.push({
        name: opts.searchResult.name,
        operationId: opts.operationId,
        keepPreviousVersion: opts.keepPreviousVersion,
      });
      return realInstall.call(this, opts);
    };
  });
  afterAll(() => {
    AddonInstaller.prototype.install = realInstall;
  });

  const catalog = (): CatalogEntry[] => [
    { id: "950", name: "Base", version: "1.0.0", releaseId: "b1", folders: ["Base"] },
    { id: "951", name: "Top", version: "1.0.0", releaseId: "t1", folders: ["Top"], requiredDependencyIds: ["950"] },
  ];
  const publish = (f: ReturnType<typeof localFixture>, id: string, version: string) => {
    const c = f.provider.catalog.find((e) => e.id === id)!;
    c.version = version;
    c.releaseId = `${id}-${version}`;
    f.versions[id] = version;
  };
  const record = (f: ReturnType<typeof localFixture>, name: string) => f.store.addons.all().find((a) => a.name === name)!;

  test("install: installed, dependency installed alongside without its own result", async () => {
    seen = [];
    const f = localFixture("rf12-install", catalog());
    const { operation } = await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "951", installation: f.installation });
    expect(operation).toMatchObject({ status: "installed", error: null });
    expect(operation.missingRequiredDependencies).toBeUndefined();
    expect(record(f, "Top")).toMatchObject({ isDependency: false });
    expect(record(f, "Top").lastUpdatedAt).toBeUndefined();
    expect(record(f, "Base")).toMatchObject({ isDependency: true });
    // RF-12: recorded like any install (the separate path skipped these).
    expect(record(f, "Base")).toMatchObject({ hasNewerPrerelease: false, dependencies: [] });
    expect(seen).toEqual([
      { name: "Top", operationId: operation.operationId, keepPreviousVersion: false },
      { name: "Base", operationId: expect.any(String), keepPreviousVersion: DEP_KEEP_PREVIOUS },
    ]);
    expect(f.operations).toEqual([operation]);
    expect(f.changed).toEqual([[record(f, "Base").id], [record(f, "Top").id]]);
  });

  test("install over a dependency makes it the user's choice", async () => {
    seen = [];
    const f = localFixture("rf12-claim", catalog());
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "951", installation: f.installation });
    seen = [];
    const { operation } = await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "950", installation: f.installation });
    expect(operation.status).toBe("installed");
    expect(record(f, "Base").isDependency).toBe(false);
    expect(seen).toEqual([{ name: "Base", operationId: operation.operationId, keepPreviousVersion: true }]);
  });

  test("update: updated, stamped, pause cleared, dependency flag kept", async () => {
    seen = [];
    const f = localFixture("rf12-update", catalog());
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "951", installation: f.installation });
    const base = f.store.addons.patch(record(f, "Base").id, { autoUpdatePaused: true, skipReleaseId: "x" });
    publish(f, "950", "1.1.0");
    seen = [];
    const { operation } = await f.service.updateAddon(base.id);
    expect(operation.status).toBe("updated");
    expect(record(f, "Base")).toMatchObject({ isDependency: true, installedVersion: "1.1.0" });
    expect(record(f, "Base").lastUpdatedAt).toBeNumber();
    expect(record(f, "Base").autoUpdatePaused).toBeUndefined();
    expect(record(f, "Base").skipReleaseId).toBeUndefined();
    expect(seen).toEqual([{ name: "Base", operationId: operation.operationId, keepPreviousVersion: true }]);
  });

  test("reinstall: installed, not stamped, dependency flag kept", async () => {
    seen = [];
    const f = localFixture("rf12-reinstall", catalog());
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "951", installation: f.installation });
    seen = [];
    const { operation } = await f.service.reinstall(record(f, "Base").id);
    expect(operation.status).toBe("installed");
    expect(record(f, "Base").isDependency).toBe(true);
    expect(record(f, "Base").lastUpdatedAt).toBeUndefined();
    expect(seen).toEqual([{ name: "Base", operationId: operation.operationId, keepPreviousVersion: true }]);
  });

  test("channel switch: installed on the new channel, dependency flag kept", async () => {
    seen = [];
    const f = localFixture("rf12-channel", [
      { id: "952", name: "Lib", version: "1.0.0", releaseId: "l1", folders: ["Lib"] },
      {
        id: "953",
        name: "Chan",
        version: "1.0.0",
        releaseId: "c1",
        folders: ["Chan"],
        requiredDependencyIds: ["952"],
        prereleases: [{ channelType: AddonChannelType.Beta, version: "1.1.0-beta", releaseId: "cb1", releaseDate: "2026-07-01T00:00:00.000Z" }],
      },
    ]);
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "953", installation: f.installation });
    const chan = f.store.addons.patch(record(f, "Chan").id, { isDependency: true }); // as if pulled in by another addon
    seen = [];
    const { operation } = await f.service.setChannel(chan.id, AddonChannelType.Beta);
    expect(operation.status).toBe("installed");
    expect(record(f, "Chan")).toMatchObject({ isDependency: true, channelType: AddonChannelType.Beta, installedVersion: "1.1.0-beta" });
    expect(record(f, "Chan").lastUpdatedAt).toBeUndefined();
    expect(seen).toEqual([{ name: "Chan", operationId: operation.operationId, keepPreviousVersion: true }]);
  });

  test("a required dependency that can't be installed is reported, the addon still installs", async () => {
    seen = [];
    const f = localFixture("rf12-missing", [
      { id: "954", name: "Needs", version: "1.0.0", releaseId: "n1", folders: ["Needs"], requiredDependencyIds: ["999"] },
    ]);
    const { operation } = await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "954", installation: f.installation });
    expect(operation).toMatchObject({ status: "installed", missingRequiredDependencies: ["999"] });
    expect(f.store.addons.all().map((a) => a.name)).toEqual(["Needs"]);
  });
});

// RF-12: a dependency now goes through the one install path, which says
// false explicitly where the old separate path passed nothing.
const DEP_KEEP_PREVIOUS: boolean | undefined = false;

describe("records are written only through AddonRecords", () => {
  const catalog = (): CatalogEntry[] => [
    {
      id: "960",
      name: "Rec",
      version: "1.0.0",
      releaseId: "s1",
      folders: ["Rec"],
      prereleases: [{ channelType: AddonChannelType.Beta, version: "1.1.0-beta", releaseId: "b1", releaseDate: "2026-07-01T00:00:00.000Z" }],
    },
  ];
  /** The record as a restarted engine reads it from the state file. */
  const onDisk = (f: ReturnType<typeof localFixture>, id: string) =>
    createStateStore(dirname(f.installation.location)).addons.get(id);
  /** Installs fail while the game folder is gone (an SD card taken out). */
  const withoutGameFolder = async <T>(f: ReturnType<typeof localFixture>, run: () => Promise<T>): Promise<T> => {
    renameSync(f.installation.location, `${f.installation.location}.away`);
    try {
      return await run();
    } finally {
      renameSync(`${f.installation.location}.away`, f.installation.location);
    }
  };

  test("a failed channel switch leaves the stored record as it was", async () => {
    const f = localFixture("records-channel-fail", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    const before = structuredClone(f.store.addons.require(addon.id));
    const { operation } = await withoutGameFolder(f, () => f.service.setChannel(addon.id, AddonChannelType.Beta));
    expect(operation.status).toBe("failed");
    expect(f.store.addons.require(addon.id)).toEqual(before);
    expect(onDisk(f, addon.id)).toEqual(before);
  });

  test("a failed update leaks nothing into a later unrelated write", async () => {
    const f = localFixture("records-update-fail", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    const before = structuredClone(f.store.addons.require(addon.id));
    // A new stable that needs a library and leaves no newer pre-release.
    Object.assign(f.provider.catalog[0]!, { version: "2.0.0", releaseId: "s2", requiredDependencyIds: ["961"], prereleases: [] });
    const { operation } = await withoutGameFolder(f, () => f.service.updateAddon(addon.id));
    expect(operation.status).toBe("failed");
    f.store.updateSettings({ newlyUpdatedHours: 1 });
    expect(onDisk(f, addon.id)).toEqual(before);
  });

  test("an update that finds the addon current keeps what the provider said", async () => {
    const f = localFixture("records-current", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    f.store.addons.patch(addon.id, { latestVersion: "0.9", hasNewerPrerelease: false });
    const { operation } = await f.service.updateAddon(addon.id);
    expect(operation.status).toBe("current");
    expect(onDisk(f, addon.id)).toMatchObject({ latestVersion: "1.0.0", hasNewerPrerelease: true });
  });

  test("a change made while an install runs survives the install", async () => {
    const f = localFixture("records-concurrent", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    f.downloads.length = 0;
    const reinstall = f.service.reinstall(addon.id);
    while (f.downloads.length === 0) {
      await Bun.sleep(0);
    }
    const ignore = f.service.setIgnored(addon.id, true);
    expect((await reinstall).operation.status).toBe("installed");
    await ignore;
    expect(f.store.addons.require(addon.id).isIgnored).toBe(true);
    expect(onDisk(f, addon.id)!.isIgnored).toBe(true);
  });

  test("Pause and Ignore set while an update runs survive the update", async () => {
    const f = localFixture("records-concurrent-update", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    Object.assign(f.provider.catalog[0]!, { version: "2.0.0", releaseId: "s2", prereleases: [] });
    f.versions["960"] = "2.0.0";
    f.downloads.length = 0;
    const update = f.service.updateAddon(addon.id);
    while (f.downloads.length === 0) {
      await Bun.sleep(0);
    }
    const pause = f.service.setAutoUpdatePaused(addon.id, true);
    const ignore = f.service.setIgnored(addon.id, true);
    expect((await update).operation.status).toBe("updated");
    await Promise.all([pause, ignore]);
    expect(f.store.addons.require(addon.id)).toMatchObject({ autoUpdatePaused: true, isIgnored: true, installedVersion: "2.0.0" });
    expect(onDisk(f, addon.id)).toMatchObject({ autoUpdatePaused: true, isIgnored: true });
  });

  test("a change made while an update reads the provider survives the update", async () => {
    const f = localFixture("records-concurrent-update-read", catalog());
    const { addon } = await f.service.install({ intent: "install", providerId: "WowUpHub", externalId: "960", installation: f.installation });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let reading = false;
    const getById = f.provider.getById.bind(f.provider);
    f.provider.getById = async (id) => {
      reading = true;
      await held;
      return getById(id);
    };
    const update = f.service.updateAddon(addon.id);
    while (!reading) {
      await Bun.sleep(0);
    }
    const ignore = f.service.setIgnored(addon.id, true);
    release();
    expect((await update).operation.status).toBe("current");
    expect((await ignore).ignored).toBe(true);
    expect(onDisk(f, addon.id)).toMatchObject({ isIgnored: true });
  });
});

describe("adopting an unmanaged folder (WF-23)", () => {
  function setup(name: string) {
    const localProvider = new FakeProvider([
      { id: "501", name: "Zeta Frames", version: "2.0.0", releaseId: "z2", folders: ["Zeta"] },
      { id: "502", name: "Zeta Frames Classic", version: "1.0.0", releaseId: "zc1", folders: ["ZetaClassic"] },
      { id: "503", name: "Zeta", version: "3.0.0", releaseId: "z3", folders: ["Zeta", "ZetaLib", "Zeta_Options"] },
      { id: "504", name: "Zeta Frames Plus", version: "1.0.0", releaseId: "zp1", folders: ["Zeta"] },
    ]);
    const registry = new ProviderRegistry();
    registry.register(localProvider);
    const localRoot = tempRoot(name);
    const installRoot = join(localRoot, "_retail_");
    const addonsPath = join(installRoot, "Interface", "AddOns");
    mkdirSync(join(addonsPath, "Zeta"), { recursive: true });
    // Hand-copied: a TOC title differing from the folder name, and a file the release lacks.
    writeFileSync(join(addonsPath, "Zeta", "Zeta.toc"), "## Title: Zeta Frames\n## Version: 0.9-local\n## Interface: 110005\n");
    writeFileSync(join(addonsPath, "Zeta", "local.lua"), "-- my edits\n");
    // A sub-folder whose title and name match no catalog entry; its TOC requires Zeta.
    mkdirSync(join(addonsPath, "Zeta_Options"), { recursive: true });
    writeFileSync(
      join(addonsPath, "Zeta_Options", "Zeta_Options.toc"),
      "## Title: Zeta Settings\n## Dependencies: Zeta, Blizzard_Settings\n## Interface: 110005\n",
    );
    const localInstallation: WowInstallation = { ...installation, id: `inst-${name}`, location: installRoot };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(makeNetwork(localProvider.catalog, {}), join(localRoot, "dl")),
      { addonsChanged: () => {}, operationResult: () => {} },
    );
    return { localService, localInstallation, addonsPath, store };
  }

  test("sources for a folder are searched by its TOC title and folder name", async () => {
    const { localService, localInstallation } = setup("adopt-find");
    const request = await localService.sourceRequestForFolder(localInstallation, "Zeta");
    expect(request).toMatchObject({ folderName: "Zeta", queries: ["Zeta Frames", "Zeta"] });
    expect(request.toc?.version).toBe("0.9-local");
  });

  test("a sub-folder is also searched by the addons its TOC requires, Blizzard's left out", async () => {
    const { localService, localInstallation } = setup("adopt-sub");
    const request = await localService.sourceRequestForFolder(localInstallation, "Zeta_Options");
    expect(request.queries).toEqual(["Zeta Settings", "Zeta_Options", "Zeta"]);
  });

  test("refuses a folder that is missing or managed", async () => {
    const { localService, localInstallation } = setup("adopt-refuse");
    await expect(localService.sourceRequestForFolder(localInstallation, "Nope")).rejects.toThrow(/isn't an unmanaged/);
    await localService.adopt(localInstallation, "Zeta", "WowUpHub", "501");
    await expect(localService.sourceRequestForFolder(localInstallation, "Zeta")).rejects.toThrow(/managed addon folder/);
  });

  test("adopting installs the release over the folder; Roll back returns the hand-copied files", async () => {
    const { localService, localInstallation, addonsPath, store } = setup("adopt-install");
    // Kept even with the setting off: the hand-copied files may exist nowhere else.
    store.updateSettings({ keepPreviousVersions: false });
    const { addon, operation } = await localService.adopt(localInstallation, "Zeta", "WowUpHub", "501");
    expect(operation.status).toBe("installed");
    expect(existsSync(join(addonsPath, "Zeta", "local.lua"))).toBe(false);

    const listed = await localService.listAddons(localInstallation);
    expect(listed.some((a) => a.id === "unmanaged:Zeta")).toBe(false);
    const managed = listed.find((a) => a.id === addon.id)!;
    expect(managed.providerId).toBe("WowUpHub");
    expect(managed.version).toBe("2.0.0");
    expect(managed.previousVersion).toBe("0.9-local");

    await localService.rollback(addon.id);
    expect(readFileSync(join(addonsPath, "Zeta", "local.lua"), "utf8")).toBe("-- my edits\n");
  });

  test("a release without the folder is refused and the folder is left alone", async () => {
    const { localService, localInstallation, addonsPath } = setup("adopt-wrong");
    await expect(localService.adopt(localInstallation, "Zeta", "WowUpHub", "502")).rejects.toThrow(
      /doesn't install the folder Zeta/,
    );
    expect(existsSync(join(addonsPath, "Zeta", "local.lua"))).toBe(true);
    expect(existsSync(join(addonsPath, "ZetaClassic"))).toBe(false);
    expect(localService.addonsFor(localInstallation.id)).toEqual([]);
  });
});

describe("changing an addon's source (WF-12)", () => {
  /** A second source, naming its addons in the TOC like TukUI (X-Tukui-ProjectID). */
  class TukProvider extends FakeProvider {
    override name: AddonProviderType = "TukUI";
    override allowChannelChange = false;
    override tocId(toc: Toc): string | undefined {
      return toc.tukUiProjectId;
    }
  }

  function setup(name: string) {
    const hub = new FakeProvider([
      { id: "501", name: "Zeta", version: "2.0.0", releaseId: "z2", folders: ["Zeta"] },
      { id: "502", name: "Omega", version: "1.0.0", releaseId: "o1", folders: ["Omega"] },
      // Another edition on the addon's own provider: never offered.
      { id: "503", name: "Zeta", version: "1.5.0", releaseId: "z15", folders: ["Zeta"] },
    ]);
    const tuk = new TukProvider([
      { id: "601", name: "Zeta", version: "2.1.0", releaseId: "t21", folders: ["Zeta", "ZetaLib"] },
      // Named only by the TOC's X-Tukui-ProjectID: no search finds it.
      { id: "602", name: "Zeta Reborn", version: "3.0.0", releaseId: "t3", folders: ["Zeta"] },
      { id: "603", name: "Zeta", version: "1.0.0", releaseId: "t1", folders: ["ZetaClassic"] },
      { id: "604", name: "Omega", version: "1.0.0", releaseId: "to1", folders: ["Omega"] },
      // Lists no folders, like WoWInterface: one holds Zeta, one does not.
      { id: "605", name: "Zeta Unlisted", version: "2.2.0", releaseId: "t22", folders: ["AZetaArchive", "Zeta"], unlisted: true },
      { id: "606", name: "Zeta Wrong", version: "9.0.0", releaseId: "t9", folders: ["ZetaClassic"], unlisted: true },
    ]);
    const registry = new ProviderRegistry();
    registry.register(hub);
    registry.register(tuk);
    const localRoot = tempRoot(name);
    const addonsPath = join(localRoot, "_retail_", "Interface", "AddOns");
    mkdirSync(addonsPath, { recursive: true });
    const localInstallation: WowInstallation = { ...installation, id: `inst-${name}`, location: join(localRoot, "_retail_") };
    const store = createStateStore(localRoot);
    store.setInstallations([localInstallation]);
    const localService = new AddonService(
      store,
      registry,
      new DownloadService(makeNetwork([...hub.catalog, ...tuk.catalog], {}), join(localRoot, "dl")),
      { addonsChanged: () => {}, operationResult: () => {} },
    );
    const install = async (externalId: string) =>
      (await localService.install({ intent: "install", providerId: "WowUpHub", externalId, installation: localInstallation })).addon;
    return { localService, localInstallation, addonsPath, store, install };
  }

  test("other sources are looked for by the main folder's TOC and the addon's name; its own provider left out", async () => {
    const { localService, addonsPath, install } = setup("source-find");
    const zeta = await install("501");
    writeFileSync(join(addonsPath, "Zeta", "Zeta.toc"), "## Title: Zeta Frames\n## Interface: 110005\n## X-Tukui-ProjectID: 602\n");
    const request = await localService.sourceRequestForAddon(zeta.id);
    expect(request).toMatchObject({ folderName: "Zeta", queries: ["Zeta Frames", "Zeta", "Zeta"], ownProvider: "WowUpHub" });
    expect(request.toc?.tukUiProjectId).toBe("602");
  });

  test("a release that lists no folders is checked on its archive", async () => {
    const { localService, store, install } = setup("source-unlisted");
    const zeta = await install("501");
    const before = structuredClone(store.addons.require(zeta.id));
    const wrong = await localService.changeSource(zeta.id, "TukUI", "606");
    expect(wrong.operation).toMatchObject({ status: "failed", error: "Zeta Wrong doesn't install the folder Zeta" });
    expect(store.addons.require(zeta.id)).toEqual(before);
    const right = await localService.changeSource(zeta.id, "TukUI", "605");
    expect(right.operation.status).toBe("installed");
    // The main folder stays first, whatever the archive's order.
    expect(store.addons.require(zeta.id)).toMatchObject({
      providerName: "TukUI",
      externalId: "605",
      installedVersion: "2.2.0",
      installedFolderList: ["Zeta", "AZetaArchive"],
    });
  });

  test("switching installs the other release into the same addon, which then updates from there", async () => {
    const { localService, localInstallation, addonsPath, store, install } = setup("source-switch");
    const zeta = await install("501");
    await localService.setIgnored(zeta.id, true);
    const { addon, operation } = await localService.changeSource(zeta.id, "TukUI", "601");
    expect(operation.status).toBe("installed");
    expect(addon.id).toBe(zeta.id);
    expect(store.addons.require(zeta.id)).toMatchObject({
      providerName: "TukUI",
      externalId: "601",
      externalUrl: "https://fake/601",
      installedVersion: "2.1.0",
      installedFolderList: ["Zeta", "ZetaLib"],
      channelType: AddonChannelType.Stable,
      isIgnored: true,
      rollbackVersion: "2.0.0",
    });
    expect(existsSync(join(addonsPath, "ZetaLib", "ZetaLib.toc"))).toBe(true);
    const listed = await localService.listAddons(localInstallation);
    expect(listed.map((a) => a.id)).toEqual([zeta.id]);
  });

  test("refuses its own source, a source installed as another addon, and a release without its main folder", async () => {
    const { localService, store, install } = setup("source-refuse");
    const zeta = await install("501");
    await localService.install({ intent: "install", providerId: "TukUI", externalId: "604", installation: store.installations[0]! });
    const before = structuredClone(store.addons.require(zeta.id));
    await expect(localService.changeSource(zeta.id, "WowUpHub", "501")).rejects.toThrow(/already updates from there/);
    await expect(localService.changeSource(zeta.id, "TukUI", "604")).rejects.toThrow(/Omega from there is already installed/);
    await expect(localService.changeSource(zeta.id, "TukUI", "603")).rejects.toThrow(/doesn't install the folder Zeta/);
    expect(store.addons.require(zeta.id)).toEqual(before);
  });
});

// WF-21: an addon list carries which addons are libraries, so autoremove
// keeps working after an import on another Deck.
describe("addon list import keeps libraries libraries (WF-21)", () => {
  const catalog = (): CatalogEntry[] => [
    { id: "960", name: "Lib", version: "1.0.0", releaseId: "l1", folders: ["Lib"] },
    { id: "961", name: "App", version: "1.0.0", releaseId: "a1", folders: ["App"], requiredDependencyIds: ["960"] },
  ];
  const record = (f: ReturnType<typeof localFixture>, name: string) => f.store.addons.all().find((a) => a.name === name);
  const listOf = (f: ReturnType<typeof localFixture>, entries: { id: string; name: string; dependency?: boolean }[]) =>
    Buffer.from(
      JSON.stringify({ client_type: "Retail", addons: entries.map((e) => ({ ...e, provider_name: f.provider.name })) }),
    ).toString("base64");

  test("export on one Deck, import on another: the library stays a library and goes with its dependant", async () => {
    const from = localFixture("wf21-from", catalog());
    await from.service.install({ intent: "install", providerId: from.provider.name, externalId: "961", installation: from.installation });
    const { payload } = await from.service.portability.export(from.installation);

    const to = localFixture("wf21-to", catalog());
    const { operations, error } = await to.service.importAddonList(payload, to.installation);
    expect(error).toBeNull();
    expect(operations.map((o) => o.status)).toEqual(["installed", "installed"]);
    expect(record(to, "App")!.isDependency).toBe(false);
    expect(record(to, "Lib")!.isDependency).toBe(true);

    await to.service.removeAddon(record(to, "App")!.id);
    expect(record(to, "Lib")).toBeUndefined();
  });

  test("the library listed before its dependant is still a library", async () => {
    const f = localFixture("wf21-order", catalog());
    await f.service.importAddonList(
      listOf(f, [
        { id: "960", name: "Lib", dependency: true },
        { id: "961", name: "App" },
      ]),
      f.installation,
    );
    expect(record(f, "Lib")!.isDependency).toBe(true);
    expect(record(f, "App")!.isDependency).toBe(false);
  });

  test("a library its dependant already pulled in is not downloaded again, and counts as installed", async () => {
    const f = localFixture("wf21-once", catalog());
    const installed: string[] = [];
    const realInstall = AddonInstaller.prototype.install;
    AddonInstaller.prototype.install = function (this: AddonInstaller, opts: Parameters<AddonInstaller["install"]>[0]) {
      installed.push(opts.searchResult.name);
      return realInstall.call(this, opts);
    };
    try {
      const { operations } = await f.service.importAddonList(
        listOf(f, [
          { id: "961", name: "App" },
          { id: "960", name: "Lib", dependency: true },
        ]),
        f.installation,
      );
      expect(installed).toEqual(["App", "Lib"]);
      expect(operations.map((o) => [o.addonName, o.status, o.addonId])).toEqual([
        ["App", "installed", record(f, "App")!.id],
        ["Lib", "installed", record(f, "Lib")!.id],
      ]);
      expect(record(f, "Lib")!.isDependency).toBe(true);
    } finally {
      AddonInstaller.prototype.install = realInstall;
    }
  });

  test("a library whose dependant is not in the list becomes the user's own, so no Remove sweeps it", async () => {
    const f = localFixture("wf21-orphan", catalog());
    const changedBefore = f.changed.length;
    await f.service.importAddonList(listOf(f, [{ id: "960", name: "Lib", dependency: true }]), f.installation);
    expect(record(f, "Lib")!.isDependency).toBe(false);
    expect(f.changed.slice(changedBefore).at(-1)).toEqual([record(f, "Lib")!.id]);
  });

  test("removing the last dependant takes a library chain with it, in rounds", async () => {
    const f = localFixture("wf21-chain", [
      { id: "972", name: "Base", version: "1.0.0", releaseId: "b1", folders: ["Base"] },
      { id: "971", name: "Mid", version: "1.0.0", releaseId: "m1", folders: ["Mid"], requiredDependencyIds: ["972"] },
      { id: "973", name: "Top", version: "1.0.0", releaseId: "t1", folders: ["Top"], requiredDependencyIds: ["971"] },
      { id: "974", name: "Other", version: "1.0.0", releaseId: "o1", folders: ["Other"], requiredDependencyIds: ["972"] },
    ]);
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "973", installation: f.installation });
    await f.service.install({ intent: "install", providerId: f.provider.name, externalId: "974", installation: f.installation });
    expect([record(f, "Mid")!.isDependency, record(f, "Base")!.isDependency]).toEqual([true, true]);

    await f.service.removeAddon(record(f, "Other")!.id);
    expect(record(f, "Base")).toBeDefined(); // Mid still requires it

    await f.service.removeAddon(record(f, "Top")!.id);
    expect(f.store.addons.all().map((a) => a.name)).toEqual([]);
  });

  test("a list without the mark (WowUp's own) imports every addon as the user's own, as before", async () => {
    const f = localFixture("wf21-wowup", catalog());
    await f.service.importAddonList(
      listOf(f, [
        { id: "961", name: "App" },
        { id: "960", name: "Lib" },
      ]),
      f.installation,
    );
    expect(record(f, "Lib")!.isDependency).toBe(false);
  });
});
