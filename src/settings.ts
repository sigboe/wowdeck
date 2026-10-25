import * as api from "./services/backend";
import { pluginToast } from "./toast";
import { createSettingsStore } from "./settingsStore";

/** The one settings store (settingsStore.ts), wired to the engine. */
export const settingsStore = createSettingsStore({
  get: async () => (await api.rpc("settings.get")).settings,
  set: async (patch) => (await api.rpc("settings.set", { settings: patch })).settings,
  toast: pluginToast,
});
