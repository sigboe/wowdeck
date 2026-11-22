/**
 * Every addon method's answer is the addon's row: what `addons.list` shows
 * for it, TOC fields, library needs and the installation's game version
 * included. The frontend puts an answer in place of the row as it is.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Addon } from "../src/api/contracts";
import type { AddonService } from "../src/wow/addons/AddonService";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import type { NetworkClient } from "../src/wow/net/network";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonChannelType, AddonDependencyType, WowClientType, type AddonProviderType } from "../src/wow/types";
import { addonService } from "./helpers/addon-service";

interface Entry {
  id: string;
  name: string;
  version: string;
  folders: string[];
  /** Source-listed required dependencies (provider ids). */
  requires?: string[];
  /** The main folder's TOC lines beyond title, version and interface. */
  toc?: string;
  beta?: string;
}

class Provider extends AddonProvider {
  enabled = true;
  override allowReinstall = true;
  override allowChannelChange = true;

  constructor(
    public override name: AddonProviderType,
    public catalog: Entry[],
  ) {
    super();
  }

  override async getById(id: string): Promise<AddonSearchResult | undefined> {
    const entry = this.catalog.find((c) => c.id === id);
    return entry && this.result(entry);
  }

  override async getAll(_i: WowInstallation, ids: string[]) {
    return { searchResults: this.catalog.filter((c) => ids.includes(c.id)).map((c) => this.result(c)), errors: [] };
  }

  override isValidAddonId(id: string): boolean {
    return /^\d+$/.test(id);
  }

  private result(entry: Entry): AddonSearchResult {
    const file = (channelType: AddonChannelType, version: string, date: string) => ({
      channelType,
      folders: entry.folders,
      gameVersion: "11.0.2",
      downloadUrl: `https://fake/dl/${entry.id}.zip?v=${version}`,
      version,
      releaseDate: date,
      externalId: `${entry.id}-${version}`,
      dependencies: (entry.requires ?? []).map((externalAddonId) => ({ externalAddonId, type: AddonDependencyType.Required })),
    });
    return {
      author: "Dev",
      externalId: entry.id,
      externalUrl: `https://fake/${entry.id}`,
      name: entry.name,
      providerName: this.name,
      downloadCount: 1,
      files: [
        file(AddonChannelType.Stable, entry.version, "2026-06-01T00:00:00.000Z"),
        ...(entry.beta ? [file(AddonChannelType.Beta, entry.beta, "2026-07-01T00:00:00.000Z")] : []),
      ],
    };
  }
}

const text = (s: string) => new TextEncoder().encode(s);

function network(catalog: Entry[]): NetworkClient {
  return {
    downloadToFile: async (url: string, dest: string) => {
      const [, id, version] = url.match(/dl\/(\d+)\.zip\?v=(.+)$/)!;
      const entry = catalog.find((c) => c.id === id)!;
      const files: Record<string, Uint8Array> = {};
      entry.folders.forEach((folder, i) => {
        files[`${folder}/${folder}.toc`] = text(
          `## Title: ${entry.name}\n## Version: ${version}\n## Interface: 110005, 110007\n${i === 0 ? (entry.toc ?? "") : ""}`,
        );
      });
      const bytes = zipSync(files);
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

let service: AddonService;
let installation: WowInstallation;
let hub: Provider;
let addonsPath: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-view-"));
  roots.push(root);
  addonsPath = join(root, "_retail_", "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  installation = {
    id: "inst1",
    clientType: WowClientType.Retail,
    location: join(root, "_retail_"),
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
    version: "11.0.7",
  };
  hub = new Provider("WowUpHub", [
    {
      id: "111",
      name: "Main",
      version: "1.0.0",
      beta: "1.1.0-beta",
      folders: ["Main", "Main_Options"],
      requires: ["333"],
      toc: "## Dependencies: LibA, Main_Options, MissingDep, Blizzard_Settings\n## OptionalDeps: OptLib\n",
    },
    { id: "333", name: "LibA", version: "1.0.0", folders: ["LibA"] },
    { id: "444", name: "Hand", version: "2.0.0", folders: ["Hand"], toc: "## Dependencies: LibA\n" },
  ]);
  const tuk = new Provider("TukUI", [
    { id: "611", name: "Main", version: "1.2.0", folders: ["Main"], toc: "## Dependencies: LibA\n" },
  ]);
  tuk.allowChannelChange = false;
  const registry = new ProviderRegistry();
  registry.register(hub);
  registry.register(tuk);
  const store = createStateStore(root);
  store.setInstallations([installation]);
  service = addonService(
    store,
    registry,
    new DownloadService(network([...hub.catalog, ...tuk.catalog]), join(root, "dl")),
    { addonsChanged: () => {}, operationResult: () => {} },
  );
});

async function listRow(id: string): Promise<Addon> {
  const { addons } = await service.addonList(installation);
  const row = addons.find((a) => a.id === id);
  expect(row).toBeDefined();
  return row!;
}

const installMain = () => service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation });

test("an install answers the addon's list row: TOC dependencies, library needs and the installation's game version", async () => {
  const { addon } = await installMain();

  expect(addon).toMatchObject({
    dependencies: ["LibA", "MissingDep", "Blizzard_Settings"],
    optionalDependencies: ["OptLib"],
    missingDependencies: ["MissingDep"],
    leavesUnneeded: ["LibA"],
    interfaceVersion: "110005",
    gameVersion: "11.0.7",
  });
  expect(addon).toEqual(await listRow(addon.id));
});

test("a library's answer names who needs it", async () => {
  await installMain();
  const lib = (await service.addonList(installation)).addons.find((a) => a.name === "LibA")!;

  const addon = await service.setIgnored(lib.id, true);

  expect(addon).toMatchObject({ neededBy: ["Main"], installedAsDependency: true, ignored: true });
  expect(addon).toEqual(await listRow(lib.id));
});

test("update, Roll back, reinstall and a channel switch answer the list row", async () => {
  const main = (await installMain()).addon;
  hub.catalog[0]!.version = "1.0.1";

  const updated = await service.updateAddon(main.id);
  expect(updated.operation.status).toBe("updated");
  expect(updated.addon).toMatchObject({ version: "1.0.1", previousVersion: "1.0.0", dependencies: ["LibA", "MissingDep", "Blizzard_Settings"] });
  expect(updated.addon).toEqual(await listRow(main.id));

  const rolledBack = await service.rollback(main.id);
  expect(rolledBack.addon).toMatchObject({ version: "1.0.0", autoUpdatePaused: true, leavesUnneeded: ["LibA"] });
  expect(rolledBack.addon).toEqual(await listRow(main.id));

  const reinstalled = await service.reinstall(main.id);
  expect(reinstalled.operation.status).toBe("installed");
  expect(reinstalled.addon).toEqual(await listRow(main.id));

  const beta = await service.setChannel(main.id, AddonChannelType.Beta);
  expect(beta.addon).toMatchObject({ channel: "beta", version: "1.1.0-beta", gameVersion: "11.0.7" });
  expect(beta.addon).toEqual(await listRow(main.id));
});

test("pausing auto-update and ignoring answer the list row", async () => {
  const main = (await installMain()).addon;

  const paused = await service.setAutoUpdatePaused(main.id, true);
  expect(paused).toMatchObject({ autoUpdatePaused: true, missingDependencies: ["MissingDep"] });
  expect(paused).toEqual(await listRow(main.id));

  const ignored = await service.setIgnored(main.id, true);
  expect(ignored).toMatchObject({ ignored: true, optionalDependencies: ["OptLib"] });
  expect(ignored).toEqual(await listRow(main.id));
});

test("adopting a folder answers the new addon's list row", async () => {
  await installMain();
  mkdirSync(join(addonsPath, "Hand"));
  writeFileSync(join(addonsPath, "Hand", "Hand.toc"), "## Title: Hand\n## Version: 0.9\n## Interface: 110007\n");

  const { addon, operation } = await service.adopt(installation, "Hand", "WowUpHub", "444");

  expect(operation.status).toBe("installed");
  expect(addon).toMatchObject({ dependencies: ["LibA"], missingDependencies: [], previousVersion: "0.9" });
  expect(addon).toEqual(await listRow(addon.id));
});

test("changing the source answers the list row", async () => {
  const main = (await installMain()).addon;

  const { addon, operation } = await service.changeSource(main.id, "TukUI", "611");

  expect(operation.status).toBe("installed");
  expect(addon).toMatchObject({ providerId: "TukUI", dependencies: ["LibA"], optionalDependencies: [], interfaceVersion: "110005" });
  expect(addon).toEqual(await listRow(main.id));
});
