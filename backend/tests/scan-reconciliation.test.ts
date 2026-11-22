/**
 * Regression coverage for the "managed/unmanaged addon state
 * corruption" matrix — duplicate scan, re-scan, and the same addon
 * being claimable by more than one provider, through the check My
 * Addons' refresh runs (AddonUpdates). AddonService.scanInstallation
 * runs providers in its SCAN_ORDER and hands each one only the folders no
 * earlier provider matched, so the first provider to claim a folder wins
 * whatever order providers were registered in. reconcileRecords then
 * upserts by `providerName:externalId`, so re-running a scan must never
 * create a second record for the same match.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addonService } from "./helpers/addon-service";
import { AddonUpdates } from "../src/wow/addons/AddonUpdates";
import type { AddonRecord } from "../src/wow/addons/AddonRecords";
import { AddonProvider, type ScanMatch } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore, type StateStore } from "../src/wow/storage/StateStore";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonFolder, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/scan-reconciliation";

/**
 * Matches every folder it is given whose TOC title is in `claims`, by exact
 * name. The matched release lists that folder plus `modules[title]`, like a
 * CurseForge file's modules.
 */
class ClaimingProvider extends AddonProvider {
  constructor(
    public override name: "WowUpHub" | "TukUI",
    private claims: Record<string, string>, // title -> externalId
    private modules: Record<string, string[]> = {}, // title -> the release's other folders
  ) {
    super();
    this.enabled = true;
  }

  override async scan(_installation: WowInstallation, folders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    const matches = new Map<string, ScanMatch>();
    for (const folder of folders) {
      const title = folder.tocs[0]?.title;
      const externalId = title ? this.claims[title] : undefined;
      if (!externalId) {
        continue;
      }
      const file = {
        externalId,
        channelType: 0,
        version: folder.tocs[0]!.version ?? "",
        folders: [folder.name, ...(this.modules[title!] ?? [])],
        gameVersion: "",
        downloadUrl: "",
        releaseDate: "",
      };
      matches.set(folder.name, {
        addon: { name: title!, author: "", externalId, externalUrl: "", providerName: this.name, files: [file] },
        latestFile: file,
        installedFile: file,
      });
    }
    return matches;
  }
}

let installation: WowInstallation;
let addonsPath: string;

function writeFolder(name: string, title: string, version: string): void {
  const dir = join(addonsPath, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.toc`), `## Title: ${title}\n## Version: ${version}\n## Interface: 110005\n`);
}

/** A service, and the check My Addons' refresh runs (AddonUpdates), answering the installation's records after it. */
function stackOf(store: StateStore, registry: ProviderRegistry, downloads: string) {
  const service = addonService(store, registry, new DownloadService(new NetworkClient(), join(ROOT, downloads)), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  const updates = new AddonUpdates(service, registry, store);
  const check = async (install: WowInstallation): Promise<AddonRecord[]> => {
    await updates.refresh(install);
    return service.addonsFor(install.id);
  };
  return { service, check };
}

function makeService(claimOrder: Array<["WowUpHub" | "TukUI", Record<string, string>]>) {
  const registry = new ProviderRegistry();
  for (const [name, claims] of claimOrder) {
    registry.register(new ClaimingProvider(name, claims));
  }
  const store = createStateStore(join(ROOT, "data"));
  store.setInstallations([installation]);
  return stackOf(store, registry, "dl");
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  const installRoot = join(ROOT, "_retail_");
  addonsPath = join(installRoot, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
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
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("scan reconciliation", () => {
  test("re-scanning is idempotent: no duplicate records", async () => {
    writeFolder("SoloAddon", "SoloAddon", "1.0.0");
    const { check } = makeService([["WowUpHub", { SoloAddon: "solo-1" }]]);

    const first = await check(installation);
    expect(first).toHaveLength(1);
    const firstId = first[0]!.id;

    const second = await check(installation);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(firstId); // same record, not a duplicate
  });

  test.each([
    ["Hub registered first", ["WowUpHub", "TukUI"]],
    ["TukUI registered first", ["TukUI", "WowUpHub"]],
  ] as const)("a folder claimable by two providers is matched by the first in scan order (%s)", async (_label, order) => {
    const contentionRoot = join(ROOT, `_retail_contention_${order[0]}`);
    rmSync(contentionRoot, { recursive: true, force: true });
    const contentionAddons = join(contentionRoot, "Interface", "AddOns");
    mkdirSync(join(contentionAddons, "SharedName"), { recursive: true });
    writeFileSync(
      join(contentionAddons, "SharedName", "SharedName.toc"),
      "## Title: SharedName\n## Version: 1.0.0\n## Interface: 110005\n",
    );
    const contentionInstall: WowInstallation = { ...installation, id: `inst-contention-${order[0]}`, location: contentionRoot };

    const claims = { WowUpHub: { SharedName: "hub-wins" }, TukUI: { SharedName: "tukui-loses" } };
    const registry = new ProviderRegistry();
    for (const name of order) {
      registry.register(new ClaimingProvider(name, claims[name]));
    }
    const store = createStateStore(join(ROOT, `data-contention-${order[0]}`));
    store.setInstallations([contentionInstall]);
    const { check } = stackOf(store, registry, "dl-contention");

    const addons = await check(contentionInstall);
    expect(addons).toHaveLength(1);
    expect(addons[0]!.providerName).toBe("WowUpHub");
    expect(addons[0]!.externalId).toBe("hub-wins");
  });

  describe("Raider.IO's own client (upstream raiderio-provider)", () => {
    const CLIENT_TOC = "## X-Website: https://raider.io\n## X-AddonProvider: raiderio-client\n";
    const claimAll = { "Raider.IO Mythic Plus and Raiding": "rio", "Raider.IO DB EU": "rio-db", Details: "details" };

    function raiderIoInstall(id: string, client: boolean): WowInstallation {
      const root = join(ROOT, `_retail_${id}`);
      rmSync(root, { recursive: true, force: true });
      const addons = join(root, "Interface", "AddOns");
      const folder = (name: string, toc: string) => {
        mkdirSync(join(addons, name), { recursive: true });
        writeFileSync(join(addons, name, `${name}.toc`), `${toc}## Version: 1.0.0\n## Interface: 110005\n`);
      };
      folder("RaiderIO", `## Title: Raider.IO Mythic Plus and Raiding\n${client ? CLIENT_TOC : ""}`);
      folder("RaiderIO_DB_EU_M", "## Title: Raider.IO DB EU\n## Dependencies: RaiderIO\n");
      folder("Details", "## Title: Details\n");
      return { ...installation, id, location: root };
    }

    function serviceFor(install: WowInstallation) {
      const registry = new ProviderRegistry();
      registry.register(new ClaimingProvider("WowUpHub", claimAll));
      const store = createStateStore(join(ROOT, `data-${install.id}`));
      store.setInstallations([install]);
      return stackOf(store, registry, "dl-rio");
    }

    test("its folders are never matched, and are listed as ignored with the reason", async () => {
      const install = raiderIoInstall("rio-client", true);
      const { service, check } = serviceFor(install);
      const records = await check(install);
      expect(records.map((r) => r.externalId)).toEqual(["details"]);
      const listed = await service.listAddons(install);
      const rio = listed.filter((a) => a.ignoreReason === "raiderio_client").map((a) => a.folderName).sort();
      expect(rio).toEqual(["RaiderIO", "RaiderIO_DB_EU_M"]);
      expect(listed.filter((a) => a.ignoreReason === "raiderio_client").every((a) => a.ignored && a.providerId === null)).toBe(
        true,
      );
    });

    test("a RaiderIO from an addon site (no client TOC fields) is matched like any addon", async () => {
      const install = raiderIoInstall("rio-site", false);
      const records = await serviceFor(install).check(install);
      expect(records.map((r) => r.externalId).sort()).toEqual(["details", "rio", "rio-db"]);
    });
  });

  test("a match claims the other folders its release lists (a TOC id only in the main folder)", async () => {
    // DEVICE 2026-10-21: CurseForge matched Raider.IO by the project id in
    // RaiderIO.toc only; its 15 RaiderIO_DB_* folders, part of the same
    // release, were listed as unmanaged.
    const root = join(ROOT, "_retail_modules");
    rmSync(root, { recursive: true, force: true });
    const addons = join(root, "Interface", "AddOns");
    for (const [name, title] of [["Main", "Main"], ["Main_DB", "Main DB"], ["Main_Git", "Main Git"], ["Other", "Other"]]) {
      mkdirSync(join(addons, name), { recursive: true });
      writeFileSync(join(addons, name, `${name}.toc`), `## Title: ${title}\n## Version: 1.0.0\n## Interface: 110005\n`);
    }
    mkdirSync(join(addons, "Main_Git", ".git"), { recursive: true });
    const install: WowInstallation = { ...installation, id: "inst-modules", location: root };
    const registry = new ProviderRegistry();
    // Main_Missing is in the release but not on disk; Other is claimed by its own match.
    registry.register(
      new ClaimingProvider("WowUpHub", { Main: "main", Other: "other" }, { Main: ["Main_DB", "Main_Git", "Main_Missing", "Other"] }),
    );
    const store = createStateStore(join(ROOT, "data-modules"));
    store.setInstallations([install]);
    const { service, check } = stackOf(store, registry, "dl-modules");

    const records = await check(install);
    const main = records.find((r) => r.externalId === "main")!;
    expect(main.installedFolderList).toEqual(["Main", "Main_DB"]);
    expect(records.find((r) => r.externalId === "other")!.installedFolderList).toEqual(["Other"]);
    const listed = await service.listAddons(install);
    expect(listed.filter((a) => a.providerId === null).map((a) => a.folderName)).toEqual(["Main_Git"]);
  });

  test("a release never claims a folder another addon's record owns", async () => {
    const root = join(ROOT, "_retail_owned");
    rmSync(root, { recursive: true, force: true });
    const addons = join(root, "Interface", "AddOns");
    for (const [name, title] of [["Main", "Main"], ["Lib", "Lib"]]) {
      mkdirSync(join(addons, name), { recursive: true });
      writeFileSync(join(addons, name, `${name}.toc`), `## Title: ${title}\n## Version: 1.0.0\n## Interface: 110005\n`);
    }
    const install: WowInstallation = { ...installation, id: "inst-owned", location: root };
    const store = createStateStore(join(ROOT, "data-owned"));
    store.setInstallations([install]);
    const make = (claims: Record<string, string>, modules: Record<string, string[]> = {}) => {
      const registry = new ProviderRegistry();
      registry.register(new ClaimingProvider("WowUpHub", claims, modules));
      return stackOf(store, registry, "dl-owned");
    };
    await make({ Lib: "lib" }).check(install); // Lib's own record
    // Lib's provider no longer matches it, and Main's release also ships Lib.
    const records = await make({ Main: "main" }, { Main: ["Lib"] }).check(install);
    expect(records.find((r) => r.externalId === "main")!.installedFolderList).toEqual(["Main"]);
    expect(records.find((r) => r.externalId === "lib")!.installedFolderList).toEqual(["Lib"]);
  });

  test("unmanaged folders stay unmanaged across a re-scan (no silent promotion without evidence)", async () => {
    writeFolder("NoEvidenceAddon", "NoEvidenceAddon", "1.0.0");
    const { service, check } = makeService([["WowUpHub", {}]]); // claims nothing

    await check(installation);
    const addons = await service.listAddons(installation);
    const unmanaged = addons.find((a) => a.name === "NoEvidenceAddon");
    expect(unmanaged?.providerId).toBeNull();

    await check(installation);
    const again = await service.listAddons(installation);
    expect(again.find((a) => a.name === "NoEvidenceAddon")?.providerId).toBeNull();
  });
});
