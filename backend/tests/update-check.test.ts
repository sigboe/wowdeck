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
  const companion = new CompanionSyncCoordinator(service);
  companion.regenerate = async () => {
    calls.push("regenerate");
  };
  const check = new UpdateCheck(service, companion);
  return { store, service, check, calls };
}

const FULL_CHECK = ["scan A", "refresh A", "scan B", "refresh B", "regenerate", "autoUpdate"];

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
    const { service, check, calls } = recordingStack();
    await check.checkAll();
    service.updateSummary();
    expect(calls).toEqual(FULL_CHECK);
  });

  test("Update all installations: the check without auto-update, then updates each", async () => {
    const { service, check, calls } = recordingStack();
    await check.checkAll({ autoUpdate: false });
    await service.updateAllInstallations();
    expect(calls).toEqual(["scan A", "refresh A", "scan B", "refresh B", "regenerate", "updateAll A", "updateAll B"]);
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
    expect(calls).toEqual(["scan B", "refresh B", "regenerate", "autoUpdate"]);
  });
});
