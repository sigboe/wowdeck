/**
 * The load-time repair of records that share folders (#127): decks that hit
 * the duplicate-listing bug carry two records claiming the same AddOns
 * folders. Loading the installation's records keeps the newest install (and
 * its kept previous version), drops the older ones with theirs, and leaves
 * the addon folders alone.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { WowAddon, WowInstallation } from "../src/wow/models";
import { AddonChannelType, WowClientType } from "../src/wow/types";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeAddon(dir: string, folder: string, version: string): void {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, `${folder}.toc`), `## Title: ${folder}\n## Version: ${version}\n## Interface: 110005\n`);
}

/** A kept previous version in the rollback cache, as an update leaves it. */
function writeKept(addonsPath: string, addonId: string, version: string, folders: string[]): void {
  const kept = join(addonsPath, ".wowdeck", "rollback", addonId);
  for (const folder of folders) {
    writeAddon(kept, folder, version);
  }
  writeFileSync(join(kept, "meta.json"), JSON.stringify({ version, releaseId: null, folders, savedAt: 1 }));
}

function record(fields: Partial<WowAddon> & Pick<WowAddon, "id" | "name" | "installationId">): WowAddon {
  return { channelType: AddonChannelType.Stable, isIgnored: false, isLoadOnDemand: false, ...fields };
}

/** Every file under `dir`, with its content: what "unchanged on disk" compares. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[relative(dir, full)] = readFileSync(full, "utf-8");
      }
    }
  };
  walk(dir);
  return out;
}

function fixture(name: string, seed: (addonsPath: string, installationId: string) => WowAddon[]) {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-repair-${name}-`));
  roots.push(root);
  const installRoot = join(root, "_retail_");
  const addonsPath = join(installRoot, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  const installation: WowInstallation = {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location: installRoot,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const store = createStateStore(root);
  store.setInstallations([installation]);
  store.addons.createMany(seed(addonsPath, installation.id));
  const offline = { downloadToFile: async () => { throw new Error("no network in tests"); } } as unknown as NetworkClient;
  const service = new AddonService(
    store,
    new ProviderRegistry(),
    new DownloadService(offline, join(root, "dl")),
    { addonsChanged: () => {}, operationResult: () => {} },
  );
  const stateFile = () => readFileSync(join(root, "state.json"), "utf-8");
  return { service, installation, addonsPath, store, stateFile };
}

/** Two RestedXP records from two zips: the older one first, both claiming RestedXP and its guides. */
function duplicateRestedXp(addonsPath: string, installationId: string): WowAddon[] {
  writeAddon(addonsPath, "RestedXP", "2.0");
  writeAddon(addonsPath, "RestedXPGuides", "2.0");
  writeKept(addonsPath, "old-rec", "0.9", ["RestedXP"]);
  writeKept(addonsPath, "new-rec", "1.0", ["RestedXP", "RestedXPGuides"]);
  const folders = ["RestedXP", "RestedXPGuides"];
  return [
    record({
      id: "old-rec",
      name: "RestedXP",
      installationId,
      providerName: "Zip",
      externalId: "/home/deck/Downloads/RestedXP-1.0.zip",
      installedVersion: "1.0",
      installedAt: 1_000,
      installedFolderList: ["RestedXP"],
      installedFolders: "RestedXP",
      rollbackVersion: "0.9",
    }),
    record({
      id: "new-rec",
      name: "RestedXP",
      installationId,
      providerName: "Zip",
      externalId: "/home/deck/Downloads/RestedXP-2.0.zip",
      installedVersion: "2.0",
      installedAt: 2_000,
      installedFolderList: folders,
      installedFolders: folders.join(", "),
      rollbackVersion: "1.0",
    }),
  ];
}

const storedIds = (f: ReturnType<typeof fixture>) =>
  f.store.addons.forInstallation(f.installation.id).map((r) => r.id);

describe("repair of records that share folders (#127)", () => {
  test("two records sharing folders load as one: the newest install's", async () => {
    const f = fixture("dup", duplicateRestedXp);
    const listed = await f.service.listAddons(f.installation);
    expect(storedIds(f)).toEqual(["new-rec"]);
    const restedXp = listed.filter((a) => a.name === "RestedXP");
    expect(restedXp).toHaveLength(1);
    expect(restedXp[0]).toMatchObject({ id: "new-rec", version: "2.0", previousVersion: "1.0" });
  });

  test("the survivor still rolls back; the dropped record's kept version is gone", async () => {
    const f = fixture("rollback", duplicateRestedXp);
    await f.service.listAddons(f.installation);
    expect(existsSync(join(f.addonsPath, ".wowdeck", "rollback", "old-rec"))).toBe(false);
    expect(existsSync(join(f.addonsPath, ".wowdeck", "rollback", "new-rec", "meta.json"))).toBe(true);

    const back = await f.service.rollback("new-rec");
    expect(back.operation.status).toBe("installed");
    expect(back.addon).toMatchObject({ version: "1.0", previousVersion: "2.0" });
    expect(readFileSync(join(f.addonsPath, "RestedXP", "RestedXP.toc"), "utf-8")).toContain("1.0");
  });

  test("addon folders on disk are unchanged by the repair", async () => {
    const f = fixture("folders", duplicateRestedXp);
    const before = { xp: snapshot(join(f.addonsPath, "RestedXP")), guides: snapshot(join(f.addonsPath, "RestedXPGuides")) };
    await f.service.listAddons(f.installation);
    expect(snapshot(join(f.addonsPath, "RestedXP"))).toEqual(before.xp);
    expect(snapshot(join(f.addonsPath, "RestedXPGuides"))).toEqual(before.guides);
  });

  test("records that share no folders are untouched, and a second load is a no-op", async () => {
    const f = fixture("noop", (addonsPath, installationId) => {
      const records = duplicateRestedXp(addonsPath, installationId);
      writeAddon(addonsPath, "Details", "3.0");
      writeKept(addonsPath, "details-rec", "2.9", ["Details"]);
      return [
        ...records,
        record({
          id: "details-rec",
          name: "Details",
          installationId,
          providerName: "Zip",
          externalId: "/home/deck/Downloads/Details.zip",
          installedVersion: "3.0",
          installedAt: 500,
          installedFolderList: ["Details"],
          installedFolders: "Details",
          rollbackVersion: "2.9",
        }),
      ];
    });
    const detailsBefore = JSON.stringify(f.store.addons.get("details-rec"));
    await f.service.listAddons(f.installation);
    expect(JSON.stringify(f.store.addons.get("details-rec"))).toBe(detailsBefore);
    expect(existsSync(join(f.addonsPath, ".wowdeck", "rollback", "details-rec", "meta.json"))).toBe(true);

    const afterFirst = f.stateFile();
    const disk = snapshot(f.addonsPath);
    await f.service.listAddons(f.installation);
    expect(f.stateFile()).toBe(afterFirst);
    expect(snapshot(f.addonsPath)).toEqual(disk);
  });

  test("the repair logs one structured line per dropped record, without paths", async () => {
    const f = fixture("log", (addonsPath, installationId) => {
      const records = duplicateRestedXp(addonsPath, installationId);
      return [...records, record({ ...records[0]!, id: "oldest-rec", installedAt: 10, rollbackVersion: undefined })];
    });
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      await f.service.listAddons(f.installation);
      await f.service.listAddons(f.installation);
    } finally {
      console.error = original;
    }
    const repairs = logged.filter((line) => line.startsWith("[repair]"));
    expect(repairs).toHaveLength(2);
    expect(repairs.some((line) => line.includes("old-rec") && line.includes("new-rec"))).toBe(true);
    expect(repairs.some((line) => line.includes("oldest-rec") && line.includes("new-rec"))).toBe(true);
    expect(repairs.every((line) => !line.includes("/"))).toBe(true);
    expect(storedIds(f)).toEqual(["new-rec"]);
  });

  test("catalogue records sharing an embedded library folder are untouched", async () => {
    const f = fixture("catalogue", (addonsPath, installationId) => {
      writeAddon(addonsPath, "Details", "3.0");
      writeAddon(addonsPath, "Plater", "5.0");
      writeAddon(addonsPath, "LibSharedMedia-3.0", "1.0");
      const lib = (id: string, name: string, folder: string, installedAt: number) =>
        record({
          id,
          name,
          installationId,
          providerName: "Curse",
          externalId: `${id}-curse`,
          installedAt,
          installedFolderList: [folder, "LibSharedMedia-3.0"],
          installedFolders: `${folder}, LibSharedMedia-3.0`,
        });
      return [lib("details-rec", "Details", "Details", 1_000), lib("plater-rec", "Plater", "Plater", 2_000)];
    });
    await f.service.listAddons(f.installation);
    expect(storedIds(f).sort()).toEqual(["details-rec", "plater-rec"]);
  });

  test("a record that shares a folder only with a dropped record is kept", async () => {
    const f = fixture("chain", (addonsPath, installationId) => {
      for (const folder of ["A", "B", "C"]) {
        writeAddon(addonsPath, folder, "1.0");
      }
      const zip = (id: string, folders: string[], installedAt: number) =>
        record({
          id,
          name: id,
          installationId,
          providerName: "Zip",
          externalId: `/home/deck/Downloads/${id}.zip`,
          installedAt,
          installedFolderList: folders,
          installedFolders: folders.join(", "),
        });
      // oldest shares A with middle; middle shares B with newest; oldest and newest share nothing.
      return [zip("oldest", ["A"], 1_000), zip("middle", ["A", "B"], 2_000), zip("newest", ["B", "C"], 3_000)];
    });
    await f.service.listAddons(f.installation);
    expect(storedIds(f).sort()).toEqual(["newest", "oldest"]);
  });
});
