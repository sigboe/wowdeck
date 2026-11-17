import type { ControllerLayout, ControllerLayoutPreviewJob } from "../backend/src/api/contracts";
import { systemClock, type Clock } from "./clock";
import {
  previewLayout,
  type LayoutPreviewOutcome,
  type NativeLayoutAdapter,
} from "./controllerLayoutPreview";
import { engine } from "./engineLink";
import { backendErrorMessage } from "./errors";
import { createKeyedResource } from "./keyedResource";
import { nativeControllerLayouts } from "./nativeControllerLayouts";
import type { Rpc } from "./services/envelope";

export type PreviewPaneState = LayoutPreviewOutcome | { state: "preparing" };

/** Module lifetime: work survives QAM teardown; reopening reads the same job. */
export function createLayoutPreviewSession(deps: {
  rpc: Rpc;
  native: NativeLayoutAdapter;
  clock: Clock;
}) {
  let attempt = 0;
  const jobs = new Map<string, Promise<string>>();
  const outcomes = new Map<string, Promise<LayoutPreviewOutcome>>();
  const resource = createKeyedResource<PreviewPaneState>({
    clock: deps.clock,
    pollMs: 500,
    errorText: (error) => {
      const message = backendErrorMessage(error);
      return message.startsWith("Couldn't")
        ? message
        : "Couldn't preview the layout. Steam's controller support is unavailable. Open controller settings, then choose the layout again.";
    },
    read: async (key) => {
      if (outcomes.has(key)) return outcomes.get(key)!;
      const params = JSON.parse(key) as { layoutId: string; revision: number; target: number };
      if (!jobs.has(key))
        jobs.set(
          key,
          (async () => {
            const context = await deps.native.context(params.target);
            const job = await deps.rpc("controllerLayouts.preparePreview", {
              layoutId: params.layoutId,
              revision: params.revision,
              accountId: context.accountId,
            });
            return job.jobId;
          })(),
        );
      const jobId = await jobs.get(key)!;
      const status: ControllerLayoutPreviewJob = await deps.rpc("controllerLayouts.previewStatus", {
        jobId,
      });
      if (status.state === "error") {
        outcomes.set(key, Promise.resolve(status));
        return status;
      }
      if (status.state !== "ready") return status;
      if (!outcomes.has(key))
        outcomes.set(key, previewLayout(deps.native, status.preview, params.target));
      return outcomes.get(key)!;
    },
  });
  return {
    resource,
    key: (layout: ControllerLayout, target: number) =>
      JSON.stringify({
        layoutId: layout.id,
        revision: layout.revision?.number,
        target,
        attempt: ++attempt,
      }),
    reset: () => {
      resource.retainOnly([]);
      jobs.clear();
      outcomes.clear();
    },
  };
}
let choice: {
  layout: ControllerLayout;
  key: string | null;
  target?: number;
  correcting?: boolean;
} | null = null;
const listeners = new Set<() => void>();
export const previewChoice = {
  get: () => choice,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  select: (layout: ControllerLayout | null, target?: number, correcting = false) => {
    choice = layout
      ? {
          layout,
          key: target ? layoutPreviewSession.key(layout, target) : null,
          target,
          correcting,
        }
      : null;
    listeners.forEach((listener) => listener());
  },
};
export const layoutNative = nativeControllerLayouts();
export const layoutTargetContext = createKeyedResource({
  clock: systemClock,
  pollMs: 1000,
  errorText: () => "Couldn't establish the Steam account. Choose a library entry for preview.",
  read: (key) => layoutNative.context(Number(key)),
});
export const layoutPreviewSession = createLayoutPreviewSession({
  rpc: engine.rpc,
  native: layoutNative,
  clock: systemClock,
});
