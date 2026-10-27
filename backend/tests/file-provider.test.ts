/**
 * Manual Install's From a file: inspecting a picked archive and installing
 * it through the real installer, with the same never-update semantics as
 * the Zip (direct link) provider — the provider this one deliberately
 * mirrors. Local files only: any network call fails the test.
 */

import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { FileProvider } from "../src/wow/providers/file/FileProvider";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { NetworkClient } from "../src/wow/net/network";
import { createStateStore } from "../src/wow/storage/StateStore";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";

const ROOT = "/tmp/opencode/wowdeck-tests/file-provider";
const FIXTURES = join(import.meta.dir, "fixtures", "archives");
const hasRarTool = !!Bun.which("unrar") || ["7zz", "7z"].some(
  (c) => !!Bun.which(c) && /\b40305 Rar5\b/.test(Bun.spawnSync([c, "i"], { stderr: "ignore" }).stdout.toString()),
);
const has7zTool = ["7zz", "7z", "7za"].some((c) => !!Bun.which(c));

const fooZip = zipSync({
  "Foo/Foo.toc": new TextEncoder().encode(
    "## Interface: 110005\n## Title: Foo Addon\n## Version: 1.2\n## Author: Someone\n",
  ),
  "Foo/Foo.lua": new TextEncoder().encode("print(1)\n"),
});

/** A bundled distribution: two addon folders in one archive. */
const bundleZip = zipSync({
  "Bar/Bar.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Bar Suite\n## Version: 3.0\n"),
  "BarLib/BarLib.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Bar Library\n## Version: 3.0\n"),
});

/** No folder with a TOC at the top level: nothing installable. */
const noAddonZip = zipSync({
  "README.md": new TextEncoder().encode("readme\n"),
});

/**
 * A top-level folder that is no addon folder: the install refuses such an
 * archive (every installed folder needs a TOC), so the preview must refuse
 * it first rather than promise folders it cannot deliver.
 */
const mixedZip = zipSync({
  "Foo/Foo.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Addon\n## Version: 1.2\n"),
  "Docs/readme.txt": new TextEncoder().encode("readme\n"),
});

function fixture(dir: string, files: Record<string, Uint8Array>) {
  const root = join(ROOT, dir);
  rmSync(root, { recursive: true, force: true });
  const location = join(root, "_retail_");
  mkdirSync(join(location, "Interface", "AddOns"), { recursive: true });
  const archives = join(root, "archives");
  mkdirSync(archives, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(archives, name), bytes);
  }
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
  registry.register(new FileProvider());
  registry.attachStore(store);
  // No network is ever involved; a net that throws says so loudly.
  const net = {
    downloadToFile: async (url: string) => {
      throw new Error(`unexpected network download ${url}`);
    },
  } as unknown as NetworkClient;
  const service = new AddonService(
    store,
    registry,
    new DownloadService(net, join(root, "dl")),
    {
      addonsChanged: () => {},
      operationProgress: () => {},
      operationResult: () => {},
    },
    undefined,
    join(root, "inspect"),
  );
  return {
    service,
    store,
    registry,
    installation,
    archivePath: (name: string) => realpathSync(join(archives, name)),
    inspectRoot: join(root, "inspect"),
    addonsPath: join(location, "Interface", "AddOns"),
  };
}

describe("the File provider (Manual Install, From a file)", () => {
  test("is not a source people turn on or off, nor part of the name search, and never checks for updates", () => {
    const f = fixture("infos", {});
    expect(f.registry.get("File")!.getAll).toBeUndefined();
    expect(f.registry.providerInfos()).toEqual([
      expect.objectContaining({
        id: "File",
        name: "Local file",
        allowEdit: false,
        catalogSearch: false,
        available: true,
      }),
    ]);
  });

  test("an addon id is a supported archive path, and nothing else", () => {
    const file = new FileProvider();
    expect(file.isValidAddonId("/home/deck/Downloads/Foo.zip")).toBe(true);
    expect(file.isValidAddonId("/home/deck/Downloads/Foo.RAR")).toBe(true);
    expect(file.isValidAddonId("/home/deck/Downloads/Foo.7z")).toBe(true);
    expect(file.isValidAddonId("/home/deck/Downloads/Foo.tar.gz")).toBe(false);
    expect(file.isValidAddonId("https://example.org/Foo.zip")).toBe(false);
    expect(file.isValidAddonId("")).toBe(false);
  });
});

describe("AddonService.inspectArchive", () => {
  test("previews the archive: TOC name, author, version and the folders it installs", async () => {
    const f = fixture("inspect", { "Foo-1.2.zip": fooZip });
    const path = f.archivePath("Foo-1.2.zip");
    const preview = await f.service.inspectArchive(path, f.installation);
    expect(preview).toEqual({
      fileName: "Foo-1.2.zip",
      name: "Foo Addon",
      author: "Someone",
      version: "1.2",
      folders: ["Foo"],
      providerId: "File",
      externalId: path,
    });
  });

  test("answers the canonical path however the file was reached", async () => {
    const f = fixture("canonical", { "Foo-1.2.zip": fooZip });
    const viaSymlink = join(ROOT, "canonical", "linked.zip");
    rmSync(viaSymlink, { force: true });
    await symlink(join(ROOT, "canonical", "archives", "Foo-1.2.zip"), viaSymlink);
    const preview = await f.service.inspectArchive(viaSymlink, f.installation);
    expect(preview.externalId).toBe(f.archivePath("Foo-1.2.zip"));
  });

  test("a bundled distribution lists every addon folder it installs", async () => {
    const f = fixture("bundle", { "Bar-3.0.zip": bundleZip });
    const preview = await f.service.inspectArchive(f.archivePath("Bar-3.0.zip"), f.installation);
    expect(preview.folders).toEqual(["Bar", "BarLib"]);
    expect(preview.name).toBe("Bar Suite");
  });

  test("an archive without addon folders says so", async () => {
    const f = fixture("no-addons", { "readme.zip": noAddonZip });
    await expect(f.service.inspectArchive(f.archivePath("readme.zip"), f.installation)).rejects.toMatchObject({
      code: "archive_no_addons",
    });
  });

  test("a top-level folder without a TOC is refused here, as the install would refuse it", async () => {
    const f = fixture("mixed", { "mixed.zip": mixedZip });
    await expect(f.service.inspectArchive(f.archivePath("mixed.zip"), f.installation)).rejects.toMatchObject({
      code: "archive_no_addons",
    });
  });

  test("a file with a supported extension that is no archive at all says so", async () => {
    const f = fixture("html", { "page.zip": new TextEncoder().encode("<!doctype html><p>Click to download</p>") });
    await expect(f.service.inspectArchive(f.archivePath("page.zip"), f.installation)).rejects.toMatchObject({
      code: "archive_not_supported",
    });
  });

  test("a missing or moved file fails with what it is", async () => {
    const f = fixture("missing", {});
    await expect(f.service.inspectArchive("/home/deck/Downloads/nope.zip", f.installation)).rejects.toMatchObject({
      code: "archive_unreadable",
    });
  });

  test("a path that is not a supported archive extension is refused", async () => {
    const f = fixture("ext", { "Foo.tar.gz": fooZip });
    await expect(f.service.inspectArchive(f.archivePath("Foo.tar.gz"), f.installation)).rejects.toMatchObject({
      code: "archive_not_supported",
    });
  });

  test("an empty input is invalid, not unreadable", async () => {
    const f = fixture("blank", {});
    await expect(f.service.inspectArchive("  ", f.installation)).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  test.skipIf(!hasRarTool)("previews a RAR packed like RestedXP Guides", async () => {
    const f = fixture("rar", {});
    writeFileSync(join(ROOT, "rar", "archives", "RXPGuides.rar"), readFileSync(join(FIXTURES, "rar5-addon.rar")));
    const preview = await f.service.inspectArchive(f.archivePath("RXPGuides.rar"), f.installation);
    expect(preview.name).toBe("RXP Lite");
    // The library is nested inside the one top-level addon folder, so the
    // archive installs a single folder (the extractor fixture's own shape).
    expect(preview.folders).toEqual(["RXPLite"]);
  });

  test.skipIf(!has7zTool)("previews a 7z with the host tool", async () => {
    const f = fixture("sevenzip", {});
    writeFileSync(join(ROOT, "sevenzip", "archives", "RXPLite.7z"), readFileSync(join(FIXTURES, "addon.7z")));
    const preview = await f.service.inspectArchive(f.archivePath("RXPLite.7z"), f.installation);
    expect(preview.name).toBe("RXP Lite");
    expect(preview.folders).toEqual(["RXPLite"]);
  });

  test("leaves no inspection leftovers behind", async () => {
    const f = fixture("cleanup", { "Foo-1.2.zip": fooZip });
    await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(Array.from(new Bun.Glob("inspect-*").scanSync({ cwd: f.inspectRoot }))).toEqual([]);
  });
});

describe("installing a local archive", () => {
  test("installs through the transactional installer, named from its TOC, with no update and no reinstall", async () => {
    const f = fixture("zip", { "Foo-1.2.zip": fooZip });
    const path = f.archivePath("Foo-1.2.zip");
    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: path,
      installation: f.installation,
    });
    expect(operation.status).toBe("installed");
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toContain("Foo Addon");

    const [addon] = await f.service.listAddons(f.installation);
    expect(addon).toMatchObject({
      name: "Foo Addon",
      version: "1.2",
      author: "Someone",
      providerId: "File",
      externalId: path,
      updateAvailable: false,
      ignored: false,
      canReinstall: false,
      canChangeChannel: false,
      sourceOff: false,
      problem: null,
    });
  });

  test("installs every folder of a bundled distribution in one pass", async () => {
    const f = fixture("bundle-install", { "Bar-3.0.zip": bundleZip });
    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("Bar-3.0.zip"),
      installation: f.installation,
    });
    expect(operation.status).toBe("installed");
    expect(existsSync(join(f.addonsPath, "Bar", "Bar.toc"))).toBe(true);
    expect(existsSync(join(f.addonsPath, "BarLib", "BarLib.toc"))).toBe(true);
  });

  test("an update check never asks about it, so it is never 'gone from its source'", async () => {
    const f = fixture("refresh", { "Foo-1.2.zip": fooZip });
    await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("Foo-1.2.zip"),
      installation: f.installation,
    });
    await f.service.refresh(f.installation);
    const [listed] = await f.service.listAddons(f.installation);
    expect(listed!.problem).toBeNull();
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
  });

  test("a file deleted after the preview fails with a clear error and installs nothing", async () => {
    const f = fixture("deleted", { "Foo-1.2.zip": fooZip });
    const path = f.archivePath("Foo-1.2.zip");
    await f.service.inspectArchive(path, f.installation);
    rmSync(path);
    await expect(
      f.service.install({ intent: "install", providerId: "File", externalId: path, installation: f.installation }),
    ).rejects.toThrow(/missing/i);
    expect(await f.service.listAddons(f.installation)).toEqual([]);
  });

  test("a re-install over the installed addon replaces it through the same swap", async () => {
    const f = fixture("reinstall", { "Foo-1.2.zip": fooZip });
    const path = f.archivePath("Foo-1.2.zip");
    await f.service.install({ intent: "install", providerId: "File", externalId: path, installation: f.installation });
    writeFileSync(
      path,
      zipSync({
        "Foo/Foo.toc": new TextEncoder().encode(
          "## Interface: 110005\n## Title: Foo Addon\n## Version: 1.3\n## Author: Someone\n",
        ),
      }),
    );
    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: path,
      installation: f.installation,
    });
    expect(operation.status).toBe("installed");
    const [addon] = await f.service.listAddons(f.installation);
    expect(addon!.version).toBe("1.3");
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toContain("1.3");
  });

  test("a corrupt archive fails the operation and installs nothing", async () => {
    const f = fixture("corrupt", { "page.zip": new TextEncoder().encode("<!doctype html><p>Click to download</p>") });
    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("page.zip"),
      installation: f.installation,
    });
    expect(operation.status).toBe("failed");
    expect(operation.error).toMatch(/isn't a zip, RAR or 7z archive/i);
    expect(await f.service.listAddons(f.installation)).toEqual([]);
    expect(readdirSync(f.addonsPath)).toEqual([]);
  });

  test("an archive with no addon folders fails the install", async () => {
    const f = fixture("no-addons-install", { "readme.zip": noAddonZip });
    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("readme.zip"),
      installation: f.installation,
    });
    expect(operation.status).toBe("failed");
    expect(operation.error).toMatch(/doesn't contain an addon/i);
    expect(await f.service.listAddons(f.installation)).toEqual([]);
    expect(readdirSync(f.addonsPath)).toEqual([]);
  });
});
