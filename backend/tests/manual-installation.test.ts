/**
 * Manual installations — add (validate/name/client type), persistence,
 * survival across detection, removal that never touches WoW files,
 * selection fallback after removal.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/manual";

function makeService(dataDir: string) {
  const store = createStateStore(dataDir);
  const service = new AddonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(dataDir, "dl")), {
    addonsChanged: () => {},
    operationResult: () => {},
  });
  return { service, store };
}

let service: AddonService;
let store: ReturnType<typeof createStateStore>;

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "home"), { recursive: true });
  ({ service, store } = makeService(join(ROOT, "data")));
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("manual installation", () => {
  test("adding a flavor dir (addon-data tier) succeeds via explicit confirmation", async () => {
    // reference-Deck retail layout: only Interface/
    const retail = join(ROOT, "wow/World of Warcraft/_retail_");
    mkdirSync(join(retail, "Interface", "AddOns"), { recursive: true });

    const added = await service.installations.addManual(retail);
    expect(added).toHaveLength(1);
    expect(added[0]!.source).toBe("manual");
    expect(added[0]!.gameType).toBe("retail");
    expect(service.installations.list()).toHaveLength(1);
  });

  test("inspecting a folder reports what it holds, without adding it", async () => {
    const before = service.installations.list().length;
    const ptr = join(ROOT, "inspect/World of Warcraft/_ptr_");
    mkdirSync(join(ptr, "Interface", "AddOns"), { recursive: true });
    const found = await service.installations.inspect(ptr);
    expect(found).toEqual([{ gameType: "ptr", displayName: "Retail PTR" }]);
    expect(await service.installations.inspect(join(ROOT, "inspect"))).toHaveLength(1);
    expect(await service.installations.inspect("relative")).toEqual([]);
    expect(await service.installations.inspect("/nonexistent/x")).toEqual([]);
    expect(service.installations.list()).toHaveLength(before);
  });

  test("display name applies to single-install adds only", async () => {
    const era = join(ROOT, "wow/World of Warcraft/_classic_era_");
    mkdirSync(join(era, "Interface", "AddOns"), { recursive: true });
    writeFileSync(join(era, "WowClassic.exe"), "MZ");

    // adding the WoW root yields two flavors; a display name would be
    // ambiguous there and is ignored (documented behavior)
    const added = await service.installations.addManual(join(ROOT, "wow"), {
      displayName: "My Era Copy",
    });
    expect(added).toHaveLength(2);
    expect(added.every((i) => i.displayName === i.clientName)).toBe(true);

    // adding the flavor dir directly takes the custom name
    const single = await service.installations.addManual(era, { displayName: "My Era Copy" });
    expect(single).toHaveLength(1);
    expect(single[0]!.displayName).toBe("My Era Copy");
  });

  /** Add a fresh installation of one flavor, then store `name` as an earlier version would have. */
  async function storedAs(dir: string, flavor: string, name: string) {
    const path = join(ROOT, dir, "World of Warcraft", flavor);
    mkdirSync(join(path, "Interface", "AddOns"), { recursive: true });
    const [added] = await service.installations.addManual(path);
    store.setInstallations(store.installations.map((i) => (i.id === added!.id ? { ...i, displayName: name } : i)));
    return { path, id: added!.id };
  }

  test("a beta installation auto-named Forever is renamed Forever Beta", async () => {
    const short = await storedAs("beta-short", "_classic_beta_", "Forever");
    const full = await storedAs("beta-full", "_classic_beta_", "World of Warcraft: Forever");
    await service.installations.addManual(short.path);
    await service.installations.addManual(full.path);

    const listed = service.installations.listed();
    for (const { id } of [short, full]) {
      const installation = listed.find((i) => i.id === id)!;
      expect(installation.displayName).toBe("Forever Beta");
      expect(installation.clientFullName).toBe("World of Warcraft: Forever Beta");
      await service.installations.remove(id);
    }
  });

  test("a name the player typed survives re-detection", async () => {
    const typed = await storedAs("beta-typed", "_classic_beta_", "My Beta");
    // "Forever" was only ever an auto name for the beta, so on Retail it was typed
    const retail = await storedAs("retail-forever", "_retail_", "Forever");
    await service.installations.addManual(typed.path);
    await service.installations.addManual(retail.path);

    const listed = service.installations.listed();
    expect(listed.find((i) => i.id === typed.id)!.displayName).toBe("My Beta");
    expect(listed.find((i) => i.id === retail.id)!.displayName).toBe("Forever");
    await service.installations.remove(typed.id);
    await service.installations.remove(retail.id);
  });

  test("manual installation persists and survives detection", async () => {
    store.updateSettings({ customWowPaths: [] });
    // detection finds nothing under the empty home; manual entries must stay
    const detected = await service.installations.detect(join(ROOT, "home"));
    expect(detected).toHaveLength(2);
    expect(detected.every((i) => i.source === "manual")).toBe(true);
  });

  test("invalid directories produce useful errors", async () => {
    const junk = join(ROOT, "junk");
    mkdirSync(join(junk, "random"), { recursive: true });
    writeFileSync(join(junk, "readme.txt"), "nothing");

    // no flavor dir and no explicit client type
    await expect(service.installations.addManual(junk)).rejects.toThrow(
      /does not contain a WoW flavor directory/i,
    );
    // flavor dir with junk-only contents
    const fakeFlavor = join(ROOT, "fake/World of Warcraft/_retail_");
    mkdirSync(fakeFlavor, { recursive: true });
    writeFileSync(join(fakeFlavor, "notes.txt"), "x");
    await expect(service.installations.addManual(fakeFlavor)).rejects.toThrow(
      /no WoW installation markers/i,
    );
    await expect(service.installations.addManual("/nonexistent/absolute/path")).rejects.toThrow();
  });

  test("relative paths are rejected", async () => {
    await expect(service.installations.addManual("relative/path")).rejects.toThrow(/full folder path/i);
  });

  test("custom layout with forced client type", async () => {
    const custom = join(ROOT, "custom-era");
    mkdirSync(join(custom, "Interface", "AddOns"), { recursive: true });

    const added = await service.installations.addManual(custom, {
      clientType: WowClientType.ClassicEra,
    });
    expect(added).toHaveLength(1);
    expect(added[0]!.gameType).toBe("classic_era");
    expect(added[0]!.path).toBe(custom);
  });

  test("removal never deletes WoW files and drops records", async () => {
    const era = service
      .installations.list()
      .find((i) => i.clientType === WowClientType.ClassicEra)!;
    const eraPath = era.location;

    await service.installations.remove(era.id);
    expect(service.installations.list().find((i) => i.id === era.id)).toBeUndefined();
    // files untouched
    expect(existsSync(join(eraPath, "WowClassic.exe"))).toBe(true);
    expect(existsSync(join(eraPath, "Interface", "AddOns"))).toBe(true);
  });

  test("removing the selected installation falls back and persists", async () => {
    const remaining = service.installations.list();
    expect(remaining.length).toBeGreaterThan(0);
    const target = remaining[0]!;
    service.installations.select(target.id);
    await service.installations.remove(target.id);

    const next = service.installations.ensureSelection();
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(target.id);
    expect(store.settings.selectedInstallationId).toBe(next!.id);
  });

  test("removing the selected installation persists the fallback itself (no read needed)", async () => {
    await service.installations.addManual(join(ROOT, "wow"));
    const [target, other] = service.installations.list();
    expect(other).toBeDefined();
    service.installations.select(target!.id);
    await service.installations.remove(target!.id);
    // Read the store straight away: nothing else may have written it.
    const stored = store.settings.selectedInstallationId;
    expect(stored).not.toBeNull();
    expect(stored).not.toBe(target!.id);
    expect(service.installations.list().some((i) => i.id === stored)).toBe(true);
  });

  test("removing an unknown id fails loudly", async () => {
    await expect(service.installations.remove("nope")).rejects.toThrow(/isn't available|isn't in your list|weren't found|wasn't found/i);
  });
});
