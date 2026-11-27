/**
 * Removed installations (#321): the startup scan leaves them out; Find WoW
 * installations brings back the ones it finds, and a manual add brings back
 * the ones it adds. One whose folder isn't found stays removed.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addonService } from "./helpers/addon-service";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";

const ROOT = "/tmp/opencode/wowdeck-tests/removed-installations";
const HOME = join(ROOT, "home");
const WOW = join(ROOT, "wow");
const DATA = join(ROOT, "data");

/** A "likely" flavor folder (a Data folder, no executable). */
function flavor(name: string): string {
  const dir = join(WOW, name);
  mkdirSync(join(dir, "Interface", "AddOns"), { recursive: true });
  mkdirSync(join(dir, "Data"), { recursive: true });
  return dir;
}

/** The engine as a fresh start reads it: a new store and service over the same data folder. */
function start() {
  const store = createStateStore(DATA);
  store.updateSettings({ customWowPaths: [WOW] });
  const service = addonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(DATA, "dl")), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  return service.installations;
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

describe("removed installations", () => {
  test("one Find WoW installations can't find stays removed until its folder is back", async () => {
    flavor("_retail_");
    const era = flavor("_classic_era_");
    const installations = start();
    const found = await installations.scan(HOME);
    const removedEra = found.find((i) => i.gameType === "classic_era")!;
    await installations.remove(removedEra.id);

    // The drive holding it is unplugged.
    renameSync(era, join(ROOT, "unplugged"));
    expect(await installations.find(HOME)).toMatchObject({ restored: 0 });

    // Plugged back in: the startup scan still leaves it out, Find WoW brings it back.
    renameSync(join(ROOT, "unplugged"), era);
    const restarted = start();
    expect((await restarted.scan(HOME)).map((i) => i.id)).not.toContain(removedEra.id);
    const { installations: list, restored } = await restarted.find(HOME);
    expect(restored).toBe(1);
    expect(list.map((i) => i.id)).toContain(removedEra.id);
  });

  test("adding a removed installation's WoW folder by hand brings it back", async () => {
    flavor("_retail_");
    const installations = start();
    const [retail] = await installations.scan(HOME);
    await installations.remove(retail!.id);

    const added = await installations.addManual(WOW);
    expect(added.map((i) => i.id)).toEqual([retail!.id]);

    // Off the removed list: a restart's scan keeps it and reads its game version again.
    writeFileSync(join(WOW, "_retail_", ".flavor.info"), "Product Flavor!STRING:0\nwow\n");
    writeFileSync(join(WOW, ".build.info"), "Product!STRING:0|Version!STRING:0\nwow|11.1.0\n");
    const restarted = start();
    expect(await restarted.scan(HOME)).toMatchObject([{ id: retail!.id, version: "11.1.0" }]);
  });

  test("a state file from before removed installations loads with none removed", async () => {
    flavor("_retail_");
    const installations = start();
    const [retail] = await installations.scan(HOME);
    const state = JSON.parse(readFileSync(join(DATA, "state.json"), "utf8"));
    expect(state).not.toHaveProperty("removedInstallations");

    // A file without the key, as older builds wrote it.
    expect(await start().find(HOME)).toMatchObject({ restored: 0, installations: [{ id: retail!.id }] });
    expect(JSON.parse(readFileSync(join(DATA, "state.json"), "utf8"))).not.toHaveProperty("removedInstallations");

    // A damaged value reads as none removed too.
    writeFileSync(join(DATA, "state.json"), JSON.stringify({ ...state, removedInstallations: "not a list" }));
    expect((await start().scan(HOME)).map((i) => i.id)).toEqual([retail!.id]);
  });
});
