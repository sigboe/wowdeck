/** RPC handlers: the Controller layouts destination's catalogue. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { ControllerLayoutCatalogue } from "../contracts";
import type { ControllerLayoutCatalogueSource } from "../../wow/controllerLayouts/ControllerLayoutCatalogue";
import { controllerLayoutsSourceEnabled } from "../../wow/controllerLayouts/source";
import type { StateStore } from "../../wow/storage/StateStore";

/** What the Controller layouts handlers use. */
export interface ControllerLayoutsDeps {
  controllerLayoutOperations?: import("../../wow/controllerLayouts/ControllerLayoutOperations").ControllerLayoutOperations;
  controllerLayoutPreviews?: import("../../wow/controllerLayouts/ControllerLayoutPreviews").ControllerLayoutPreviews;
  controllerLayouts: Pick<ControllerLayoutCatalogueSource, "read">;
  /** Read live: the source toggle is checked on every call. */
  store: Pick<StateStore, "settings">;
}

export function controllerLayoutsHandlers({
  controllerLayouts,
  controllerLayoutOperations,
  controllerLayoutPreviews,
  store,
}: ControllerLayoutsDeps) {
  return {
    "controllerLayouts.saveRecovery": async (params: import("../contracts").MethodMap["controllerLayouts.saveRecovery"]["params"]) => {
      if (!controllerLayoutOperations) throw Error("Couldn't preserve controls.");
      return controllerLayoutOperations.saveRecovery(params);
    },
    "controllerLayouts.sealRecovery": async (params: import("../contracts").MethodMap["controllerLayouts.sealRecovery"]["params"]) => {
      if (!controllerLayoutOperations) throw Error("Couldn't preserve the native export.");
      return controllerLayoutOperations.sealRecovery(params);
    },
    "controllerLayouts.readRecovery": async ({ id }: { id: string }) => {
      if (!controllerLayoutOperations) throw Error("Couldn't read preserved controls.");
      return controllerLayoutOperations.readRecovery(id);
    },
    "controllerLayouts.prepareRecovery": async ({ id }: { id: string }) => {
      if (!controllerLayoutOperations) throw Error("Couldn't deliver preserved controls.");
      return controllerLayoutOperations.prepareRecovery(id);
    },
    "controllerLayouts.resumeRestore": async ({ id, nativeOwner }: { id: string; nativeOwner: string }) => {
      if (!controllerLayoutOperations) throw Error("Couldn't restore controls.");
      return controllerLayoutOperations.resumeRestore(id, nativeOwner);
    },
    "controllerLayouts.beginOperation": async (params: import("../contracts").MethodMap["controllerLayouts.beginOperation"]["params"]) => {
      if (!controllerLayoutsSourceEnabled(store.settings) || !controllerLayoutOperations) throw Error("Couldn't apply layouts while the source is off.");
      return controllerLayoutOperations.begin(params);
    },
    "controllerLayouts.releaseOperation": async ({ id, nativeOwner }: { id: string; nativeOwner: string }) => {
      if (!controllerLayoutOperations) throw Error("Couldn't release native controller work.");
      return controllerLayoutOperations.release(id, nativeOwner);
    },
    "controllerLayouts.operationStatus": async (_params: Record<string, never>) => controllerLayoutOperations?.current() ?? null,
    "controllerLayouts.advanceOperation": async (params: import("../contracts").MethodMap["controllerLayouts.advanceOperation"]["params"]) => {
      if (!controllerLayoutOperations) throw Error("Couldn't find this controller operation.");
      if (params.phase === "applying" && !controllerLayoutsSourceEnabled(store.settings)) throw Error("Couldn't apply layouts while the source is off.");
      return controllerLayoutOperations.advance(params);
    },
    "controllerLayouts.preparePreview": async (params: {
      layoutId: string;
      revision: number;
      accountId: number;
    }) => {
      if (!controllerLayoutsSourceEnabled(store.settings) || !controllerLayoutPreviews)
        throw Error("Couldn't preview layouts while the source is off.");
      return controllerLayoutPreviews.start(params);
    },
    "controllerLayouts.previewStatus": async ({ jobId }: { jobId: string }) =>
      controllerLayoutPreviews?.status(jobId) ?? {
        state: "error" as const,
        message: "Couldn't find this preview.",
      },
    "controllerLayouts.catalogue": async (): Promise<ControllerLayoutCatalogue> =>
      controllerLayoutsSourceEnabled(store.settings)
        ? controllerLayouts.read()
        : { state: "disabled" },
  } satisfies Partial<HandlerTable>;
}
