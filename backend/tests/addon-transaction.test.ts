/**
 * Install and update commit their folder changes and addon record together
 * (ADR 0006, #101), seen through the addon-service operation boundary: real
 * temporary game folders, generated archives, a fake provider, reopened
 * state stores, and FaultInjectingFs failing named stages.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonTransactions, classifyTransaction } from "../src/wow/addons/AddonTransaction";
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

interface Release {
  version: string;
  releaseId: string;
  folders: string[];
}

/** One addon whose current release a test changes (`publish`). */
class OneAddonProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  release: Release = { version: "1.0", releaseId: "r1", folders: ["Suite", "SuiteLib"] };

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
    const { version, releaseId, folders } = this.release;
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
          folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/700.zip?v=${version}`,
          version,
          releaseDate: "2026-06-01T00:00:00.000Z",
          externalId: releaseId,
        },
      ],
    };
  }
}

/** Each folder holds a TOC and a code file that both name the version. */
function zipOf(release: Release): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of release.folders) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${folder}\n## Version: ${release.version}\n## Interface: 110005\n`);
    files[`${folder}/core.lua`] = new TextEncoder().encode(`-- ${folder} ${release.version}\n`);
  }
  return zipSync(files);
}

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-tx-${name}-`));
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
  const provider = new OneAddonProvider();
  const network = {
    downloadToFile: async (_url: string, dest: string) => {
      const bytes = zipOf(provider.release);
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
  const fs = new FaultInjectingFs();
  const dataDir = join(root, "data");
  const registry = new ProviderRegistry();
  registry.register(provider);
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
  first.store.updateSettings({ keepPreviousVersions: true });
  return {
    ...first,
    fs,
    provider,
    installation,
    addonsPath,
    operations,
    /** The engine as it is after a restart: storage reopened from disk. */
    reopen: () => open(),
    install: () => first.service.install({ intent: "install", providerId: "WowUpHub", externalId: "700", installation }),
    publish(version: string, releaseId: string, folders = provider.release.folders) {
      provider.release = { version, releaseId, folders };
    },
  };
}

/** Every file and folder under `dir` with its contents ("<dir>" for a folder). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (lstatSync(path).isSymbolicLink()) {
        out[rel] = "<link>";
      } else if (lstatSync(path).isDirectory()) {
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

/** The live addon folders, without the plugin's own work folder. */
function live(addonsPath: string): Record<string, string> {
  return Object.fromEntries(Object.entries(tree(addonsPath)).filter(([p]) => !p.startsWith(".wowdeck")));
}

type Fixture = ReturnType<typeof fixture>;

/** Installs 1.0 and publishes 2.0; returns the addon's id. */
async function installedWithUpdate(f: Fixture, folders?: string[]): Promise<string> {
  const { addon, operation } = await f.install();
  expect(operation.status).toBe("installed");
  f.publish("2.0", "r2", folders);
  await f.service.refresh(f.installation);
  return addon.id;
}

const storedRecord = (f: Fixture, id: string) => f.reopen().store.addons.get(id);

describe("an update whose record write fails (the reviewed mid-swap path)", () => {
  for (const stage of ["state.write", "state.replace"] as const satisfies FsStage[]) {
    test(`at ${stage} restores the original folders and record, reports failure, and allows another attempt`, async () => {
      const f = fixture(`record-${stage}`);
      const id = await installedWithUpdate(f);
      const folders = live(f.addonsPath);
      const record = storedRecord(f, id);

      f.fs.failAt(stage);
      const { operation } = await f.service.updateAddon(id);

      expect(operation.status).toBe("failed");
      expect(live(f.addonsPath)).toEqual(folders);
      expect(storedRecord(f, id)).toEqual(record);
      expect(f.service.addonsFor(f.installation.id).find((a) => a.id === id)).toEqual(record);

      f.fs.clear();
      const retry = await f.service.updateAddon(id);
      expect(retry.operation.status).toBe("updated");
      expect(readFileSync(join(f.addonsPath, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 2.0\n");
      expect(storedRecord(f, id)?.installedVersion).toBe("2.0");
    });
  }
});

describe("a completed install or update (scenario 1)", () => {
  test("leaves folders and records in agreement, identified by commit evidence after reopening storage", async () => {
    const f = fixture("commit");
    const { addon } = await f.install();
    const installEvidence = f.reopen().store.addons.commitsFor(f.installation.id);
    expect(installEvidence).toEqual([
      expect.objectContaining({ operation: "install", addonId: addon.id, folders: ["Suite", "SuiteLib"] }),
    ]);

    f.publish("2.0", "r2");
    await f.service.refresh(f.installation);
    const { operation } = await f.service.updateAddon(addon.id);
    expect(operation.status).toBe("updated");

    const reopened = f.reopen().store.addons;
    const record = reopened.require(addon.id);
    expect(record).toMatchObject({ installedVersion: "2.0", installedFolderList: ["Suite", "SuiteLib"] });
    expect(live(f.addonsPath)).toMatchObject({
      "Suite/core.lua": "-- Suite 2.0\n",
      "SuiteLib/core.lua": "-- SuiteLib 2.0\n",
    });
    // The update's evidence is the addon's proof now; the install's is superseded.
    expect(reopened.commitsFor(f.installation.id)).toEqual([
      expect.objectContaining({ operation: "update", addonId: addon.id, folders: ["Suite", "SuiteLib"] }),
    ]);
    expect(reopened.markers()).toEqual([]);
    // Only the Roll back cache is left in the plugin's folder.
    expect(readdirSync(join(f.addonsPath, ".wowdeck"))).toEqual(["rollback"]);
  });
});

describe("a folder move that fails before commit (scenario 2)", () => {
  const cases: [string, FsStage, number][] = [
    ["moving the first live folder aside", "folder.backup", 0],
    ["moving the second live folder aside", "folder.backup", 1],
    ["moving the first staged folder in", "folder.install", 0],
    ["moving the second staged folder in", "folder.install", 1],
  ];
  for (const [what, stage, after] of cases) {
    test(`${what} restores the original folders and record byte for byte and allows another attempt`, async () => {
      const f = fixture(`move-${stage}-${after}`);
      const id = await installedWithUpdate(f);
      await f.service.updateAddon(id); // 2.0, with 1.0 kept for Roll back
      f.publish("3.0", "r3");
      await f.service.refresh(f.installation);
      const before = tree(f.addonsPath);
      const record = storedRecord(f, id);

      f.fs.failAt(stage, { after });
      const { operation } = await f.service.updateAddon(id);

      expect(operation.status).toBe("failed");
      expect(operation.error).toBe("Couldn't put the addon's files in place. Nothing was changed");
      expect(tree(f.addonsPath)).toEqual(before); // live folders and the kept previous version
      expect(storedRecord(f, id)).toEqual(record);
      expect(f.reopen().store.addons.markers()).toEqual([]);

      f.fs.clear();
      expect((await f.service.updateAddon(id)).operation.status).toBe("updated");
      expect(storedRecord(f, id)).toMatchObject({ installedVersion: "3.0", rollbackVersion: "2.0" });
    });
  }

  test("a new install whose record write fails leaves no folders and no record", async () => {
    const f = fixture("new-record-fails");
    f.fs.failAt("state.write");
    const { operation } = await f.install();

    expect(operation).toMatchObject({ status: "failed", error: "Couldn't save the addon list. Nothing was changed" });
    expect(tree(f.addonsPath)).toEqual({});
    expect(f.reopen().store.addons.all()).toEqual([]);
    expect(f.reopen().store.addons.commitsFor(f.installation.id)).toEqual([]);

    f.fs.clear();
    expect((await f.install()).operation.status).toBe("installed");
  });

  test("an adopt whose record write fails puts the hand-copied folder back as it was", async () => {
    const f = fixture("adopt-fails");
    mkdirSync(join(f.addonsPath, "Suite"));
    writeFileSync(join(f.addonsPath, "Suite", "Suite.toc"), "## Title: Suite\n## Version: 0.9\n");
    writeFileSync(join(f.addonsPath, "Suite", "mine.lua"), "-- edited by hand\n");
    const before = tree(f.addonsPath);

    f.fs.failAt("state.write");
    const { operation } = await f.service.adopt(f.installation, "Suite", "WowUpHub", "700");

    expect(operation.status).toBe("failed");
    expect(tree(f.addonsPath)).toEqual(before);
    expect(f.reopen().store.addons.all()).toEqual([]);
  });
});

describe("a marker or evidence that can't be written (scenario 10)", () => {
  for (const stage of ["tx.prepare", "evidence.read", "marker.write", "marker.replace"] as const satisfies FsStage[]) {
    test(`at ${stage} fails the update before any live folder changes or any record is published`, async () => {
      const f = fixture(`mark-${stage}`);
      const id = await installedWithUpdate(f);
      const before = tree(f.addonsPath);
      const record = storedRecord(f, id);
      // Had any live folder moved, its undo would fail and leave it moved.
      f.fs.failAt("folder.restore");

      f.fs.failAt(stage);
      const { operation } = await f.service.updateAddon(id);

      expect(operation.status).toBe("failed");
      expect(tree(f.addonsPath)).toEqual(before);
      expect(storedRecord(f, id)).toEqual(record);
      expect(f.service.addonsFor(f.installation.id).find((a) => a.id === id)).toEqual(record);
      expect(f.reopen().store.addons.markers()).toEqual([]);
    });
  }

  test("a new install whose marker can't be written installs nothing", async () => {
    const f = fixture("mark-new");
    f.fs.failAt("marker.write");
    expect((await f.install()).operation.status).toBe("failed");
    expect(tree(f.addonsPath)).toEqual({});
    expect(f.reopen().store.addons.all()).toEqual([]);
  });
});

describe("a game folder without Interface/AddOns (scenario 10)", () => {
  for (const missing of ["Interface", "Interface/AddOns"]) {
    test(`missing ${missing}: an install whose marker can't be written leaves the game folder as it was`, async () => {
      const f = fixture(`mark-no-${missing.replace("/", "-")}`);
      rmSync(join(f.installation.location, ...missing.split("/")), { recursive: true });
      const before = tree(f.installation.location);
      f.fs.failAt("marker.write");

      expect((await f.install()).operation.status).toBe("failed");

      expect(tree(f.installation.location)).toEqual(before);
    });
  }

  test("an install that commits creates them", async () => {
    const f = fixture("mark-no-interface-ok");
    rmSync(join(f.installation.location, "Interface"), { recursive: true });
    expect((await f.install()).operation.status).toBe("installed");
    expect(Object.keys(live(f.addonsPath))).toContain("Suite");
  });
});

describe("keeping the previous version for Roll back (scenario 8, update)", () => {
  test("a kept previous version is offered and rolls back", async () => {
    const f = fixture("keep");
    const id = await installedWithUpdate(f);
    const updated = await f.service.updateAddon(id);
    expect(updated.operation.status).toBe("updated");
    expect(updated.addon.previousVersion).toBe("1.0");
    expect((await f.service.rollback(id)).operation.status).toBe("installed");
    expect(readFileSync(join(f.addonsPath, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 1.0\n");
  });

  for (const stage of ["folder.retain", "previous.meta"] as const satisfies FsStage[]) {
    test(`failing at ${stage} with nothing kept before updates, and reports no Roll back`, async () => {
      const f = fixture(`keep-first-${stage}`);
      const id = await installedWithUpdate(f);
      f.fs.failAt(stage);
      const updated = await f.service.updateAddon(id);

      expect(updated.operation.status).toBe("updated");
      expect(updated.addon.previousVersion).toBeNull();
      expect(storedRecord(f, id)?.rollbackVersion).toBeUndefined();
      expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 2.0\n");
      expect(existsSync(join(f.addonsPath, ".wowdeck"))).toBe(false);
    });

    test(`failing at ${stage} keeps the version kept before, still offered`, async () => {
      const f = fixture(`keep-again-${stage}`);
      const id = await installedWithUpdate(f);
      await f.service.updateAddon(id); // 2.0, 1.0 kept
      f.publish("3.0", "r3");
      await f.service.refresh(f.installation);
      const kept = tree(join(f.addonsPath, ".wowdeck", "rollback"));

      f.fs.failAt(stage);
      const updated = await f.service.updateAddon(id);

      expect(updated.operation.status).toBe("updated");
      expect(updated.addon.previousVersion).toBe("1.0");
      expect(tree(join(f.addonsPath, ".wowdeck", "rollback"))).toEqual(kept);
      f.fs.clear();
      expect((await f.service.rollback(id)).operation.status).toBe("installed");
      expect(readFileSync(join(f.addonsPath, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 1.0\n");
    });
  }

  test("a record write failing after the previous version was replaced puts the old one back", async () => {
    const f = fixture("keep-then-record-fails");
    const id = await installedWithUpdate(f);
    await f.service.updateAddon(id); // 2.0, 1.0 kept
    f.publish("3.0", "r3");
    await f.service.refresh(f.installation);
    const before = tree(f.addonsPath);

    f.fs.failAt("state.write");
    expect((await f.service.updateAddon(id)).operation.status).toBe("failed");
    expect(tree(f.addonsPath)).toEqual(before);
    expect(storedRecord(f, id)).toMatchObject({ installedVersion: "2.0", rollbackVersion: "1.0" });
  });
});

describe("an undo that can't finish", () => {
  test("deletes nothing: every original file stays under the plugin's folder and the marker survives reopening", async () => {
    const f = fixture("undo-stops");
    const id = await installedWithUpdate(f);
    const original = live(f.addonsPath);
    const record = storedRecord(f, id);

    f.fs.failAt("state.write").failAt("folder.restore");
    const { operation } = await f.service.updateAddon(id);

    expect(operation.status).toBe("failed");
    expect(operation.error).toMatch(/^Couldn't put the addon's files back\. Its original files are kept in AddOns\/\.wowdeck\/tx-/);
    expect(storedRecord(f, id)).toEqual(record);
    // Every original file, byte for byte, somewhere in the plugin's folder.
    const kept = Object.entries(tree(f.addonsPath)).filter(([p]) => p.startsWith(".wowdeck/"));
    for (const [path, content] of Object.entries(original)) {
      expect(kept.some(([p, c]) => p.endsWith(`/${path}`) && c === content)).toBe(true);
    }
    expect(f.reopen().store.addons.markers()).toHaveLength(1);
  });
});

describe("Roll back exchanges versions through the transaction (scenario 8, rollback)", () => {
  /** Installed 1.0, updated to 2.0 with 1.0 kept as the previous version. */
  async function updatedWithPrevious(f: Fixture): Promise<string> {
    const id = await installedWithUpdate(f);
    const updated = await f.service.updateAddon(id);
    expect(updated.addon.previousVersion).toBe("1.0");
    return id;
  }

  test("preserving the outgoing version failing after the live change restores the starting folders and record", async () => {
    const f = fixture("rb-outgoing");
    const id = await updatedWithPrevious(f);
    const before = tree(f.addonsPath);
    const record = storedRecord(f, id);

    // The second Roll back cache move is the outgoing 2.0 going into the cache.
    f.fs.failAt("folder.retain", { after: 1 });
    const { addon, operation } = await f.service.rollback(id);

    expect(operation.status).toBe("failed");
    expect(operation.recoveryRequired).toBeUndefined();
    expect(tree(f.addonsPath)).toEqual(before);
    expect(storedRecord(f, id)).toEqual(record);
    expect(addon.previousVersion).toBe("1.0");
    expect(f.reopen().store.addons.markers()).toEqual([]);
  });

  const steps: [string, FsStage, number][] = [
    ["moving the kept version out of the cache", "folder.retain", 0],
    ["moving the live folders aside", "folder.backup", 1],
    ["moving the previous version in", "folder.install", 1],
    ["describing the outgoing version", "previous.meta", 0],
    ["moving the outgoing version into the cache", "folder.retain", 1],
    ["writing the record", "state.write", 0],
  ];
  for (const [step, stage, after] of steps) {
    test(`a failure ${step} restores the starting folders, cache and record, and allows another attempt`, async () => {
      const f = fixture(`rb-step-${stage}-${after}`);
      const id = await updatedWithPrevious(f);
      const before = tree(f.addonsPath);
      const record = storedRecord(f, id);

      f.fs.failAt(stage, { after, times: 1 });
      const { operation } = await f.service.rollback(id);

      expect(operation).toMatchObject({ status: "failed", error: expect.stringMatching(/Nothing was changed/) });
      expect(operation.recoveryRequired).toBeUndefined();
      expect(tree(f.addonsPath)).toEqual(before);
      expect(storedRecord(f, id)).toEqual(record);
      expect(f.service.recovery.required(f.installation.id)).toBe(false);

      expect((await f.service.rollback(id)).operation.status).toBe("installed");
      expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 1.0\n");
    });
  }

  test("a restoration that stops keeps every remaining copy, the previous version included, and requires recovery", async () => {
    const f = fixture("rb-undo-stops");
    const id = await updatedWithPrevious(f);
    const files = Object.entries(tree(f.addonsPath)).filter(([, c]) => c !== "<dir>");
    const record = storedRecord(f, id);

    f.fs.failAt("folder.retain", { after: 1 }).failAt("folder.restore");
    const { operation } = await f.service.rollback(id);

    expect(operation).toMatchObject({ status: "failed", recoveryRequired: true });
    expect(storedRecord(f, id)).toEqual(record);
    // Every file there was (2.0 live, 1.0 kept with its meta.json), byte for byte, somewhere.
    const now = Object.entries(tree(f.addonsPath));
    for (const [path, content] of files) {
      const name = path.split("/").at(-1)!;
      expect(now.some(([p, c]) => p.endsWith(`/${name}`) && c === content)).toBe(true);
    }
    expect(now.filter(([p]) => p.endsWith("core.lua")).map(([, c]) => c).sort()).toEqual([
      "-- Suite 1.0\n",
      "-- Suite 2.0\n",
      "-- SuiteLib 1.0\n",
      "-- SuiteLib 2.0\n",
    ]);
    f.fs.clear();
    const reopened = f.reopen();
    expect(reopened.store.addons.markers()).toHaveLength(1);
    expect(reopened.service.recovery.required(f.installation.id)).toBe(true);
  });

  test("a completed rollback commits the exchange, the record and the new previous version together", async () => {
    const f = fixture("rb-commit");
    const id = await updatedWithPrevious(f);
    const at2 = live(f.addonsPath);

    const back = await f.service.rollback(id);

    expect(back.operation).toMatchObject({ status: "installed", error: null });
    expect(back.addon).toMatchObject({ version: "1.0", previousVersion: "2.0" });
    expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 1.0\n");
    // The outgoing 2.0 is the previous version now, and nothing else is left.
    const cache = tree(join(f.addonsPath, ".wowdeck"));
    expect(Object.keys(cache).filter((p) => !p.startsWith(`rollback/${id}`))).toEqual(["rollback"]);
    expect(cache[`rollback/${id}/Suite/core.lua`]).toBe("-- Suite 2.0\n");
    const { store } = f.reopen();
    expect(store.addons.markers()).toEqual([]);
    expect(store.addons.commitsFor(f.installation.id).at(-1)).toMatchObject({ operation: "rollback", addonId: id, folders: ["Suite", "SuiteLib"] });
    expect(store.addons.get(id)).toMatchObject({ installedVersion: "1.0", rollbackVersion: "2.0" });

    // Roll back is offered and undoes the rollback.
    const forward = await f.service.rollback(id);
    expect(forward.addon).toMatchObject({ version: "2.0", previousVersion: "1.0" });
    expect(live(f.addonsPath)).toEqual(at2);
  });

  test("with the live folders gone by hand, the rollback succeeds and offers no Roll back", async () => {
    const f = fixture("rb-nothing-live");
    const id = await updatedWithPrevious(f);
    for (const folder of ["Suite", "SuiteLib"]) {
      rmSync(join(f.addonsPath, folder), { recursive: true });
    }

    const back = await f.service.rollback(id);

    expect(back.operation.status).toBe("installed");
    expect(back.addon).toMatchObject({ version: "1.0", previousVersion: null });
    expect(storedRecord(f, id)?.rollbackVersion).toBeUndefined();
    expect(existsSync(join(f.addonsPath, ".wowdeck", "rollback", id))).toBe(false);
  });
});

describe("moves stay inside the installation", () => {
  test("a linked folder where the addon goes is refused, with nothing changed", async () => {
    const f = fixture("linked");
    const elsewhere = mkdtempSync(join(tmpdir(), "wowdeck-tx-elsewhere-"));
    roots.push(elsewhere);
    writeFileSync(join(elsewhere, "keep.lua"), "-- not ours\n");
    symlinkSync(elsewhere, join(f.addonsPath, "SuiteLib"));

    const { operation } = await f.install();

    expect(operation).toMatchObject({ status: "failed", error: expect.stringContaining("SuiteLib in AddOns is a link") });
    expect(lstatSync(join(f.addonsPath, "SuiteLib")).isSymbolicLink()).toBe(true);
    expect(readdirSync(f.addonsPath)).toEqual(["SuiteLib"]);
    expect(tree(elsewhere)).toEqual({ "keep.lua": "-- not ours\n" });
  });

  test("a linked Roll back cache folder: the update keeps no previous version and writes nothing through the link", async () => {
    const f = fixture("linked-cache-update");
    const id = await installedWithUpdate(f);
    const elsewhere = mkdtempSync(join(tmpdir(), "wowdeck-tx-elsewhere-"));
    roots.push(elsewhere);
    mkdirSync(join(f.addonsPath, ".wowdeck"), { recursive: true });
    symlinkSync(elsewhere, join(f.addonsPath, ".wowdeck", "rollback"));

    const { operation } = await f.service.updateAddon(id);

    expect(operation.status).toBe("updated");
    expect(storedRecord(f, id)).toMatchObject({ installedVersion: "2.0" });
    expect(storedRecord(f, id)?.rollbackVersion).toBeUndefined();
    expect(tree(elsewhere)).toEqual({});
    expect(lstatSync(join(f.addonsPath, ".wowdeck", "rollback")).isSymbolicLink()).toBe(true);
  });

  test("a linked Roll back cache folder: Roll back is refused, with nothing changed", async () => {
    const f = fixture("linked-cache-rollback");
    const id = await installedWithUpdate(f);
    expect((await f.service.updateAddon(id)).addon.previousVersion).toBe("1.0");
    const elsewhere = mkdtempSync(join(tmpdir(), "wowdeck-tx-elsewhere-"));
    roots.push(elsewhere);
    const cache = join(f.addonsPath, ".wowdeck", "rollback");
    renameSync(cache, join(elsewhere, "rollback"));
    symlinkSync(join(elsewhere, "rollback"), cache);
    const before = { live: live(f.addonsPath), elsewhere: tree(elsewhere), record: storedRecord(f, id) };

    const { operation } = await f.service.rollback(id);

    expect(operation.status).toBe("failed");
    expect({ live: live(f.addonsPath), elsewhere: tree(elsewhere), record: storedRecord(f, id) }).toEqual(before);
    expect(f.reopen().store.addons.markers()).toEqual([]);
  });

  test("a missing game folder is never recreated", async () => {
    const f = fixture("no-root");
    rmSync(f.installation.location, { recursive: true });
    const { operation } = await f.install();
    expect(operation.status).toBe("failed");
    expect(existsSync(f.installation.location)).toBe(false);
  });
});

describe("a committed operation whose cleanup fails (scenario 7)", () => {
  const txDirs = (f: Fixture) =>
    existsSync(join(f.addonsPath, ".wowdeck")) ? readdirSync(join(f.addonsPath, ".wowdeck")).filter((n) => n.startsWith("tx-")) : [];

  test("deleting the work folder fails: updated with a warning, files and record intact, the leftover committed after reopening", async () => {
    const f = fixture("cleanup-remove");
    const id = await installedWithUpdate(f);

    f.fs.failAt("cleanup.remove");
    const { addon, operation } = await f.service.updateAddon(id);

    expect(operation).toMatchObject({ status: "updated", error: null });
    expect(operation.cleanupWarning).toMatch(/^Its temporary files are left in AddOns\/\.wowdeck\/tx-/);
    expect(f.operations.at(-1)).toEqual(operation);
    expect(addon.version).toBe("2.0");
    expect(live(f.addonsPath)).toMatchObject({ "Suite/core.lua": "-- Suite 2.0\n", "SuiteLib/core.lua": "-- SuiteLib 2.0\n" });
    expect(storedRecord(f, id)).toMatchObject({ installedVersion: "2.0", rollbackVersion: "1.0" });
    expect(txDirs(f)).toHaveLength(1);

    const reopened = f.reopen().store.addons;
    const [marker] = reopened.markers();
    expect(classifyTransaction(reopened, marker)).toBe("committed");
    expect(reopened.commitEvidence((marker as { transactionId: string }).transactionId)).toMatchObject({
      operation: "update",
      addonId: id,
    });
  });

  test("clearing the marker fails: updated with a warning, record intact, the marker committed after reopening", async () => {
    const f = fixture("cleanup-marker");
    const id = await installedWithUpdate(f);

    // The first marker write stores it; the second, clearing it, fails.
    f.fs.failAt("marker.write", { after: 1 });
    const { operation } = await f.service.updateAddon(id);

    expect(operation.status).toBe("updated");
    expect(operation.cleanupWarning).toBe("WoWDeck couldn't finish cleaning up after it. It tries again at the next addon change.");
    expect(storedRecord(f, id)?.installedVersion).toBe("2.0");
    expect(txDirs(f)).toEqual([]);

    const reopened = f.reopen().store.addons;
    expect(reopened.markers()).toHaveLength(1);
    expect(classifyTransaction(reopened, reopened.markers()[0])).toBe("committed");
  });

  test("replacing the state file to clear the marker fails: updated with a warning, the marker committed", async () => {
    const f = fixture("cleanup-marker-replace");
    const id = await installedWithUpdate(f);

    f.fs.failAt("marker.replace", { after: 1 });
    const { operation } = await f.service.updateAddon(id);

    expect(operation.status).toBe("updated");
    expect(operation.cleanupWarning).toBeDefined();
    const reopened = f.reopen().store.addons;
    expect(reopened.require(id).installedVersion).toBe("2.0");
    expect(reopened.markers().map((m) => classifyTransaction(reopened, m))).toEqual(["committed"]);
  });

  test("a new install whose cleanup fails is installed, with a warning", async () => {
    const f = fixture("cleanup-new");
    f.fs.failAt("cleanup.remove");
    const { operation } = await f.install();
    expect(operation.status).toBe("installed");
    expect(operation.cleanupWarning).toBeDefined();
    expect(f.reopen().store.addons.all()).toHaveLength(1);
  });

  test("after a restart, the next addon change cleans the leftover up and never restores it", async () => {
    const f = fixture("cleanup-later");
    const id = await installedWithUpdate(f);
    f.fs.failAt("cleanup.remove");
    await f.service.updateAddon(id);
    f.fs.clear();

    const engine = f.reopen();
    f.publish("3.0", "r3");
    await engine.service.refresh(f.installation);
    const { operation } = await engine.service.updateAddon(id);

    expect(operation.status).toBe("updated");
    expect(operation.cleanupWarning).toBeUndefined();
    expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 3.0\n");
    expect(txDirs(f)).toEqual([]);
    expect(f.reopen().store.addons.markers()).toEqual([]);
    expect(storedRecord(f, id)).toMatchObject({ installedVersion: "3.0", rollbackVersion: "2.0" });
  });

  test("a leftover marker without commit evidence is unfinished, and cleanup leaves its files alone", async () => {
    const f = fixture("cleanup-protects");
    const id = await installedWithUpdate(f);
    // One committed leftover (deleting stays failing, so the next run's
    // cleanup can't take it either)...
    f.fs.failAt("cleanup.remove");
    await f.service.updateAddon(id);
    // ...and one unresolved operation whose undo stopped.
    f.publish("3.0", "r3");
    await f.service.refresh(f.installation);
    f.fs.failAt("state.write").failAt("folder.restore");
    expect((await f.service.updateAddon(id)).operation.status).toBe("failed");
    f.fs.clear();

    const { store } = f.reopen();
    const markers = store.addons.markers();
    const unfinished = markers.filter((m) => classifyTransaction(store.addons, m) === "unfinished");
    expect(markers).toHaveLength(2);
    expect(unfinished).toHaveLength(1);
    const kept = (unfinished[0] as { workDir: string }).workDir;
    const protectedFiles = tree(join(f.addonsPath, kept));

    const outcome = await new AddonTransactions(store.fs).cleanUpCommitted(store.addons, f.installation);

    expect(outcome.left).toEqual([(unfinished[0] as { transactionId: string }).transactionId]);
    expect(outcome.cleaned).toHaveLength(1);
    expect(tree(join(f.addonsPath, kept))).toEqual(protectedFiles);
    expect(txDirs(f)).toEqual([kept.split("/")[1]]);
    expect(f.reopen().store.addons.markers()).toEqual(unfinished);
  });

  test("a work folder left without a marker (#134) goes at the next addon change", async () => {
    const f = fixture("cleanup-unmarked");
    const id = await installedWithUpdate(f);
    // An engine killed while staging: its work folder, never marked.
    const leftover = join(f.addonsPath, ".wowdeck", `tx-${crypto.randomUUID()}`);
    mkdirSync(join(leftover, "stage", "Suite"), { recursive: true });
    mkdirSync(join(leftover, "backup"));
    writeFileSync(join(leftover, "stage", "Suite", "core.lua"), "-- partly");

    const engine = f.reopen();
    const { operation } = await engine.service.updateAddon(id);

    expect(operation.status).toBe("updated");
    expect(existsSync(leftover)).toBe(false);
    expect(txDirs(f)).toEqual([]);
    expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 2.0\n");
  });

  test("a failed orphan-sweep listing does not fail the addon update", async () => {
    const f = fixture("cleanup-list-fails");
    const id = await installedWithUpdate(f);
    mkdirSync(join(f.addonsPath, ".wowdeck"), { recursive: true });
    f.fs.failAt("cleanup.list");
    const { operation } = await f.service.updateAddon(id);
    expect(operation.status).toBe("updated");
    expect(live(f.addonsPath)["Suite/core.lua"]).toBe("-- Suite 2.0\n");
  });

  test("a running transaction's unmarked work folder is left alone", async () => {
    const f = fixture("cleanup-running");
    const transactions = new AddonTransactions(f.store.fs);
    let staged!: () => void;
    const staging = new Promise<void>((resolve) => (staged = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const running = transactions.run(f.store.addons, {
      operation: "install",
      installation: f.installation,
      addonId: "unmarked-running",
      originalRecord: null,
      stage: async (stageDir) => {
        mkdirSync(join(stageDir, "Solo"));
        writeFileSync(join(stageDir, "Solo", "Solo.toc"), "## Title: Solo\n");
        staged();
        await held;
        return ["Solo"];
      },
      change: async () => {
        throw new Error("not committing");
      },
    });
    await staging;
    const work = txDirs(f);
    expect(work).toHaveLength(1);

    const outcome = await transactions.cleanUpCommitted(f.store.addons, f.installation);

    expect(outcome.cleaned).toEqual([]);
    expect(txDirs(f)).toEqual(work);
    expect(existsSync(join(f.addonsPath, ".wowdeck", work[0]!, "stage", "Solo", "Solo.toc"))).toBe(true);
    release();
    await expect(running).rejects.toThrow();
  });

  test("an unreadable marker is never treated as committed", () => {
    const f = fixture("cleanup-unreadable");
    expect(classifyTransaction(f.store.addons, { version: 99 })).toBe("unfinished");
    expect(classifyTransaction(f.store.addons, "garbage")).toBe("unfinished");
  });
});
