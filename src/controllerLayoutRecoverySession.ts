import type { ControllerLayoutOperation } from "../backend/src/api/contracts";
import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import { backendErrorMessage } from "./errors";
import { layoutNative } from "./controllerLayoutPreviewSession";

import { applyLayout } from "./controllerLayoutOperation";
import { layoutPreservation } from "./controllerLayoutPreservation";
import type { ControllerLayoutContext } from "../backend/src/api/contracts";
import { restoreLayout } from "./controllerLayoutRestore";
let running: Promise<unknown> | undefined;
type ApplyStatus =
  "idle" | "applying" | "succeeded" | "restored" | "failed" | "blocked" | "recovery-required";
let applyState: ApplyStatus = "idle";
const applyListeners = new Set<() => void>();
const setApply = (next: ApplyStatus) => {
  applyState = next;
  applyListeners.forEach((listener) => listener());
};
/** Module scope: the outcome survives the confirmation modal unmounting the QAM. */
export const layoutApplyStatus = {
  get: () => applyState,
  /** After a restore the last Apply outcome no longer describes the controls. */
  clear: () => setApply("idle"),
  subscribe(listener: () => void) {
    applyListeners.add(listener);
    return () => applyListeners.delete(listener);
  },
};
let lastFailedId: string | undefined;
export const layoutRecovery = createKeyedResource<{
  operation: ControllerLayoutOperation | null;
  restoreFailed: boolean;
}>({
  clock: systemClock,
  pollMs: 500,
  read: async () => {
    const operation = await engine.rpc("controllerLayouts.operationStatus", {});
    return { operation, restoreFailed: !!operation && operation.id === lastFailedId };
  },
  errorText: (error) => {
    backendErrorMessage(error);
    return "Couldn't read previous controls. Further changes are blocked.";
  },
});
export function retryLayoutRestore(
  operation: ControllerLayoutOperation,
  currentInstallation: () => string,
) {
  if (running) return running;
  running = restoreLayout({ rpc: engine.rpc, native: layoutNative, operation, currentInstallation })
    .then((outcome) => {
      lastFailedId = outcome === "recovery-required" ? operation.id : undefined;
      return layoutRecovery.refresh("current");
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}

/** Shared operation slot survives pane teardown. A future evidenced scope resolver
 * can expose Apply without creating another native or preservation lifecycle. */
export function startLayoutApply(
  previewJobId: string,
  context: ControllerLayoutContext,
  currentInstallation: () => string,
) {
  if (running) return running;
  setApply("applying");
  running = applyLayout({
    rpc: engine.rpc,
    native: layoutNative,
    preservation: layoutPreservation(engine.rpc, layoutNative),
    previewJobId,
    context,
    currentInstallation,
  })
    .then(
      (outcome) => setApply(outcome.state),
      () => setApply("failed"),
    )
    .then(() => layoutRecovery.refresh("current"))
    .finally(() => {
      running = undefined;
    });
  return running;
}

export function resetLayoutRecovery() {
  // Running work and its callback cleanup remain owned until it settles.
  if (!running) {
    lastFailedId = undefined;
    applyState = "idle";
    layoutRecovery.retainOnly([]);
  }
}
