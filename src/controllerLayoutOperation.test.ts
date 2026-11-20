import { expect, test } from "bun:test";
import { applyLayout } from "./controllerLayoutOperation";

test("application without connected preservation never invokes native mutation", async () => {
  let mutations = 0;
  const result = await applyLayout({
    native: {
      apply: async () => {
        mutations++;
      },
    },
  } as never);
  expect(result.state).toBe("blocked");
  expect(mutations).toBe(0);
});

import type {
  ControllerLayoutContext,
  ControllerLayoutOperation,
} from "../backend/src/api/contracts";
import type { LayoutOperationAdapter, LayoutPreservation } from "./controllerLayoutOperation";
import type { Rpc } from "./services/envelope";
import model from "../backend/tests/fixtures/controller-layouts/decoded-approved.json";
import fallback from "../backend/tests/fixtures/controller-layouts/decoded-fallback.json";

function fixture(
  change?:
    | "scope"
    | "account"
    | "controller"
    | "selection"
    | "installation"
    | "fallback"
    | "restore"
    | "capture"
    | "missing",
) {
  const context: ControllerLayoutContext = {
    installationId: "retail",
    target: 42,
    accountId: 123,
    controllerIndex: 15,
    controllerType: 4,
    controllerIdentity: "physical-controller-a",
    selection: "custom inherited semantics",
    scope: {
      state: "established",
      identity: "all-equivalent-controllers:one",
      targets: [
        { appId: 42, name: "WoW" },
        { appId: 43, name: "WoW" },
      ],
    },
  };
  const op: ControllerLayoutOperation = {
    id: "operation",
    phase: "preserving",
    context,
    approved: {
      title: "Approved",
      accountId: 123,
      sha256: "a".repeat(64),
      url: "usercloud://wowdeck-approved/" + "a".repeat(64),
      mappings: { "4": "7580191d0c2d91371f278d5743f7bc406c0fffd80c13ed51f662ca95fd0c4ffb" },
    },
  };
  let applied = 0,
    restored = 0,
    disposed = 0,
    captured = false;
  let invalidate: () => void = () => {};
  const phases: string[] = [];
  const rpc = (async (
    method: string,
    params: { phase?: ControllerLayoutOperation["phase"]; recoveryId?: string },
  ) => {
    if (method === "controllerLayouts.advanceOperation") {
      op.phase = params.phase!;
      if (params.recoveryId) op.recoveryId = params.recoveryId;
      phases.push(op.phase);
    }
    return structuredClone(op);
  }) as Rpc;
  const native: LayoutOperationAdapter = {
    context: async () => ({ ...context }),
    operationContext: async () => {
      const value = structuredClone(context);
      if (captured && change === "scope") value.scope.targets.push({ appId: 44, name: "Other" });
      if (captured && change === "account") value.accountId = 456;
      if (captured && change === "controller") value.controllerIdentity = "reconnected-controller";
      if (captured && change === "selection") value.selection = "new personal edits";
      if (applied) value.selection = "approved selection";
      return value;
    },
    preview: async () => ({ model, release: () => {} }),
    apply: async () => {
      applied++;
      invalidate();
      if (change === "missing") throw Error("native disappeared");
    },
    readback: async () => (change === "fallback" || change === "restore" ? fallback : model),
    settled: async () => {},
    subscribe: (listener) => {
      invalidate = listener;
      return () => {
        disposed++;
      };
    },
  };
  const preservation: LayoutPreservation = {
    capture: async () => {
      captured = true;
      if (change === "capture") throw Error();
      return { recoveryId: "durable-local-export" };
    },
    restore: async () => {
      restored++;
      if (change === "restore") throw Error();
    },
  };
  return {
    run: () =>
      applyLayout({
        rpc,
        native,
        preservation,
        context,
        previewJobId: "preview",
        currentInstallation: () =>
          captured && change === "installation" ? "other-installation" : "retail",
      }),
    counts: () => ({ applied, restored, disposed }),
    phases,
  };
}

test("approved apply succeeds only after decoded readback, never from invalidation notification", async () => {
  const app = fixture();
  expect(await app.run()).toEqual({ state: "succeeded" });
  expect(app.phases).toEqual(["preserved", "applying", "verifying", "succeeded"]);
  expect(app.counts()).toEqual({ applied: 1, restored: 0, disposed: 1 });
});
for (const change of ["scope", "account", "controller", "selection", "installation"] as const) {
  test(`changed ${change} refuses mutation and preserves recovery evidence`, async () => {
    const app = fixture(change);
    expect(await app.run()).toEqual({ state: "recovery-required" });
    expect(app.counts()).toEqual({ applied: 0, restored: 0, disposed: 1 });
  });
}
for (const change of ["fallback", "missing"] as const) {
  test(`${change} never reports success and restores preserved controls`, async () => {
    const app = fixture(change);
    expect(await app.run()).toEqual({ state: "restored" });
    expect(app.counts()).toEqual({ applied: 1, restored: 1, disposed: 1 });
  });
}
for (const change of ["restore", "capture"] as const) {
  test(`failed ${change} retains recovery-required intent`, async () => {
    const app = fixture(change);
    expect(await app.run()).toEqual({ state: "recovery-required" });
    expect(app.phases[app.phases.length - 1]).toBe("recovery-required");
  });
}

test("a capture-only preservation implementation cannot enable mutation", async () => {
  const result = await applyLayout({
    preservation: { capture: async () => ({ recoveryId: "saved" }) },
    native: { apply: async () => {}, readback: async () => model, subscribe: () => () => {} },
  } as never);
  expect(result.state).toBe("blocked");
});
