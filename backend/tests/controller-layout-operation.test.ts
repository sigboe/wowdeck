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
    await expect(rpc["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: "durable-export" })).rejects.toThrow();
    const restarted = make();
    expect(await restarted["controllerLayouts.operationStatus"]({})).toMatchObject({ id: op.id, phase: "recovery-required", context });
    await expect(restarted["controllerLayouts.beginOperation"]({ previewJobId: "preview", context })).rejects.toThrow();
    expect((await restarted["controllerLayouts.operationStatus"]({}))?.recoveryId).toBeUndefined();
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

test("recovery RPC retains personal bytes and absence semantics across restart and failed restore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-recovery-"));
  try {
    const config = join(dir, "home/.local/share/Steam/steamapps/common/Steam Controller Configs/123/config/personal");
    await Bun.write(join(config, "edited.vdf"), '"controller_mappings" { "personal" "A to B" }');
    const make = () => new ControllerLayoutOperations(dir, { status: () => ({ state: "ready", preview: approved }), authorize: async () => approved }, join(dir, "home"));
    let operations = make();
    const rpc = () => controllerLayoutsHandlers({ controllerLayoutOperations: operations, store: { settings: { controllerLayoutsEnabled: true } } } as never);
    const op = await rpc()["controllerLayouts.beginOperation"]({ previewJobId: "preview", context });
    await operations.settled();
    const sourceURL = `autosave://${join(config, "edited.vdf")}`;
    const snapshot = { sourceURL, mapping: '{"type":4,"sets":[{"personal":"A to B"}],"modes":[]}', selections: [42,43].flatMap(target => [{ target, selectionType: 0, present: false }, { target, selectionType: 1, present: true, url: sourceURL }]) };
    const saved = await rpc()["controllerLayouts.saveRecovery"]({ id: op.id, snapshot });
    await expect(rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: saved.recoveryId })).rejects.toThrow();
    await Bun.write(join(config, "export.vdf"), '"controller_mappings" { "personal" "native export" }');
    await rpc()["controllerLayouts.sealRecovery"]({ id: op.id, sourceURL: "usercloud://personal/export" });
    await rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: saved.recoveryId });
    operations = make();
    const interrupted = await rpc()["controllerLayouts.operationStatus"]({});
    expect(interrupted).toMatchObject({ phase: "recovery-required", recoveryId: saved.recoveryId });
    expect(await rpc()["controllerLayouts.readRecovery"]({ id: op.id })).toEqual(snapshot);
    const restoring = await rpc()["controllerLayouts.resumeRestore"]({ id: op.id });
    expect(restoring.phase).toBe("restoring");
    await rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "restoring", phase: "recovery-required" });
    expect(await rpc()["controllerLayouts.readRecovery"]({ id: op.id })).toEqual(snapshot);
    await Bun.write(join(config, "edited.vdf"), "new personal edits");
    await expect(rpc()["controllerLayouts.resumeRestore"]({ id: op.id })).rejects.toThrow();
    expect((await rpc()["controllerLayouts.operationStatus"]({}))?.recoveryId).toBe(saved.recoveryId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
