import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllerLayoutsHandlers } from "../src/api/handlers/controllerLayouts";
import { ControllerLayoutOperations } from "../src/wow/controllerLayouts/ControllerLayoutOperations";

test("unknown native scope is refused through typed operation RPC without durable intent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-op-"));
  try {
    const operations = new ControllerLayoutOperations(dir, { authorize: async () => { throw Error("must not authorize"); } } as never);
    const rpc = controllerLayoutsHandlers({ controllerLayoutOperations: operations, store: { settings: { controllerLayoutsEnabled: true } } } as never);
    await expect(rpc["controllerLayouts.beginOperation"]({ previewJobId: "unknown", context: { scope: { state: "unknown" } } } as never)).rejects.toThrow();
    expect(await rpc["controllerLayouts.operationStatus"]({})).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import type { ControllerLayoutContext, ControllerLayoutPreview } from "../src/api/contracts";
const context: ControllerLayoutContext = {
  installationId: "retail", target: 42, accountId: 123, controllerIndex: 15, controllerType: 4,
  controllerIdentity: "physical-controller", selection: "inherited", scope: {
    state: "established", identity: "controller-scope", targets: [{ appId: 42, name: "WoW" }, { appId: 43, name: "WoW" }],
  },
};
const approved: ControllerLayoutPreview = { title: "Approved", url: "usercloud://wowdeck-approved/" + "a".repeat(64), sha256: "a".repeat(64), accountId: 123, mappings: { "4": "b".repeat(64) } };
test("typed lifecycle retains interrupted intent and rejects retries after engine restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-op-"));
  try {
    let operations: ControllerLayoutOperations;
    const make = () => controllerLayoutsHandlers({ controllerLayoutOperations: (operations = new ControllerLayoutOperations(dir, { status: () => ({ state: "ready", preview: approved }), authorize: async () => approved })), store: { settings: { controllerLayoutsEnabled: true } } } as never);
    const rpc = make();
    const op = await rpc["controllerLayouts.beginOperation"]({ previewJobId: "preview", context });
    await operations!.settled();
    await expect(rpc["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "succeeded" })).rejects.toThrow();
    await rpc["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: "durable-export" });
    const restarted = make();
    expect(await restarted["controllerLayouts.operationStatus"]({})).toMatchObject({ id: op.id, phase: "recovery-required", recoveryId: "durable-export", context });
    await expect(restarted["controllerLayouts.beginOperation"]({ previewJobId: "preview", context })).rejects.toThrow();
    expect((await restarted["controllerLayouts.operationStatus"]({}))?.recoveryId).toBe("durable-export");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a syntactically valid but malformed recovery record cannot release the gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-op-"));
  try {
    await Bun.write(join(dir, "operation.json"), JSON.stringify({ id: "broken", phase: "failed", context: "lost", approved: {} }));
    const rpc = controllerLayoutsHandlers({ controllerLayoutOperations: new ControllerLayoutOperations(dir, {} as never) } as never);
    await expect(rpc["controllerLayouts.operationStatus"]({})).rejects.toThrow("Couldn't read controller recovery state");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
