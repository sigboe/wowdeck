import { useSyncExternalStore } from "react";
import { settingsStore } from "./settings";
import type { SettingsState } from "./settingsStore";
import { controllerLayoutsSourceEnabled } from "../backend/src/wow/controllerLayouts/source";

/**
 * Whether the Controller layouts source is on (Options › Sources), for the
 * Controller layouts destination and anything that asks for its catalogue.
 * Off until the engine's settings arrive: a player who opted out never sees
 * the destination appear and vanish.
 */
export function controllerLayoutsSourceOn(state: SettingsState): boolean {
  return state.loaded && controllerLayoutsSourceEnabled(state.settings);
}

/** `controllerLayoutsSourceOn` for a component, re-rendering when it changes. */
export function useControllerLayoutsSourceOn(): boolean {
  return controllerLayoutsSourceOn(
    useSyncExternalStore(settingsStore.subscribe, settingsStore.get),
  );
}
