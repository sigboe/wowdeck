/**
 * The active installation is never a hidden one while a visible one exists
 * (#338): a hidden active installation turns My Addons' and Get Addons'
 * pickers into an Unhide-only menu.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addonService } from "./helpers/addon-service";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";

const ROOT = "/tmp/opencode/wowdeck-tests/hidden-selection";
const HOME = join(ROOT, "home");
const WOW = join(ROOT, "wow");
const DATA = join(ROOT, "data");

function flavor(name: string): void {
  mkdirSync(join(WOW, name, "Interface", "AddOns"), { recursive: true });
  mkdirSync(join(WOW, name, "Data"), { recursive: true });
}

async function threeInstallations() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
  for (const name of ["_retail_", "_classic_era_", "_classic_"]) flavor(name);
  const store = createStateStore(DATA);
  store.updateSettings({ customWowPaths: [WOW] });
  const service = addonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(DATA, "dl")), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  const installations = service.installations;
  const list = await installations.scan(HOME);
  expect(list).toHaveLength(3);
  return { installations, ids: list.map((i) => i.id) };
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("hidden installations and the active installation", () => {
  test("removing the active installation never makes a hidden one active while a visible one is left", async () => {
    const { installations, ids } = await threeInstallations();
    const [first, second, third] = ids as [string, string, string];
    installations.update(first, { hidden: true });
    installations.update(second, { hidden: true });
    installations.select(first);

    await installations.remove(first);

    expect(installations.selectedId()).toBe(third);
  });

  test("with every remaining installation hidden, the first one becomes active", async () => {
    const { installations, ids } = await threeInstallations();
    const [first, second, third] = ids as [string, string, string];
    installations.update(second, { hidden: true });
    installations.update(third, { hidden: true });
    installations.select(first);

    await installations.remove(first);

    expect(installations.selectedId()).toBe(second);
  });
});
