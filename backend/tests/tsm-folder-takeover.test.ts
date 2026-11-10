/**
 * Characterization of TradeSkillMaster's takeover of an old File record
 * (spec #185 part 2): written before the folder rules moved out of the
 * addon service, and kept to show the move changed nothing.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { AddonService } from "../src/wow/addons/AddonService";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { AddonProvider, type ScanMatch } from "../src/wow/providers/addon-provider";
import { FileProvider } from "../src/wow/providers/file/FileProvider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import type { AddonFolder, AddonSearchResult, WowInstallation } from "../src/wow/models";
import { AddonChannelType, WowClientType } from "../src/wow/types";

const TSM = "TradeSkillMaster";
const HELPER = "TradeSkillMaster_AppHelper";
const OTHER = "UnrelatedAddon";

/** A signed-in TradeSkillMaster source answering from a fixed release list. */
class RecordedTradeSkillMaster extends AddonProvider {
  override name = "TradeSkillMaster" as const;
  override enabled = true;
  override isConfigured() { return true; }
  override isValidAddonId(id: string) { return id === TSM || id === HELPER; }
  override async getById(id: string): Promise<AddonSearchResult | undefined> {
    if (!this.isValidAddonId(id)) return undefined;
    return {
      externalId: id,
      name: id,
      author: "TradeSkillMaster",
      providerName: this.name,
      externalUrl: "https://www.tradeskillmaster.com",
      files: [{
        externalId: "release/v4.15",
        channelType: AddonChannelType.Stable,
        version: "4.15",
        folders: [id],
        gameVersion: "",
        downloadUrl: `https://cdn.invalid/${id}.zip`,
        releaseDate: "",
        dependencies: [],
      }],
    };
  }
  override async scan(_installation: WowInstallation, folders: AddonFolder[]) {
    const matches = new Map<string, ScanMatch>();
    for (const folder of folders) {
      const addon = await this.getById(folder.name);
      if (addon) matches.set(folder.name, { addon, latestFile: addon.files![0]! });
    }
    return matches;
  }
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const toc = (name: string) => new TextEncoder().encode(`## Title: ${name}\n## Interface: 110005\n## Version: 4.0\n`);

test.each(["TradeSkillMaster first", "AppHelper first"])(
  "an old File record holding both TradeSkillMaster folders and another is taken over with %s",
  async (order) => {
    const root = mkdtempSync(join(tmpdir(), "tsm-takeover-"));
    roots.push(root);
    const installation: WowInstallation = {
      id: "retail",
      clientType: WowClientType.Retail,
      location: join(root, "_retail_"),
      label: "_retail_",
      displayName: "Retail",
      selected: true,
      // The old install picked up this channel; the takeover must not reset it.
      defaultAddonChannelType: AddonChannelType.Beta,
      source: "detected",
    };
    const addonsPath = join(installation.location, "Interface", "AddOns");
    mkdirSync(addonsPath, { recursive: true });
    const store = createStateStore(root);
    store.setInstallations([installation]);
    const registry = new ProviderRegistry();
    const tsm = new RecordedTradeSkillMaster();
    registry.register(tsm);
    registry.register(new FileProvider());
    const service = new AddonService(
      store,
      registry,
      new DownloadService(new NetworkClient(), join(root, "downloads")),
      { addonsChanged() {}, operationResult() {} },
    );

    // An old File install from before the source existed.
    tsm.enabled = false;
    const archive = join(root, "bundle.zip");
    writeFileSync(archive, zipSync({
      [`${TSM}/${TSM}.toc`]: toc(TSM),
      [`${HELPER}/${HELPER}.toc`]: toc(HELPER),
      [`${OTHER}/${OTHER}.toc`]: toc(OTHER),
    }));
    const installed = await service.install({ intent: "install", providerId: "File", externalId: archive, installation });
    expect(installed.operation.status).toBe("installed");
    const id = installed.operation.addonId!;
    await service.setAutoUpdatePaused(id, true);
    const before = service.addonsFor(installation.id).find((r) => r.id === id)!;
    expect(before.providerName).toBe("File");
    expect(before.channelType).toBe(AddonChannelType.Beta);
    expect([...before.installedFolderList!].sort()).toEqual([OTHER, TSM, HELPER].sort());
    expect(before.installedArchiveHash).toBeDefined();
    expect(before.installedExternalReleaseId).toBeDefined();

    // Groups follow the scanned folder order: fix it either way round.
    const takesOverFirst = order === "TradeSkillMaster first" ? TSM : HELPER;
    const readdir = fsPromises.readdir;
    const listing = spyOn(fsPromises, "readdir").mockImplementation((async (path: string, options: unknown) => {
      const entries = await (readdir as (p: string, o: unknown) => Promise<Dirent[]>)(path, options);
      if (path !== addonsPath) return entries;
      const rank = (name: string) => (name === takesOverFirst ? 0 : name === OTHER ? 2 : 1);
      return [...entries].sort((a, b) => rank(a.name) - rank(b.name));
    }) as unknown as typeof fsPromises.readdir);
    tsm.enabled = true;
    try {
      await service.scanInstallation(installation);
    } finally {
      listing.mockRestore();
    }

    const records = service.addonsFor(installation.id);
    // Each folder has exactly one owner.
    for (const folder of [TSM, HELPER, OTHER]) {
      expect(records.filter((r) => r.installedFolderList?.includes(folder))).toHaveLength(1);
    }
    expect(records).toHaveLength(2);
    // The old record keeps its ID, becomes the first TradeSkillMaster match
    // and keeps the folder TradeSkillMaster didn't match.
    const taken = records.find((r) => r.id === id)!;
    expect(taken).toMatchObject({ providerName: "TradeSkillMaster", externalId: takesOverFirst });
    expect([...taken.installedFolderList!].sort()).toEqual([takesOverFirst, OTHER].sort());
    // Archive identity is cleared; the user's choices stay.
    expect(taken.installedArchiveHash).toBeUndefined();
    expect(taken.installedExternalReleaseId).toBeUndefined();
    expect(taken.autoUpdatePaused).toBe(true);
    expect(taken.channelType).toBe(AddonChannelType.Beta);
    // The other TradeSkillMaster folder gets a record of its own.
    const other = records.find((r) => r.id !== id)!;
    const second = takesOverFirst === TSM ? HELPER : TSM;
    expect(other).toMatchObject({ providerName: "TradeSkillMaster", externalId: second, installedFolderList: [second] });
  },
);
