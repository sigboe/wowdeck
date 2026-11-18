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
import {
  currentSteamAccountId,
  MULTIPLE_CONTROLLERS_REASON,
  nativeControllerLayouts,
} from "./nativeControllerLayouts";
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
    /** The engine job behind a ready preview; Apply re-authorizes it. */
    job: (key: string) => jobs.get(key),
    reset: () => {
      resource.retainOnly([]);
      jobs.clear();
      outcomes.clear();
    },
  };
}
export const layoutNative = nativeControllerLayouts();
/** The signed-in Steam account, which detected links must belong to. One key: "current". */
export const steamAccount = createKeyedResource({
  clock: systemClock,
  pollMs: 1000,
  errorText: () => "Couldn't establish the Steam account.",
  read: () => currentSteamAccountId(),
});
/** Key: `${target}|${installationId}`. Scope is reread on every Apply boundary too. */
export const layoutOperationContext = createKeyedResource({
  clock: systemClock,
  pollMs: 1000,
  errorText: (error) =>
    backendErrorMessage(error) === MULTIPLE_CONTROLLERS_REASON
      ? MULTIPLE_CONTROLLERS_REASON
      : "Couldn't establish which library entries share these controls.",
  read: (key) => {
    const [target, installationId] = key.split("|");
    return layoutNative.operationContext(Number(target), installationId!);
  },
});
export const layoutPreviewSession = createLayoutPreviewSession({
  rpc: engine.rpc,
  native: layoutNative,
  clock: systemClock,
});
