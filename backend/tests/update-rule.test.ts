/**
 * The one update rule (addonStatus.updateStatus): whether an addon can
 * update, can auto-update, and why not. Update all, auto-update, the toast,
 * the update summary, the companion data and the wired flag all ask it.
 */

import { describe, expect, test } from "bun:test";
import { updateStatus, type UpdateStatus } from "../src/wow/addons/addonStatus";
import { AddonProvider } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import type { WowAddon } from "../src/wow/models";
import type { AddonProviderType } from "../src/wow/types";

class StubProvider extends AddonProvider {
  constructor(name: AddonProviderType, enabled: boolean) {
    super();
    this.name = name;
    this.enabled = enabled;
  }
}

const registry = new ProviderRegistry();
registry.register(new StubProvider("WowUpHub", true));
registry.register(new StubProvider("TukUI", false));

const outdated: WowAddon = {
  id: "a",
  name: "A",
  installationId: "i",
  channelType: 0,
  isIgnored: false,
  isLoadOnDemand: false,
  providerName: "WowUpHub",
  externalId: "1",
  installedVersion: "1.0",
  latestVersion: "1.1",
};

const can: UpdateStatus = { canUpdate: true, canAutoUpdate: true, reason: null };
const blocked = (reason: UpdateStatus["reason"]): UpdateStatus => ({ canUpdate: false, canAutoUpdate: false, reason });

const cases: Array<[string, Partial<WowAddon>, UpdateStatus]> = [
  ["a newer version from a source that is on", {}, can],
  ["ignored", { isIgnored: true }, blocked("ignored")],
  ["ignored wins over a source that is off", { isIgnored: true, providerName: "TukUI" }, blocked("ignored")],
  ["source off in Options", { providerName: "TukUI" }, blocked("source_off")],
  ["source no longer registered", { providerName: "CurseForge" }, blocked("source_off")],
  ["no source at all", { providerName: undefined }, blocked("source_off")],
  ["source off wins over up to date", { providerName: "TukUI", latestVersion: "1.0" }, blocked("source_off")],
  ["paused: Update all still takes it, auto-update does not", { autoUpdatePaused: true }, { canUpdate: true, canAutoUpdate: false, reason: "paused" }],
  ["the old skip mark counts as paused", { skipReleaseId: "r2" }, { canUpdate: true, canAutoUpdate: false, reason: "paused" }],
  ["up to date", { latestVersion: "1.0" }, blocked("up_to_date")],
  ["up to date wins over paused", { latestVersion: "1.0", autoUpdatePaused: true }, blocked("up_to_date")],
  ["version strings compare without a v prefix", { installedVersion: "v1.1" }, blocked("up_to_date")],
  ["no installed version is never an update", { installedVersion: "" }, blocked("up_to_date")],
  [
    "release ids differ: an update even when the versions read the same",
    { latestVersion: "1.0", installedExternalReleaseId: "r1", externalLatestReleaseId: "r2" },
    can,
  ],
  [
    "release ids match: up to date even when the versions read differently",
    { installedVersion: "1.1 (fun name)", installedExternalReleaseId: "r1", externalLatestReleaseId: "r1" },
    blocked("up_to_date"),
  ],
  [
    "one release id missing: the versions decide",
    { latestVersion: "1.0", installedExternalReleaseId: "r1" },
    blocked("up_to_date"),
  ],
];

describe("updateStatus", () => {
  test.each(cases)("%s", (_name, fields, expected) => {
    expect(updateStatus({ ...outdated, ...fields }, registry)).toEqual(expected);
  });
});
