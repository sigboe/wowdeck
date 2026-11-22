/**
 * Installation-scoped methods act on the installation they name: never on
 * the selected one by default. The real engine, assembled in-process with a
 * Retail and a Classic Era installation, Retail selected.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MethodName } from "../src/api/contracts";
import { configFromEnv, startEngine, type Engine } from "../src/engine";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PRODUCT: Record<string, string> = { _retail_: "wow", _classic_era_: "wow_classic_era" };

/** Retail and Classic Era, each with one unmanaged addon folder of its own; Retail selected. */
async function twoInstallations(): Promise<{ engine: Engine; retail: string; era: string }> {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-scoped-"));
  roots.push(root);
  const homeDir = join(root, "home");
  const wowRoot = join(homeDir, "Applications", "World of Warcraft");
  for (const [flavor, folder] of [["_retail_", "RetailOnly"], ["_classic_era_", "EraOnly"]] as const) {
    const addon = join(wowRoot, flavor, "Interface", "AddOns", folder);
    mkdirSync(addon, { recursive: true });
    writeFileSync(join(addon, `${folder}.toc`), `## Title: ${folder}\n## Interface: 110002\n`);
    writeFileSync(join(wowRoot, flavor, ".flavor.info"), `Product Flavor!STRING:0\n${PRODUCT[flavor]}\n`);
  }
  writeFileSync(join(wowRoot, ".build.info"), "Product!STRING:0|Version!STRING:0\nwow|11.0.2\nwow_classic_era|1.15.7\n");
  const base = configFromEnv({ HOME: homeDir, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  const network = new ReplayNetwork(await loadCassette("wowup-hub"));
  const engine = await startEngine({ ...base, network, now: () => Date.UTC(2026, 10, 1) });
  const { installations } = await engine.call("installations.list", {});
  const retail = installations.find((i) => i.gameType === "retail")!.id;
  const era = installations.find((i) => i.gameType === "classic_era")!.id;
  await engine.call("installations.select", { installationId: retail });
  return { engine, retail, era };
}

test("a method acts on the installation it names, not the selected one", async () => {
  const { engine, era } = await twoInstallations();

  const { addons } = await engine.call("addons.list", { installationId: era });
  expect(addons.map((a) => a.name)).toEqual(["EraOnly"]);
  const { folders } = await engine.call("addons.folders", { installationId: era, addonId: "unmanaged:EraOnly" });
  expect(folders.map((f) => f.name)).toEqual(["EraOnly"]);
  const { sources } = await engine.call("wtf.copySources", { installationId: era });
  expect(sources.every((s) => s.installationId !== era)).toBe(true);
});

/** Each installation-scoped method, with every other param it needs. */
const WITHOUT_ID: Array<[MethodName, Record<string, unknown>]> = [
  ["addons.list", {}],
  ["addons.refresh", {}],
  ["addons.folders", { addonId: "unmanaged:RetailOnly" }],
  ["addons.showFolders", { addonId: "unmanaged:RetailOnly" }],
  ["addons.search", { query: "bags" }],
  ["discover.latest", { providerId: "WowUpHub", index: 0, pageSize: 5 }],
  ["discover.popular", { providerId: "WowUpHub", index: 0, pageSize: 5 }],
  ["addons.getChangelog", { providerId: "WowUpHub", externalId: "1" }],
  ["addons.lookup", { providerId: "WowUpHub", externalIds: ["1"] }],
  ["addons.getCategories", { providerId: "WowUpHub" }],
  ["addons.install", { providerId: "WowUpHub", externalId: "1" }],
  ["addons.removeUnmanaged", { folderName: "RetailOnly" }],
  ["addons.findSources", { folderName: "RetailOnly" }],
  ["addons.adopt", { folderName: "RetailOnly", providerId: "WowUpHub", externalId: "1" }],
  ["addons.updateAll", {}],
  ["addons.export", {}],
  ["addons.previewImport", { importString: "x" }],
  ["addons.importAddonList", { importString: "x" }],
  ["tradeskillmaster.cleanupPreview", {}],
  ["tradeskillmaster.removeAddons", {}],
  ["tradeskillmaster.refresh", {}],
  ["tradeskillmaster.setFollow", { realmId: 1, auctionHouseType: "Horde", followed: true }],
  ["tradeskillmaster.destination", {}],
  ["wtf.list", {}],
  ["wtf.create", {}],
  ["wtf.restore", { fileName: "x.zip" }],
  ["wtf.copySources", {}],
  ["wtf.copy", { sourceFlavor: "_classic_era_", fileName: "x.zip" }],
  ["wtf.delete", { fileName: "x.zip" }],
  ["wtf.import", { path: "/nowhere/x.zip" }],
  ["installations.recoveryDetails", {}],
];

test.each(WITHOUT_ID)("%s without an installation id is refused, though one is selected", async (method, params) => {
  const { engine } = await twoInstallations();

  await expect(engine.call(method, params as never)).rejects.toMatchObject({ code: "invalid_request" });
});

test.each([["addons.resolveUrlImport", { url: "https://example.com/a.zip" }], ["addons.inspectArchive", { path: "/nowhere/a.zip" }]] as const)(
  "%s without an installation id answers invalid_request",
  async (method, params) => {
    const { engine } = await twoInstallations();

    expect(await engine.call(method, params as never)).toMatchObject({ result: null, error: { code: "invalid_request" } });
  },
);

test("an unknown installation id is not found, never the selected one", async () => {
  const { engine } = await twoInstallations();

  await expect(engine.call("addons.list", { installationId: "gone" })).rejects.toMatchObject({ code: "not_found" });
});
