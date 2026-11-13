/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Rpc } from "./services/envelope";
import type { Diagnostics } from "./types";
import { companionStatus, installCompanion } from "./companionInstall";

type Call = { method: string; params?: unknown };

function fakeRpc(answer: (method: string) => unknown = () => ({})) {
  const calls: Call[] = [];
  const rpc = (async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return answer(method);
  }) as Rpc;
  return { rpc, calls };
}

const installed = (status: "installed" | "failed", error: string | null = null) => ({
  addon: {},
  operation: { operationId: "op", addonId: "a", status, error },
});

function harness(hubOn: boolean, answer?: (method: string) => unknown) {
  const { rpc, calls } = fakeRpc(answer);
  const reloads: string[] = [];
  const deps = {
    rpc,
    hubEnabled: () => hubOn,
    reloadDiagnostics: async () => void reloads.push("diagnostics"),
    reloadAddons: async () => void reloads.push("addons"),
  };
  return { deps, calls, reloads };
}

describe("installing WowUp Companion into the active installation", () => {
  test("with WowUp Hub off, it refuses and asks the engine nothing", async () => {
    const h = harness(false);
    const result = await installCompanion(h.deps, "retail-1");
    expect(result).toEqual({ status: "hubOff" });
    expect(h.calls).toEqual([]);
    expect(h.reloads).toEqual([]);
  });

  test("with WowUp Hub on, it installs Hub addon 27 into that installation, then reloads", async () => {
    const h = harness(true, () => installed("installed"));
    const result = await installCompanion(h.deps, "retail-1");
    expect(result.status).toBe("installed");
    expect(h.calls).toEqual([
      {
        method: "addons.install",
        params: { providerId: "WowUpHub", externalId: "27", installationId: "retail-1" },
      },
    ]);
    expect(h.reloads.sort()).toEqual(["addons", "diagnostics"]);
  });

  test("a failed install comes back with the engine's error", async () => {
    const h = harness(true, () => installed("failed", "HTTP 404"));
    expect(await installCompanion(h.deps, "retail-1")).toEqual({
      status: "failed",
      error: "HTTP 404",
    });
  });

  test("a rejected call comes back as failed with what it threw", async () => {
    const boom = new Error("engine not ready");
    const h = harness(true, () => {
      throw boom;
    });
    expect(await installCompanion(h.deps, "retail-1")).toEqual({ status: "failed", error: boom });
  });
});

const diagnostics = (
  ...installations: { id: string; clientLabel: string; companionAddonDetected: boolean }[]
) => ({ installations: installations.map((i) => ({ ...i, path: "/x" })) }) as Diagnostics;

describe("the companion status Updates inside WoW shows", () => {
  test("missing from the active installation: offered there, others missing listed", () => {
    const status = companionStatus(
      diagnostics(
        { id: "r", clientLabel: "Retail", companionAddonDetected: false },
        { id: "c", clientLabel: "Classic", companionAddonDetected: false },
        { id: "e", clientLabel: "Classic Era", companionAddonDetected: true },
      ),
      "r",
    );
    expect(status).toEqual({ kind: "missing", installationId: "r", missingElsewhere: ["Classic"] });
  });

  test("already in the active installation: nothing offered, others missing still listed", () => {
    const status = companionStatus(
      diagnostics(
        { id: "r", clientLabel: "Retail", companionAddonDetected: true },
        { id: "c", clientLabel: "Classic", companionAddonDetected: false },
      ),
      "r",
    );
    expect(status).toEqual({ kind: "installed", missingElsewhere: ["Classic"] });
  });

  test("no diagnostics or no active installation: nothing to offer", () => {
    expect(companionStatus(null, "r")).toEqual({ kind: "unknown", missingElsewhere: [] });
    expect(
      companionStatus(
        diagnostics({ id: "c", clientLabel: "Classic", companionAddonDetected: false }),
        null,
      ),
    ).toEqual({ kind: "unknown", missingElsewhere: ["Classic"] });
  });
});
