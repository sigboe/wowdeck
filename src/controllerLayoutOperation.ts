import type {
  ControllerLayoutContext,
  ControllerLayoutOperation,
  ControllerLayoutPhase,
} from "../backend/src/api/contracts";
import type { NativeLayoutAdapter, NativeLayoutModel } from "./controllerLayoutPreview";
import { previewLayout, mappingContent } from "./controllerLayoutPreview";
import type { Rpc } from "./services/envelope";

export interface LayoutOperationAdapter extends NativeLayoutAdapter {
  operationContext(target: number, installationId: string): Promise<ControllerLayoutContext>;
  apply(context: ControllerLayoutContext, url: string): Promise<void>;
  readback(context: ControllerLayoutContext): Promise<NativeLayoutModel>;
  /** Notification appID 0 invalidates; no notification establishes success. */
  subscribe(invalidate: () => void): () => void;
}
/** #269 must persist complete previous mappings and selection semantics before returning.
 * capture may itself change Steam selection: a durable intent must precede it.
 * restore must verify previous decoded mappings and explicit/inherited semantics.
 */
export interface LayoutPreservation {
  capture(operation: ControllerLayoutOperation): Promise<{ recoveryId: string }>;
  restore(operation: ControllerLayoutOperation): Promise<void>;
}
export type LayoutApplyOutcome = {
  state: "blocked" | "succeeded" | "restored" | "recovery-required" | "failed";
};

/** Public operation boundary. No caller can enable mutation by omitting rollback. */
export async function applyLayout(deps: {
  rpc: Rpc;
  native: LayoutOperationAdapter;
  preservation?: LayoutPreservation;
  previewJobId: string;
  context: ControllerLayoutContext;
  currentInstallation(): string;
  wait?: () => Promise<void>;
}): Promise<LayoutApplyOutcome> {
  if (
    typeof deps.preservation?.capture !== "function" ||
    typeof deps.preservation?.restore !== "function" ||
    typeof deps.native?.apply !== "function" ||
    typeof deps.native?.readback !== "function" ||
    typeof deps.native?.subscribe !== "function"
  )
    return { state: "blocked" };
  let captureStarted = false;
  let mutationAttempted = false;
  let operation: ControllerLayoutOperation | undefined;
  let unsubscribe: (() => void) | undefined;
  const advance = async (phase: ControllerLayoutPhase, recoveryId?: string) => {
    operation = await deps.rpc("controllerLayouts.advanceOperation", {
      id: operation!.id,
      from: operation!.phase,
      phase,
      recoveryId,
    });
  };
  const context = () =>
    deps.native.operationContext(deps.context.target, deps.context.installationId);
  const unchanged = async () => {
    if (
      deps.currentInstallation() !== deps.context.installationId ||
      JSON.stringify(await context()) !== JSON.stringify(deps.context)
    )
      throw Error("Context changed");
  };
  try {
    await unchanged();
    if (deps.context.scope.state !== "established") return { state: "blocked" };
    // Callback lifetime belongs to the operation, independent of pane mounts.
    // Even without notifications every boundary rereads context and decoded content.
    let invalidated = false;
    unsubscribe = deps.native.subscribe(() => {
      invalidated = true;
    });
    operation = await deps.rpc("controllerLayouts.beginOperation", {
      previewJobId: deps.previewJobId,
      context: deps.context,
    });
    while (operation.phase === "validating") {
      await (deps.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 250)));
      const current = await deps.rpc("controllerLayouts.operationStatus", {});
      if (!current || current.id !== operation.id) throw Error("Operation lost");
      operation = current;
    }
    if (operation.phase !== "preserving")
      return { state: operation.phase === "recovery-required" ? "recovery-required" : "failed" };
    const preview = await previewLayout(deps.native, operation.approved, deps.context.target);
    if (preview.state !== "ready") throw Error("Preview mismatch");
    await unchanged();
    captureStarted = true;
    const saved = await deps.preservation.capture(operation);
    await advance("preserved", saved.recoveryId);
    await unchanged();
    // Revalidate the engine's approved bytes immediately before native mutation.
    await advance("applying");
    await unchanged();
    mutationAttempted = true;
    await deps.native.apply(deps.context, operation.approved.url);
    await advance("verifying");
    const actualContext = await context();
    const before = { ...deps.context, selection: "" };
    const after = { ...actualContext, selection: "" };
    if (
      deps.currentInstallation() !== deps.context.installationId ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw Error("Context changed");
    const model = await deps.native.readback(actualContext);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mappingContent(model))),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (
      model.controller_type !== deps.context.controllerType ||
      !Array.isArray(model.sets) ||
      !Array.isArray(model.modes) ||
      hash !== operation.approved.mappings[String(deps.context.controllerType)]
    )
      throw Error("Native fallback");
    // A callback, including appID 0, only asks us to reread. It is never an acknowledgement.
    if (invalidated) {
      if (JSON.stringify(await context()) !== JSON.stringify(actualContext))
        throw Error("Selection changed");
      invalidated = false;
    }
    if (JSON.stringify(await context()) !== JSON.stringify(actualContext))
      throw Error("Selection changed");
    await advance("succeeded");
    return { state: "succeeded" };
  } catch {
    if (!operation) return { state: "failed" };
    try {
      if (!captureStarted) {
        await advance("failed");
        return { state: "failed" };
      }
      if (operation.phase === "preserving" || operation.recoveryId) {
        // Never restore onto a different account/controller/scope. #269 owns
        // recovery after capture fails or context can no longer be established.
        const now = await context();
        const before = { ...deps.context, selection: "" };
        const after = { ...now, selection: "" };
        if (
          deps.currentInstallation() !== deps.context.installationId ||
          (!mutationAttempted && now.selection !== deps.context.selection) ||
          !operation.recoveryId ||
          JSON.stringify(before) !== JSON.stringify(after)
        )
          throw Error();
        await advance("restoring");
        await deps.preservation.restore(operation);
        await advance("restored");
        return { state: "restored" };
      }
      await advance("failed");
      return { state: "failed" };
    } catch {
      try {
        await advance("recovery-required");
      } catch {
        /* persisted nonterminal intent also blocks retries */
      }
      return { state: "recovery-required" };
    }
  } finally {
    try {
      unsubscribe?.();
    } catch {
      /* no callback is used as success evidence */
    }
  }
}
