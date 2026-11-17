import type {
  ControllerLayoutOperation,
  ControllerLayoutRecoverySnapshot,
} from "../backend/src/api/contracts";
import type { LayoutOperationAdapter, LayoutPreservation } from "./controllerLayoutOperation";
import { mappingContent } from "./controllerLayoutPreview";
import type { Rpc } from "./services/envelope";

/** Native scope resolver must prove override presence/absence, not infer it from
 * the current URL. The shipped adapter refuses capture until that is possible. */
export interface LayoutRecoveryAdapter extends LayoutOperationAdapter {
  preservationState(
    operation: ControllerLayoutOperation,
  ): Promise<ControllerLayoutRecoverySnapshot>;
  exportLocal(operation: ControllerLayoutOperation): Promise<string>;
  restoreSelections(
    operation: ControllerLayoutOperation,
    snapshot: ControllerLayoutRecoverySnapshot,
  ): Promise<void>;
}
export function layoutPreservation(rpc: Rpc, native: LayoutRecoveryAdapter): LayoutPreservation {
  const verify = async (
    op: ControllerLayoutOperation,
    snapshot: ControllerLayoutRecoverySnapshot,
    restored = false,
  ) => {
    const context = await native.operationContext(op.context.target, op.context.installationId);
    if (
      JSON.stringify({ ...context, ...(restored ? { selection: "" } : {}) }) !==
        JSON.stringify({ ...op.context, ...(restored ? { selection: "" } : {}) }) ||
      mappingContent(await native.readback(context)) !== snapshot.mapping
    )
      throw Error("Couldn't verify previous controls and selection semantics.");
    const actual = await native.preservationState(op);
    if (JSON.stringify(actual) !== JSON.stringify(snapshot))
      throw Error("Couldn't verify previous selection semantics.");
  };
  return {
    async capture(op) {
      const snapshot = await native.preservationState(op);
      await verify(op, snapshot);
      // Intent and complete pre-export bytes are durable before export can change
      // selection. A timed-out export is unknown, never permission to retry it.
      const saved = await rpc("controllerLayouts.saveRecovery", { id: op.id, snapshot });
      const exported = await native.exportLocal(op);
      try {
        // DEVICE 2026-11-17: Steam's export drops activators without bindings,
        // so it need not equal the snapshot. The archived source bytes are the
        // recovery; the export only has to read back as it previews.
        const exportedModel = await native.readback(
          await native.operationContext(op.context.target, op.context.installationId),
        );
        const preview = await native.preview(op.context, exported);
        try {
          if (mappingContent(preview.model) !== mappingContent(exportedModel))
            throw Error("Couldn't verify the exported bytes' mappings.");
        } finally {
          preview.release();
        }
        await rpc("controllerLayouts.sealRecovery", { id: op.id, sourceURL: exported });
      } finally {
        // Export selected its copy; put the previous selection back either way.
        await native.restoreSelections(op, snapshot);
      }
      await verify(op, snapshot);
      return saved;
    },
    async restore(op) {
      const snapshot = await rpc("controllerLayouts.prepareRecovery", { id: op.id });
      const context = await native.operationContext(op.context.target, op.context.installationId);
      if (
        JSON.stringify({ ...context, selection: "" }) !==
        JSON.stringify({ ...op.context, selection: "" })
      )
        throw Error("Couldn't restore controls onto a changed target or controller.");
      await native.restoreSelections(op, snapshot);
      await verify(op, snapshot, true);
    },
  };
}
