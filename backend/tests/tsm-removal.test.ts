/**
 * Removing TradeSkillMaster's addons (tradeskillmaster.removeAddons): its
 * folder checks and the removals run in one turn of the addon gate, so no
 * other addon change runs between them.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { WowInstallation } from "../src/wow/models";
import { NetworkClient } from "../src/wow/net/network";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { removeTradeSkillMasterAddons } from "../src/wow/tsm/TradeSkillMasterFolders";
import { WowClientType } from "../src/wow/types";
import { addonService } from "./helpers/addon-service";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-tsm-removal-"));
  roots.push(root);
  const installation: WowInstallation = {
    id: "retail",
    clientType: WowClientType.Retail,
    location: join(root, "_retail_"),
    label: "Retail",
    displayName: "Retail",
    selected: true,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const addonsPath = join(installation.location, "Interface", "AddOns");
  for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) {
    mkdirSync(join(addonsPath, name), { recursive: true });
    writeFileSync(join(addonsPath, name, `${name}.toc`), "## Interface: 110005\n## Version: v4.0\n");
  }
  const store = createStateStore(join(root, "data"));
  store.setInstallations([installation]);
  const service = addonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(root, "dl")), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  return { service, installation, addonsPath };
}

test("a change queued while the removal runs comes after every removal", async () => {
  const { service, installation, addonsPath } = fixture();

  const removal = removeTradeSkillMasterAddons(service, installation);
  const listedMeanwhile = service.listAddons(installation);

  expect((await removal).map((op) => op.status)).toEqual(["removed", "removed"]);
  expect((await listedMeanwhile).map((addon) => addon.name)).toEqual([]);
  expect(existsSync(join(addonsPath, "TradeSkillMaster"))).toBe(false);
});

test("a developer addon among them is refused and left in place", async () => {
  const { service, installation, addonsPath } = fixture();
  mkdirSync(join(addonsPath, "TradeSkillMaster", ".git"));

  const operations = await removeTradeSkillMasterAddons(service, installation);

  const byAddon = Object.fromEntries(operations.map((op) => [op.addonId, op]));
  expect(byAddon["unmanaged:TradeSkillMaster"]).toMatchObject({ status: "failed", error: "Cannot remove a developer addon" });
  expect(byAddon["unmanaged:TradeSkillMaster_AppHelper"]?.status).toBe("removed");
  expect(existsSync(join(addonsPath, "TradeSkillMaster"))).toBe(true);
});
