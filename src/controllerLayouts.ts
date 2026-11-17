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

/**
 * Steam's controller-type declarations this client can name for a player.
 * A type missing here is left off the row rather than shown as Steam's
 * internal word (copy rule C05).
 */
const CONTROLLER_TYPES: Record<string, string> = {
  controller_neptune: "Steam Deck",
  controller_triton: "Steam Controller",
  controller_steamcontroller_gordon: "Steam Controller (2015)",
  controller_ps4: "DualShock 4",
  controller_ps5: "DualSense",
  controller_xboxone: "Xbox controller",
  controller_xbox360: "Xbox 360 controller",
  controller_switch_pro: "Switch Pro Controller",
};

/** What one layout row shows. */
export interface LayoutRow {
  title: string;
  /** Short facts for the line under the title: author, controller type. */
  facts: string[];
  description?: string;
  /** Why the layout isn't offered (withdrawn, needs a newer client); null when it is. */
  note: string | null;
  /** Not offered: shown the way Steam shows a row that is switched off (S23). */
  inactive: boolean;
}

export function layoutRow(layout: ControllerLayout): LayoutRow {
  const controller = CONTROLLER_TYPES[layout.controllerType];
  return {
    title: layout.title,
    facts: [`by ${layout.author}`, ...(controller ? [controller] : [])],
    description: layout.description,
    note:
      layout.offer === "withdrawn"
        ? "Withdrawn by the WoWDeck maintainers"
        : layout.offer === "unsupported"
          ? "Needs a newer WoWDeck"
          : null,
    inactive: layout.offer !== "available",
  };
}

export const controllerLayoutsModule = createControllerLayoutsModule({
  rpc: engine.rpc,
  clock: systemClock,
});

/**
 * The catalogue's view for a component; `refresh` is Retry and `loading`
 * says one is running. Nothing is read while the Controller layouts source
 * is off (`sourceOn`, from useControllerLayoutsSourceOn): the resource is
 * then viewed with no key.
 */
export function useControllerLayoutCatalogue(sourceOn: boolean): {
  view: CatalogueView;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { refresh, ...snapshot } = useResource(
    controllerLayoutsModule.catalogue,
    sourceOn ? KEY : null,
  );
  return { view: catalogueView(snapshot), loading: snapshot.loading, refresh };
}
