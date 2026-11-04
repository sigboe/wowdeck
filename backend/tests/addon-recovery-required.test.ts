/**
 * Recovery required (ADR 0006, #102): when a failed addon transaction's
 * undo also fails, the engine keeps every remaining recovery copy and
 * guards that installation against anything that could change or discard
 * them, while a second installation keeps working. Seen through the
 * addon-service operation boundary with real temporary game folders, a
 * fake provider and FaultInjectingFs failing named stages.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { WowClientType, type AddonProviderType } from "../src/wow/types";
import type { OperationResult } from "../src/api/contracts";
import { RecoveryRequiredError } from "../src/wow/errors";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register as registerInstallations } from "../src/api/handlers/installations";
import { register as registerAddons } from "../src/api/handlers/addons";
import { JsonlServer } from "../src/bridge/jsonl";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface Release {
  version: string;
  releaseId: string;
}

const FOLDERS = ["Suite", "SuiteLib"];

/** One addon (id 700) whose current release a test changes. */
class OneAddonProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  release: Release = { version: "1.0", releaseId: "r1" };

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
    const { version, releaseId } = this.release;
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
          downloadUrl: `https://fake/dl/700.zip?v=${version}`,
          version,
          releaseDate: "2026-06-01T00:00:00.000Z",
          externalId: releaseId,
        },
      ],
    };
  }
}

function zipOf(release: Release): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of FOLDERS) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${folder}\n## Version: ${release.version}\n## Interface: 110005\n`);
    files[`${folder}/core.lua`] = new TextEncoder().encode(`-- ${folder} ${release.version}\n`);
  }
  return zipSync(files);
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

/** Two installations, A and B, served by one engine. */
function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-recovery-${name}-`));
  roots.push(root);
  const a = installationAt(root, "A");
  const b = installationAt(root, "B");
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
  const store = createStateStore(dataDir, fs);
  const service = new AddonService(store, registry, new DownloadService(network, join(root, "dl")), {
    addonsChanged: () => {},
    operationResult: (op) => operations.push(op),
  });
  const { addonsPath: _a, ...instA } = a;
  const { addonsPath: _b, ...instB } = b;
  store.setInstallations([instA, instB]);
  store.updateSettings({ keepPreviousVersions: true });
  return {
    store,
    service,
    fs,
    provider,
    a: instA,
    b: instB,
    addonsA: a.addonsPath,
    addonsB: b.addonsPath,
    operations,
    install: (installation: WowInstallation) =>
      service.install({ intent: "install", providerId: "WowUpHub", externalId: "700", installation }),
    async publish(version: string, releaseId: string) {
      provider.release = { version, releaseId };
      await service.refresh(instA);
      await service.refresh(instB);
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

/** Every file and folder under `dir` with its contents ("<dir>" for a folder). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
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

/**
 * Installs 1.0 in A and B, then updates A to 2.0 with the record write and
 * every undo move failing: A is left with its recovery copies under its
 * `.wowdeck` folder. Returns A's addon id and the failed outcome.
 */
async function recoveryRequiredInA(f: Fixture) {
  const { addon } = await f.install(f.a);
  await f.install(f.b);
  await f.publish("2.0", "r2");
  f.fs.failAt("state.write").failAt("folder.restore");
  const { operation } = await f.service.updateAddon(addon.id);
  f.fs.clear();
  return { id: addon.id, operation };
}

describe("cleanup after a failed restoration (the reviewed path)", () => {
  test("a later update of the addon leaves the preserved original files where they are", async () => {
    const f = fixture("later-update");
    const { id } = await recoveryRequiredInA(f);
    const preserved = tree(join(f.addonsA, ".wowdeck"));
    expect(Object.values(preserved)).toContain("-- Suite 1.0\n");

    await expect(f.service.updateAddon(id)).rejects.toThrow(RecoveryRequiredError);

    expect(tree(join(f.addonsA, ".wowdeck"))).toEqual(preserved);
  });
});

describe("restoration that fails (scenario 3)", () => {
  test("preserves every remaining copy byte for byte, and the outcome and status say recovery required", async () => {
    const f = fixture("outcome");
    const { addon } = await f.install(f.a);
    const original = tree(f.addonsA);
    await f.install(f.b);
    await f.publish("2.0", "r2");
    expect(f.service.recovery.status(f.a.id)).toEqual({ installationId: f.a.id, status: "ready" });

    f.fs.failAt("state.write").failAt("folder.restore");
    const { operation } = await f.service.updateAddon(addon.id);

    expect(operation).toMatchObject({ status: "failed", recoveryRequired: true });
    expect(f.operations.at(-1)).toMatchObject({ status: "failed", recoveryRequired: true });
    // Every original file, byte for byte, somewhere under the plugin's folder.
    const preserved = Object.entries(tree(join(f.addonsA, ".wowdeck")));
    for (const [path, content] of Object.entries(original).filter(([, c]) => c !== "<dir>")) {
      expect(preserved.some(([p, c]) => p.endsWith(`/${path}`) && c === content)).toBe(true);
    }
    expect(f.service.recovery.status(f.a.id)).toEqual({ installationId: f.a.id, status: "recoveryRequired" });
    expect(f.service.recovery.status(f.b.id)).toEqual({ installationId: f.b.id, status: "ready" });
  });

  test("a failure whose restoration succeeds is an ordinary failure", async () => {
    const f = fixture("ordinary");
    const { addon } = await f.install(f.a);
    await f.publish("2.0", "r2");
    f.fs.failAt("state.write");
    const { operation } = await f.service.updateAddon(addon.id);
    f.fs.clear();

    expect(operation.status).toBe("failed");
    expect(operation.recoveryRequired).toBeUndefined();
    expect(f.service.recovery.status(f.a.id).status).toBe("ready");
    expect((await f.service.updateAddon(addon.id)).operation.status).toBe("updated");
  });
});

describe("the guard in a recovery-required installation", () => {
  /** A's state that no refused call may change: files, records and markers. */
  function snapshot(f: Fixture) {
    return {
      files: tree(f.addonsA),
      records: f.store.addons.forInstallation(f.a.id),
      markers: f.store.addons.markers(),
    };
  }

  test("refuses listing, refreshing, scanning and every addon mutation, changing nothing", async () => {
    const f = fixture("refusals");
    const { id } = await recoveryRequiredInA(f);
    mkdirSync(join(f.addonsA, "Loose"));
    writeFileSync(join(f.addonsA, "Loose", "Loose.toc"), "## Title: Loose\n");
    const before = snapshot(f);

    const refused: [string, () => Promise<unknown>][] = [
      ["list", () => f.service.listAddons(f.a)],
      ["refresh", () => f.service.refresh(f.a)],
      ["scan", () => f.service.scanInstallation(f.a)],
      ["install", () => f.install(f.a)],
      ["update", () => f.service.updateAddon(id)],
      ["reinstall", () => f.service.reinstall(id)],
      ["change channel", () => f.service.setChannel(id, 1)],
      ["change source", () => f.service.changeSource(id, "WowUpHub", "701")],
      ["rollback", () => f.service.rollback(id)],
      ["remove", () => f.service.removeAddon(id)],
      ["remove unmanaged", () => f.service.removeUnmanagedFolder(f.a, "Loose")],
      ["adopt", () => f.service.adopt(f.a, "Loose", "WowUpHub", "700")],
      ["ignore", () => f.service.setIgnored(id, true)],
      ["pause", () => f.service.setAutoUpdatePaused(id, true)],
    ];
    for (const [what, call] of refused) {
      await expect(call(), what).rejects.toThrow(RecoveryRequiredError);
    }
    expect(snapshot(f)).toEqual(before);
  });

  test("Update all and automatic updates leave it alone", async () => {
    const f = fixture("bulk");
    const { id } = await recoveryRequiredInA(f);
    f.store.updateSettings({ autoUpdate: true });
    await f.publish("3.0", "r3").catch(() => {}); // A's refresh is refused
    const before = snapshot(f);

    const operations = await f.service.updateAll(f.a);
    expect(operations).toEqual([expect.objectContaining({ addonId: id, status: "failed", recoveryRequired: true })]);
    const auto = await f.service.autoUpdate(async () => "not_running");
    expect(auto?.failed).toEqual([]);
    expect(auto?.updated).toEqual(["Suite"]); // B's

    expect(snapshot(f)).toEqual(before);
    expect(readFileSync(join(f.addonsB, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 3.0\n");
  });

  test("an addon list import installs nothing and skips its follow-up write", async () => {
    const f = fixture("import");
    await f.install(f.b);
    // A new install in A whose undo stops: A has no record of the addon.
    f.fs.failAt("state.write").failAt("folder.restore");
    expect((await f.install(f.a)).operation).toMatchObject({ status: "failed", recoveryRequired: true });
    f.fs.clear();
    const { payload } = await f.service.portability.export(f.b);
    const before = snapshot(f);

    const result = await f.service.importAddonList(payload, f.a);

    expect(result.error).toBeNull();
    expect(result.operations).toEqual([expect.objectContaining({ status: "failed", recoveryRequired: true })]);
    expect(snapshot(f)).toEqual(before);
  });

  test("clearing the Roll back cache keeps its copies and clears the other installation's", async () => {
    const f = fixture("clear");
    await recoveryRequiredInA(f);
    const { addon: inB } = await f.service.updateAddon(f.store.addons.forInstallation(f.b.id)[0]!.id);
    expect(inB.previousVersion).toBe("1.0");
    const before = snapshot(f);

    await f.service.clearRollback();

    expect(snapshot(f)).toEqual(before);
    expect(tree(join(f.addonsB, ".wowdeck"))).toEqual({});
    expect(f.store.addons.forInstallation(f.b.id)[0]?.rollbackVersion).toBeUndefined();
  });

  test("removing the installation is refused before its entry or records go", async () => {
    const f = fixture("remove-installation");
    await recoveryRequiredInA(f);
    const before = snapshot(f);

    await expect(f.service.installations.remove(f.a.id)).rejects.toThrow(RecoveryRequiredError);

    expect(f.store.installations.map((i) => i.id)).toEqual([f.a.id, f.b.id]);
    expect(snapshot(f)).toEqual(before);
    await f.service.installations.remove(f.b.id);
    expect(f.store.installations.map((i) => i.id)).toEqual([f.a.id]);
  });

  test("removing the installation while an install is queued for it leaves no stopped change behind", async () => {
    const f = fixture("remove-racing-install");
    // The removal's turn comes first; the install queued behind it was
    // handed A before A went, and would stop with nowhere to show it.
    const removal = f.service.installations.remove(f.a.id);
    f.fs.failAt("state.write", { after: 0 }).failAt("folder.restore");
    const install = f.install(f.a).then(
      (r) => r.operation.status,
      (err: Error) => err.name,
    );
    await removal;
    const outcome = await install;
    f.fs.clear();

    expect(f.store.installations.map((i) => i.id)).toEqual([f.b.id]);
    expect(outcome).not.toBe("installed");
    expect(f.store.addons.markers()).toEqual([]);
    expect(tree(f.addonsA)).toEqual({});
  });

  test("the companion data folder isn't written in a recovery-required installation", async () => {
    const f = fixture("companion");
    await recoveryRequiredInA(f);
    f.store.setInstallations(f.store.installations.map((i) => ({ ...i, version: "11.0.2" })));
    for (const addons of [f.addonsA, f.addonsB]) {
      mkdirSync(join(addons, "WowUp"));
      writeFileSync(join(addons, "WowUp", "WowUp.toc"), "## Interface: 110000\n## Title: WowUp\n");
    }
    const before = tree(f.addonsA);

    await new CompanionSyncCoordinator(f.service).regenerate();

    expect(tree(f.addonsA)).toEqual(before);
    expect(existsSync(join(f.addonsB, "wowup_data_addon"))).toBe(true);
  });

  test("the other installation keeps working, mutations included", async () => {
    const f = fixture("isolation");
    await recoveryRequiredInA(f);
    const id = f.store.addons.forInstallation(f.b.id)[0]!.id;

    expect((await f.service.listAddons(f.b)).length).toBeGreaterThan(0);
    await f.service.scanInstallation(f.b);
    expect((await f.service.updateAddon(id)).operation.status).toBe("updated");
    expect((await f.service.rollback(id)).operation.status).toBe("installed");
    expect((await f.service.removeAddon(id)).status).toBe("removed");
    expect((await f.install(f.b)).operation.status).toBe("installed");
    expect(f.service.recovery.status(f.b.id).status).toBe("ready");
  });
});

describe("the typed contracts", () => {
  test("installations.recoveryStatus names each installation's status, and a refused call answers recovery_required", async () => {
    const f = fixture("rpc");
    await recoveryRequiredInA(f);
    f.store.updateSettings({ selectedInstallationId: f.a.id });
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    const deps = { service: f.service, installationService: f.service.installations } as unknown as HandlerDeps;
    registerInstallations(server, deps);
    registerAddons(server, deps);

    await server.handleLine(JSON.stringify({ id: 1, method: "installations.recoveryStatus", params: {} }));
    await server.handleLine(JSON.stringify({ id: 2, method: "addons.list", params: {} }));
    await server.handleLine(JSON.stringify({ id: 3, method: "installations.remove", params: { installationId: f.a.id } }));

    const [status, list, remove] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(status).toEqual({
      id: 1,
      result: {
        installations: [
          { installationId: f.a.id, status: "recoveryRequired" },
          { installationId: f.b.id, status: "ready" },
        ],
        stateFile: { status: "readable" },
      },
    });
    expect(list).toMatchObject({ id: 2, result: { unverified: true } });
    expect(remove).toMatchObject({ id: 3, error: { code: "recovery_required" } });
  });
});

/** A JSONL server over the fixture's service, answering one call at a time. */
function rpcFor(f: Fixture) {
  const lines: string[] = [];
  const server = new JsonlServer((l) => lines.push(l));
  const deps = { service: f.service, installationService: f.service.installations } as unknown as HandlerDeps;
  registerInstallations(server, deps);
  registerAddons(server, deps);
  let id = 0;
  return async (method: string, params: Record<string, unknown> = {}) => {
    await server.handleLine(JSON.stringify({ id: ++id, method, params }));
    return JSON.parse(lines.at(-1)!) as { result?: Record<string, unknown>; error?: { code: string } };
  };
}

describe("stored addon information in a recovery-required installation (#107)", () => {
  test("addons.list answers the stored records, unverified, without scanning or writing", async () => {
    const f = fixture("unverified");
    const { id } = await recoveryRequiredInA(f);
    mkdirSync(join(f.addonsA, "Loose"));
    writeFileSync(join(f.addonsA, "Loose", "Loose.toc"), "## Title: Loose\n");
    f.store.updateSettings({ selectedInstallationId: f.a.id });
    const files = tree(f.addonsA);
    const records = f.store.addons.forInstallation(f.a.id);
    const rpc = rpcFor(f);

    const { result } = await rpc("addons.list");

    expect(result?.unverified).toBe(true);
    // The record as stored: still 1.0, though 2.0's files are live.
    expect(result?.addons).toEqual([expect.objectContaining({ id, name: "Suite", version: "1.0" })]);
    expect(tree(f.addonsA)).toEqual(files);
    expect(f.store.addons.forInstallation(f.a.id)).toEqual(records);
  });

  test("a ready installation's list is not marked unverified", async () => {
    const f = fixture("verified");
    await recoveryRequiredInA(f);
    f.store.updateSettings({ selectedInstallationId: f.b.id });

    const { result } = await rpcFor(f)("addons.list");

    expect(result?.unverified).toBeUndefined();
    expect(result?.addons).toEqual([expect.objectContaining({ name: "Suite", version: "1.0" })]);
  });
});

describe("installations.recoveryDetails (#107)", () => {
  test("names where the original files are kept, where they belong, and what is in their place", async () => {
    const f = fixture("details");
    const { id } = await recoveryRequiredInA(f);

    const { result } = await rpcFor(f)("installations.recoveryDetails", { installationId: f.a.id });

    expect(result).toEqual({
      installationId: f.a.id,
      installationName: "A",
      status: "recoveryRequired",
      operations: [
        {
          transactionId: expect.any(String),
          addonName: "Suite",
          originalVersion: "1.0",
          operation: "update",
          startedAt: expect.any(Number),
          preserved: [
            { location: `AddOns/.wowdeck/rollback/${id}/Suite`, belongsAt: "AddOns/Suite" },
            { location: `AddOns/.wowdeck/rollback/${id}/SuiteLib`, belongsAt: "AddOns/SuiteLib" },
          ],
          conflicts: [
            { location: "AddOns/Suite", reason: "Holds the files this addon change put here. Retry recovery moves them aside. To repair by hand, move them out, then put the original files back." },
            { location: "AddOns/SuiteLib", reason: "Holds the files this addon change put here. Retry recovery moves them aside. To repair by hand, move them out, then put the original files back." },
          ],
        },
      ],
      retry: { available: true },
      verify: { available: true },
    });
    // Read-only: the preserved copies are byte for byte where they were.
    expect(readFileSync(join(f.addonsA, ".wowdeck", "rollback", id, "Suite", "core.lua"), "utf-8")).toBe("-- Suite 1.0\n");
  });

  test("a new install's folders that weren't there before are conflicts, with nothing to preserve", async () => {
    const f = fixture("details-new");
    f.fs.failAt("state.write").failAt("folder.restore");
    await f.install(f.a);
    f.fs.clear();

    const { result } = await rpcFor(f)("installations.recoveryDetails", { installationId: f.a.id });
    const [operation] = result?.operations as Record<string, unknown>[];

    expect(operation).toMatchObject({ addonName: "Suite", originalVersion: null, operation: "install", preserved: [] });
    expect(operation?.conflicts).toContainEqual({ location: "AddOns/SuiteLib", reason: "Wasn't there before this addon change." });
  });

  test("a game folder that isn't available is named, and nothing is read or created", async () => {
    const f = fixture("details-missing");
    await recoveryRequiredInA(f);
    const moved = `${f.a.location}-away`;
    renameSync(f.a.location, moved);

    const { result } = await rpcFor(f)("installations.recoveryDetails", { installationId: f.a.id });
    const [operation] = result?.operations as Record<string, unknown>[];

    expect(operation?.conflicts).toEqual([{ location: "Game folder", reason: "Isn't available. Is the SD card inserted?" }]);
    expect(existsSync(f.a.location)).toBe(false);
  });

  test("a marker it can't read is named as such, not guessed at", async () => {
    const f = fixture("details-unreadable");
    f.store.addons.writeMarker({ transactionId: "t-odd", installationId: f.a.id, moves: "?" } as { transactionId: string });

    const { result } = await rpcFor(f)("installations.recoveryDetails", { installationId: f.a.id });

    expect(result?.status).toBe("recoveryRequired");
    expect(result?.operations).toEqual([
      expect.objectContaining({
        transactionId: "t-odd",
        operation: "unknown",
        preserved: [],
        conflicts: [{ location: "Recovery information", reason: "WoWDeck can't read it." }],
      }),
    ]);
  });

  test("a marker from another build reads as unreadable in the details and for Retry recovery alike", async () => {
    const f = fixture("details-other-build");
    await recoveryRequiredInA(f);
    // The same marker, from a build with another marker format.
    const [marker] = f.store.addons.markers() as Record<string, unknown>[];
    f.store.addons.writeMarker({ ...marker!, version: 99 } as unknown as { transactionId: string });

    const { result } = await rpcFor(f)("installations.recoveryDetails", { installationId: f.a.id });

    expect(result?.operations).toEqual([
      expect.objectContaining({
        operation: "unknown",
        preserved: [],
        conflicts: [{ location: "Recovery information", reason: "WoWDeck can't read it." }],
      }),
    ]);
    expect(result?.retry).toMatchObject({ available: false });
    expect(result?.verify).toMatchObject({ available: false });
  });

  test("a ready installation has no operations, and an unknown one is not found", async () => {
    const f = fixture("details-ready");
    await recoveryRequiredInA(f);
    const rpc = rpcFor(f);

    expect((await rpc("installations.recoveryDetails", { installationId: f.b.id })).result).toEqual({
      installationId: f.b.id,
      installationName: "B",
      status: "ready",
      operations: [],
      retry: { available: false, reason: "B doesn't need recovery", nextStep: "" },
      verify: { available: false, reason: "B doesn't need recovery", nextStep: "" },
    });
    expect((await rpc("installations.recoveryDetails", { installationId: "nope" })).error?.code).toBe("not_found");
  });
});
