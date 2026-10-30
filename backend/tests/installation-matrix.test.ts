/**
 * Installation regression matrix. One core suite that runs the full
 * lifecycle against a fixture tree containing every installation shape:
 * valid retail/era/beta, leftover-only, empty, malformed, and a manual
 * installation.
 *
 * Covers: detect → select ×N → scan → client-scoped search → install →
 * update → switch → persistence across restart.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { AddonService } from "../src/wow/addons/AddonService";
import { Catalogue } from "../src/wow/catalogue/Catalogue";
import { needsUpdate } from "../src/wow/addons/addonStatus";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/matrix";

/**
 * Fake provider that records the installation each query was scoped to,
 * so client-aware search is regression-tested.
 */
class ScopedFakeProvider extends AddonProvider {
  searchInstallations: string[] = [];
  #versions: Record<string, string>;

  constructor(
    name: "WowUpHub",
    public catalog: Array<{ id: string; name: string; version: string; releaseId: string; folders: string[] }>,
    versions: Record<string, string> = {},
  ) {
    super();
    this.name = name;
    this.enabled = true;
    this.#versions = versions;
  }

  override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
    const entry = this.catalog.find((c) => c.id === addonId);
    return entry ? this.toResult(entry) : undefined;
  }

  override async getAll(
    _installation: WowInstallation,
    addonIds: string[],
  ): Promise<{ searchResults: AddonSearchResult[]; errors: Error[] }> {
    return {
      searchResults: this.catalog.filter((c) => addonIds.includes(c.id)).map((c) => this.toResult(c)),
      errors: [],
    };
  }

  override async searchByQuery(query: string, installation: WowInstallation): Promise<AddonSearchResult[]> {
    this.searchInstallations.push(installation.id);
    return this.catalog
      .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
      .map((c) => this.toResult(c));
  }

  override isValidAddonId(addonId: string): boolean {
    return /^\d+$/.test(addonId);
  }

  private toResult(entry: { id: string; name: string; version: string; releaseId: string; folders: string[] }): AddonSearchResult {
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
          folders: entry.folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${entry.id}.zip`,
          version: this.#versions[entry.id] ?? entry.version,
          releaseDate: new Date().toISOString(),
          externalId: entry.releaseId,
        },
      ],
    };
  }
}

function zipFor(entry: { name: string; folders: string[] }, version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of entry.folders) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
      `## Title: ${entry.name}\n## Version: ${version}\n## Interface: 110005\n`,
    );
  }
  return zipSync(files);
}

function makeStack(dataDir: string, provider: ScopedFakeProvider) {
  const store = createStateStore(dataDir);
  const registry = new ProviderRegistry();
  registry.register(provider);
  registry.attachStore(store);
  const service = new AddonService(
    store,
    registry,
    new DownloadService(
      {
        downloadToFile: async (url: string, dest: string) => {
          const id = url.match(/dl\/(\d+)\.zip/)?.[1]!;
          const entry = provider.catalog.find((c) => c.id === id)!;
          const version = entry.version;
          const bytes = zipFor(entry, version);
          writeFileSync(dest, Buffer.from(bytes));
          return bytes.length;
        },
      } as unknown as NetworkClient,
      join(dataDir, "dl"),
    ),
    { addonsChanged: () => {}, operationResult: () => {} },
  );
  return { store, service, catalogue: new Catalogue(registry) };
}

function writeExe(dir: string, exe: string): void {
  writeFileSync(join(dir, exe), "MZ");
}

let provider: ScopedFakeProvider;
let stack: ReturnType<typeof makeStack>;
const versions: Record<string, string> = {};

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });

  const wowRoot = join(ROOT, "wow", "World of Warcraft");
  // valid retail (confirmed)
  const retail = join(wowRoot, "_retail_");
  mkdirSync(join(retail, "Interface", "AddOns"), { recursive: true });
  writeExe(retail, "Wow.exe");
  // valid era (confirmed)
  const era = join(wowRoot, "_classic_era_");
  mkdirSync(join(era, "Interface", "AddOns"), { recursive: true });
  writeExe(era, "WowClassic.exe");
  // valid beta (likely) — real layout: shared .build.info in the WoW root
  // matched by .flavor.info's Product, see docs/wow-client-identity.md
  const beta = join(wowRoot, "_classic_beta_");
  mkdirSync(join(beta, "Interface", "AddOns"), { recursive: true });
  writeFileSync(join(beta, ".flavor.info"), "Product Flavor!STRING:0\nwow_classic_beta\n");
  writeFileSync(
    join(wowRoot, ".build.info"),
    "Product!STRING:0|Version!STRING:0\nwow_classic_beta|1.15.7\n",
  );
  // leftover-only flavor (addon-data): must NOT auto-register
  const leftover = join(wowRoot, "_ptr_");
  mkdirSync(join(leftover, "Interface", "AddOns"), { recursive: true });
  mkdirSync(join(leftover, "WTF"), { recursive: true });
  // empty flavor (invalid)
  mkdirSync(join(wowRoot, "_classic_ptr_"), { recursive: true });
  // malformed flavor (invalid)
  mkdirSync(join(wowRoot, "_classic_era_ptr_"), { recursive: true });
  writeFileSync(join(wowRoot, "_classic_era_ptr_", "garbage.txt"), "x");

  provider = new ScopedFakeProvider(
    "WowUpHub",
    [{ id: "111", name: "MatrixAddon", version: "1.0.0", releaseId: "r1", folders: ["MatrixAddon"] }],
    versions,
  );
  stack = makeStack(join(ROOT, "data"), provider);
  stack.store.updateSettings({ customWowPaths: [join(ROOT, "wow")] });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("installation matrix", () => {
  test("detect registers exactly the valid installations", async () => {
    await stack.service.installations.detect(join(ROOT, "home"));
    const labels = stack.service.installations.list().map((i) => i.label).sort();
    expect(labels).toEqual(["_classic_beta_", "_classic_era_", "_retail_"]);
  });

  test("selecting each installation switches scan scope and search context", async () => {
    const installs = stack.service.installations.list();
    const retail = installs.find((i) => i.label === "_retail_")!;
    const era = installs.find((i) => i.label === "_classic_era_")!;
    const beta = installs.find((i) => i.label === "_classic_beta_")!;

    for (const target of [retail, era, beta]) {
      stack.service.installations.select(target.id);
      expect(stack.service.installations.require().id).toBe(target.id);
      const addons = await stack.service.listAddons(target);
      expect(addons.every((a) => a.installationId === target.id)).toBe(true);
      await stack.catalogue.search("matrix", stack.service.installations.require());
    }
    // every search was scoped to the installation active at call time
    expect(provider.searchInstallations).toEqual([retail.id, era.id, beta.id]);
  });

  test("install → update lifecycle on the selected installation", async () => {
    const retail = stack.service.installations.list().find((i) => i.label === "_retail_")!;
    stack.service.installations.select(retail.id);

    const { addon } = await stack.service.install({ intent: "install", providerId: "WowUpHub", externalId: "111", installation: retail });
    expect(existsSync(join(retail.location, "Interface", "AddOns", "MatrixAddon", "MatrixAddon.toc"))).toBe(true);

    provider.catalog[0]!.version = "1.1.0";
    provider.catalog[0]!.releaseId = "r2";
    versions["111"] = "1.1.0";
    await stack.service.refresh(retail);
    const listed = await stack.service.listAddons(retail);
    const record = listed.find((a) => a.id === addon.id)!;
    expect(record.updateAvailable).toBe(true);

    const { operation, addon: updated } = await stack.service.updateAddon(addon.id);
    expect(operation.status).toBe("updated");
    expect(updated.version).toBe("1.1.0");
  });

  test("manual installation joins the list and survives re-detection", async () => {
    const manualRoot = join(ROOT, "manual");
    mkdirSync(join(manualRoot, "Interface", "AddOns"), { recursive: true });
    const added = await stack.service.installations.addManual(manualRoot, {
      displayName: "Manual Era",
      clientType: WowClientType.ClassicEra,
    });
    expect(added).toHaveLength(1);

    await stack.service.installations.detect(join(ROOT, "home"));
    expect(stack.service.installations.list().some((i) => i.id === added[0]!.id)).toBe(true);
  });

  test("leftover/empty/malformed flavors never become selectable", async () => {
    const labels = stack.service.installations.list().map((i) => i.label);
    for (const label of ["_ptr_", "_classic_ptr_", "_classic_era_ptr_"]) {
      expect(labels).not.toContain(label);
    }
  });

  test("full state survives an engine restart", () => {
    const retail = stack.service.installations.list().find((i) => i.label === "_retail_")!;
    stack.service.installations.select(retail.id);

    const restarted = makeStack(join(ROOT, "data"), provider);
    expect(restarted.service.installations.selectedId()).toBe(retail.id);
    expect(restarted.service.installations.list().map((i) => i.label).sort()).toEqual([
      "_classic_beta_",
      "_classic_era_",
      "_retail_",
      "manual",
    ]);
    // manual entry present
    expect(restarted.service.installations.list().some((i) => i.displayName === "Manual Era")).toBe(true);
    // installed addon record persists for retail
    const addons = restarted.service.addonsFor(retail.id);
    expect(addons.length).toBeGreaterThan(0);
    expect(needsUpdate(addons[0]!)).toBe(false);
  });
});
