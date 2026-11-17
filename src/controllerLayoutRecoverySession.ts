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
let running: Promise<void> | undefined;
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
  running = applyLayout({
    rpc: engine.rpc,
    native: layoutNative,
    preservation: layoutPreservation(engine.rpc, layoutNative),
    previewJobId,
    context,
    currentInstallation,
  })
    .then(async () => {
      await layoutRecovery.refresh("current");
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}

export function resetLayoutRecovery() {
  // Running work and its callback cleanup remain owned until it settles.
  if (!running) {
    lastFailedId = undefined;
    layoutRecovery.retainOnly([]);
  }
}
