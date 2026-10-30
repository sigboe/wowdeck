import * as api from "./services/backend";
import { pluginToast, toastError } from "./toast";
import { requestPluginUpdate } from "./pluginUpdate";
import { createSelfUpdateStore } from "./selfUpdateStore";

/** The one self-update store (selfUpdateStore.ts), wired to the engine. */
export const selfUpdateStore = createSelfUpdateStore({
  rpc: api.rpc,
  toast: pluginToast,
  toastError,
  requestUpdate: requestPluginUpdate,
});
