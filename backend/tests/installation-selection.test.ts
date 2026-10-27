/**
 * Installation selection is a single canonical engine-side id,
 * persisted, and never silently dropped by re-detection.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import type { WowInstallation } from "../src/wow/models";

const ROOT = "/tmp/opencode/wowdeck-tests/selection";

function makeService(dataDir: string): { service: AddonService; store: ReturnType<typeof createStateStore> } {
  const store = createStateStore(dataDir);
  const service = new AddonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  return { service, store };
}

const PRODUCT_FOR_FLAVOR: Record<string, string> = {
  _retail_: "wow",
  _classic_era_: "wow_classic_era",
  _classic_beta_: "wow_classic_beta",
};

/**
 * Real layout: `.build.info` is shared across all flavor dirs
 * under the WoW root, matched by Product via each flavor's own
 * `.flavor.info`. Upserts this flavor's row so calling flavorDir() for a
 * newly-discovered flavor (added after the root was first built) still
 * produces a correctly-linked "likely" installation. See
 * docs/wow-client-identity.md.
 */
function flavorDir(name: string): string {
  const dir = join(ROOT, "wow", name);
  mkdirSync(join(dir, "Interface", "AddOns"), { recursive: true });
  const product = PRODUCT_FOR_FLAVOR[name] ?? name.replace(/_/g, "");
  writeFileSync(join(dir, ".flavor.info"), `Product Flavor!STRING:0\n${product}\n`);

  const buildInfoPath = join(ROOT, "wow", ".build.info");
  const rows = existsSync(buildInfoPath)
    ? readFileSync(buildInfoPath, "utf8")
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim() !== "")
    : [];
  if (!rows.some((r) => r.startsWith(`${product}|`))) {
    rows.push(`${product}|11.0.2`);
  }
  writeFileSync(buildInfoPath, `Product!STRING:0|Version!STRING:0\n${rows.join("\n")}\n`);
  return dir;
}

function makeWowRoot(): string {
  rmSync(join(ROOT, "wow"), { recursive: true, force: true });
  flavorDir("_retail_");
  flavorDir("_classic_era_");
  return join(ROOT, "wow");
}

let service: AddonService;
let store: ReturnType<typeof createStateStore>;
let retail: WowInstallation;
let era: WowInstallation;

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "home"), { recursive: true });
  makeWowRoot();
  ({ service, store } = makeService(join(ROOT, "data")));
  store.updateSettings({ customWowPaths: [join(ROOT, "wow")] });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("installation selection", () => {
  test("detect adds both flavors and persists first-installation fallback", async () => {
    expect(await service.installations.detect(join(ROOT, "home"))).toHaveLength(2);
    const found = service.installations.list();
    retail = found.find((i) => i.label === "_retail_")!;
    era = found.find((i) => i.label === "_classic_era_")!;

    expect(service.installations.selectedId()).toBe(retail.id);
    // fallback must be persisted, not just implied (engine/UI must agree)
    expect(store.settings.selectedInstallationId).toBe(retail.id);
  });

  test("selecting classic era is canonical for queries and install target", () => {
    service.installations.select(era.id);
    expect(service.installations.selectedId()).toBe(era.id);
    expect(service.installations.require().id).toBe(era.id);
    expect(store.settings.selectedInstallationId).toBe(era.id);
  });

  test("selecting an unknown id fails loudly instead of falling back", () => {
    expect(() => service.installations.select("bogus")).toThrow(/isn't available|isn't in your list|weren't found|wasn't found/i);
    expect(service.installations.selectedId()).toBe(era.id);
  });

  test("selection survives an engine restart", () => {
    const restarted = makeService(join(ROOT, "data")).service;
    expect(restarted.installations.selectedId()).toBe(era.id);
    expect(restarted.installations.require().location).toBe(era.location);
  });

  test("re-detection never drops installations and keeps the selection", async () => {
    // flavor dir temporarily unavailable (unmounted SD card etc.)
    rmSync(join(ROOT, "wow", "_classic_era_"), { recursive: true, force: true });
    await service.installations.detect(join(ROOT, "home"));
    expect(service.installations.list().map((i) => i.label).sort()).toEqual(["_classic_era_", "_retail_"]);
    expect(service.installations.selectedId()).toBe(era.id);

    // and it recovers once the directory is back
    flavorDir("_classic_era_");
    const restored = await service.installations.detect(join(ROOT, "home"));
    expect(restored).toHaveLength(2);
    expect(service.installations.selectedId()).toBe(era.id);
  });

  test("newly discovered installations are appended without touching selection", async () => {
    flavorDir("_classic_beta_");
    const grown = await service.installations.detect(join(ROOT, "home"));
    expect(grown).toHaveLength(3);
    expect(service.installations.selectedId()).toBe(era.id);
  });

  test("listInstallations refreshes a legacy auto-generated displayName, never a custom one", async () => {
    await service.installations.detect(join(ROOT, "home"));
    const beta = service.installations.list().find((i) => i.label === "_classic_beta_")!;

    // Simulate installations persisted before the naming fix (the old
    // `World of Warcraft (${label})` composition, and the brief
    // intermediate "World of Warcraft: Forever" scheme) and a genuinely
    // user-customized name — fixed on *read*, not only re-detection,
    // since My Addons' own Refresh button never calls
    // detectInstallations() at all (it only re-scans addon/provider
    // data), so a fix living only there would never reach most users.
    const current = store.installations;
    store.setInstallations(
      current.map((i) =>
        i.id === beta.id
          ? { ...i, displayName: "World of Warcraft (Classic Beta)" }
          : i.id === era.id
            ? { ...i, displayName: "My Era Copy" }
            : i,
      ),
    );

    const after = service.installations.list();
    expect(after.find((i) => i.id === beta.id)!.displayName).toBe("Forever");
    // a custom name must survive the read untouched
    expect(after.find((i) => i.id === era.id)!.displayName).toBe("My Era Copy");
  });
});
