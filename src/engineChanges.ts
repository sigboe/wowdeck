import { useSyncExternalStore } from "react";
import { engine } from "./engineLink";
import { createStore } from "./store";

/** The engine's change events a view can follow without a store of its own. */
export type ChangeEvent = "addons.changed" | "tradeskillmaster.changed";

/**
 * How many of each change event have arrived since plugin load. A view that
 * shows engine data no store keeps reloads when its count moves, instead of
 * subscribing to engine events itself.
 */
export const engineChanges = createStore<Record<ChangeEvent, number>>({
  "addons.changed": 0,
  "tradeskillmaster.changed": 0,
});

const count = (event: ChangeEvent) => () =>
  engineChanges.patch({ [event]: engineChanges.get()[event] + 1 });
engine.events.on("addons.changed", count("addons.changed"));
engine.events.on("tradeskillmaster.changed", count("tradeskillmaster.changed"));

/** The count of `event`, for a view's effect dependencies. */
export function useEngineChange(event: ChangeEvent): number {
  return useSyncExternalStore(engineChanges.subscribe, () => engineChanges.get()[event]);
}
