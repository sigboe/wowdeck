/**
 * Install from a direct archive link (WF-09): URL dispatch, the install
 * itself through the real installer, and what the record looks like after
 * (never an update, never "gone from its source").
 */

import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identifyUrlImportProvider } from "../src/wow/providers/url-import";
import { ZipProvider, parseArchiveUrl } from "../src/wow/providers/zip/ZipProvider";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { NetworkClient } from "../src/wow/net/network";
import { createStateStore } from "../src/wow/storage/StateStore";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";

const ROOT = "/tmp/opencode/wowdeck-tests/zip-provider";
const FIXTURES = join(import.meta.dir, "fixtures", "archives");
const hasRarTool = !!Bun.which("unrar") || ["7zz", "7z"].some(
  (c) => !!Bun.which(c) && /\b40305 Rar5\b/.test(Bun.spawnSync([c, "i"], { stderr: "ignore" }).stdout.toString()),
);

const ZIP_URL = "https://addons.example.org/files/Foo-1.2.zip";
const RAR_URL = "https://cdn.example.net/RXPGuides-v4.11.26.rar";

/** Serves each link's bytes; counts downloads. */
function fakeNet(files: Record<string, Uint8Array>) {
  const downloads: string[] = [];
  const net = {
    downloadToFile: async (url: string, dest: string) => {
      downloads.push(url);
      const bytes = files[url];
      if (!bytes) {
        throw new Error(`unexpected download ${url}`);
      }
      writeFileSync(dest, bytes);
      return bytes.length;
    },
  } as unknown as NetworkClient;
  return { net, downloads };
}

function fixture(dir: string, files: Record<string, Uint8Array>) {
  const root = join(ROOT, dir);
  rmSync(root, { recursive: true, force: true });
  const location = join(root, "_retail_");
  mkdirSync(join(location, "Interface", "AddOns"), { recursive: true });
  const installation: WowInstallation = {
    id: "inst",
    clientType: WowClientType.Retail,
    location,
    label: "_retail_",
    displayName: "Retail",
    selected: true,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const store = createStateStore(join(root, "state"));
  store.setInstallations([installation]);
  const registry = new ProviderRegistry();
  registry.register(new ZipProvider());
  registry.attachStore(store);
  const { net, downloads } = fakeNet(files);
  const service = new AddonService(store, registry, new DownloadService(net, join(root, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  return { service, store, registry, installation, downloads, addonsPath: join(location, "Interface", "AddOns") };
}

const fooZip = zipSync({
  "Foo/Foo.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Addon\n## Version: 1.2\n## Author: Someone\n"),
  "Foo/Foo.lua": new TextEncoder().encode("print(1)\n"),
});

describe("direct archive links (WF-09)", () => {
  test("which addresses are direct links", () => {
    expect(identifyUrlImportProvider(ZIP_URL)).toBe("Zip");
    expect(identifyUrlImportProvider(RAR_URL)).toBe("Zip");
    expect(identifyUrlImportProvider("https://x.example/a/Addon.7z?token=1")).toBe("Zip");
    expect(identifyUrlImportProvider("addons.example.org/Foo.ZIP")).toBe("Zip"); // no scheme typed
    // A release asset on GitHub stays GitHub's, which tracks its updates.
    expect(identifyUrlImportProvider("https://github.com/o/r/releases/download/v1/r.zip")).toBe("GitHub");
    expect(identifyUrlImportProvider("http://addons.example.org/Foo.zip")).toBeNull(); // https only
    expect(identifyUrlImportProvider("https://addons.example.org/Foo.tar.gz")).toBeNull();
    expect(identifyUrlImportProvider("https://addons.example.org/download?file=Foo.zip")).toBeNull();
  });

  test("an addon id is exactly a link the provider made", () => {
    const zip = new ZipProvider();
    expect(zip.isValidAddonId(parseArchiveUrl(ZIP_URL)!.toString())).toBe(true);
    expect(zip.isValidAddonId("http://addons.example.org/Foo.zip")).toBe(false);
    expect(zip.isValidAddonId("addons.example.org/Foo.zip")).toBe(false);
    expect(zip.isValidAddonId("12345")).toBe(false);
  });

  test("Look up shows the file and the host it comes from, without downloading", async () => {
    const f = fixture("lookup", {});
    const result = await f.service.resolveUrlImport(`  ${RAR_URL}  `, f.installation);
    expect(result).toMatchObject({
      providerId: "Zip",
      externalId: RAR_URL,
      name: "RXPGuides-v4.11.26.rar",
      author: "cdn.example.net",
      websiteUrl: null,
    });
    expect(f.downloads).toEqual([]);
  });

  test("is not a source people turn on or off, nor part of the name search", () => {
    const f = fixture("infos", {});
    expect(f.registry.providerInfos()).toEqual([
      expect.objectContaining({ id: "Zip", name: "Direct link", allowEdit: false, catalogSearch: false, available: true }),
    ]);
  });

  test("installs a zip, named from its TOC, with no update and no reinstall", async () => {
    const f = fixture("zip", { [ZIP_URL]: fooZip });
    const { operation } = await f.service.install({ intent: "install", providerId: "Zip", externalId: ZIP_URL, installation: f.installation });
    expect(operation.status).toBe("installed");
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toContain("Foo Addon");

    const [addon] = await f.service.listAddons(f.installation);
    expect(addon).toMatchObject({
      name: "Foo Addon",
      version: "1.2",
      author: "Someone",
      providerId: "Zip",
      externalId: ZIP_URL,
      updateAvailable: false,
      ignored: false,
      canReinstall: false,
      sourceOff: false,
      problem: null,
    });
  });

  test("an update check never asks about it, so it is never 'gone from its source'", async () => {
    const f = fixture("refresh", { [ZIP_URL]: fooZip });
    const { addon } = await f.service.install({ intent: "install", providerId: "Zip", externalId: ZIP_URL, installation: f.installation });
    await f.service.refresh(f.installation);
    const [listed] = await f.service.listAddons(f.installation);
    expect(listed!.problem).toBeNull();
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
    expect(f.store.addons.all().find((a) => a.id === addon.id)!.warningType).toBeUndefined();
    expect(f.downloads).toEqual([ZIP_URL]);
  });

  test("a link that serves a web page fails with what it is, and changes nothing", async () => {
    const f = fixture("html", { [ZIP_URL]: new TextEncoder().encode("<!doctype html><p>Click to download</p>") });
    const { operation } = await f.service.install({ intent: "install", providerId: "Zip", externalId: ZIP_URL, installation: f.installation });
    expect(operation.status).toBe("failed");
    expect(operation.error).toMatch(/isn't a zip, RAR or 7z archive/);
    expect(await f.service.listAddons(f.installation)).toEqual([]);
  });

  test.skipIf(!hasRarTool)("installs a RAR packed like RestedXP Guides", async () => {
    const f = fixture("rar", { [RAR_URL]: readFileSync(join(FIXTURES, "rar5-addon.rar")) });
    const { operation } = await f.service.install({ intent: "install", providerId: "Zip", externalId: RAR_URL, installation: f.installation });
    expect(operation.status).toBe("installed");
    expect(existsSync(join(f.addonsPath, "RXPLite", "libs", "HereBeDragons", "HereBeDragons.toc"))).toBe(true);
    const [addon] = await f.service.listAddons(f.installation);
    expect(addon).toMatchObject({ name: "RXP Lite", version: "4.11.26", folderName: "RXPLite", updateAvailable: false });
  });
});
