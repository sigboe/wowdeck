/**
 * Workflows that change several addons (#110, scenario 9): required
 * dependencies, the libraries a removal leaves unneeded, addon-list import
 * and Update all commit each addon in a transaction of its own. Completed ones stay committed, the
 * result names every addon's outcome, an ordinary failure lets the rest go
 * on, and recovery required stops the rest in that installation only. Seen
 * through the addon-service operation boundary with real temporary game
 * folders, a fake provider and FaultInjectingFs failing named stages.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { AddonDependencyType, WowClientType, type AddonProviderType } from "../src/wow/types";
import type { OperationResult } from "../src/api/contracts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface Entry {
  name: string;
  version: string;
  dependencies?: string[];
}

/** A small catalogue: each addon installs one folder named after it. */
class CatalogProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  constructor(readonly catalog: Map<string, Entry>) {
    super();
  }

  override async getById(id: string): Promise<AddonSearchResult | undefined> {
    return this.result(id);
  }

  override async getAll(_i: WowInstallation, ids: string[]) {
    return { searchResults: ids.flatMap((id) => this.result(id) ?? []), errors: [] };
  }

  override isValidAddonId(id: string): boolean {
    return /^\d+$/.test(id);
  }

  private result(id: string): AddonSearchResult | undefined {
    const entry = this.catalog.get(id);
    if (!entry) {
      return undefined;
    }
    return {
      author: "Dev",
      externalId: id,
      externalUrl: `https://fake/${id}`,
      name: entry.name,
      providerName: this.name,
      downloadCount: 1,
      files: [
        {
          channelType: 0,
          folders: [entry.name],
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${id}.zip?v=${entry.version}`,
          version: entry.version,
          releaseDate: "2026-06-01T00:00:00.000Z",
          externalId: `${id}-${entry.version}`,
          dependencies: (entry.dependencies ?? []).map((externalAddonId) => ({
            externalAddonId,
            type: AddonDependencyType.Required,
          })),
        },
      ],
    };
  }
}

function installationAt(root: string, name: string): WowInstallation & { addonsPath: string } {
  const location = join(root, name, "_retail_");
  const addonsPath = join(location, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  return {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location,
    label: "_retail_",
    displayName: name,
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
    addonsPath,
  };
}

/**
 * Two installations, A and B. `failDownload` makes an addon's download fail
 * (an ordinary failure, nothing changed); `stopUndo` makes an addon's next
 * install fail at its commit with the undo stopping (recovery required).
 */
function fixture(name: string, catalog: Record<string, Entry>) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-partial-${name}-`));
  roots.push(root);
  const a = installationAt(root, "A");
  const b = installationAt(root, "B");
  const entries = new Map(Object.entries(catalog).map(([id, e]) => [id, { ...e }]));
  const provider = new CatalogProvider(entries);
  const fs = new FaultInjectingFs();
  const failDownload = new Set<string>();
  const stopUndo = new Set<string>();
  const network = {
    downloadToFile: async (url: string, dest: string) => {
      const id = /\/dl\/(\d+)\.zip/.exec(url)![1]!;
      if (failDownload.has(id)) {
        throw new Error(`download of ${id} failed`);
      }
      if (stopUndo.delete(id)) {
        fs.failAt("state.write", { times: 1 }).failAt("folder.restore", { times: 1 });
      }
      const entry = entries.get(id)!;
      const bytes = zipSync({
        [`${entry.name}/${entry.name}.toc`]: new TextEncoder().encode(
          `## Title: ${entry.name}\n## Version: ${entry.version}\n## Interface: 110005\n`,
        ),
        [`${entry.name}/core.lua`]: new TextEncoder().encode(`-- ${entry.name} ${entry.version}\n`),
      });
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
  const registry = new ProviderRegistry();
  registry.register(provider);
  const operations: OperationResult[] = [];
  const store = createStateStore(join(root, "data"), fs);
  const service = new AddonService(store, registry, new DownloadService(network, join(root, "dl")), {
    addonsChanged: () => {},
    operationResult: (op) => operations.push(op),
  });
  const { addonsPath: addonsA, ...instA } = a;
  const { addonsPath: addonsB, ...instB } = b;
  store.setInstallations([instA, instB]);
  return {
    store,
    service,
    fs,
    entries,
    failDownload,
    stopUndo,
    operations,
    a: instA,
    b: instB,
    addonsA,
    addonsB,
    install: (installation: WowInstallation, externalId: string) =>
      service.install({ intent: "install", providerId: "WowUpHub", externalId, installation }),
    /** The installed copy of an addon's code file, or null. */
    onDisk: (addonsPath: string, folder: string) => {
      const path = join(addonsPath, folder, "core.lua");
      return existsSync(path) ? readFileSync(path, "utf-8") : null;
    },
    async publish(id: string, version: string) {
      entries.get(id)!.version = version;
      for (const installation of [instA, instB]) {
        await service.refresh(installation).catch(() => {});
      }
    },
  };
}

describe("required dependencies", () => {
  test("each commits on its own; the result names every dependency's outcome, and a failure doesn't stop the next", async () => {
    const f = fixture("deps", {
      "100": { name: "Main", version: "1.0", dependencies: ["101", "102", "103"] },
      "101": { name: "LibOne", version: "1.0" },
      "102": { name: "LibTwo", version: "1.0" },
      "103": { name: "LibThree", version: "1.0" },
    });
    f.failDownload.add("102");

    const { operation } = await f.install(f.a, "100");

    expect(operation.status).toBe("installed");
    expect(operation.followUps).toEqual([
      expect.objectContaining({ addonName: "LibOne", status: "installed", error: null }),
      expect.objectContaining({ addonName: "LibTwo", status: "failed", error: expect.stringContaining("102") }),
      expect.objectContaining({ addonName: "LibThree", status: "installed", error: null }),
    ]);
    expect(operation.followUps?.some((o) => o.recoveryRequired)).toBe(false);
    expect(operation.missingRequiredDependencies).toEqual(["102"]);
    expect(f.onDisk(f.addonsA, "Main")).toBe("-- Main 1.0\n");
    expect(f.onDisk(f.addonsA, "LibOne")).toBe("-- LibOne 1.0\n");
    expect(f.onDisk(f.addonsA, "LibTwo")).toBeNull();
    expect(f.onDisk(f.addonsA, "LibThree")).toBe("-- LibThree 1.0\n");
    expect(f.store.addons.forInstallation(f.a.id).map((r) => r.name).sort()).toEqual(["LibOne", "LibThree", "Main"]);
  });

  test("one whose undo stops leaves the addon and earlier dependencies committed, and stops the rest", async () => {
    const f = fixture("deps-recovery", {
      "100": { name: "Main", version: "1.0", dependencies: ["101", "102", "103"] },
      "101": { name: "LibOne", version: "1.0" },
      "102": { name: "LibTwo", version: "1.0" },
      "103": { name: "LibThree", version: "1.0" },
    });
    f.stopUndo.add("102");

    const { operation } = await f.install(f.a, "100");

    expect(operation.status).toBe("installed");
    expect(operation.followUps).toEqual([
      expect.objectContaining({ addonName: "LibOne", status: "installed" }),
      expect.objectContaining({ addonName: "LibTwo", status: "failed", recoveryRequired: true }),
      expect.objectContaining({ status: "failed", recoveryRequired: true }),
    ]);
    expect(operation.missingRequiredDependencies).toEqual(["102", "103"]);
    expect(f.onDisk(f.addonsA, "LibThree")).toBeNull();
    expect(f.store.addons.forInstallation(f.a.id).map((r) => r.name).sort()).toEqual(["LibOne", "Main"]);
    expect(f.service.recovery.status(f.a.id).status).toBe("recoveryRequired");
    expect(f.service.recovery.status(f.b.id).status).toBe("ready");
  });
});

describe("libraries a removal leaves unneeded", () => {
  const LIBS = {
    "100": { name: "Main", version: "1.0", dependencies: ["101", "102", "103"] },
    "101": { name: "LibOne", version: "1.0" },
    "102": { name: "LibTwo", version: "1.0" },
    "103": { name: "LibThree", version: "1.0" },
  };

  test("each goes on its own; one that fails stays, the next still goes, and the result names each", async () => {
    const f = fixture("orphans", LIBS);
    const { addon } = await f.install(f.a, "100");
    // Main's folder and LibOne's move aside; LibTwo's move fails.
    f.fs.failAt("folder.backup", { after: 2, times: 1 });

    const operation = await f.service.removeAddon(addon.id, { removeLibraries: true });

    expect(operation).toMatchObject({ addonId: addon.id, status: "removed" });
    expect(operation.followUps).toEqual([
      expect.objectContaining({ addonName: "LibOne", status: "removed", error: null }),
      expect.objectContaining({ addonName: "LibTwo", status: "failed" }),
      expect.objectContaining({ addonName: "LibThree", status: "removed", error: null }),
    ]);
    expect(operation.followUps?.some((o) => o.recoveryRequired)).toBe(false);
    expect(f.store.addons.forInstallation(f.a.id).map((r) => r.name)).toEqual(["LibTwo"]);
    expect(f.onDisk(f.addonsA, "LibTwo")).toBe("-- LibTwo 1.0\n");
    expect(["Main", "LibOne", "LibThree"].map((n) => f.onDisk(f.addonsA, n))).toEqual([null, null, null]);
  });

  test("one whose undo stops keeps earlier removals and stops the rest; the result says so", async () => {
    const f = fixture("orphans-recovery", LIBS);
    const { addon } = await f.install(f.a, "100");
    await f.install(f.b, "100");
    // Main's and LibOne's commits go through; LibTwo's fails and its undo stops.
    f.fs.failAt("state.write", { after: 2, times: 1 }).failAt("folder.restore", { times: 1 });

    const operation = await f.service.removeAddon(addon.id, { removeLibraries: true });

    expect(operation).toMatchObject({ addonId: addon.id, status: "removed" });
    expect(operation.followUps).toEqual([
      expect.objectContaining({ addonName: "LibOne", status: "removed" }),
      expect.objectContaining({ addonName: "LibTwo", status: "failed", recoveryRequired: true }),
      expect.objectContaining({ addonName: "LibThree", status: "failed", recoveryRequired: true }),
    ]);
    expect(f.onDisk(f.addonsA, "LibThree")).toBe("-- LibThree 1.0\n");
    expect(f.store.addons.forInstallation(f.a.id).map((r) => r.name).sort()).toEqual(["LibThree", "LibTwo"]);
    expect(f.service.recovery.status(f.a.id).status).toBe("recoveryRequired");
    // The other installation is untouched and still changes.
    expect(f.store.addons.forInstallation(f.b.id)).toHaveLength(4);
    const inB = f.store.addons.forInstallation(f.b.id).find((r) => r.name === "Main")!;
    expect((await f.service.removeAddon(inB.id, { removeLibraries: true })).followUps).toHaveLength(3);
  });
});

const FOUR = {
  "101": { name: "Alpha", version: "1.0" },
  "102": { name: "Bravo", version: "1.0" },
  "103": { name: "Charlie", version: "1.0" },
  "104": { name: "Delta", version: "1.0" },
};

/** An addon's outcome in a list of results, by name. */
const outcome = (operations: OperationResult[], name: string) => operations.find((o) => o.addonName === name);

describe("addon-list import", () => {
  test("an entry that fails doesn't stop the next; one whose undo stops refuses the rest and the follow-up write", async () => {
    const f = fixture("import", FOUR);
    for (const id of Object.keys(FOUR)) {
      await f.install(f.b, id);
    }
    const { payload } = await f.service.portability.export(f.b);
    f.failDownload.add("102");
    f.stopUndo.add("103");

    const { operations, error } = await f.service.importAddonList(payload, f.a);

    expect(error).toBeNull();
    expect(operations.map((o) => o.addonName)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(outcome(operations, "Alpha")).toMatchObject({ status: "installed", error: null });
    expect(outcome(operations, "Bravo")).toMatchObject({ status: "failed" });
    expect(outcome(operations, "Bravo")?.recoveryRequired).toBeUndefined();
    expect(outcome(operations, "Charlie")).toMatchObject({ status: "failed", recoveryRequired: true });
    expect(outcome(operations, "Delta")).toMatchObject({ status: "failed", recoveryRequired: true });
    expect(f.store.addons.forInstallation(f.a.id).map((r) => r.name)).toEqual(["Alpha"]);
    expect(f.onDisk(f.addonsA, "Delta")).toBeNull();
    expect(f.service.recovery.status(f.b.id).status).toBe("ready");
  });
});

describe("Update all", () => {
  async function updatable(name: string) {
    const f = fixture(name, FOUR);
    for (const installation of [f.a, f.b]) {
      for (const id of Object.keys(FOUR)) {
        await f.install(installation, id);
      }
    }
    for (const id of Object.keys(FOUR)) {
      await f.publish(id, "2.0");
    }
    return f;
  }

  test("names each addon's outcome; a failure doesn't stop the next", async () => {
    const f = await updatable("update-all");
    f.failDownload.add("102");

    const operations = await f.service.updateAll(f.a);

    expect(operations.map((o) => [o.addonName, o.status])).toEqual([
      ["Alpha", "updated"],
      ["Bravo", "failed"],
      ["Charlie", "updated"],
      ["Delta", "updated"],
    ]);
    expect(operations.some((o) => o.recoveryRequired)).toBe(false);
    expect(f.onDisk(f.addonsA, "Bravo")).toBe("-- Bravo 1.0\n");
    expect(f.onDisk(f.addonsA, "Delta")).toBe("-- Delta 2.0\n");
  });

  test("across installations: recovery required stops the rest of that installation only", async () => {
    const f = await updatable("update-all-installations");
    f.stopUndo.add("103");

    const operations = await f.service.updateAllInstallations();

    expect(operations.map((o) => [o.addonName, o.status, o.recoveryRequired ?? false])).toEqual([
      ["Alpha", "updated", false],
      ["Bravo", "updated", false],
      ["Charlie", "failed", true],
      ["Delta", "failed", true],
      ["Alpha", "updated", false],
      ["Bravo", "updated", false],
      ["Charlie", "updated", false],
      ["Delta", "updated", false],
    ]);
    // Committed updates in A stay; the refused one never changed.
    expect(f.onDisk(f.addonsA, "Bravo")).toBe("-- Bravo 2.0\n");
    expect(f.onDisk(f.addonsA, "Delta")).toBe("-- Delta 1.0\n");
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      expect(f.onDisk(f.addonsB, name)).toBe(`-- ${name} 2.0\n`);
    }
    expect(f.service.recovery.status(f.a.id).status).toBe("recoveryRequired");
    expect(f.service.recovery.status(f.b.id).status).toBe("ready");
  });
});
