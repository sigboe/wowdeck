import type { ControllerLayout, ControllerLayoutCatalogue } from "../backend/src/api/contracts";
import { systemClock, type Clock } from "./clock";
import { engine } from "./engineLink";
import { backendErrorMessage } from "./errors";
import { createKeyedResource, type ResourceSnapshot } from "./keyedResource";
import type { Rpc } from "./services/envelope";
import { useResource } from "./useResource";

/**
 * The Controller layouts catalogue (GLOSSARY: Controller layout) as a
 * keyed resource with one key: read when a view first asks and on Retry,
 * never polled. Whether a view asks at all is the source toggle's to decide
 * (#265); nothing here reads on import.
 */
const KEY = "catalogue";

export function createControllerLayoutsModule(deps: { rpc: Rpc; clock: Clock }) {
  const catalogue = createKeyedResource<ControllerLayoutCatalogue>({
    read: () => deps.rpc("controllerLayouts.catalogue", {}),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't load controller layouts";
    },
    clock: deps.clock,
  });
  return { KEY, catalogue };
}

/**
 * What the destination shows, one state each: a failed request, content
 * that isn't a catalogue and a catalogue newer than this client never read
 * as an empty one.
 */
export type CatalogueView =
  | { kind: "loading" }
  | { kind: "ready"; layouts: ControllerLayout[] }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "malformed" }
  | { kind: "unsupported" }
  /** The engine call itself failed. */
  | { kind: "error"; message: string };

export function catalogueView(
  snapshot: ResourceSnapshot<ControllerLayoutCatalogue>,
): CatalogueView {
  const { data, error } = snapshot;
  if (data === null)
    return error === null ? { kind: "loading" } : { kind: "error", message: error };
  switch (data.state) {
    case "ready":
      return data.layouts.length > 0 ? { kind: "ready", layouts: data.layouts } : { kind: "empty" };
    case "unavailable":
    case "malformed":
    case "unsupported":
      return { kind: data.state };
  }
}

export const controllerLayoutsModule = createControllerLayoutsModule({
  rpc: engine.rpc,
  clock: systemClock,
});

/** The catalogue's view for a component; `refresh` is Retry. */
export function useControllerLayoutCatalogue(): {
  view: CatalogueView;
  refresh: () => Promise<void>;
} {
  const { refresh, ...snapshot } = useResource(controllerLayoutsModule.catalogue, KEY);
  return { view: catalogueView(snapshot), refresh };
}
