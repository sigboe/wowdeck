import { describe, expect, test, afterAll } from "bun:test";
import { zipSync } from "fflate";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExportPayload,
  computeImportSummary,
  decodeImportString,
  encodeExportString,
  isImportSummaryError,
} from "../src/wow/addons/AddonPortability";
import { AddonService } from "../src/wow/addons/AddonService";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { NetworkClient } from "../src/wow/net/network";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowAddon, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const ROOT = "/tmp/opencode/wowdeck-tests/portability";

function installationFor(clientType: WowClientType, id = "inst1"): WowInstallation {
  return {
    id,
    clientType,
    location: join(ROOT, id),
    label: id,
    displayName: id,
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
}

function addon(partial: Partial<WowAddon> & { id: string; installationId: string }): WowAddon {
  return {
    name: "Addon",
    channelType: 0,
    isIgnored: false,
    isLoadOnDemand: false,
    ...partial,
  };
}

describe("buildExportPayload / encode / decode (pure)", () => {
  const installation = installationFor(WowClientType.Retail);

  test("exports managed addons with provider+external id", () => {
    const addons = [
      addon({ id: "a1", installationId: installation.id, name: "Alpha", providerName: "WowUpHub", externalId: "111", installedExternalReleaseId: "r1" }),
      addon({ id: "a2", installationId: installation.id, name: "Beta", providerName: "GitHub", externalId: "owner/repo" }),
    ];
    const { payload, unsupported } = buildExportPayload(addons, installation);
    expect(unsupported).toEqual([]);
    expect(payload.client_type).toBe("Retail");
    expect(payload.addons).toEqual([
      { name: "Alpha", provider_name: "WowUpHub", id: "111", version_id: "r1" },
      { name: "Beta", provider_name: "GitHub", id: "owner/repo", version_id: undefined },
    ]);
  });

  test("marks a library with dependency: true and leaves every other entry as WowUp writes it (WF-21)", () => {
    const addons = [
      addon({ id: "a1", installationId: installation.id, name: "Alpha", providerName: "WowUpHub", externalId: "111" }),
      addon({ id: "a2", installationId: installation.id, name: "Lib", providerName: "WowUpHub", externalId: "222", isDependency: true }),
    ];
    const entries = buildExportPayload(addons, installation).payload.addons;
    expect(entries[0]).not.toHaveProperty("dependency");
    expect(entries[1]).toMatchObject({ id: "222", dependency: true });
  });

  test("reports an addon with no resolvable provider as unsupported instead of dropping it silently", () => {
    const addons = [addon({ id: "a1", installationId: installation.id, name: "Mystery" })];
    const { payload, unsupported } = buildExportPayload(addons, installation);
    expect(payload.addons).toEqual([]);
    expect(unsupported).toEqual([{ name: "Mystery", reason: "Not from a known addon source" }]);
  });

  test("base64 round-trips through decodeImportString", () => {
    const addons = [addon({ id: "a1", installationId: installation.id, name: "Alpha", providerName: "WowUpHub", externalId: "111" })];
    const { payload } = buildExportPayload(addons, installation);
    const encoded = encodeExportString(payload);
    expect(encoded.charAt(0)).not.toBe("{");
    const decoded = decodeImportString(encoded);
    expect(decoded).toEqual(payload);
  });

  test("decodeImportString also accepts raw JSON (no base64), matching WowUp's own detection", () => {
    const raw = JSON.stringify({ client_type: "Retail", addons: [] });
    expect(decodeImportString(raw)).toEqual({ client_type: "Retail", addons: [] });
  });

  test("decodeImportString rejects malformed base64/JSON", () => {
    expect(() => decodeImportString("{not valid json")).toThrow();
    expect(() => decodeImportString("###not-base64-or-json###")).toThrow();
    expect(() => decodeImportString("   ")).toThrow();
  });
});

describe("computeImportSummary: client compatibility", () => {
  const registry = new ProviderRegistry();
  class Fake extends AddonProvider {
    name = "WowUpHub" as const;
    enabled = true;
  }
  registry.register(new Fake());

  test("Retail export is compatible with a Retail PTR installation (same group)", () => {
    const result = computeImportSummary(
      { client_type: "Retail", addons: [{ name: "A", provider_name: "WowUpHub", id: "1" }] },
      [],
      installationFor(WowClientType.RetailPtr),
      registry,
    );
    expect(isImportSummaryError(result)).toBe(false);
  });

  test("Retail export is incompatible with a Classic installation", () => {
    const result = computeImportSummary(
      { client_type: "Retail", addons: [{ name: "A", provider_name: "WowUpHub", id: "1" }] },
      [],
      installationFor(WowClientType.Classic),
      registry,
    );
    expect(isImportSummaryError(result)).toBe(true);
    expect(isImportSummaryError(result) && result.code).toBe("incompatible_client");
  });

  test("Forever and Forever Beta lists import into each other, never into Mists Classic", () => {
    const listFor = (client_type: string) => ({ client_type, addons: [{ name: "A", provider_name: "WowUpHub", id: "1" }] });
    const imports = (client_type: string, clientType: WowClientType) =>
      !isImportSummaryError(computeImportSummary(listFor(client_type), [], installationFor(clientType), registry));
    expect(imports("ClassicBeta", WowClientType.Forever)).toBe(true);
    expect(imports("Forever", WowClientType.ClassicBeta)).toBe(true);
    expect(imports("Forever", WowClientType.Classic)).toBe(false);
    expect(imports("ClassicBeta", WowClientType.Classic)).toBe(false);
    expect(imports("Classic", WowClientType.Forever)).toBe(false);
  });

  test("Anniversary (Burning Crusade group) is distinct from Classic and from ClassicEra — the reported TBC Anniversary mislabeling never recurs here", () => {
    const anniversaryImport = { client_type: "Anniversary", addons: [{ name: "A", provider_name: "WowUpHub", id: "1" }] };
    expect(isImportSummaryError(computeImportSummary(anniversaryImport, [], installationFor(WowClientType.Classic), registry))).toBe(true);
    expect(isImportSummaryError(computeImportSummary(anniversaryImport, [], installationFor(WowClientType.ClassicEra), registry))).toBe(true);
    expect(isImportSummaryError(computeImportSummary(anniversaryImport, [], installationFor(WowClientType.Retail), registry))).toBe(true);
  });

  test("unknown/future client identifier is a clear compatibility error, not a silent default", () => {
    const result = computeImportSummary(
      { client_type: "SomeFutureClient", addons: [{ name: "A", provider_name: "WowUpHub", id: "1" }] },
      [],
      installationFor(WowClientType.Retail),
      registry,
    );
    expect(isImportSummaryError(result) && result.code).toBe("incompatible_client");
  });

  test("empty addons array is a whole-import error", () => {
    const result = computeImportSummary({ client_type: "Retail", addons: [] }, [], installationFor(WowClientType.Retail), registry);
    expect(isImportSummaryError(result) && result.code).toBe("empty_import");
  });
});

describe("computeImportSummary: per-entry resolution", () => {
  const installation = installationFor(WowClientType.Retail);
  const registry = new ProviderRegistry();
  class Enabled extends AddonProvider {
    name = "WowUpHub" as const;
    enabled = true;
  }
  class Disabled extends AddonProvider {
    name = "GitHub" as const;
    enabled = false;
  }
  registry.register(new Enabled());
  registry.register(new Disabled());

  function summaryFor(entries: { name: string; provider_name: string; id: string; version_id?: string; dependency?: boolean }[], current: WowAddon[] = []) {
    const result = computeImportSummary({ client_type: "Retail", addons: entries }, current, installation, registry);
    if (isImportSummaryError(result)) {
      throw new Error(`unexpected summary error: ${result.code}`);
    }
    return result;
  }

  test("not-yet-installed addon from an enabled provider is 'new'", () => {
    const summary = summaryFor([{ name: "Alpha", provider_name: "WowUpHub", id: "111" }]);
    expect(summary.comparisons).toEqual([
      { name: "Alpha", providerId: "WowUpHub", externalId: "111", versionId: null, state: "new", reason: null, dependency: false },
    ]);
    expect(summary.addedCt).toBe(1);
  });

  test("each skipped or uninstallable row says why in plain words", () => {
    const reason = (entries: Parameters<typeof summaryFor>[0], current: WowAddon[] = []) =>
      summaryFor(entries, current).comparisons.map((c) => c.reason);
    expect(reason([{ name: "A", provider_name: "GitHub", id: "o/r" }])).toEqual([
      "GitHub is turned off or not set up in Options",
    ]);
    expect(reason([{ name: "A", provider_name: "constructor", id: "1" }])).toEqual(["constructor isn't supported"]);
    expect(
      reason(
        [{ name: "A", provider_name: "WowUpHub", id: "1" }, { name: "A", provider_name: "WowUpHub", id: "1" }],
      )[1],
    ).toBe("Listed twice. The first one is used.");
    expect(
      reason(
        [{ name: "A", provider_name: "WowUpHub", id: "1", version_id: "r2" }],
        [addon({ id: "x", installationId: "inst1", providerName: "WowUpHub", externalId: "1", installedExternalReleaseId: "r1" })],
      ),
    ).toEqual(["You have a different version. Update it from My Addons."]);
    expect(
      reason(
        [{ name: "Bagnon", provider_name: "WowUpHub", id: "9" }],
        [addon({ id: "y", installationId: "inst1", name: "Bagnon", providerName: "Curse", externalId: "5" })],
      ),
    ).toEqual(["You have it from CurseForge"]);
    expect(
      reason(
        [{ name: "Bagnon", provider_name: "WowUpHub", id: "9" }],
        [addon({ id: "z", installationId: "inst1", name: "Bagnon" })],
      ),
    ).toEqual(["You installed it manually"]);
  });

  test("the dependency mark is read per entry; an entry without it (every WowUp list) is not a library", () => {
    const summary = summaryFor([
      { name: "Alpha", provider_name: "WowUpHub", id: "111" },
      { name: "Lib", provider_name: "WowUpHub", id: "222", dependency: true },
    ]);
    expect(summary.comparisons.map((c) => c.dependency)).toEqual([false, true]);
  });

  test("unknown provider name is 'unresolved', not a whole-import failure", () => {
    const summary = summaryFor([{ name: "Alpha", provider_name: "NoSuchProvider", id: "111" }]);
    expect(summary.comparisons[0]!.state).toBe("unresolved");
    expect(summary.unresolvedCt).toBe(1);
  });

  test("disabled provider is 'unresolved'", () => {
    const summary = summaryFor([{ name: "Beta", provider_name: "GitHub", id: "owner/repo" }]);
    expect(summary.comparisons[0]!.state).toBe("unresolved");
  });

  test("same provider+id+version already installed is 'no_change'", () => {
    const current = [addon({ id: "x", installationId: installation.id, providerName: "WowUpHub", externalId: "111", installedExternalReleaseId: "r1" })];
    const summary = summaryFor([{ name: "Alpha", provider_name: "WowUpHub", id: "111", version_id: "r1" }], current);
    expect(summary.comparisons[0]!.state).toBe("no_change");
  });

  test("same provider+id, different version is a conflict (never auto-replaced)", () => {
    const current = [addon({ id: "x", installationId: installation.id, providerName: "WowUpHub", externalId: "111", installedExternalReleaseId: "r1" })];
    const summary = summaryFor([{ name: "Alpha", provider_name: "WowUpHub", id: "111", version_id: "r2" }], current);
    expect(summary.comparisons[0]!.state).toBe("conflict");
  });

  test("same name installed under a different provider is a conflict", () => {
    const current = [addon({ id: "x", installationId: installation.id, name: "Alpha", providerName: "GitHub", externalId: "owner/repo" })];
    const summary = summaryFor([{ name: "Alpha", provider_name: "WowUpHub", id: "111" }], current);
    expect(summary.comparisons[0]!.state).toBe("conflict");
  });

  test("a malformed entry (missing provider_name/id) is reported as unresolved, not silently dropped", () => {
    const result = computeImportSummary(
      { client_type: "Retail", addons: [{ name: "Broken" } as never] },
      [],
      installation,
      registry,
    );
    if (isImportSummaryError(result)) {
      throw new Error("unexpected summary error");
    }
    expect(result.comparisons).toEqual([
      { name: "Broken", providerId: "", externalId: "", versionId: null, state: "unresolved", reason: "This entry is damaged", dependency: false },
    ]);
  });

  test("duplicate entries in the same import: only the first is evaluated, the rest are flagged conflicts", () => {
    const summary = summaryFor([
      { name: "Alpha", provider_name: "WowUpHub", id: "111" },
      { name: "Alpha", provider_name: "WowUpHub", id: "111" },
    ]);
    expect(summary.comparisons[0]!.state).toBe("new");
    expect(summary.comparisons[1]!.state).toBe("conflict");
    expect(summary.addedCt).toBe(1);
  });
});

function zipFor(folders: string[], name: string, version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of folders) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(`## Title: ${name}\n## Version: ${version}\n`);
  }
  return zipSync(files);
}

describe("AddonListPortability.apply (end-to-end)", () => {
  class Fake extends AddonProvider {
    name = "WowUpHub" as const;
    enabled = true;
    catalog = [
      { id: "111", name: "Alpha", version: "1.0.0", folders: ["Alpha"] },
      { id: "222", name: "Beta", version: "2.0.0", folders: ["Beta"] },
    ];

    override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
      const entry = this.catalog.find((c) => c.id === addonId);
      if (!entry) {
        return undefined;
      }
      return {
        author: "Dev",
        externalId: entry.id,
        externalUrl: `https://fake/${entry.id}`,
        name: entry.name,
        providerName: this.name,
        files: [
          {
            channelType: 0,
            folders: entry.folders,
            gameVersion: "11.0.2",
            downloadUrl: `https://fake/dl/${entry.id}.zip`,
            version: entry.version,
            releaseDate: new Date().toISOString(),
          },
        ],
      };
    }

    override isValidAddonId(addonId: string): boolean {
      return /^\d+$/.test(addonId);
    }
  }

  function makeNetwork(catalog: { id: string; name: string; version: string; folders: string[] }[]): NetworkClient {
    return {
      downloadToFile: async (url: string, dest: string) => {
        const id = url.match(/dl\/(\d+)\.zip/)?.[1]!;
        const entry = catalog.find((c) => c.id === id)!;
        const bytes = zipFor(entry.folders, entry.name, entry.version);
        writeFileSync(dest, Buffer.from(bytes));
        return bytes.length;
      },
    } as unknown as NetworkClient;
  }

  function setup(root: string) {
    rmSync(root, { recursive: true, force: true });
    const installRoot = join(root, "_retail_");
    mkdirSync(join(installRoot, "Interface", "AddOns"), { recursive: true });
    const installation: WowInstallation = {
      id: "inst1",
      clientType: WowClientType.Retail,
      location: installRoot,
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const provider = new Fake();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const store = createStateStore(root);
    store.setInstallations([installation]);
    const service = new AddonService(store, registry, new DownloadService(makeNetwork(provider.catalog), join(root, "dl")), {
      addonsChanged: () => {},
      operationProgress: () => {},
      operationResult: () => {},
    });
    return { service, store, installation };
  }

  test("installs only the 'new' entries; conflicts/no-change/unresolved are never touched", async () => {
    const root = join(ROOT, "e2e-1");
    const { service, store, installation } = setup(root);

    const importString = encodeExportString({
      client_type: "Retail",
      addons: [
        { name: "Alpha", provider_name: "WowUpHub", id: "111" },
        { name: "Beta", provider_name: "WowUpHub", id: "222" },
        { name: "Unknown", provider_name: "NoSuchProvider", id: "999" },
      ],
    });

    const { operations, error } = await service.importAddonList(importString, installation);
    expect(error).toBeNull();
    expect(operations.length).toBe(2);
    expect(operations.every((op) => op.status === "installed")).toBe(true);
    expect(operations.map((op) => op.addonName).sort()).toEqual(["Alpha", "Beta"]); // WF-14

    const installed = store.addons.all().filter((a) => a.installationId === installation.id);
    expect(installed.map((a) => a.externalId).sort()).toEqual(["111", "222"]);

    rmSync(root, { recursive: true, force: true });
  });

  test("re-running the same import a second time installs nothing new (now all 'no_change')", async () => {
    const root = join(ROOT, "e2e-2");
    const { service, store, installation } = setup(root);
    const importString = encodeExportString({
      client_type: "Retail",
      addons: [{ name: "Alpha", provider_name: "WowUpHub", id: "111" }],
    });

    await service.importAddonList(importString, installation);
    expect(store.addons.all().filter((a) => a.installationId === installation.id).length).toBe(1);

    const second = await service.importAddonList(importString, installation);
    expect(second.operations.length).toBe(0);
    expect(store.addons.all().filter((a) => a.installationId === installation.id).length).toBe(1);

    rmSync(root, { recursive: true, force: true });
  });

  test("export output can be fed straight back into preview with no changes (round trip)", async () => {
    const root = join(ROOT, "e2e-3");
    const { service, installation } = setup(root);
    await service.importAddonList(
      encodeExportString({ client_type: "Retail", addons: [{ name: "Alpha", provider_name: "WowUpHub", id: "111" }] }),
      installation,
    );

    const exported = await service.portability.export(installation);
    expect(exported.exportedCount).toBe(1);

    const preview = service.portability.preview(exported.payload, installation);
    expect(preview.error).toBeNull();
    expect(preview.summary?.noChangeCt).toBe(1);
    expect(preview.summary?.addedCt).toBe(0);

    rmSync(root, { recursive: true, force: true });
  });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});
