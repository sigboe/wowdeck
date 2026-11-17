/** RPC handlers: the Controller layouts destination's catalogue. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { ControllerLayoutCatalogue } from "../contracts";
import type { ControllerLayoutCatalogueSource } from "../../wow/controllerLayouts/ControllerLayoutCatalogue";
import { controllerLayoutsSourceEnabled } from "../../wow/controllerLayouts/source";
import type { StateStore } from "../../wow/storage/StateStore";

/** What the Controller layouts handlers use. */
export interface ControllerLayoutsDeps {
  controllerLayoutPreviews?: import("../../wow/controllerLayouts/ControllerLayoutPreviews").ControllerLayoutPreviews;
  controllerLayouts: Pick<ControllerLayoutCatalogueSource, "read">;
  /** Read live: the source toggle is checked on every call. */
  store: Pick<StateStore, "settings">;
}

export function controllerLayoutsHandlers({
  controllerLayouts,
  controllerLayoutPreviews,
  store,
}: ControllerLayoutsDeps) {
  return {
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
