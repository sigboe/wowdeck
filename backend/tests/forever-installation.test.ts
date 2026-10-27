/**
 * Forever installations (`_forever_`): Forever runs the Retail game binary,
 * so only its folder tells it apart from Retail. Detection, adding by hand,
 * a forced game type and a restart all keep it Forever, beside Retail and
 * Forever Beta.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { getClientTypeForGameType } from "../src/wow/utils/gametype";

const ROOT = "/tmp/opencode/wowdeck-tests/forever";
const WOW = join(ROOT, "wow/World of Warcraft");
const DATA = join(ROOT, "data");

function makeService(dataDir: string) {
  const store = createStateStore(dataDir);
  const service = new AddonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  return { service, store };
}

/** Create a flavor folder holding a game binary (Wow.exe: the Retail binary, which `_forever_` ships too). */
function makeFlavor(path: string, binary = "Wow.exe"): string {
  mkdirSync(join(path, "Interface", "AddOns"), { recursive: true });
  writeFileSync(join(path, binary), "MZ fake");
  return path;
}

/** The listed Forever and Forever Beta installations. */
function foreverInstallations(s: AddonService) {
  return s.installations.listed().filter((i) => i.gameType === "forever" || i.gameType === "classic_beta");
}

let service: AddonService;
let store: ReturnType<typeof createStateStore>;

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "home"), { recursive: true });
  makeFlavor(join(WOW, "_retail_"));
  makeFlavor(join(WOW, "_forever_"));
  ({ service, store } = makeService(DATA));
  store.updateSettings({ customWowPaths: [join(ROOT, "wow")] });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("Forever installations", () => {
  test("a _forever_ folder is detected as Forever; the _retail_ next to it stays Retail", async () => {
    const detected = await service.installations.detect(join(ROOT, "home"));

    const byLabel = (label: string) => detected.find((i) => i.path.endsWith(`/${label}`))!;
    expect(byLabel("_forever_")).toMatchObject({
      gameType: "forever",
      displayName: "Forever",
      clientName: "Forever",
      clientFullName: "World of Warcraft: Forever",
    });
    expect(byLabel("_retail_")).toMatchObject({ gameType: "retail", displayName: "Retail" });
  });

  test("adding _forever_ by hand yields Forever", async () => {
    const added = await service.installations.addManual(join(WOW, "_forever_"));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ gameType: "forever", displayName: "Forever", source: "manual" });
  });

  test("a custom folder added with the forever game type forced is Forever", async () => {
    const custom = makeFlavor(join(ROOT, "custom/WoW Forever"));
    const added = await service.installations.addManual(custom, { clientType: getClientTypeForGameType("forever") });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ gameType: "forever", displayName: "Forever", path: custom });
  });

  test("Forever and Forever Beta installations survive a restart unchanged", async () => {
    makeFlavor(join(WOW, "_classic_beta_"), "WowB.exe");
    await service.installations.detect(join(ROOT, "home"));
    const before = foreverInstallations(service);
    expect(before.map((i) => i.displayName)).toEqual(expect.arrayContaining(["Forever", "Forever Beta"]));

    expect(foreverInstallations(makeService(DATA).service)).toEqual(before);
  });

  test("a Retail installation the player named World of Warcraft: Forever keeps that name", async () => {
    await service.installations.detect(join(ROOT, "home"));
    const retail = service.installations.list().find((i) => i.location.endsWith("/_retail_"))!;
    store.setInstallations(store.installations.map((i) => (i.id === retail.id ? { ...i, displayName: "World of Warcraft: Forever" } : i)));
    await service.installations.detect(join(ROOT, "home"));
    expect(service.installations.listed().find((i) => i.id === retail.id)!.displayName).toBe("World of Warcraft: Forever");
  });
});
