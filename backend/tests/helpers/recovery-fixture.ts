/**
 * A recovery-required installation to test against (ADR 0006): two
 * installations with real temporary game folders, a fake provider, a
 * reopenable state store and FaultInjectingFs. Shared by the Retry recovery
 * (#108) and Verify recovery (#109) suites.
 */
import { afterEach, expect } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../../src/wow/addons/AddonService";
import { FaultInjectingFs } from "../../src/wow/fs/StageFs";
import { createStateStore } from "../../src/wow/storage/StateStore";
import { AddonProvider } from "../../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../../src/wow/providers/provider-registry";
import { NetworkClient } from "../../src/wow/net/network";
import { DownloadService } from "../../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowInstallation } from "../../src/wow/models";
import { WowClientType, type AddonProviderType } from "../../src/wow/types";

export const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

export const FOLDERS = ["Suite", "SuiteLib"];

/** One addon (id 700) whose current release a test changes. */
export class OneAddonProvider extends AddonProvider {
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

export function zipOf(version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of FOLDERS) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${folder}\n## Version: ${version}\n## Interface: 110005\n`);
    files[`${folder}/core.lua`] = new TextEncoder().encode(`-- ${folder} ${version}\n`);
  }
  return zipSync(files);
}

export function installationAt(root: string, name: string): WowInstallation {
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

export const addonsOf = (i: WowInstallation) => join(i.location, "Interface", "AddOns");

/** Two installations, A and B; `restart()` is a fresh engine over the same files. */
export function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-recovery-${name}-`));
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

export type Fixture = ReturnType<typeof fixture>;

/** Every file and folder under `dir` with its contents ("<dir>" for a folder). */
export function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) {
    return out;
  }
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (lstatSync(path).isSymbolicLink()) {
        out[rel] = `<link ${readlinkSync(path)}>`;
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

/** The tree without the plugin's own `.wowdeck` folder: what WoW loads. */
export const live = (i: WowInstallation) =>
  Object.fromEntries(Object.entries(tree(addonsOf(i))).filter(([p]) => !p.startsWith(".wowdeck")));
export const status = (service: AddonService, i: WowInstallation) => service.recovery.status(i.id).status;
export const workFolders = (i: WowInstallation) =>
  existsSync(join(addonsOf(i), ".wowdeck")) ? readdirSync(join(addonsOf(i), ".wowdeck")).filter((n) => n.startsWith("tx-")) : [];

/**
 * Installs 1.0 in A and B, then updates A to 2.0 with the record write
 * failing and the undo stopping after `restores` moves back (every one
 * by default). Returns A's addon id and A as it was before the update.
 */
export async function stoppedUpdateInA(f: Fixture, restores?: number) {
  const { addon } = await f.install(f.service, f.a);
  await f.install(f.service, f.b);
  await f.publish(f.service, "2.0");
  const original = { files: live(f.a), record: f.store.addons.get(addon.id) };
  f.fs.failAt("state.write").failAt("folder.restore", { after: restores ?? 0 });
  const { operation } = await f.service.updateAddon(addon.id);
  f.fs.clear();
  expect(operation).toMatchObject({ status: "failed", recoveryRequired: true });
  return { id: addon.id, original };
}

/** A's files, record and markers: what a refused retry must leave exactly as they are. */
export function snapshot(f: Fixture, id: string) {
  return { files: tree(addonsOf(f.a)), record: f.store.addons.get(id), markers: f.store.addons.markers() };
}

/** Every file under `dir` whose content is `content`, AddOns-relative. */
export function filesHolding(dir: string, content: string): string[] {
  return Object.entries(tree(dir))
    .filter(([, c]) => c === content)
    .map(([p]) => p);
}

export type Stop = (f: Fixture, restores: number) => Promise<{ id: string; original: ReturnType<typeof snapshot> }>;

/** Each operation shape, stopped with its undo failing after `restores` moves back. */
export const SHAPES: [string, number, Stop][] = [
  [
    "new install",
    2,
    async (f, restores) => {
      await f.install(f.service, f.b);
      const original = snapshot(f, "none");
      f.fs.failAt("state.write").failAt("folder.restore", { after: restores });
      const { operation } = await f.install(f.service, f.a);
      f.fs.clear();
      expect(operation.recoveryRequired).toBe(true);
      return { id: operation.addonId!, original: { ...original, record: undefined } };
    },
  ],
  [
    "update keeping the previous version",
    5,
    async (f, restores) => {
      const { addon } = await f.install(f.service, f.a);
      await f.publish(f.service, "2.0");
      const original = snapshot(f, addon.id);
      f.fs.failAt("state.write").failAt("folder.restore", { after: restores });
      expect((await f.service.updateAddon(addon.id)).operation.recoveryRequired).toBe(true);
      f.fs.clear();
      return { id: addon.id, original };
    },
  ],
  [
    "removal",
    2,
    async (f, restores) => {
      const { addon } = await f.install(f.service, f.a);
      const original = snapshot(f, addon.id);
      f.fs.failAt("state.write").failAt("folder.restore", { after: restores });
      expect((await f.service.removeAddon(addon.id)).recoveryRequired).toBe(true);
      f.fs.clear();
      return { id: addon.id, original };
    },
  ],
  [
    "Roll back",
    6,
    async (f, restores) => {
      const { addon } = await f.install(f.service, f.a);
      await f.publish(f.service, "2.0");
      await f.service.updateAddon(addon.id);
      const original = snapshot(f, addon.id);
      f.fs.failAt("state.write").failAt("folder.restore", { after: restores });
      expect((await f.service.rollback(addon.id)).operation.recoveryRequired).toBe(true);
      f.fs.clear();
      return { id: addon.id, original };
    },
  ],
];

export const withoutWork = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith(".wowdeck/tx-") && p !== ".wowdeck"));
