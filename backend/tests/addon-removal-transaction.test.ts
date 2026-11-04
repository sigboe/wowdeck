/**
 * Managed, unmanaged and orphan removals commit through the addon
 * transaction (ADR 0006, #103): the folders go and the record with them, in
 * one commit with evidence that outlives the record. Seen through the
 * addon-service operation boundary with real temporary game folders, a fake
 * provider, reopened state stores and FaultInjectingFs failing named stages.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { classifyTransaction } from "../src/wow/addons/AddonTransaction";
import { FaultInjectingFs, type FsStage } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { WowClientType, type AddonProviderType } from "../src/wow/types";
import type { OperationResult } from "../src/api/contracts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const FOLDERS = ["Suite", "SuiteLib"];

/** One addon (id 700) installing Suite and SuiteLib. */
class OneAddonProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;

  override async getById(id: string): Promise<AddonSearchResult | undefined> {
    return id === "700" ? this.result() : undefined;
  }

  override async getAll(_i: WowInstallation, ids: string[]) {
    return { searchResults: ids.includes("700") ? [this.result()] : [], errors: [] };
  }

  override isValidAddonId(id: string): boolean {
    return /^\d+$/.test(id);
  }

  private result(): AddonSearchResult {
    return {
      author: "Dev",
      externalId: "700",
      externalUrl: "https://fake/700",
      name: "Suite",
      providerName: this.name,
      downloadCount: 1,
      files: [
        {
          channelType: 0,
          folders: FOLDERS,
          gameVersion: "11.0.2",
          downloadUrl: "https://fake/dl/700.zip",
          version: "1.0",
          releaseDate: "2026-06-01T00:00:00.000Z",
          externalId: "r1",
        },
      ],
    };
  }
}

function zipOfSuite(): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of FOLDERS) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${folder}\n## Version: 1.0\n## Interface: 110005\n`);
    files[`${folder}/core.lua`] = new TextEncoder().encode(`-- ${folder} 1.0\n`);
  }
  return zipSync(files);
}

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-remove-${name}-`));
  roots.push(root);
  const location = join(root, "_retail_");
  const addonsPath = join(location, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  const installation: WowInstallation = {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const network = {
    downloadToFile: async (_url: string, dest: string) => {
      const bytes = zipOfSuite();
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
  const fs = new FaultInjectingFs();
  const dataDir = join(root, "data");
  const registry = new ProviderRegistry();
  registry.register(new OneAddonProvider());
  const operations: OperationResult[] = [];
  const open = () => {
    const store = createStateStore(dataDir, fs);
    return {
      store,
      service: new AddonService(store, registry, new DownloadService(network, join(root, "dl")), {
        addonsChanged: () => {},
        operationResult: (op) => operations.push(op),
      }),
    };
  };
  const first = open();
  first.store.setInstallations([installation]);
  return {
    ...first,
    fs,
    installation,
    addonsPath,
    operations,
    /** The engine as it is after a restart: storage reopened from disk. */
    reopen: () => open(),
    async installSuite(): Promise<string> {
      const { addon, operation } = await first.service.install({
        intent: "install",
        providerId: "WowUpHub",
        externalId: "700",
        installation,
      });
      expect(operation.status).toBe("installed");
      return addon.id;
    },
    /** A hand-copied folder no record owns. */
    loose(folder = "Loose") {
      mkdirSync(join(addonsPath, folder));
      writeFileSync(join(addonsPath, folder, `${folder}.toc`), `## Title: ${folder}\n`);
      writeFileSync(join(addonsPath, folder, "mine.lua"), "-- edited by hand\n");
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

/** Every file and folder under `dir` with its contents ("<dir>" for a folder). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) {
    return out;
  }
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (lstatSync(path).isDirectory()) {
        out[rel] = "<dir>";
        walk(path);
      } else {
        out[rel] = readFileSync(path, "utf-8");
      }
    }
  };
  walk(dir);
  return out;
}

const stored = (f: Fixture) => f.reopen().store.addons;

/** Every original file is somewhere under the plugin's folder, byte for byte. */
function expectPreserved(f: Fixture, original: Record<string, string>) {
  const kept = Object.entries(tree(join(f.addonsPath, ".wowdeck")));
  for (const [path, content] of Object.entries(original).filter(([, c]) => c !== "<dir>")) {
    expect(kept.some(([p, c]) => p.endsWith(`/${path}`) && c === content), path).toBe(true);
  }
}

/** A library record (isDependency) owning the folder `Lib`, which nothing installed requires. */
function orphanLibrary(f: Fixture, mainId: string): string {
  const main = f.store.addons.require(mainId);
  mkdirSync(join(f.addonsPath, "Lib"));
  writeFileSync(join(f.addonsPath, "Lib", "Lib.toc"), "## Title: Lib\n");
  writeFileSync(join(f.addonsPath, "Lib", "lib.lua"), "-- Lib\n");
  f.store.addons.create({
    ...main,
    id: "lib-record",
    name: "Lib",
    externalId: "701",
    installedFolderList: ["Lib"],
    installedFolders: "Lib",
    isDependency: true,
    dependencies: [],
  });
  return "lib-record";
}

describe("a completed removal (scenario 1)", () => {
  test("managed: folders and record go together, and commit evidence names it after reopening with no record left", async () => {
    const f = fixture("managed");
    const id = await f.installSuite();
    f.loose("Other");

    const operation = await f.service.removeAddon(id);

    expect(operation).toMatchObject({ addonId: id, status: "removed", error: null });
    expect(operation.cleanupWarning).toBeUndefined();
    expect(tree(f.addonsPath)).toEqual({
      Other: "<dir>",
      "Other/Other.toc": "## Title: Other\n",
      "Other/mine.lua": "-- edited by hand\n",
    });
    const reopened = stored(f);
    expect(reopened.get(id)).toBeUndefined();
    expect(reopened.markers()).toEqual([]);
    expect(reopened.commitsFor(f.installation.id)).toEqual([
      expect.objectContaining({ operation: "remove", addonId: id, folders: FOLDERS }),
    ]);
  });

  test("unmanaged: the folder goes, no record changes, and commit evidence names the folder", async () => {
    const f = fixture("unmanaged");
    const id = await f.installSuite();
    f.loose();
    const records = stored(f).all();

    const operation = await f.service.removeUnmanagedFolder(f.installation, "Loose");

    expect(operation).toMatchObject({ addonId: "unmanaged:Loose", status: "removed", error: null });
    expect(existsSync(join(f.addonsPath, "Loose"))).toBe(false);
    expect(readFileSync(join(f.addonsPath, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 1.0\n");
    const reopened = stored(f);
    expect(reopened.all()).toEqual(records);
    expect(reopened.markers()).toEqual([]);
    const evidence = reopened.commitsFor(f.installation.id).filter((c) => c.operation === "remove");
    expect(evidence).toEqual([{ transactionId: expect.any(String), installationId: f.installation.id, operation: "remove", folders: ["Loose"] }]);
    expect(reopened.require(id).installedVersion).toBe("1.0");
  });

  test("removing the same unmanaged folder again keeps one evidence entry for it", async () => {
    const f = fixture("unmanaged-again");
    f.loose();
    f.loose("Other");
    await f.service.removeUnmanagedFolder(f.installation, "Other");
    await f.service.removeUnmanagedFolder(f.installation, "Loose");
    f.loose();
    await f.service.removeUnmanagedFolder(f.installation, "Loose");

    expect(stored(f).commitsFor(f.installation.id).map((c) => c.folders)).toEqual([["Other"], ["Loose"]]);
  });

  test("a record naming no folders is refused, changing nothing", async () => {
    const f = fixture("no-folders");
    const id = await f.installSuite();
    f.store.addons.patch(id, { installedFolderList: [], installedFolders: "" });
    const before = tree(f.addonsPath);

    await expect(f.service.removeAddon(id)).rejects.toThrow(/weren't found/);
    expect(tree(f.addonsPath)).toEqual(before);
    expect(stored(f).get(id)).toBeDefined();
  });

  test("a recorded folder already missing on disk counts as removed", async () => {
    const f = fixture("missing");
    const id = await f.installSuite();
    rmSync(join(f.addonsPath, "SuiteLib"), { recursive: true });

    expect((await f.service.removeAddon(id)).status).toBe("removed");
    expect(tree(f.addonsPath)).toEqual({});
    expect(stored(f).get(id)).toBeUndefined();
  });
});

describe("a removal that fails before commit (scenario 2)", () => {
  const cases: [string, FsStage, number][] = [
    ["moving the first folder aside", "folder.backup", 0],
    ["moving the second folder aside", "folder.backup", 1],
    ["writing the record", "state.write", 0],
    ["replacing the state file", "state.replace", 0],
  ];
  for (const [what, stage, after] of cases) {
    test(`managed, ${what}: folders and record stay as they were, and another attempt removes it`, async () => {
      const f = fixture(`managed-${stage}-${after}`);
      const id = await f.installSuite();
      const before = tree(f.addonsPath);
      const record = stored(f).require(id);

      f.fs.failAt(stage, { after });
      const operation = await f.service.removeAddon(id);

      expect(operation).toMatchObject({ addonId: id, status: "failed" });
      expect(operation.error).toMatch(/Nothing was changed$/);
      expect(operation.recoveryRequired).toBeUndefined();
      expect(f.operations.at(-1)).toEqual(operation);
      expect(tree(f.addonsPath)).toEqual(before);
      expect(stored(f).require(id)).toEqual(record);
      expect(stored(f).markers()).toEqual([]);
      expect(f.service.recovery.status(f.installation.id).status).toBe("ready");

      f.fs.clear();
      expect((await f.service.removeAddon(id)).status).toBe("removed");
      expect(tree(f.addonsPath)).toEqual({});
      expect(stored(f).get(id)).toBeUndefined();
    });
  }

  for (const stage of ["folder.backup", "state.write"] as const satisfies FsStage[]) {
    test(`unmanaged, failing at ${stage}: the folder stays as it was, and another attempt removes it`, async () => {
      const f = fixture(`unmanaged-${stage}`);
      f.loose();
      const before = tree(f.addonsPath);

      f.fs.failAt(stage);
      const operation = await f.service.removeUnmanagedFolder(f.installation, "Loose");

      expect(operation).toMatchObject({ addonId: "unmanaged:Loose", status: "failed" });
      expect(tree(f.addonsPath)).toEqual(before);
      expect(stored(f).markers()).toEqual([]);
      expect(stored(f).commitsFor(f.installation.id)).toEqual([]);

      f.fs.clear();
      expect((await f.service.removeUnmanagedFolder(f.installation, "Loose")).status).toBe("removed");
      expect(tree(f.addonsPath)).toEqual({});
    });
  }
});

describe("a removal whose restoration fails (scenario 3)", () => {
  test("managed: every copy is kept, the record stays, and the installation is recovery required", async () => {
    const f = fixture("managed-undo-stops");
    const id = await f.installSuite();
    const original = tree(f.addonsPath);
    const record = stored(f).require(id);

    f.fs.failAt("state.write").failAt("folder.restore");
    const operation = await f.service.removeAddon(id);
    f.fs.clear();

    expect(operation).toMatchObject({ addonId: id, status: "failed", recoveryRequired: true });
    expect(operation.error).toMatch(/^Couldn't put the addon's files back\. Its original files are kept in AddOns\/\.wowdeck\/tx-/);
    expectPreserved(f, original);
    const reopened = f.reopen();
    expect(reopened.store.addons.require(id)).toEqual(record);
    expect(reopened.store.addons.markers()).toHaveLength(1);
    expect(reopened.service.recovery.status(f.installation.id).status).toBe("recoveryRequired");
  });

  test("unmanaged: the folder's copy is kept and the installation is recovery required", async () => {
    const f = fixture("unmanaged-undo-stops");
    f.loose();
    const original = tree(f.addonsPath);

    f.fs.failAt("state.write").failAt("folder.restore");
    const operation = await f.service.removeUnmanagedFolder(f.installation, "Loose");
    f.fs.clear();

    expect(operation).toMatchObject({ status: "failed", recoveryRequired: true });
    expectPreserved(f, original);
    expect(f.reopen().service.recovery.status(f.installation.id).status).toBe("recoveryRequired");
  });
});

describe("orphan removal", () => {
  test("each orphaned library goes in a transaction of its own, with its own commit evidence", async () => {
    const f = fixture("orphan");
    const id = await f.installSuite();
    const lib = orphanLibrary(f, id);

    expect((await f.service.removeAddon(id)).status).toBe("removed");

    expect(tree(f.addonsPath)).toEqual({});
    const reopened = stored(f);
    expect(reopened.all()).toEqual([]);
    expect(reopened.markers()).toEqual([]);
    const evidence = reopened.commitsFor(f.installation.id);
    expect(evidence).toEqual([
      expect.objectContaining({ operation: "remove", addonId: id, folders: FOLDERS }),
      expect.objectContaining({ operation: "remove", addonId: lib, folders: ["Lib"] }),
    ]);
    expect(evidence[0]!.transactionId).not.toBe(evidence[1]!.transactionId);
  });

  test("an orphan whose removal fails stays as it was; the removal itself stands", async () => {
    const f = fixture("orphan-fails");
    const id = await f.installSuite();
    const lib = orphanLibrary(f, id);
    const libRecord = stored(f).require(lib);
    const libFiles = tree(join(f.addonsPath, "Lib"));

    // Suite and SuiteLib move aside; the library's move fails.
    f.fs.failAt("folder.backup", { after: 2 });
    const operation = await f.service.removeAddon(id);

    expect(operation).toMatchObject({ addonId: id, status: "removed" });
    expect(tree(join(f.addonsPath, "Lib"))).toEqual(libFiles);
    const reopened = stored(f);
    expect(reopened.get(id)).toBeUndefined();
    expect(reopened.require(lib)).toEqual(libRecord);
    expect(reopened.markers()).toEqual([]);
    expect(FOLDERS.some((folder) => existsSync(join(f.addonsPath, folder)))).toBe(false);
  });
});

describe("a committed removal whose cleanup fails", () => {
  test("is removed with a warning; its leftover is committed after reopening and goes at the next change", async () => {
    const f = fixture("cleanup");
    const id = await f.installSuite();
    f.loose();

    f.fs.failAt("cleanup.remove");
    const operation = await f.service.removeAddon(id);
    f.fs.clear();

    expect(operation).toMatchObject({ status: "removed", error: null });
    expect(operation.cleanupWarning).toMatch(/^Its temporary files are left in AddOns\/\.wowdeck\/tx-/);
    expect(FOLDERS.some((folder) => existsSync(join(f.addonsPath, folder)))).toBe(false);
    const engine = f.reopen();
    expect(engine.store.addons.get(id)).toBeUndefined();
    const [marker] = engine.store.addons.markers();
    expect(classifyTransaction(engine.store.addons, marker)).toBe("committed");
    expect(engine.service.recovery.status(f.installation.id).status).toBe("ready");

    expect((await engine.service.removeUnmanagedFolder(f.installation, "Loose")).cleanupWarning).toBeUndefined();
    expect(tree(f.addonsPath)).toEqual({});
    expect(stored(f).markers()).toEqual([]);
  });
});
