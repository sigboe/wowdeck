import * as api from "./services/backend";
import { pluginToast, toastError } from "./toast";
import { settingsStore } from "./settings";
import { createAddonSession } from "./addonSession";

/** The one addon session (addonSession.ts), wired to the engine. */
export const addonSession = createAddonSession({
  rpc: api.rpc,
  toast: pluginToast,
  toastError,
  autoUpdateOn: () => settingsStore.get().settings.autoUpdate,
});
