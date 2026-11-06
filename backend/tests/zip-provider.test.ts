/**
 * Install from a direct archive link (WF-09): URL dispatch, the install
 * itself through the real installer, and what the record looks like after
 * (never an update, never "gone from its source").
 */

import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identifyUrlImportProvider } from "../src/wow/providers/url-import";
import { ZipProvider, parseArchiveUrl } from "../src/wow/providers/zip/ZipProvider";
import { AddonService } from "../src/wow/addons/AddonService";
import { Catalogue } from "../src/wow/catalogue/Catalogue";
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
    operationResult: () => {},
  });
  const catalogue = new Catalogue(registry);
  return { service, catalogue, store, registry, installation, downloads, addonsPath: join(location, "Interface", "AddOns") };
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
    const result = await f.catalogue.resolveUrlImport(`  ${RAR_URL}  `, f.installation);
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

describe("a changed link updates the addon it matches", () => {
  const NEWER_URL = "https://addons.example.org/files/Foo-1.3.zip";
  const fooNewer = zipSync({
    "Foo/Foo.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Addon\n## Version: 1.3\n"),
    "Foo/Foo.lua": new TextEncoder().encode("print(2)\n"),
  });

  test("a link whose archive installs a folder one record owns updates that record, downloading once", async () => {
    const f = fixture("match", { [ZIP_URL]: fooZip, [NEWER_URL]: fooNewer });
    const { addon: first } = await f.service.install({ intent: "install", providerId: "Zip", externalId: ZIP_URL, installation: f.installation });
    const { operation, addon } = await f.service.install({ intent: "install", providerId: "Zip", externalId: NEWER_URL, installation: f.installation });
    expect(operation.status).toBe("installed");
    expect(addon.id).toBe(first.id);
    const listed = await f.service.listAddons(f.installation);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.id, version: "1.3", externalId: NEWER_URL, previousVersion: "1.2" });
    expect(f.downloads).toEqual([ZIP_URL, NEWER_URL]);

    await f.service.rollback(addon.id);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("print(1)");
  });
});

describe("a link whose archive matches several addons", () => {
  const BAR_URL = "https://addons.example.org/files/Bar-3.0.zip";
  const BOTH_URL = "https://addons.example.org/files/FooBar-2.0.zip";
  const barZip = zipSync({
    "Bar/Bar.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Bar Addon\n## Version: 3.0\n"),
    "Bar/Bar.lua": new TextEncoder().encode("print(3)\n"),
  });
  const bothZip = zipSync({
    "Foo/Foo.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Bar\n## Version: 2.0\n"),
    "Foo/Foo.lua": new TextEncoder().encode("print(20)\n"),
    "Bar/Bar.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Bar\n## Version: 2.0\n"),
    "Bar/Bar.lua": new TextEncoder().encode("print(20)\n"),
  });

  test("reusing a link still refuses a conflict without changing records or files", async () => {
    const files = { [ZIP_URL]: fooZip, [BAR_URL]: barZip };
    const f = fixture("conflict-reused-link", files);
    const install = (url: string) => f.service.install({ intent: "install", providerId: "Zip", externalId: url, installation: f.installation });
    await install(ZIP_URL);
    await install(BAR_URL);
    const recordsBefore = structuredClone(f.store.addons.all());
    files[ZIP_URL] = bothZip;
    await expect(install(ZIP_URL)).rejects.toThrow("This file matches 2 installed addons");
    expect(f.store.addons.all()).toEqual(recordsBefore);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toBe("print(1)\n");
    expect(readFileSync(join(f.addonsPath, "Bar", "Bar.lua"), "utf8")).toBe("print(3)\n");
  });

  test("the install is refused with an error naming both addons, and nothing on disk changes", async () => {
    const f = fixture("conflict", { [ZIP_URL]: fooZip, [BAR_URL]: barZip, [BOTH_URL]: bothZip });
    const install = (url: string) => f.service.install({ intent: "install", providerId: "Zip", externalId: url, installation: f.installation });
    await install(ZIP_URL);
    await install(BAR_URL);
    const recordsBefore = f.store.addons.all();

    await expect(install(BOTH_URL)).rejects.toThrow("This file matches 2 installed addons (Foo Addon and Bar Addon)");

    expect(f.store.addons.all()).toEqual(recordsBefore);
    expect(readdirSync(f.addonsPath).sort()).toEqual(["Bar", "Foo"]);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toBe("print(1)\n");
    expect(readFileSync(join(f.addonsPath, "Bar", "Bar.lua"), "utf8")).toBe("print(3)\n");
  });
});

describe("a link whose archive changed", () => {
  const OLDER_URL = "https://addons.example.org/files/Foo-1.1.zip";
  const release = (version: string) =>
    zipSync({
      "Foo/Foo.toc": new TextEncoder().encode(`## Interface: 110005\n## Title: Foo Addon\n## Version: ${version}\n`),
      "Foo/Foo.lua": new TextEncoder().encode(`-- ${version}\n`),
    });

  test("installing the same link again with new content keeps the replaced files for Roll back", async () => {
    const files: Record<string, Uint8Array> = { [OLDER_URL]: release("1.1"), [ZIP_URL]: release("1.2") };
    const f = fixture("changed", files);
    const install = (url: string) => f.service.install({ intent: "install", providerId: "Zip", externalId: url, installation: f.installation });
    await install(OLDER_URL);
    await install(ZIP_URL);

    // The host now serves a newer build at the same link.
    files[ZIP_URL] = release("1.3");
    const { addon } = await install(ZIP_URL);
    expect(addon).toMatchObject({ version: "1.3", previousVersion: "1.2" });
    await f.service.rollback(addon.id);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("1.2");
  });
});
