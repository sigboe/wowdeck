import { engine } from "./engineLink";
import { pluginToast } from "./toast";
import { createSettingsStore, type SettingsState } from "./settingsStore";

/** The one settings store (settingsStore.ts), wired to the engine. */
export const settingsStore = createSettingsStore({
  get: async () => (await engine.rpc("settings.get")).settings,
  set: async (patch) => (await engine.rpc("settings.set", { settings: patch })).settings,
  toast: pluginToast,
});

/**
 * Options' "Play starts WoW" (#286), read as off until the
 * engine's settings arrive: Steam's Play button and the launch reads wait
 * for the player's real choice.
 */
export const steamLaunchMenuOn = ({ settings, loaded }: SettingsState): boolean =>
  loaded && settings.steamLaunchMenu;
