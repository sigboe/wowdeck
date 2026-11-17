import type { ControllerLayoutOperation } from "../backend/src/api/contracts";
import type { Rpc } from "./services/envelope";
import { backendErrorMessage } from "./errors";
import { layoutPreservation, type LayoutRecoveryAdapter } from "./controllerLayoutPreservation";

/** Explicit recovery only. No mount, notification or catalogue update mutates controls. */
export async function restoreLayout(deps: {
  rpc: Rpc;
  native: LayoutRecoveryAdapter;
  operation: ControllerLayoutOperation;
  currentInstallation(): string;
}) {
  let op = deps.operation;
  const nativeOwner = crypto.randomUUID();
  let claimed = false;
  const unchanged = async () => {
    const actual = await deps.native.operationContext(op.context.target, op.context.installationId);
    if (
      deps.currentInstallation() !== op.context.installationId ||
      actual.scope.state !== "established" ||
      JSON.stringify({ ...actual, selection: "" }) !==
        JSON.stringify({ ...op.context, selection: "" })
    )
      throw Error("Couldn't restore controls onto a changed account, controller or shared scope.");
  };
  let unsubscribe: (() => void) | undefined;
  try {
    await unchanged();
    unsubscribe = deps.native.subscribe(() => {});
    op = await deps.rpc("controllerLayouts.resumeRestore", { id: op.id, nativeOwner });
    claimed = true;
    await unchanged();
    await layoutPreservation(deps.rpc, deps.native).restore(op);
    await deps.rpc("controllerLayouts.advanceOperation", {
      id: op.id,
      from: "restoring",
      phase: "restored",
    });
    return "restored" as const;
  } catch (error) {
    backendErrorMessage(error);
    if (claimed && op.phase === "restoring") {
      try {
        await deps.rpc("controllerLayouts.advanceOperation", {
          id: op.id,
          from: "restoring",
          phase: "recovery-required",
        });
      } catch {
        /* uncertain persisted intent remains */
      }
    }
    return "recovery-required" as const;
  } finally {
    if (claimed) {
      try {
        await deps.native.settled();
        await deps.rpc("controllerLayouts.releaseOperation", { id: op.id, nativeOwner });
      } catch {
        /* Retain uncertain ownership. */
      }
    }
    unsubscribe?.();
  }
}
