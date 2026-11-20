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
const nativeOwner = "11111111-1111-4111-8111-111111111111";
const approved: ControllerLayoutPreview = { title: "Approved", url: "usercloud://wowdeck-approved/" + "a".repeat(64), sha256: "a".repeat(64), accountId: 123, mappings: { "4": "b".repeat(64) } };
test("typed lifecycle retains interrupted intent and rejects retries after engine restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-op-"));
  try {
    let operations: ControllerLayoutOperations;
    const make = () => controllerLayoutsHandlers({ controllerLayoutOperations: (operations = new ControllerLayoutOperations(dir, { status: () => ({ state: "ready", preview: approved }), authorize: async () => approved })), store: { settings: { controllerLayoutsEnabled: true } } } as never);
    const rpc = make();
    const op = await rpc["controllerLayouts.beginOperation"]({ previewJobId: "preview", context, nativeOwner });
    await operations!.settled();
    await expect(rpc["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "succeeded" })).rejects.toThrow();
    await expect(rpc["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: "durable-export" })).rejects.toThrow();
    const restarted = make();
    expect(await restarted["controllerLayouts.operationStatus"]({})).toMatchObject({ id: op.id, phase: "recovery-required", context });
    await expect(restarted["controllerLayouts.beginOperation"]({ previewJobId: "preview", context, nativeOwner })).rejects.toThrow();
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
    const op = await rpc()["controllerLayouts.beginOperation"]({ previewJobId: "preview", context, nativeOwner });
    await operations.settled();
    const sourceURL = `autosave://${join(config, "edited.vdf")}`;
    const snapshot = { sourceURL, mapping: '{"type":4,"sets":[{"personal":"A to B"}],"modes":[]}', selections: [42,43].flatMap(target => [{ target, selectionType: 0, present: false }, { target, selectionType: 1, present: true, url: sourceURL }]) };
    const saved = await rpc()["controllerLayouts.saveRecovery"]({ id: op.id, snapshot });
    await expect(rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: saved.recoveryId })).rejects.toThrow();
    await Bun.write(join(config, "export.vdf"), '"controller_mappings" { "personal" "native export" }');
    await rpc()["controllerLayouts.sealRecovery"]({ id: op.id, sourceURL: "usercloud://personal/export" });
    await rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "preserving", phase: "preserved", recoveryId: saved.recoveryId });
    await rpc()["controllerLayouts.releaseOperation"]({ id: op.id, nativeOwner });
    operations = make();
    const interrupted = await rpc()["controllerLayouts.operationStatus"]({});
    expect(interrupted).toMatchObject({ phase: "recovery-required", recoveryId: saved.recoveryId });
    expect(await rpc()["controllerLayouts.readRecovery"]({ id: op.id })).toEqual(snapshot);
    const restoring = await rpc()["controllerLayouts.resumeRestore"]({ id: op.id, nativeOwner });
    expect(restoring.phase).toBe("restoring");
    await rpc()["controllerLayouts.advanceOperation"]({ id: op.id, from: "restoring", phase: "recovery-required" });
    expect(await rpc()["controllerLayouts.readRecovery"]({ id: op.id })).toEqual(snapshot);
    await Bun.write(join(config, "edited.vdf"), "new personal edits");
    await rpc()["controllerLayouts.releaseOperation"]({ id: op.id, nativeOwner });
    await rpc()["controllerLayouts.resumeRestore"]({ id: op.id, nativeOwner });
    const delivery = await rpc()["controllerLayouts.prepareRecovery"]({ id: op.id });
    expect(delivery.sourceURL).toMatch(/^usercloud:\/\/wowdeck-recovery\/[a-f0-9-]{36}\/[a-f0-9]{64}$/);
    expect(delivery.mapping).toBe(snapshot.mapping);
    expect(delivery.selections.filter(e => !e.present)).toEqual(snapshot.selections.filter(e => !e.present));
    expect(delivery.selections.filter(e => e.present).every(e => e.url === delivery.sourceURL)).toBe(true);
    expect(await Bun.file(join(config, "edited.vdf")).text()).toBe("new personal edits");
    const deliveredPath = join(config, "..", delivery.sourceURL.slice("usercloud://".length) + ".vdf");
    expect(await Bun.file(deliveredPath).text()).toBe('"controller_mappings" { "personal" "A to B" }');
    await rm(join(config, "edited.vdf"));
    expect(await rpc()["controllerLayouts.prepareRecovery"]({ id: op.id })).toEqual(delivery);
    await Bun.write(deliveredPath, "conflicting bytes");
    await expect(rpc()["controllerLayouts.prepareRecovery"]({ id: op.id })).rejects.toThrow("verify delivered recovery bytes");
    expect(await Bun.file(deliveredPath).text()).toBe("conflicting bytes");
    expect((await rpc()["controllerLayouts.operationStatus"]({}))?.phase).toBe("restoring");
    expect((await rpc()["controllerLayouts.operationStatus"]({}))?.recoveryId).toBe(saved.recoveryId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("durable browser ownership prevents a second restore until native work is released", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-owner-"));
  try {
    const operations = new ControllerLayoutOperations(dir, { status: () => ({ state: "ready", preview: approved }), authorize: async () => approved });
    const rpc = controllerLayoutsHandlers({ controllerLayoutOperations: operations, store: { settings: { controllerLayoutsEnabled: true } } } as never);
    const op = await rpc["controllerLayouts.beginOperation"]({ previewJobId: "preview", context, nativeOwner });
    await operations.settled();
    await expect(rpc["controllerLayouts.releaseOperation"]({ id: op.id, nativeOwner: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow();
    const restarted = controllerLayoutsHandlers({ controllerLayoutOperations: new ControllerLayoutOperations(dir, {} as never) } as never);
    expect(await restarted["controllerLayouts.operationStatus"]({})).toMatchObject({ nativeOwner, phase: "recovery-required" });
    await expect(restarted["controllerLayouts.resumeRestore"]({ id: op.id, nativeOwner: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow("owned by a browser");
    expect(await rpc["controllerLayouts.releaseOperation"]({ id: op.id, nativeOwner })).toMatchObject({ phase: "recovery-required" });
    expect((await rpc["controllerLayouts.operationStatus"]({}))?.nativeOwner).toBeUndefined();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an operation for a revision without published mappings stays readable after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "layout-op-"));
  try {
    const unreviewed: ControllerLayoutPreview = { ...approved, mappings: {} };
    const make = () => controllerLayoutsHandlers({ controllerLayoutOperations: new ControllerLayoutOperations(dir, { status: () => ({ state: "ready", preview: unreviewed }), authorize: async () => unreviewed }), store: { settings: { controllerLayoutsEnabled: true } } } as never);
    const op = await make()["controllerLayouts.beginOperation"]({ previewJobId: "preview", context, nativeOwner });
    // DEVICE 2026-11-17: the engine used to reject its own record here.
    expect(await make()["controllerLayouts.operationStatus"]({})).toMatchObject({ id: op.id, context });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
