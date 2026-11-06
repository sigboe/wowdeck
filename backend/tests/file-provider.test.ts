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
import { AddonProvider } from "../src/wow/providers/addon-provider";
import type { AddonProviderType } from "../src/wow/types";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { NetworkClient } from "../src/wow/net/network";
import { createStateStore } from "../src/wow/storage/StateStore";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";
import {
  addonAndDocsZip,
  emptyTocZip,
  failTocReads,
  genericAndMainlineZip,
  looseFileZip,
  mixedCaseTocZip,
  nestedOnlyTocZip,
  orderBundleZip,
  otherClientTocZip,
  tocNamedDirectoryZip,
  upperCaseTocZip,
} from "./helpers/addon-folder-archives";

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

const installFile = (f: ReturnType<typeof fixture>, name: string) =>
  f.service.install({ intent: "install", providerId: "File", externalId: f.archivePath(name), installation: f.installation });

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
      match: { kind: "new" },
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

describe("the Addon folder rule, preview and install on the same archives", () => {
  const accepted: Array<[string, Uint8Array, string]> = [
    ["an uppercase .TOC", upperCaseTocZip, "Foo Upper"],
    ["a mixed-case .Toc", mixedCaseTocZip, "Foo Mixed"],
  ];
  const rejected: Array<[string, Uint8Array]> = [
    ["no folder at all", looseFileZip],
    ["a folder whose only TOC is nested deeper", nestedOnlyTocZip],
    ["a directory named like a TOC", tocNamedDirectoryZip],
    ["an addon folder next to one without a TOC", addonAndDocsZip],
  ];

  for (const [label, zip, title] of accepted) {
    test(`${label}: both the preview and the install accept the folder`, async () => {
      const f = fixture(`rule-accept-${title.replace(/\W/g, "")}`, { "a.zip": zip });
      const path = f.archivePath("a.zip");
      const preview = await f.service.inspectArchive(path, f.installation);
      expect(preview).toMatchObject({ name: title, folders: ["Foo"] });
      const { operation } = await f.service.install({
        intent: "install",
        providerId: "File",
        externalId: path,
        installation: f.installation,
      });
      expect(operation.status).toBe("installed");
      expect(readdirSync(f.addonsPath)).toEqual(["Foo"]);
    });
  }

  for (const [label, zip] of rejected) {
    test(`${label}: the preview refuses it and the install refuses it, leaving AddOns untouched`, async () => {
      const f = fixture(`rule-reject-${label.replace(/\W+/g, "-")}`, { "a.zip": zip });
      const path = f.archivePath("a.zip");
      await expect(f.service.inspectArchive(path, f.installation)).rejects.toMatchObject({
        code: "archive_no_addons",
      });
      const { operation } = await f.service.install({
        intent: "install",
        providerId: "File",
        externalId: path,
        installation: f.installation,
      });
      expect(operation.status).toBe("failed");
      expect(operation.error).toMatch(/valid addon|contain an addon/);
      expect(readdirSync(f.addonsPath)).toEqual([]);
      expect(Array.from(new Bun.Glob("inspect-*").scanSync({ cwd: f.inspectRoot }))).toEqual([]);
    });
  }

  test("the two refusals keep their own wording: no addon folders vs a selected folder with no TOC", async () => {
    const f = fixture("rule-wording", { "none.zip": looseFileZip, "docs.zip": addonAndDocsZip });
    await expect(f.service.inspectArchive(f.archivePath("none.zip"), f.installation)).rejects.toThrow(
      "That archive doesn't contain any WoW addon folders",
    );
    await expect(f.service.inspectArchive(f.archivePath("docs.zip"), f.installation)).rejects.toThrow(
      "That archive contains folders that aren't WoW addon folders (no .toc inside Docs)",
    );
    const failure = async (name: string) =>
      (
        await f.service.install({
          intent: "install",
          providerId: "File",
          externalId: f.archivePath(name),
          installation: f.installation,
        })
      ).operation.error;
    expect(await failure("none.zip")).toContain("The archive doesn't contain an addon");
    expect(await failure("docs.zip")).toContain("The archive doesn't contain a valid addon");
  });
});

describe("TOC metadata, preview and install on the same archives", () => {
  test("an empty TOC passes the structure check; the preview names it after the file, the install after the folder", async () => {
    const f = fixture("toc-empty", { "Foo-1.2.zip": emptyTocZip });
    const preview = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(preview).toMatchObject({ name: "Foo-1.2", author: null, version: null, folders: ["Foo"] });
    expect((await installFile(f, "Foo-1.2.zip")).operation.status).toBe("installed");
    expect(readdirSync(f.addonsPath)).toEqual(["Foo"]);
    const [addon] = await f.service.listAddons(f.installation);
    // The install has no file-name fallback: its last resort is the folder name.
    expect(addon).toMatchObject({ name: "Foo", author: null, version: "" });
  });

  test("a TOC meant for another client is still read: no compatibility check, first-TOC fallback", async () => {
    const f = fixture("toc-other-client", { "Foo-1.2.zip": otherClientTocZip });
    const preview = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(preview).toMatchObject({ name: "Foo Classic", version: "1.0", folders: ["Foo"] });
    expect((await installFile(f, "Foo-1.2.zip")).operation.status).toBe("installed");
    const [addon] = await f.service.listAddons(f.installation);
    expect(addon).toMatchObject({ name: "Foo Classic", version: "1.0" });
  });

  test("a client-specific TOC beats the generic one in the preview and in the installed record", async () => {
    const f = fixture("toc-priority", { "Foo-1.2.zip": genericAndMainlineZip });
    const preview = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(preview).toMatchObject({ name: "Foo Mainline", author: "Mainline Author", version: "2.0" });
    await installFile(f, "Foo-1.2.zip");
    const [addon] = await f.service.listAddons(f.installation);
    expect(addon).toMatchObject({ name: "Foo Mainline", author: "Mainline Author", version: "2.0" });
  });

  test("a bundle's preview lists its folders sorted and takes its metadata from the first of them", async () => {
    const f = fixture("toc-bundle-order", { "Bundle.zip": orderBundleZip });
    const preview = await f.service.inspectArchive(f.archivePath("Bundle.zip"), f.installation);
    expect(preview).toMatchObject({
      folders: ["Alpha", "Zeta"],
      name: "Alpha Suite",
      author: "Alpha Author",
      version: "1.0",
    });
  });

  test("a TOC that cannot be read fails the preview, even when another folder's TOC reads fine", async () => {
    const f = fixture("toc-read-fails", { "Bundle.zip": orderBundleZip });
    const restore = failTocReads("Zeta/Zeta.toc");
    try {
      await expect(f.service.inspectArchive(f.archivePath("Bundle.zip"), f.installation)).rejects.toThrow(
        "TOC read failed",
      );
    } finally {
      restore();
    }
    expect(Array.from(new Bun.Glob("inspect-*").scanSync({ cwd: f.inspectRoot }))).toEqual([]);
  });

  test("the same unreadable TOC does not stop the install, which keeps no metadata from the read", async () => {
    const f = fixture("toc-read-fails-install", { "Bundle.zip": orderBundleZip });
    const restore = failTocReads("Zeta/Zeta.toc");
    try {
      const { operation } = await installFile(f, "Bundle.zip");
      expect(operation.status).toBe("installed");
    } finally {
      restore();
    }
    expect(readdirSync(f.addonsPath).sort()).toEqual(["Alpha", "Zeta"]);
    const [addon] = await f.service.listAddons(f.installation);
    expect(addon!.author).toBeNull();
    expect(addon!.name).not.toMatch(/Suite/);
  });
});

/** A Foo release as its own archive: the TOC's version and title, and the folders it ships. */
function fooRelease(version: string, opts: { title?: string; folders?: string[] } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of opts.folders ?? ["Foo"]) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
      `## Interface: 110005\n## Title: ${opts.title ?? "Foo Addon"}\n## Version: ${version}\n`,
    );
    files[`${folder}/${folder}.lua`] = new TextEncoder().encode(`-- ${folder} ${version}\n`);
  }
  return zipSync(files);
}

describe("a newer file updates the addon it matches", () => {
  test("the preview says what Install will do: update the record that owns a folder, reinstall the same archive", async () => {
    const f = fixture("match-preview", {
      "Foo-1.2.zip": fooRelease("1.2"),
      "Foo-1.3.zip": fooRelease("1.3"),
      "Bar-3.0.zip": bundleZip,
    });
    const { addon } = await installFile(f, "Foo-1.2.zip");

    const newer = await f.service.inspectArchive(f.archivePath("Foo-1.3.zip"), f.installation);
    expect(newer.match).toEqual({ kind: "update", addonId: addon.id, name: "Foo Addon" });
    const same = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(same.match).toEqual({ kind: "reinstall", addonId: addon.id, name: "Foo Addon" });
    const other = await f.service.inspectArchive(f.archivePath("Bar-3.0.zip"), f.installation);
    expect(other.match).toEqual({ kind: "new" });
  });

  test("installing it leaves one listing, with the newer file's version, and its id and name kept", async () => {
    const f = fixture("match-install", {
      "Foo-1.2.zip": fooRelease("1.2"),
      "Foo-1.3.zip": fooRelease("1.3", { title: "|cff00ff00Foo|r Addon" }),
    });
    const { addon: first } = await installFile(f, "Foo-1.2.zip");
    const { operation, addon } = await installFile(f, "Foo-1.3.zip");
    expect(operation.status).toBe("installed");
    expect(addon.id).toBe(first.id);

    const listed = await f.service.listAddons(f.installation);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: first.id,
      // The clean name stays; the colour-coded TOC title does not replace it.
      name: "Foo Addon",
      version: "1.3",
      externalId: f.archivePath("Foo-1.3.zip"),
      previousVersion: "1.2",
    });
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toContain("1.3");
  });

  test("Roll back returns to the files that were on disk before", async () => {
    const f = fixture("match-rollback", { "Foo-1.2.zip": fooRelease("1.2"), "Foo-1.3.zip": fooRelease("1.3") });
    await installFile(f, "Foo-1.2.zip");
    const { addon } = await installFile(f, "Foo-1.3.zip");
    const back = await f.service.rollback(addon.id);
    expect(back.operation.status).toBe("installed");
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("1.2");
    expect(back.addon).toMatchObject({ version: "1.2", previousVersion: "1.3" });
  });

  test("after Roll back the older file is the installed one: it reinstalls, the newer file updates", async () => {
    const f = fixture("match-rollback-match", { "Foo-1.0.zip": fooRelease("1.0"), "Foo-2.0.zip": fooRelease("2.0") });
    await installFile(f, "Foo-1.0.zip");
    const { addon } = await installFile(f, "Foo-2.0.zip");
    await f.service.rollback(addon.id);

    const record = f.store.addons.get(addon.id)!;
    expect(record).toMatchObject({
      externalId: f.archivePath("Foo-1.0.zip"),
      downloadUrl: f.archivePath("Foo-1.0.zip"),
      installedExternalReleaseId: f.archivePath("Foo-1.0.zip"),
      externalLatestReleaseId: f.archivePath("Foo-1.0.zip"),
      installedArchiveHash: new Bun.CryptoHasher("sha256").update(readFileSync(f.archivePath("Foo-1.0.zip"))).digest("hex"),
    });
    const older = await f.service.inspectArchive(f.archivePath("Foo-1.0.zip"), f.installation);
    expect(older.match).toEqual({ kind: "reinstall", addonId: addon.id, name: "Foo Addon" });
    const newer = await f.service.inspectArchive(f.archivePath("Foo-2.0.zip"), f.installation);
    expect(newer.match).toEqual({ kind: "update", addonId: addon.id, name: "Foo Addon" });
  });

  test("after Roll back no update is on offer: a file never checks for updates", async () => {
    const f = fixture("match-rollback-no-update", { "Foo-1.0.zip": fooRelease("1.0"), "Foo-2.0.zip": fooRelease("2.0") });
    await installFile(f, "Foo-1.0.zip");
    const { addon } = await installFile(f, "Foo-2.0.zip");
    await f.service.rollback(addon.id);
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
    const [listed] = await f.service.listAddons(f.installation);
    expect(listed).toMatchObject({ version: "1.0", previousVersion: "2.0", updateAvailable: false });
  });

  test("installing the newer file again after Roll back keeps the older one as the previous version", async () => {
    const f = fixture("match-rollback-again", { "Foo-1.0.zip": fooRelease("1.0"), "Foo-2.0.zip": fooRelease("2.0") });
    await installFile(f, "Foo-1.0.zip");
    const { addon } = await installFile(f, "Foo-2.0.zip");
    await f.service.rollback(addon.id);

    const { addon: again } = await installFile(f, "Foo-2.0.zip");
    expect(again).toMatchObject({ id: addon.id, version: "2.0", previousVersion: "1.0" });
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("2.0");
    expect(readFileSync(join(f.addonsPath, ".wowdeck", "rollback", addon.id, "Foo", "Foo.lua"), "utf8")).toContain("1.0");

    // And Roll back from there returns to 1.0, matched as 1.0 again.
    await f.service.rollback(addon.id);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("1.0");
    const older = await f.service.inspectArchive(f.archivePath("Foo-1.0.zip"), f.installation);
    expect(older.match).toEqual({ kind: "reinstall", addonId: addon.id, name: "Foo Addon" });
  });

  test("a version kept by an older build, with no archive details, rolls back without claiming an archive", async () => {
    const f = fixture("match-rollback-old-meta", { "Foo-1.0.zip": fooRelease("1.0"), "Foo-2.0.zip": fooRelease("2.0") });
    await installFile(f, "Foo-1.0.zip");
    const { addon } = await installFile(f, "Foo-2.0.zip");
    const metaPath = join(f.addonsPath, ".wowdeck", "rollback", addon.id, "meta.json");
    const { version, releaseId, folders, savedAt } = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify({ version, releaseId, folders, savedAt }));

    await f.service.rollback(addon.id);
    const record = f.store.addons.get(addon.id)!;
    expect(record.installedArchiveHash).toBeUndefined();
    expect(record).toMatchObject({
      externalId: f.archivePath("Foo-1.0.zip"),
      installedExternalReleaseId: f.archivePath("Foo-1.0.zip"),
      externalLatestReleaseId: f.archivePath("Foo-1.0.zip"),
    });
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
    const newer = await f.service.inspectArchive(f.archivePath("Foo-2.0.zip"), f.installation);
    expect(newer.match).toEqual({ kind: "update", addonId: addon.id, name: "Foo Addon" });
  });

  test("picking the older file again after the newer one is installed updates the addon", async () => {
    const f = fixture("match-back", { "Foo-1.2.zip": fooRelease("1.2"), "Foo-1.3.zip": fooRelease("1.3") });
    const { addon } = await installFile(f, "Foo-1.2.zip");
    await installFile(f, "Foo-1.3.zip");
    const older = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
    expect(older.match).toEqual({ kind: "update", addonId: addon.id, name: "Foo Addon" });
  });

  test("the same archive saved under another name is a reinstall", async () => {
    const f = fixture("match-copy", { "Foo-1.2.zip": fooRelease("1.2"), "Foo-1.2 (1).zip": fooRelease("1.2") });
    const { addon } = await installFile(f, "Foo-1.2.zip");
    const copy = await f.service.inspectArchive(f.archivePath("Foo-1.2 (1).zip"), f.installation);
    expect(copy.match).toEqual({ kind: "reinstall", addonId: addon.id, name: "Foo Addon" });
  });

  test("a newer zip saved over the installed one is an update, and Roll back restores the files it replaced", async () => {
    const f = fixture("match-overwrite", { "Foo-1.1.zip": fooRelease("1.1"), "Foo.zip": fooRelease("1.2") });
    await installFile(f, "Foo-1.1.zip");
    const { addon } = await installFile(f, "Foo.zip");
    expect(addon).toMatchObject({ version: "1.2", previousVersion: "1.1" });

    // The browser saves the next release under the same name.
    writeFileSync(f.archivePath("Foo.zip"), fooRelease("1.3"));
    const preview = await f.service.inspectArchive(f.archivePath("Foo.zip"), f.installation);
    expect(preview.match).toEqual({ kind: "update", addonId: addon.id, name: "Foo Addon" });
    const { addon: updated } = await installFile(f, "Foo.zip");
    expect(updated).toMatchObject({ id: addon.id, version: "1.3", previousVersion: "1.2" });

    await f.service.rollback(addon.id);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("1.2");
  });

  test("installing the same archive again keeps the kept previous version", async () => {
    const f = fixture("match-same", { "Foo-1.1.zip": fooRelease("1.1"), "Foo.zip": fooRelease("1.2") });
    await installFile(f, "Foo-1.1.zip");
    await installFile(f, "Foo.zip");
    const { addon } = await installFile(f, "Foo.zip");
    expect(addon).toMatchObject({ version: "1.2", previousVersion: "1.1" });
    await f.service.rollback(addon.id);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.lua"), "utf8")).toContain("1.1");
  });

  test("a shared sub-folder is a match even when the main folder was renamed", async () => {
    const f = fixture("match-subfolder", {
      "Foo-1.2.zip": fooRelease("1.2", { folders: ["Foo", "Foo_Options"] }),
      "Foo-2.0.zip": fooRelease("2.0", { folders: ["FooReborn", "Foo_Options"] }),
    });
    const { addon: first } = await installFile(f, "Foo-1.2.zip");
    const preview = await f.service.inspectArchive(f.archivePath("Foo-2.0.zip"), f.installation);
    expect(preview.match).toEqual({ kind: "update", addonId: first.id, name: "Foo Addon" });

    await installFile(f, "Foo-2.0.zip");
    const records = f.store.addons.all();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: first.id, installedVersion: "2.0" });
    expect([...records[0]!.installedFolderList!].sort()).toEqual(["FooReborn", "Foo_Options"]);
  });
});

/** A catalogue source that is on, offline: update checks count its records. */
class FakeCurse extends AddonProvider {
  override name: AddonProviderType = "Curse";
  override enabled = true;
  override isConfigured(): boolean {
    return true;
  }
}

describe("a file that takes over a catalogue addon", () => {
  /** A RestedXP-style record from CurseForge owning Foo, with an update on offer. */
  function withCurseRecord(dir: string, files: Record<string, Uint8Array>) {
    const f = fixture(dir, files);
    f.registry.register(new FakeCurse());
    mkdirSync(join(f.addonsPath, "Foo"), { recursive: true });
    writeFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "## Interface: 110005\n## Title: Foo\n## Version: 1.0\n");
    f.store.addons.create({
      id: "curse-foo",
      name: "Foo Addon",
      installationId: f.installation.id,
      channelType: 0,
      isIgnored: false,
      isLoadOnDemand: false,
      providerName: "Curse",
      externalId: "4242",
      installedVersion: "1.0",
      latestVersion: "2.0",
      installedExternalReleaseId: "100",
      externalLatestReleaseId: "200",
      installedFolders: "Foo",
      installedFolderList: ["Foo"],
    });
    return f;
  }

  test("the preview names the addon and the source it leaves", async () => {
    const f = withCurseRecord("takeover-preview", { "Foo-1.3.zip": fooRelease("1.3") });
    const preview = await f.service.inspectArchive(f.archivePath("Foo-1.3.zip"), f.installation);
    expect(preview.match).toEqual({ kind: "takeover", addonId: "curse-foo", name: "Foo Addon", providerId: "Curse" });
  });

  test("installing it makes the addon from a file, keeps its name and stops its update checks", async () => {
    const f = withCurseRecord("takeover-install", { "Foo-1.3.zip": fooRelease("1.3") });
    expect(f.service.eligibleUpdatesFor(f.installation).map((a) => a.id)).toEqual(["curse-foo"]);

    const { operation } = await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("Foo-1.3.zip"),
      installation: f.installation,
    });
    expect(operation.status).toBe("installed");
    const records = f.store.addons.all();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "curse-foo",
      name: "Foo Addon",
      providerName: "File",
      externalId: f.archivePath("Foo-1.3.zip"),
      installedVersion: "1.3",
    });
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
  });

  test("Roll back returns the addon to its catalogue source, and forward to the file again", async () => {
    const f = withCurseRecord("takeover-rollback", { "Foo-1.3.zip": fooRelease("1.3") });
    await f.service.install({
      intent: "install",
      providerId: "File",
      externalId: f.archivePath("Foo-1.3.zip"),
      installation: f.installation,
    });
    await f.service.rollback("curse-foo");
    expect(f.store.addons.get("curse-foo")).toMatchObject({
      providerName: "Curse",
      externalId: "4242",
      installedVersion: "1.0",
      latestVersion: "2.0",
      installedExternalReleaseId: "100",
      externalLatestReleaseId: "200",
      installedArchiveHash: undefined,
    });

    await f.service.rollback("curse-foo");
    expect(f.store.addons.get("curse-foo")).toMatchObject({
      providerName: "File",
      externalId: f.archivePath("Foo-1.3.zip"),
      installedVersion: "1.3",
      installedExternalReleaseId: f.archivePath("Foo-1.3.zip"),
      externalLatestReleaseId: f.archivePath("Foo-1.3.zip"),
    });
    expect(f.service.eligibleUpdatesFor(f.installation)).toEqual([]);
    const same = await f.service.inspectArchive(f.archivePath("Foo-1.3.zip"), f.installation);
    expect(same.match).toEqual({ kind: "reinstall", addonId: "curse-foo", name: "Foo Addon" });
  });

  test("a file matching an addon from a direct link is a plain update", async () => {
    const f = withCurseRecord("takeover-zip", { "Foo-1.3.zip": fooRelease("1.3") });
    f.store.addons.patch("curse-foo", { providerName: "Zip", externalId: "https://example.invalid/foo.zip" });
    const preview = await f.service.inspectArchive(f.archivePath("Foo-1.3.zip"), f.installation);
    expect(preview.match).toEqual({ kind: "update", addonId: "curse-foo", name: "Foo Addon" });
  });
});

describe("a file that matches several addons", () => {
  /** Foo Addon (Foo, Foo_Options) and Bar Suite (Bar, BarLib) installed; the picked file ships folders of both. */
  async function twoOwners(dir: string, both: Uint8Array) {
    const f = fixture(dir, {
      "Foo-1.2.zip": fooRelease("1.2", { folders: ["Foo", "Foo_Options"] }),
      "Bar-3.0.zip": bundleZip,
      "Both.zip": both,
    });
    const { addon: foo } = await installFile(f, "Foo-1.2.zip");
    const { addon: bar } = await installFile(f, "Bar-3.0.zip");
    return { f, foo, bar };
  }

  test("the preview names each addon in the way and the folders it shares with the file", async () => {
    const { f, foo, bar } = await twoOwners("conflict-preview", fooRelease("2.0", { folders: ["Foo_Options", "Foo", "BarLib"] }));
    const preview = await f.service.inspectArchive(f.archivePath("Both.zip"), f.installation);
    expect(preview.match).toEqual({
      kind: "conflict",
      records: [
        { addonId: foo.id, name: "Foo Addon", folders: ["Foo", "Foo_Options"] },
        { addonId: bar.id, name: "Bar Suite", folders: ["BarLib"] },
      ],
    });
  });

  test("a direct install is refused with an error naming both addons, and nothing on disk changes", async () => {
    const { f } = await twoOwners("conflict-install", fooRelease("2.0", { folders: ["Foo", "BarLib"] }));
    const recordsBefore = f.store.addons.all();
    const tocBefore = readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8");

    await expect(installFile(f, "Both.zip")).rejects.toThrow("This file matches 2 installed addons (Foo Addon and Bar Suite)");

    expect(f.store.addons.all()).toEqual(recordsBefore);
    expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toBe(tocBefore);
    expect(readdirSync(f.addonsPath).sort()).toEqual(["Bar", "BarLib", "Foo", "Foo_Options"]);
  });

  for (const action of ["preview", "install"] as const) {
    test(`reusing a file path still refuses a conflict during ${action}`, async () => {
      const { f, foo, bar } = await twoOwners(`conflict-reused-${action}`, fooZip);
      writeFileSync(f.archivePath("Foo-1.2.zip"), fooRelease("2.0", { folders: ["Foo", "BarLib"] }));
      const recordsBefore = structuredClone(f.store.addons.all());
      const fooBefore = readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8");
      const barBefore = readFileSync(join(f.addonsPath, "BarLib", "BarLib.toc"), "utf8");
      if (action === "preview") {
        const preview = await f.service.inspectArchive(f.archivePath("Foo-1.2.zip"), f.installation);
        expect(preview.match).toEqual({ kind: "conflict", records: [
          { addonId: foo.id, name: "Foo Addon", folders: ["Foo"] },
          { addonId: bar.id, name: "Bar Suite", folders: ["BarLib"] },
        ] });
      } else {
        await expect(installFile(f, "Foo-1.2.zip")).rejects.toThrow("This file matches 2 installed addons");
      }
      expect(f.store.addons.all()).toEqual(recordsBefore);
      expect(readFileSync(join(f.addonsPath, "Foo", "Foo.toc"), "utf8")).toBe(fooBefore);
      expect(readFileSync(join(f.addonsPath, "BarLib", "BarLib.toc"), "utf8")).toBe(barBefore);
    });
  }

  test("with one of them removed, the file updates the other", async () => {
    const { f, foo, bar } = await twoOwners("conflict-resolved", fooRelease("2.0", { folders: ["Foo", "BarLib"] }));
    await f.service.removeAddon(bar.id);
    const preview = await f.service.inspectArchive(f.archivePath("Both.zip"), f.installation);
    expect(preview.match).toEqual({ kind: "update", addonId: foo.id, name: "Foo Addon" });
  });
});
