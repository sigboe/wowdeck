/**
 * Recovery state across a restart (ADR 0006, #106): the engine reopens
 * its storage and recreates the addon service over what an earlier run
 * left behind, and every installation's standing comes from that
 * persisted state. Unfinished operations stay blocked with nothing
 * repaired; committed ones keep their result and are only cleaned up;
 * unreadable evidence blocks; older state without transaction metadata
 * works as before. These tests make no power-loss durability claim: the
 * "restart" is a fresh service over the files an earlier one wrote.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonTransactions } from "../src/wow/addons/AddonTransaction";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../src/wow/models";
import { WowClientType, type AddonProviderType } from "../src/wow/types";
import { RecoveryRequiredError } from "../src/wow/errors";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register as registerInstallations } from "../src/api/handlers/installations";
import { JsonlServer } from "../src/bridge/jsonl";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const FOLDERS = ["Suite", "SuiteLib"];

/** One addon (id 700) whose current release a test changes. */
class OneAddonProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  release = { version: "1.0", releaseId: "r1" };

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

function zipOf(version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of FOLDERS) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${folder}\n## Version: ${version}\n## Interface: 110005\n`);
    files[`${folder}/core.lua`] = new TextEncoder().encode(`-- ${folder} ${version}\n`);
  }
  return zipSync(files);
}

function installationAt(root: string, name: string): WowInstallation {
  const location = join(root, name, "_retail_");
  mkdirSync(join(location, "Interface", "AddOns"), { recursive: true });
  return {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location,
    label: "_retail_",
    displayName: name,
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
}

const addonsOf = (i: WowInstallation) => join(i.location, "Interface", "AddOns");

/** Two installations, A and B; `restart()` is a fresh engine over the same files. */
function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-restart-${name}-`));
  roots.push(root);
  const a = installationAt(root, "A");
  const b = installationAt(root, "B");
  const provider = new OneAddonProvider();
  const network = {
    downloadToFile: async (_url: string, dest: string) => {
      const bytes = zipOf(provider.release.version);
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
  const fs = new FaultInjectingFs();
  const dataDir = join(root, "data");
  const registry = new ProviderRegistry();
  registry.register(provider);
  const open = () => {
    const store = createStateStore(dataDir, fs);
    const service = new AddonService(store, registry, new DownloadService(network, join(root, "dl")), {
      addonsChanged: () => {},
      operationResult: () => {},
    });
    return { store, service };
  };
  const first = open();
  first.store.setInstallations([a, b]);
  first.store.updateSettings({ keepPreviousVersions: true });
  return {
    ...first,
    fs,
    provider,
    a,
    b,
    statePath: join(dataDir, "state.json"),
    restart: open,
    install: (service: AddonService, installation: WowInstallation) =>
      service.install({ intent: "install", providerId: "WowUpHub", externalId: "700", installation }),
    async publish(service: AddonService, version: string) {
      provider.release = { version, releaseId: `r-${version}` };
      for (const i of [a, b]) {
        if (service.recovery.status(i.id).status === "ready") {
          await service.refresh(i);
        }
      }
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

/** Installs 1.0 in A and B and publishes 2.0; returns A's addon id. */
async function installedInBoth(f: Fixture): Promise<string> {
  const { addon } = await f.install(f.service, f.a);
  await f.install(f.service, f.b);
  await f.publish(f.service, "2.0");
  return addon.id;
}

const status = (service: AddonService, i: WowInstallation) => service.recovery.status(i.id).status;

describe("a restored operation whose marker could not be cleared", () => {
  test("is not recovery required after a restart, and the next change cleans its leftover up", async () => {
    const f = fixture("restored");
    const id = await installedInBoth(f);
    const original = tree(addonsOf(f.a));
    // The record write fails, so the moves are undone; clearing the marker
    // (the second marker write) fails too.
    f.fs.failAt("state.write").failAt("marker.write", { after: 1 });
    const { operation } = await f.service.updateAddon(id);
    f.fs.clear();
    expect(operation.status).toBe("failed");
    expect(operation.recoveryRequired).toBeUndefined();

    const engine = f.restart();
    expect(engine.store.addons.markers()).toHaveLength(1);
    expect(status(engine.service, f.a)).toBe("ready");
    expect(Object.fromEntries(Object.entries(tree(addonsOf(f.a))).filter(([p]) => !p.startsWith(".wowdeck")))).toEqual(
      Object.fromEntries(Object.entries(original).filter(([p]) => !p.startsWith(".wowdeck"))),
    );

    expect((await engine.service.updateAddon(id)).operation).toMatchObject({ status: "updated" });
    expect(f.restart().store.addons.markers()).toEqual([]);
    expect(readdirSync(join(addonsOf(f.a), ".wowdeck")).filter((n) => n.startsWith("tx-"))).toEqual([]);
  });

  test("on a drive that is unavailable or replaced stays pending until the drive is back", async () => {
    const f = fixture("restored-drive");
    const id = await installedInBoth(f);
    f.fs.failAt("state.write").failAt("marker.write", { after: 1 });
    await f.service.updateAddon(id);
    f.fs.clear();
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away);

    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
    expect(existsSync(f.a.location)).toBe(false);
    // A different folder in its place (same path, another identity) can't vouch for it.
    const notes = (dir: string) => readdirSync(join(dir, "Interface", "AddOns", ".wowdeck"));
    mkdirSync(join(f.a.location, "Interface", "AddOns", ".wowdeck"), { recursive: true });
    for (const tx of notes(away)) {
      mkdirSync(join(f.a.location, "Interface", "AddOns", ".wowdeck", tx));
      writeFileSync(
        join(f.a.location, "Interface", "AddOns", ".wowdeck", tx, "restored.json"),
        readFileSync(join(away, "Interface", "AddOns", ".wowdeck", tx, "restored.json")),
      );
    }
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");

    rmSync(f.a.location, { recursive: true });
    renameSync(away, f.a.location);
    expect(status(f.restart().service, f.a)).toBe("ready");
  });

  test("whose restore note could not be written either stays recovery required after a restart", async () => {
    const f = fixture("restored-no-note");
    const id = await installedInBoth(f);
    f.fs.failAt("state.write").failAt("marker.write", { after: 1 }).failAt("restore.note");
    await f.service.updateAddon(id);
    f.fs.clear();
    // This run restored it itself, so it carries on.
    expect(status(f.service, f.a)).toBe("ready");

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("ready");
  });
});

/** The state file as JSON, for writing fixtures an earlier run could have left. */
const readState = (f: Fixture) => JSON.parse(readFileSync(f.statePath, "utf-8")) as Record<string, unknown>;
const writeState = (f: Fixture, state: Record<string, unknown>) => writeFileSync(f.statePath, JSON.stringify(state, null, 2));

describe("malformed or unreadable recovery evidence", () => {
  test("a marker naming an installation but in a format this build can't read blocks that installation", async () => {
    const f = fixture("malformed-owned");
    await installedInBoth(f);
    writeState(f, { ...readState(f), addonTransactions: [{ version: 99, installationId: f.a.id }] });

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("ready");
    await expect(engine.service.listAddons(f.a)).rejects.toThrow(RecoveryRequiredError);
  });

  test("a marker naming no installation blocks every installation", async () => {
    const f = fixture("malformed-orphan");
    await installedInBoth(f);
    writeState(f, { ...readState(f), addonTransactions: ["garbage", { transactionId: 7 }] });

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("recoveryRequired");
    expect(engine.store.addons.markers()).toEqual(["garbage", { transactionId: 7 }]);
  });

  test("a marker list that isn't a list blocks every installation", async () => {
    const f = fixture("malformed-list");
    await installedInBoth(f);
    writeState(f, { ...readState(f), addonTransactions: { damaged: true } });

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("recoveryRequired");
  });

  test("a well-formed marker that lost its commit evidence is unfinished, not committed", async () => {
    const f = fixture("lost-evidence");
    const id = await installedInBoth(f);
    f.fs.failAt("cleanup.remove");
    await f.service.updateAddon(id);
    f.fs.clear();
    const { addonCommits: _gone, ...rest } = readState(f);
    writeState(f, rest);

    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
  });
});

describe("a state file that can't be read", () => {
  test("that may hold markers blocks every installation and is never written over", async () => {
    const f = fixture("unreadable-state");
    await installedInBoth(f);
    const damaged = `${readFileSync(f.statePath, "utf-8").slice(0, -40)} "addonTransactions": [`;
    writeFileSync(f.statePath, damaged);

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("recoveryRequired");
    engine.store.updateSettings({ autoUpdate: true });
    engine.store.setInstallations([f.a, f.b]);
    await expect(engine.service.listAddons(f.a)).rejects.toThrow(RecoveryRequiredError);

    expect(readFileSync(f.statePath, "utf-8")).toBe(damaged);
  });

  test("that can't be opened at all blocks every installation and stays as it is", () => {
    const f = fixture("unopenable-state");
    rmSync(f.statePath);
    mkdirSync(f.statePath); // reading it fails (EISDIR)

    const engine = f.restart();
    engine.store.setInstallations([f.a, f.b]);
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(engine.service, f.b)).toBe("recoveryRequired");
    expect(lstatSync(f.statePath).isDirectory()).toBe(true);
  });

  test("installations.recoveryStatus says so with no installation listed, and why", async () => {
    const f = fixture("unreadable-state-rpc");
    await installedInBoth(f);
    writeFileSync(f.statePath, `${readFileSync(f.statePath, "utf-8").slice(0, -40)} "addonTransactions": [`);
    const engine = f.restart();
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    registerInstallations(server, { service: engine.service, installationService: engine.service.installations } as unknown as HandlerDeps);

    await server.handleLine(JSON.stringify({ id: 1, method: "installations.recoveryStatus", params: {} }));

    expect(JSON.parse(lines[0]!)).toEqual({
      id: 1,
      result: {
        installations: [],
        stateFile: {
          status: "unreadable",
          reason: expect.stringContaining("can't read its saved state file"),
          nextStep: expect.stringMatching(/state\.json.*restart.*settings changes aren't saved/is),
        },
      },
    });
  });

  test("a readable state file says so", async () => {
    const f = fixture("readable-state-rpc");
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    registerInstallations(server, { service: f.service, installationService: f.service.installations } as unknown as HandlerDeps);

    await server.handleLine(JSON.stringify({ id: 1, method: "installations.recoveryStatus", params: {} }));

    expect(JSON.parse(lines[0]!).result.stateFile).toEqual({ status: "readable" });
  });

  test("that can't have held a marker starts afresh, as before", () => {
    const f = fixture("unreadable-no-markers");
    writeFileSync(f.statePath, "{ not json");

    const engine = f.restart();
    engine.store.setInstallations([f.a]);
    expect(status(engine.service, f.a)).toBe("ready");
    expect(JSON.parse(readFileSync(f.statePath, "utf-8")).installations).toHaveLength(1);
  });

  test("that is missing is a first start", () => {
    const f = fixture("missing-state");
    rmSync(f.statePath);
    expect(status(f.restart().service, f.a)).toBe("ready");
  });
});

/** Leaves A with an unfinished update (record write and undo failed); returns its id. */
async function unfinishedInA(f: Fixture): Promise<string> {
  const id = await installedInBoth(f);
  f.fs.failAt("state.write").failAt("folder.restore");
  expect((await f.service.updateAddon(id)).operation.recoveryRequired).toBe(true);
  f.fs.clear();
  return id;
}

describe("an unfinished operation after a restart (scenario 4)", () => {
  test("keeps its installation blocked with the marker kept, and nothing is repaired", async () => {
    const f = fixture("unfinished");
    const id = await unfinishedInA(f);
    const files = tree(addonsOf(f.a));
    const markers = f.restart().store.addons.markers();

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(engine.store.addons.markers()).toEqual(markers);
    await expect(engine.service.scanInstallation(f.a)).rejects.toThrow(RecoveryRequiredError);
    await expect(engine.service.updateAddon(id)).rejects.toThrow(RecoveryRequiredError);
    expect((await engine.service.updateAll(f.a))[0]).toMatchObject({ status: "failed", recoveryRequired: true });

    expect(tree(addonsOf(f.a))).toEqual(files);
    expect(f.restart().store.addons.markers()).toEqual(markers);
    // B is unaffected.
    expect(status(engine.service, f.b)).toBe("ready");
    expect((await engine.service.updateAddon(engine.store.addons.forInstallation(f.b.id)[0]!.id)).operation.status).toBe("updated");
  });

  test("with its drive unavailable stays pending, and no installation root is recreated", async () => {
    const f = fixture("unfinished-drive");
    await unfinishedInA(f);
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away); // the SD card is out

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    await expect(engine.service.scanInstallation(f.a)).rejects.toThrow(RecoveryRequiredError);
    await expect(f.install(engine.service, f.a)).rejects.toThrow(RecoveryRequiredError);
    expect(existsSync(f.a.location)).toBe(false);

    renameSync(away, f.a.location); // back in: still pending
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
  });
});

describe("a committed operation with a leftover marker after a restart", () => {
  test("keeps its installed result, is not recovery required, and is only cleaned up", async () => {
    const f = fixture("committed");
    const id = await installedInBoth(f);
    f.fs.failAt("cleanup.remove");
    expect((await f.service.updateAddon(id)).operation.status).toBe("updated");
    f.fs.clear();
    const live = () => Object.fromEntries(Object.entries(tree(addonsOf(f.a))).filter(([p]) => !p.startsWith(".wowdeck")));
    const updated = live();
    expect(updated["Suite/core.lua"]).toBe("-- Suite 2.0\n");

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("ready");
    expect(engine.store.addons.require(id).installedVersion).toBe("2.0");
    const { cleaned } = await new AddonTransactions(engine.store.fs).cleanUpCommitted(engine.store.addons, f.a);

    expect(cleaned).toHaveLength(1);
    expect(live()).toEqual(updated); // never restored
    expect(f.restart().store.addons.markers()).toEqual([]);
    expect(f.restart().store.addons.require(id).installedVersion).toBe("2.0");
  });

  test("with its drive unavailable keeps its result, waits for cleanup and recreates nothing", async () => {
    const f = fixture("committed-drive");
    const id = await installedInBoth(f);
    f.fs.failAt("cleanup.remove");
    await f.service.updateAddon(id);
    f.fs.clear();
    rmSync(join(f.a.location, ".."), { recursive: true, force: true });

    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("ready");
    const { left } = await new AddonTransactions(engine.store.fs).cleanUpCommitted(engine.store.addons, f.a);
    expect(left).toHaveLength(1);
    expect(existsSync(f.a.location)).toBe(false);
    expect(engine.store.addons.require(id).installedVersion).toBe("2.0");
  });
});

describe("older state without transaction metadata", () => {
  test("loads and works unchanged", async () => {
    const f = fixture("legacy");
    const legacy = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "state", "legacy-state.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    writeState(f, { ...legacy, installations: [f.a, f.b], addons: [] });

    const engine = f.restart();
    expect(engine.store.addons.markers()).toEqual([]);
    expect(status(engine.service, f.a)).toBe("ready");
    expect((await f.install(engine.service, f.a)).operation.status).toBe("installed");
    const stored = readState(f);
    expect(stored.addonTransactions).toBeUndefined();
    expect(stored.addonCommits).toHaveLength(1);
  });
});
