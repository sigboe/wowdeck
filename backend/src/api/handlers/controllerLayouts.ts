/** RPC handlers: the Controller layouts destination's catalogue. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { ControllerLayoutCatalogueSource } from "../../wow/controllerLayouts/ControllerLayoutCatalogue";

/** What the Controller layouts handlers use. */
export interface ControllerLayoutsDeps {
  controllerLayouts: Pick<ControllerLayoutCatalogueSource, "read">;
}

export function controllerLayoutsHandlers({ controllerLayouts }: ControllerLayoutsDeps) {
  return {
    "controllerLayouts.catalogue": async () => controllerLayouts.read(),
  } satisfies Partial<HandlerTable>;
}
