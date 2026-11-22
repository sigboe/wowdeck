/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createFakeEngine, type Answer } from "./testSupport/fakeEngine";
import type { Addon, Diagnostics } from "./types";
import { companionStatus, installCompanion } from "./companionInstall";

const installed = (status: "installed" | "failed", error: string | null = null) => ({
  addon: {} as Addon,
  operation: { operationId: "op", addonId: "a", status, error },
});

function harness(hubOn: boolean, install?: Answer<"addons.install">) {
  const fake = createFakeEngine(install ? { "addons.install": install } : {});
  const reloads: string[] = [];
  const elsewhere: string[] = [];
  const deps = {
    rpc: fake.rpc,
    installElsewhere: async <T>(installationId: string, call: () => Promise<T>) => {
      elsewhere.push(installationId);
      return await call();
    },
    hubEnabled: () => hubOn,
    reloadDiagnostics: async () => void reloads.push("diagnostics"),
  };
  return { deps, calls: fake.calls, reloads, elsewhere };
}

describe("installing WowUp Companion into the active installation", () => {
  test("with WowUp Hub off, it refuses and asks the engine nothing", async () => {
    const h = harness(false);
    const result = await installCompanion(h.deps, "retail-1");
    expect(result).toEqual({ status: "hubOff" });
    expect(h.calls).toEqual([]);
    expect(h.elsewhere).toEqual([]);
    expect(h.reloads).toEqual([]);
  });

  test("with WowUp Hub on, it installs Hub addon 27 through the session, then reloads", async () => {
    const h = harness(true, installed("installed"));
    const result = await installCompanion(h.deps, "retail-1");
    expect(result.status).toBe("installed");
    expect(h.calls).toEqual([
      {
        method: "addons.install",
        params: { providerId: "WowUpHub", externalId: "27", installationId: "retail-1" },
      },
    ]);
    // The session's entry point owns the install, so it re-reads My Addons.
    expect(h.elsewhere).toEqual(["retail-1"]);
    expect(h.reloads).toEqual(["diagnostics"]);
  });

  test("a failed install comes back with the engine's error", async () => {
    const h = harness(true, installed("failed", "HTTP 404"));
    expect(await installCompanion(h.deps, "retail-1")).toEqual({
      status: "failed",
      error: "HTTP 404",
    });
  });

  test("a rejected call comes back as failed with what it threw", async () => {
    const boom = new Error("engine not ready");
    const h = harness(true, boom);
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
