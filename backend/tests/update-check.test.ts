import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";
import { UpdateToastGate } from "../src/wow/notifications/UpdateToastGate";
import { UpdateCheck } from "../src/wow/notifications/UpdateCheck";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";

// RF-11: what each "check every installation" entry point does, in order.

function installation(id: string): WowInstallation {
  return {
    id,
    clientType: WowClientType.Retail,
    location: `/nowhere/${id}`,
    label: "_retail_",
    displayName: id,
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
}

/** A real service over two installations whose steps only record themselves. */
function recordingStack() {
  const dir = mkdtempSync(join(tmpdir(), "update-check-"));
  const store = createStateStore(dir);
  store.setInstallations([installation("A"), installation("B")]);
  store.updateSettings({ autoUpdate: true, updateToastEnabled: true });
  const service = new AddonService(store, new ProviderRegistry(), new DownloadService(new NetworkClient(), join(dir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  const calls: string[] = [];
  service.scanInstallation = async (i) => (calls.push(`scan ${i.id}`), []);
  service.refresh = async (i) => (calls.push(`refresh ${i.id}`), { updated: 0, failed: 0 });
  service.autoUpdate = async () => (calls.push("autoUpdate"), null);
  service.updateAll = async (i) => (calls.push(`updateAll ${i.id}`), []);
  service.listAddons = async (i) => (calls.push(`list ${i.id}`), []);
  const companion = new CompanionSyncCoordinator(service);
  companion.regenerate = async (ids) => {
    calls.push(`regenerate ${ids?.join(",") ?? "all"}`);
  };
  const check = new UpdateCheck(service, companion);
  return { store, service, check, calls };
}

/** Checking one installation: rescan, ask the providers, rewrite its companion data. */
const CHECK_A = ["scan A", "refresh A", "regenerate A"];
const CHECK_B = ["scan B", "refresh B", "regenerate B"];
const FULL_CHECK = [...CHECK_A, ...CHECK_B, "autoUpdate"];

// One flow for every entry point (owner decision 2026-10-20). Before RF-11
// discovery skipped auto-update, the Steam page check skipped the scan and
// the in-game data rewrite, and Update all skipped both too.
describe("checking every installation (RF-11)", () => {
  test("installation discovery runs the full check", async () => {
    const { check, calls } = recordingStack();
    await check.checkAll();
    expect(calls).toEqual(FULL_CHECK);
  });

  test("the daily check (toast) runs the full check", async () => {
    const { store, service, check, calls } = recordingStack();
    await new UpdateToastGate(service, store, check).checkNow();
    expect(calls).toEqual(FULL_CHECK);
  });

  test("the Steam page check runs the full check, then counts", async () => {
    const { check, calls } = recordingStack();
    const summary = await check.updateSummary(true);
    expect(calls).toEqual(FULL_CHECK);
    expect(summary).toEqual([
      { installationId: "A", displayName: "A", updates: 0 },
      { installationId: "B", displayName: "B", updates: 0 },
    ]);
  });

  test("the Steam page count without a refresh checks nothing", async () => {
    const { check, calls } = recordingStack();
    await check.updateSummary(false);
    expect(calls).toEqual([]);
  });

  test("Update all installations: the check without auto-update, then updates each", async () => {
    const { check, calls } = recordingStack();
    await check.updateAllInstallations();
    expect(calls).toEqual([...CHECK_A, ...CHECK_B, "updateAll A", "updateAll B"]);
  });

  test("My Addons' refresh checks only that installation, then lists it", async () => {
    const { service, check, calls } = recordingStack();
    service.refresh = async (i) => (calls.push(`refresh ${i.id}`), { updated: 3, failed: 1 });
    const result = await check.refresh(service.installations.require("B"));
    expect(calls).toEqual([...CHECK_B, "list B"]);
    expect(result).toEqual({ addons: [], updated: 3, failed: 1 });
  });

  test("My Addons' refresh reports a failed check, after rewriting the companion data", async () => {
    const { service, check, calls } = recordingStack();
    service.refresh = async () => {
      throw new Error("SD card removed");
    };
    await expect(check.refresh(service.installations.require("A"))).rejects.toThrow("SD card removed");
    expect(calls).toEqual(["scan A", "regenerate A"]);
  });

  test("concurrent checks share one pass; each still asks for auto-update", async () => {
    const { check, calls } = recordingStack();
    await Promise.all([check.checkAll(), check.checkAll()]);
    expect(calls).toEqual([...FULL_CHECK, "autoUpdate"]);
  });

  test("a failing installation does not stop the others", async () => {
    const { service, check, calls } = recordingStack();
    const scan = service.scanInstallation;
    service.scanInstallation = async (i) => {
      if (i.id === "A") {
        throw new Error("SD card removed");
      }
      return scan(i);
    };
    await check.checkAll();
    expect(calls).toEqual(["regenerate A", ...CHECK_B, "autoUpdate"]);
  });
});
