// WF-21: an addon list exported here, with our `dependency` mark, still
// imports in WowUp. Runs upstream's own AddonBrokerService from the read-only
// reference checkout, unchanged, with its Angular/Electron collaborators
// stubbed. Test only: nothing the plugin builds imports wowup/ (AGENTS.md).
// Skipped when `make wowup` has not fetched the checkout.
import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildExportPayload, encodeExportString } from "../src/wow/addons/AddonPortability";
import type { WowAddon, WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

const W = join(import.meta.dir, "..", "..", "wowup");
const SVC = join(W, "wowup-electron/src/app/services");
const BROKER = join(SVC, "addons/addon-broker.service.ts");

describe.skipIf(!existsSync(BROKER))("WowUp imports our addon lists", () => {
  async function upstreamBroker(installed: object[]) {
    const lib = {
      ...(await import(join(W, "wowup-lib/src/types.ts"))),
      ...(await import(join(W, "wowup-lib/src/utils/enum.utils.ts"))),
      ...(await import(join(W, "wowup-lib/src/utils/wow-client.utils.ts"))),
    };
    mock.module("wowup-lib-core", () => lib);
    mock.module("lodash", () => ({ default: { sortBy: (a: any[], f: (x: any) => number) => [...a].sort((x, y) => f(x) - f(y)) } }));
    mock.module("nanoid", () => ({ nanoid: () => Math.random().toString(36).slice(2) }));
    mock.module("@angular/core", () => ({ Injectable: () => (c: unknown) => c }));
    mock.module("rxjs", () => ({ Subject: class { next() {} asObservable() { return this; } } }));
    mock.module(join(SVC, "storage/addon-storage.service"), () => ({ AddonStorageService: class {} }));
    mock.module(join(SVC, "addons/addon.service"), () => ({ AddonService: class {} }));
    mock.module(join(SVC, "index"), () => ({ ElectronService: class {} }));
    mock.module(join(SVC, "addons/addon.provider.factory"), () => ({ AddonProviderFactory: class {} }));
    mock.module(join(W, "wowup-electron/src/app/models/wowup/addon-install-state"), () => ({ AddonInstallState: {} }));
    mock.module(join(W, "wowup-electron/src/environments/environment"), () => ({
      AppConfig: { wago: { enabled: true }, curseforge: { enabled: true } },
    }));
    const { AddonBrokerService } = await import(BROKER);

    const installs: { id: string; provider: string }[] = [];
    const addonService = {
      getAllAddons: async () => installed,
      installBaseAddon: async (id: string, provider: string) => installs.push({ id, provider }),
    };
    const factory = { getEnabledAddonProviders: () => [{ name: "WowUpHub" }] };
    // Upstream's main-process "base64-decode" handler (app/ipc-events.ts).
    const electron = { invoke: async (_channel: string, s: string) => Buffer.from(s, "base64").toString("utf-8") };
    return { broker: new AddonBrokerService({}, addonService, factory, electron), installs, clientType: lib.WowClientType.Retail };
  }

  test("a list with a library marked dependency: true imports in WowUp like an unmarked one", async () => {
    const installation: WowInstallation = {
      id: "inst1",
      clientType: WowClientType.Retail,
      location: "/nowhere",
      label: "_retail_",
      displayName: "Retail",
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected",
    };
    const record = (partial: Partial<WowAddon> & { id: string }): WowAddon => ({
      name: "Addon",
      installationId: installation.id,
      channelType: 0,
      isIgnored: false,
      isLoadOnDemand: false,
      providerName: "WowUpHub",
      ...partial,
    });
    const { payload } = buildExportPayload(
      [
        record({ id: "a", name: "App", externalId: "111", installedExternalReleaseId: "r1" }),
        record({ id: "l", name: "Lib", externalId: "222", installedExternalReleaseId: "r2", isDependency: true }),
      ],
      installation,
    );
    expect(payload.addons[1]!.dependency).toBe(true);

    // WowUp already has App at the same release; Lib is new to it.
    const { broker, installs, clientType } = await upstreamBroker([
      { externalId: "111", providerName: "WowUpHub", name: "App", installedExternalReleaseId: "r1" },
    ]);
    const parsed = await broker.parseImportString(encodeExportString(payload));
    const summary = await broker.getImportSummary(parsed, { id: "w1", clientType });
    expect(summary.errorCode).toBeUndefined();
    expect(Object.fromEntries(summary.comparisons.map((c: any) => [c.imported.name, c.state]))).toEqual({
      App: "no-change",
      Lib: "added",
    });
    await broker.installImportSummary(summary, { id: "w1", clientType });
    expect(installs).toEqual([{ id: "222", provider: "WowUpHub" }]);
  });
});
