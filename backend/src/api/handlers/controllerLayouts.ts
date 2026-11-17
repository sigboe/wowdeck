/** RPC handlers: the Controller layouts destination's catalogue. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { ControllerLayoutCatalogue } from "../contracts";
import type { ControllerLayoutCatalogueSource } from "../../wow/controllerLayouts/ControllerLayoutCatalogue";
import { controllerLayoutsSourceEnabled } from "../../wow/controllerLayouts/source";
import type { StateStore } from "../../wow/storage/StateStore";

/** What the Controller layouts handlers use. */
export interface ControllerLayoutsDeps {
  controllerLayouts: Pick<ControllerLayoutCatalogueSource, "read">;
  /** Read live: the source toggle is checked on every call. */
  store: Pick<StateStore, "settings">;
}

export function controllerLayoutsHandlers({ controllerLayouts, store }: ControllerLayoutsDeps) {
  return {
    "controllerLayouts.catalogue": async (): Promise<ControllerLayoutCatalogue> =>
      controllerLayoutsSourceEnabled(store.settings) ? controllerLayouts.read() : { state: "disabled" },
  } satisfies Partial<HandlerTable>;
}
