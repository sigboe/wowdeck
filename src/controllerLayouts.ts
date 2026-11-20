import type { ControllerLayout, ControllerLayoutCatalogue } from "../backend/src/api/contracts";
import { systemClock, type Clock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource, type ResourceSnapshot } from "./keyedResource";
import type { Rpc } from "./services/envelope";
import { useResource } from "./useResource";

/**
 * The Controller layouts catalogue (GLOSSARY: Controller layout) as a
 * keyed resource with one key: read when a view first asks and on Retry,
 * never polled. A view asks only while the source is on (see
 * `controllerLayoutsEnabled` in the contract for what Off stops); nothing
 * here reads on import.
 */
const KEY = "catalogue";

export function createControllerLayoutsModule(deps: { rpc: Rpc; clock: Clock }) {
  const catalogue = createKeyedResource<ControllerLayoutCatalogue>({
    read: () => deps.rpc("controllerLayouts.catalogue", {}),
    errorText: () => "Couldn't load controller layouts.",
    clock: deps.clock,
  });
  return { KEY, catalogue };
}

/**
 * What the destination shows, with each state's copy decided here: a failed
 * request, content that isn't a catalogue and a catalogue newer than this
 * client never read as an empty one.
 */
export type CatalogueView =
  | { kind: "loading" }
  | { kind: "ready"; layouts: ControllerLayout[] }
  /** Nothing to list: a focusable row naming why. */
  | { kind: "notice"; label: string; text?: string }
  /** Reading failed: a Retry row with what went wrong. */
  | { kind: "retry"; message: string }
  /** The source is off: the pane shows nothing. */
  | { kind: "off" };

export function catalogueView(
  snapshot: ResourceSnapshot<ControllerLayoutCatalogue>,
): CatalogueView {
  const { data, error } = snapshot;
  if (data === null)
    return error === null ? { kind: "loading" } : { kind: "retry", message: error };
  switch (data.state) {
    case "ready":
      return data.layouts.length > 0
        ? { kind: "ready", layouts: data.layouts }
        : { kind: "notice", label: "No controller layouts yet" };
    case "unavailable":
      return { kind: "retry", message: "Couldn't load controller layouts. Try again later." };
    case "malformed":
      return { kind: "retry", message: "Couldn't read the controller layouts list." };
    case "unsupported":
      return { kind: "notice", label: "Update WoWDeck", text: "This list needs a newer WoWDeck." };
    case "disabled":
      return { kind: "off" };
  }
}

/**
 * Steam's controller-type declarations this client can name for a player.
 * A type missing here is shown as the catalogue gives it (spec #260: show
 * the original controller type) rather than hidden.
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

/** A controller type's name; an own key only, since the type is catalogue data. */
function controllerName(type: string): string {
  return Object.prototype.hasOwnProperty.call(CONTROLLER_TYPES, type)
    ? CONTROLLER_TYPES[type]!
    : type;
}

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
  return {
    title: layout.title,
    facts: [`by ${layout.author}`, controllerName(layout.controllerType)],
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
 * says one is running. While the source is off (`sourceOn`, from
 * useControllerLayoutsSourceOn) the resource is viewed with no key.
 */
export function useControllerLayoutCatalogue(sourceOn: boolean): {
  /** What the pane shows. */
  shown: CatalogueView;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { refresh, ...snapshot } = useResource(
    controllerLayoutsModule.catalogue,
    sourceOn ? KEY : null,
  );
  return { shown: catalogueView(snapshot), loading: snapshot.loading, refresh };
}
